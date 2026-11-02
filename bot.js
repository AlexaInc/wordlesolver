/**
 * Telegram bot transport: MTProto via teleproto (the maintained GramJS fork).
 *
 * Why not gramjs: it is archived on TL layer 198, i.e. *before* rich messages
 * (layer 228) - Telegram therefore stripped WordSeek's pill buttons before
 * they ever reached the bot and forwarded boards looked empty (silent bot).
 * teleproto ships layer 232 with full RichMessage support, so forwarded
 * WordSeek boards arrive with message.richMessage intact - exact states from
 * the wh:{state}:{letter} callback data - pushed over MTProto, no polling
 * latency.
 *
 * Input chain per message: rich pills -> screenshot photo -> legacy text.
 */

require('dotenv').config();
const { TelegramClient } = require('teleproto');
const { StringSession } = require('teleproto/sessions');
const { NewMessage } = require('teleproto/events');
const WordleSolver = require('./solver');

const { parseLine, parseRichMessage, parseImageBuffer } = require('./parser');

const apiId = parseInt(process.env.API_ID);
const apiHash = process.env.API_HASH;
const botToken = process.env.BOT_TOKEN;

let client = null;
const debugArmed = new Set();

function diagnose(message) {
  const text = message.message || message.text || message.caption || '';
  const rich = message.richMessage || message.rich_message;
  const info = {
    forward: message.forwardOrigin || message.fwdFrom ? 'yes' : null,
    has_photo: !!message.photo,
    zero_width_chars: (text.match(/[\u200B-\u200D\u2060\uFEFF]/g) || []).length,
    entities: (message.entities || []).map(e => e.className || e.type).join(',') || null,
    richMessage: rich ? 'present' : 'ABSENT',
    blocks: null,
    buttons: 0,
    callback_data: [],
    styles: [],
    text_preview: JSON.stringify(text.slice(0, 60)),
  };
  const walk = (node) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) { node.forEach(walk); return; }
    if (Array.isArray(node.buttons)) {
      for (const btn of node.buttons) {
        info.buttons++;
        const data = btn && btn.type && btn.type.data;
        if (data) info.callback_data.push(Buffer.isBuffer(data) ? data.toString('utf8') : String(data));
        const st = btn && btn.style;
        if (st) info.styles.push(st.bgSuccess ? 'success' : st.bgDanger ? 'danger' : 'primary');
      }
      return;
    }
    if (Array.isArray(node.blocks)) {
      info.blocks = (info.blocks ? info.blocks + ',' : '') +
        node.blocks.map(b => b.className || b.type).join(',');
      node.blocks.forEach(walk);
    }
  };
  if (rich) walk(rich);
  return info;
}

async function handle(message, clientArg) {
  const text = message.message || message.text || message.caption || '';
  const reply = async (body, md = true) => {
    await message.reply({ message: body, parseMode: md ? 'md' : undefined });
  };

  if (text.startsWith('/')) {
    if (text === '/debug') {
      debugArmed.add(message.chat.id);
      await reply('🔬 Debug armed: send/forward the WordSeek message again and I will show exactly what Telegram delivered to me.', false);
      return;
    }
    if (text === '/start') {
      await reply(`🎯 Welcome to Wordle Solver Bot!\n\nSend me your full Wordle board, and I'll give you the best next guess.\n\nFormats:\n• Forwarded @WordSeekBot messages (new pill buttons - read exactly)\n• 📷 A screenshot of the WordSeek pill board\n• 🟨  🟥  🟨 **WORD**\n• Standard Wordle board sharing\n\n/reset`);
    } else if (text === '/reset') {
      await reply('🔄 Bot is stateless. Just send a new board to start over!\n\n/reset');
    }
    return;
  }

  const solver = new WordleSolver();
  let processedLines = 0;
  let source = null;

  // 1) NEW WordSeek format: rich_message pill buttons (exact)
  const rich = parseRichMessage(message);
  if (rich) {
    source = 'pill buttons';
    solver.loadWords(rich[0].word.length);
    for (const row of rich) {
      if (solver.filter(row.word, row.result)) processedLines++;
    }
  }

  // 2) screenshot of the pill board
  const cl = clientArg || client;
  if (!processedLines && message.photo && cl) {
    try {
      const buf = await cl.downloadMedia(message, {});
      if (buf) {
        const rows = parseImageBuffer(buf);
        if (rows.length) {
          source = 'screenshot';
          solver.loadWords(rows[0].word.length);
          for (const row of rows) {
            if (solver.filter(row.word, row.result)) processedLines++;
          }
        }
      }
    } catch (err) {
      console.error('Media download failed:', err.message);
    }
  }

  // 3) legacy emoji / styled-text boards
  if (!processedLines && text) {
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;

      const lengthMatch = line.match(/(\d)-letter/i);
      if (lengthMatch && solver.length === 0) {
        const detectedLength = parseInt(lengthMatch[1]);
        if (detectedLength >= 4 && detectedLength <= 6) {
          solver.loadWords(detectedLength);
        }
      }

      const parsed = parseLine(line, solver.getSuggestions(1)[0]);
      if (parsed.success) {
        if (solver.length === 0) {
          if (!solver.loadWords(parsed.word.length)) continue;
        } else if (parsed.word.length !== solver.length) {
          continue;
        }
        if (solver.filter(parsed.word, parsed.result)) processedLines++;
      }
    }
    if (processedLines) source = 'text';
  }

  // 4) looks like a WordSeek board but nothing readable? diagnose loudly
  const fwd = message.forwardOrigin || message.fwdFrom;
  const looksLikeBoard = /\d-letter mode/i.test(text) ||
    (fwd && (fwd.username || '').toLowerCase && (fwd.username || '').toLowerCase() === 'wordseek');
  if (!processedLines && (looksLikeBoard || debugArmed.has(message.chat.id))) {
    debugArmed.delete(message.chat.id);
    await reply(
      '🔬 I got the message but could not read the pills. What Telegram delivered to me:\n' +
      JSON.stringify(diagnose(message), null, 1) +
      '\n\nPlease also send a *screenshot* of the board so I can solve it now ' +
      '(and send this debug text to the solver maintainer).',
      false);
    return;
  }
  debugArmed.delete(message.chat.id);

  if (processedLines === 0) return;

  const answer = solver.getAnswer();
  if (answer) {
    await reply(`📝 Read ${processedLines} guesses from the ${source}\n🎉 Found it! The word is: **${answer}**\n\n🔄 Send a new board for a new game!\n\n/reset`);
    return;
  }

  const suggestions = solver.getSuggestions(10);
  const remaining = solver.possibleWords.length;
  if (remaining === 0) {
    await reply('❌ No matching words. Check your emojis or word spelling!\n\n/reset');
    return;
  }

  let response = `📝 Read ${processedLines} guesses from the ${source}\n`;
  response += `💡 Best guess: \`${suggestions[0]}\`\n`;
  response += `📊 ${remaining} words remaining\n`;
  if (suggestions.length > 1) {
    response += `🔍 Others: ${suggestions.slice(1, 4).join(', ')}`;
  }
  response += `\n\n/reset`;
  await reply(response);
}

async function startBot() {
  client = new TelegramClient(new StringSession(''), apiId, apiHash, {});
  await client.start({ botAuthToken: botToken });
  console.log('Bot started with MTProto (teleproto, layer 232 - rich messages supported)');

  client.addEventHandler(async (event) => {
    const message = event.message;
    if (!message || (!message.message && !message.photo)) return;
    handle(message).catch(err => console.error('handler error:', err.message));
  }, new NewMessage({}));
}

if (apiId && apiHash && botToken) {
  startBot().catch(err => console.error('Bot error:', err));
} else {
  console.warn('API_ID/API_HASH/BOT_TOKEN not set - Telegram bot disabled (web UI still runs).');
}

process.once('SIGINT', () => client && client.disconnect());
process.once('SIGTERM', () => client && client.disconnect());

module.exports = { handle, diagnose };
