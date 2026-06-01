require('dotenv').config();
const { TelegramClient } = require('telegram');
const { StringSession } = require('telegram/sessions');
const { NewMessage } = require('telegram/events');
const WordleSolver = require('./solver');

const { forceNormalize, parseLine } = require('./parser');

const apiId = parseInt(process.env.API_ID);
const apiHash = process.env.API_HASH;
const botToken = process.env.BOT_TOKEN;

const session = new StringSession(''); // empty for bots, or load saved session
const client = new TelegramClient(session, apiId, apiHash, {});

async function startBot() {
  await client.start({
    botAuthToken: botToken,
  });
  console.log('Bot started with MTProto (GramJS)');

  client.addEventHandler(async (event) => {
    const message = event.message;
    if (!message || !message.message) return;

    const text = message.message;
    if (text.startsWith('/')) {
      if (text === '/start') {
        await message.reply({
          message: `🎯 Welcome to Wordle Solver Bot!\n\nSend me your full Wordle board, and I'll give you the best next guess.\n\nFormats:\n• 🟨 🟩 🟥 🟥 🟨 **WORD**\n• Standard Wordle board sharing\n\n/reset`
        });
      } else if (text === '/reset') {
        await message.reply({ message: '🔄 Bot is stateless. Just send a new board to start over!\n\n/reset' });
      }
      return;
    }

    const lines = text.split('\n');
    const solver = new WordleSolver();
    let processedLines = 0;

    for (const line of lines) {
      if (!line.trim()) continue;

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
      return;
    }

    const suggestions = solver.getSuggestions(10);

    if (suggestions.length === 1 && solver.possibleWords.length === 1) {
      await message.reply({
        message: `📝 Processed ${processedLines} guesses\n🎉 Found it! The word is: **${suggestions[0]}**\n\n🔄 Send a new board for a new game!\n\n/reset`,
        parseMode: 'md'
      });
      return;
    }

    const remaining = solver.possibleWords.length;
    if (remaining === 0) {
      await message.reply({ message: '❌ No matching words. Check your emojis or word spelling!\n\n/reset' });
      return;
    }

    let response = `📝 Processed ${processedLines} guesses\n`;
    response += `💡 Best guess: \`${suggestions[0]}\`\n`;
    response += `📊 ${remaining} words remaining\n`;
    if (suggestions.length > 1) {
      response += `🔍 Others: ${suggestions.slice(1, 4).join(', ')}`;
    }
    response += `\n\n/reset`;

    await message.reply({ message: response, parseMode: 'md' });
  }, new NewMessage({}));
}

startBot().catch(err => console.error('Bot error:', err));

process.once('SIGINT', () => client.disconnect());
process.once('SIGTERM', () => client.disconnect());
