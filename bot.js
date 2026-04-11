require('dotenv').config();
const { Telegraf } = require('telegraf');
const WordleSolver = require('./solver');

const bot = new Telegraf(process.env.BOT_TOKEN);
const sessions = new Map();

function getSolver(chatId) {
    if (!sessions.has(chatId)) {
        sessions.set(chatId, {
            solver: new WordleSolver(),
            lastSuggestions: []
        });
    }
    return sessions.get(chatId);
}

/**
 * Robustly normalize styled text to plain ASCII.
 * Handles Mathematical Alphanumeric Symbols manually since NFKD might fail without ICU.
 */
function forceNormalize(text) {
    const STYLED_RANGES = [
        [0x1D400, 65], // Serif Bold A-Z
        [0x1D41A, 97], // Serif Bold a-z
        [0x1D434, 65], // Serif Italic A-Z
        [0x1D44E, 97], // Serif Italic a-z
        [0x1D468, 65], // Serif Bold Italic A-Z
        [0x1D482, 97], // Serif Bold Italic a-z
        [0x1D5A0, 65], // Sans-Serif A-Z
        [0x1D5BA, 97], // Sans-Serif a-z
        [0x1D5D4, 65], // Sans-Serif Bold A-Z (WORDSEEK)
        [0x1D5EE, 97], // Sans-Serif Bold a-z
        [0x1D608, 65], // Sans-Serif Italic A-Z
        [0x1D622, 97], // Sans-Serif Italic a-z
        [0x1D63C, 65], // Sans-Serif Bold Italic A-Z
        [0x1D656, 97], // Sans-Serif Bold Italic a-z
        [0x1D670, 65], // Monospace A-Z
        [0x1D68A, 97], // Monospace a-z
    ];

    let result = "";
    // Using for...of correctly iterates over Unicode code points (handles surrogate pairs)
    for (const char of text) {
        const code = char.codePointAt(0);

        let mapped = false;
        for (const [start, asciiStart] of STYLED_RANGES) {
            if (code >= start && code < start + 26) {
                result += String.fromCharCode(code - start + asciiStart);
                mapped = true;
                break;
            }
        }

        if (!mapped) {
            // Fallback to standard normalization
            const norm = char.normalize('NFKD');
            result += norm.replace(/[^\x00-\x7F]/g, '');
        }
    }
    // Final cleanup to only keep A-Z
    return result.replace(/[^a-zA-Z]/g, '');
}

const EMOJI_REG = /[🟩🟨🟥⬛⬜🟫🟦🟧]/gu;
const EMOJI_MAP = {
    '🟩': 'G', '🟨': 'Y', '🟥': 'R', '⬛': 'R', '⬜': 'R', '🟫': 'R', '🟦': 'R', '🟧': 'R'
};

function parseLine(line, lastSuggestion) {
    // MUST use 'u' flag to avoid matching surrogate units separately
    const emojis = line.match(EMOJI_REG);
    if (!emojis || emojis.length < 4 || emojis.length > 6) {
        return { error: `Emoji count mismatch: ${emojis ? emojis.length : 0}` };
    }

    const result = emojis.map(e => EMOJI_MAP[e] || 'R').join('');

    // Remove emojis to find the word
    const lineWithoutEmojis = line.replace(EMOJI_REG, '');
    const normalizedLine = forceNormalize(lineWithoutEmojis);

    if (normalizedLine.length === result.length) {
        return { success: true, word: normalizedLine.toLowerCase(), result };
    }

    if (normalizedLine.length > result.length) {
        const endWord = normalizedLine.slice(-result.length);
        return { success: true, word: endWord.toLowerCase(), result };
    }

    if (lastSuggestion && lastSuggestion.length === result.length) {
        return { success: true, word: lastSuggestion.toLowerCase(), result };
    }

    return { error: `Word not found. Normalized: "${normalizedLine}"` };
}

bot.start((ctx) => {
    ctx.reply(`🎯 Welcome to Wordle Solver Bot!\n\nSend me your guesses in any of these formats:\n• 🟨 🟩 🟥 🟥 🟨 **LAMAR**\n• 🟨 🟩 🟥 🟥 🟨 𝗟𝗔𝗠𝗔𝗥\n• GUESS 🟥🟨🟩🟥🟥\n\nCommands:\n• /reset - Clear session\n• /other - More suggestions`);
});

bot.command('reset', (ctx) => {
    sessions.delete(ctx.chat.id);
    ctx.reply('🔄 Use /reset to start a new game!');
});

bot.command('other', (ctx) => {
    const session = getSolver(ctx.chat.id);
    const suggestions = session.solver.getSuggestions(20);
    if (suggestions.length <= 1) return ctx.reply('No other suggestions found.');
    ctx.reply(`🔍 Other possibilities: ${suggestions.slice(1).join(', ')}`);
});

bot.on('text', async (ctx) => {
    const text = ctx.message.text;
    if (text.startsWith('/')) return;

    const lines = text.split('\n');
    const session = getSolver(ctx.chat.id);
    const solver = session.solver;

    let processedLines = 0;
    let errors = [];

    for (const line of lines) {
        if (!line.trim()) continue;

        // Auto-detect length
        const lengthMatch = line.match(/(\d)-letter/i);
        if (lengthMatch && solver.length === 0) {
            const detectedLength = parseInt(lengthMatch[1]);
            if (detectedLength >= 4 && detectedLength <= 6) {
                solver.loadWords(detectedLength);
            }
        }

        const parsed = parseLine(line, session.lastSuggestions[0]);
        if (parsed.success) {
            if (solver.length === 0) {
                if (!solver.loadWords(parsed.word.length)) {
                    errors.push(`Line "${line.trim().slice(0, 10)}...": list missing`);
                    continue;
                }
            } else if (parsed.word.length !== solver.length) {
                continue;
            }

            if (solver.filter(parsed.word, parsed.result)) {
                processedLines++;
            }
        } else if (line.match(EMOJI_REG)) {
            // Only add to errors if the line actually looks like a result
            errors.push(`Line "${line.trim().slice(0, 15)}...": ${parsed.error}`);
        }
    }

    if (processedLines === 0) {
        if (text.length > 5) {
            let msg = "🔍 I couldn't find any valid results.";
            if (errors.length > 0) {
                msg += "\n\n**Details:**\n" + errors.slice(0, 5).join('\n');
            }
            ctx.reply(msg, { parse_mode: 'Markdown' }).catch(err => {
                // If markdown fails (e.g. bad chars), send plain text
                ctx.reply(msg.replace(/\*/g, ''));
            });
        }
        return;
    }

    const suggestions = solver.getSuggestions(10);
    session.lastSuggestions = suggestions;

    if (suggestions.length === 1 && solver.possibleWords.length === 1) {
        return ctx.reply(`📝 Processed ${processedLines} guesses\n🎉 Found it! The word is: **${suggestions[0]}**\n\n🔄 Use /reset for new game!`, { parse_mode: 'Markdown' });
    }

    const remaining = solver.possibleWords.length;
    if (remaining === 0) {
        return ctx.reply('❌ No matching words. /reset?');
    }

    let response = `📝 Processed ${processedLines} guesses\n`;
    response += `💡 Best guess: \`${suggestions[0]}\`\n`;
    response += `📊 ${remaining} words remaining\n`;
    if (suggestions.length > 1) {
        response += `🔍 Others: ${suggestions.slice(1, 4).join(', ')}`;
    }

    ctx.reply(response, { parse_mode: 'Markdown' });
});

bot.launch().catch(err => console.error('Bot launch error:', err));

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
