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

const { forceNormalize, parseLine, EMOJI_REG } = require('./parser');

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
