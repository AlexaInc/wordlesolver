require('dotenv').config();
const { Telegraf } = require('telegraf');
const WordleSolver = require('./solver');

const bot = new Telegraf(process.env.BOT_TOKEN);

const { forceNormalize, parseLine } = require('./parser');

bot.start((ctx) => {
    ctx.reply(`🎯 Welcome to Wordle Solver Bot!\n\nSend me your full Wordle board, and I'll give you the best next guess.\n\nFormats:\n• 🟨 🟩 🟥 🟥 🟨 **WORD**\n• Standard Wordle board sharing\n\n/reset`);
});

bot.command('reset', (ctx) => {
    ctx.reply('🔄 Bot is stateless. Just send a new board to start over!\n\n/reset');
});

bot.on('text', async (ctx) => {
    const text = ctx.message.text;
    if (text.startsWith('/')) return;

    const lines = text.split('\n');
    const solver = new WordleSolver();
    let processedLines = 0;

    // Process all lines to build the current game state
    for (const line of lines) {
        if (!line.trim()) continue;

        // Auto-detect length or letter count
        const lengthMatch = line.match(/(\d)-letter/i);
        if (lengthMatch && solver.length === 0) {
            const detectedLength = parseInt(lengthMatch[1]);
            if (detectedLength >= 4 && detectedLength <= 6) {
                solver.loadWords(detectedLength);
            }
        }

        const parsed = parseLine(line);
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

    if (processedLines === 0) {
        return; // Do not respond for non-guess messages
    }

    const suggestions = solver.getSuggestions(10);

    if (suggestions.length === 1 && solver.possibleWords.length === 1) {
        return ctx.reply(`📝 Processed ${processedLines} guesses\n🎉 Found it! The word is: **${suggestions[0]}**\n\n🔄 Send a new board for a new game!\n\n/reset`, { parse_mode: 'Markdown' });
    }

    const remaining = solver.possibleWords.length;
    if (remaining === 0) {
        return ctx.reply('❌ No matching words. Check your emojis or word spelling!\n\n/reset');
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
