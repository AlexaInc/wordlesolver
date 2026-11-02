/**
 * Self-checks:  node test.js
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const WordleSolver = require('./solver');
const { parseLine, parseRichMessage, parseRichBlocks, parseImageBuffer } = require('./parser');

let n = 0;
function ok(name, fn) { fn(); n++; console.log('ok  ' + name); }

const BOARD = [
  { word: 'HOME', result: 'RRRR' }, { word: 'EARL', result: 'RRRR' },
  { word: 'MADE', result: 'RRRR' }, { word: 'LUST', result: 'RRRR' },
  { word: 'KNIT', result: 'YRYR' }, { word: 'INKY', result: 'YRYR' },
  { word: 'HATE', result: 'RRRR' }, { word: 'KILL', result: 'YGRR' },
  { word: 'KIND', result: 'YGRR' }, { word: 'LIFE', result: 'RGRR' },
  { word: 'WINK', result: 'RGRG' }, { word: 'FINK', result: 'RGRG' },
];

ok('legacy emoji parse', () => {
  const p = parseLine('\u{1F7E8}\u{1F7E9}\u{1F7E5}\u{1F7E5} KNOT');
  assert(p.success && p.word === 'knot' && p.result === 'YGRR');
});

ok('rich pill buttons parse', () => {
  const letters = [['K', 'present'], ['N', 'absent'], ['I', 'present'], ['T', 'absent']];
  const text = 'KNIT';
  const entities = letters.map(([ch, st], i) => ({
    offset: i, length: 1,
    data: Buffer.from(`wh:${st}:${ch}`, 'utf8'),
  }));
  const rows = parseRichMessage({ message: text, entities });
  assert.deepStrictEqual(rows, [{ word: 'KNIT', result: 'YRYR' }]);
});

ok('screenshot parse -> unique answer PICK', () => {
  const buf = fs.readFileSync(path.join(__dirname, 'examples', 'sample-board.png'));
  const rows = parseImageBuffer(buf);
  assert.strictEqual(rows.length, 12, 'expected 12 rows, got ' + rows.length);
  assert.deepStrictEqual(rows, BOARD);
  const solver = new WordleSolver();
  solver.loadWords(4);
  for (const r of rows) assert(solver.filter(r.word, r.result));
  assert.strictEqual(solver.getAnswer(), 'PICK');
});

ok('solver evaluate + duplicates', () => {
  const s = new WordleSolver();
  s.loadWords(4);
  assert.strictEqual(s.getWordleResult('knit', 'pick'), 'YRYR');
  assert.strictEqual(s.getWordleResult('llam', 'ally'), 'YGYR');
  assert.strictEqual(s.getWordleResult('llam', 'lion'), 'GRRR');
});

ok('suggestions are valid guesses', () => {
  const s = new WordleSolver();
  s.loadWords(4);
  BOARD.slice(0, 4).forEach(r => s.filter(r.word, r.result));
  const sug = s.getSuggestions(5);
  assert(sug.length === 5 && sug.every(w => w.length === 4));
});


ok('bot-api rich_message blocks parse', () => {
  const msg = {
    text: '4-letter mode\n2/30 guesses\nKNIT\nINKY',
    rich_message: {
      blocks: [
        { type: 'heading', text: { type: 'plain', text: '4-letter mode' }, size: 3 },
        { type: 'buttons', buttons: [
          { text: { type: 'plain', text: 'K' }, style: 'primary', callback_data: 'wh:present:K' },
          { text: { type: 'plain', text: 'N' }, style: 'danger', callback_data: 'wh:absent:N' },
          { text: { type: 'plain', text: 'I' }, style: 'primary', callback_data: 'wh:present:I' },
          { text: { type: 'plain', text: 'T' }, style: 'danger', callback_data: 'wh:absent:T' },
        ] },
        { type: 'buttons', buttons: [
          { text: { type: 'concat', texts: [{ type: 'plain', text: 'I' }] }, style: 'primary' },
          { text: { type: 'plain', text: 'N' }, style: 'danger' },
          { text: { type: 'plain', text: 'K' }, style: 'success' },
          { text: { type: 'plain', text: 'Y' }, style: 'danger' },
        ] },
      ],
    },
  };
  const rows = parseRichMessage(msg);
  assert.deepStrictEqual(rows, [
    { word: 'KNIT', result: 'YRYR' },
    { word: 'INKY', result: 'YRGR' },
  ]);
});


ok('teleproto TL round-trip of pill buttons', () => {
  const { Api } = require('teleproto');
  const { BinaryReader } = require('teleproto/extensions/BinaryReader');
  const { parseRichTL } = require('./parser');
  const btn = new Api.PageButton({
    text: new Api.TextPlain({ text: 'K' }),
    type: new Api.InlineButtonTypeCallback({ data: Buffer.from('wh:present:K') }),
    style: new Api.RichButtonStyle({ bgPrimary: true }),
  });
  const rich = new Api.RichMessage({
    blocks: [new Api.PageBlockButtonRow({ buttons: [btn] })],
    photos: [], documents: [],
  });
  const back = new BinaryReader(rich.getBytes()).tgReadObject();
  assert.strictEqual(back.className, 'RichMessage');
  assert.deepStrictEqual(parseRichTL(back), [{ word: 'K', result: 'Y' }]);
});

// ---- handler end-to-end (teleproto MTProto message in, reply out) ----
(async () => {
  const { handle } = require('./bot');
  const mk = (extra) => {
    const sent = [];
    const msg = Object.assign({
      message_id: 1, chat: { id: 42 },
      reply: async (opts) => { sent.push(opts); },
    }, extra);
    return { msg, sent };
  };
  const btn = (ch, state, style) => ({
    className: 'PageButton',
    text: { className: 'TextPlain', text: ch },
    type: { className: 'InlineButtonTypeCallback', data: Buffer.from(`wh:${state}:${ch}`) },
    style: { className: 'RichButtonStyle', bgSuccess: style === 'success', bgDanger: style === 'danger' },
  });

  const rich = mk({
    message: '4-letter mode\n2/30 guesses\nHOLA\nHATE',
    richMessage: { className: 'RichMessage', blocks: [
      { className: 'PageBlockButtonRow', buttons: 'HOLA'.split('').map(c => btn(c, 'absent', 'danger')) },
      { className: 'PageBlockButtonRow', buttons: [
        btn('H', 'absent', 'danger'), btn('A', 'absent', 'danger'),
        btn('T', 'absent', 'danger'), btn('E', 'correct', 'success')] },
    ] },
  });
  await handle(rich.msg);
  assert(rich.sent.length && /pill buttons/.test(rich.sent[0].message), 'rich TL reply');
  console.log('ok  handler replies on teleproto richMessage update');

  // MTProto rich messages arrive with EMPTY plain text - regression guard
  const emptyText = mk({
    message: '',
    richMessage: { className: 'RichMessage', blocks: [
      { className: 'PageBlockButtonRow', buttons: 'HOLA'.split('').map(c => btn(c, 'absent', 'danger')) },
      { className: 'PageBlockButtonRow', buttons: [
        btn('H', 'absent', 'danger'), btn('A', 'absent', 'danger'),
        btn('T', 'absent', 'danger'), btn('E', 'correct', 'success')] },
    ] },
  });
  await handle(emptyText.msg);
  assert(emptyText.sent.length && /pill buttons/.test(emptyText.sent[0].message), 'empty-text rich reply');
  console.log('ok  handler solves rich board with empty plain text');

  const bare = mk({ message: '4-letter mode\n2/30 guesses\nHOLA\nHATE' });
  await handle(bare.msg);
  assert(bare.sent.length && bare.sent[0].message.includes('\u{1F52C}'));
  assert(bare.sent[0].message.includes('"richMessage": "ABSENT"'));
  console.log('ok  handler self-diagnoses unreadable boards');
  console.log(`\n${n + 4} tests passed`);
})().catch(e => { console.error(e); process.exit(1); });
