require('dotenv').config();
const { Telegraf } = require('telegraf');
const WordleSolver = require('./solver');

const bot = new Telegraf(process.env.BOT_TOKEN);
const sessions = new Map();

function getSolver(chatId) {
    if (!sessions.has(chatId)) {
        sessions.set(chatId, {
            solver: new WordleSolver(),
            lastSuggestions: [],
            lastGuessCount: 0
        });
    }
    return sessions.get(chatId);
}

const { forceNormalize, parseLine, EMOJI_REG } = require('./parser');

bot.start((ctx) => {
    ctx.reply(`🎯 Welcome to Wordle Solver Bot!\n\nSend me your guesses in any of these formats:\n• 🟨 🟩 🟥 🟥 🟨 **LAMAR**\n• 🟨 🟩 🟥 🟥 🟨 𝗟𝗔𝗠𝗔𝗥\n• GUESS 🟥🟨🟩🟥🟥\n\nCommands:\n• /reset - Clear session\n• /other - More suggestions\n\n/reset`);
});

bot.command('reset', (ctx) => {
    sessions.delete(ctx.chat.id);
    ctx.reply('🔄 Use /reset to start a new game!\n\n/reset');
});

bot.command('other', (ctx) => {
    const session = getSolver(ctx.chat.id);
    const suggestions = session.solver.getSuggestions(20);
    if (suggestions.length <= 1) return ctx.reply('No other suggestions found.\n\n/reset');
    ctx.reply(`🔍 Other possibilities: ${suggestions.slice(1).join(', ')}\n\n/reset`);
});

bot.on('text', async (ctx) => {
    const text = ctx.message.text;
    if (text.startsWith('/')) return;

    const lines = text.split('\n');
    const session = getSolver(ctx.chat.id);

    // Auto-detect current message guesses and length
    let currentValidGuesses = 0;
    let currentWordLength = 0;

    for (const line of lines) {
        if (!line.trim()) continue;
        const parsed = parseLine(line, session.lastSuggestions[0]);
        if (parsed.success) {
            currentValidGuesses++;
            if (currentWordLength === 0) currentWordLength = parsed.word.length;
        }
    }

    // Auto-reset logic
    let shouldReset = false;
    if (currentValidGuesses > 0) {
        // Reset if length changed
        if (session.solver.length > 0 && currentWordLength !== session.solver.length) {
            shouldReset = true;
        }
        // Reset if last msg had more and this has fewer (new game started)
        else if (session.lastGuessCount > 0 && currentValidGuesses < session.lastGuessCount) {
            shouldReset = true;
        }
    }

    if (shouldReset) {
        session.solver = new WordleSolver();
        session.lastSuggestions = [];
        session.lastGuessCount = 0;
    }

    const solver = session.solver;
    let processedLines = 0;

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
                    continue;
                }
            } else if (parsed.word.length !== solver.length) {
                continue;
            }

            if (solver.filter(parsed.word, parsed.result)) {
                processedLines++;
            }
        }
    }

    if (currentValidGuesses > 0) {
        session.lastGuessCount = currentValidGuesses;
    }

    if (processedLines === 0) {
        return; // Do not respond for other messages
    }

    const suggestions = solver.getSuggestions(10);
    session.lastSuggestions = suggestions;

    if (suggestions.length === 1 && solver.possibleWords.length === 1) {
        return ctx.reply(`📝 Processed ${processedLines} guesses\n🎉 Found it! The word is: **${suggestions[0]}**\n\n🔄 Use /reset for new game!\n\n/reset`, { parse_mode: 'Markdown' });
    }

    const remaining = solver.possibleWords.length;
    if (remaining === 0) {
        return ctx.reply('❌ No matching words. /reset?\n\n/reset');
    }

    let response = `📝 Processed ${processedLines} guesses\n`;
    response += `💡 Best guess: \`${suggestions[0]}\`\n`;
    response += `📊 ${remaining} words remaining\n`;
    if (suggestions.length > 1) {
        response += `🔍 Others: ${suggestions.slice(1, 4).join(', ')}`;
    }
    response += `\n\n/reset`;

    ctx.reply(response, { parse_mode: 'Markdown' });
});

bot.launch().catch(err => console.error('Bot launch error:', err));

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
