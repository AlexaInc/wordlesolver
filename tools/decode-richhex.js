// Offline decoder for [richhex] dumps: node tools/decode-richhex.js hexfile
const fs = require('fs');
require('teleproto');
const { Reader } = require('teleproto/tl/binary/Reader');
const hex = fs.readFileSync(process.argv[2], 'utf8').trim();
const buf = Buffer.from(hex, 'hex');
const SIG = {
  '8b9df3ba': 'richMessage', '1803646d': 'pageBlockButtonRow', '88542a69': 'pageButton',
  '66077946': 'pageBlockParagraph', 'ad31e767': 'pageBlockHeading3',
  '38bc5529': 'inlineButtonTypeCallback', '0b10c603': 'richButtonStyle',
};
console.log('--- constructor-id scan (little-endian byte patterns) ---');
for (const [pat, name] of Object.entries(SIG)) {
  let i = 0, n = 0;
  while ((i = hex.indexOf(pat, i)) !== -1) { n++; i += pat.length; }
  console.log(`${name.padEnd(26)} 0x${Buffer.from(pat, 'hex').readUInt32LE(0).toString(16).padStart(8, '0')} x${n}`);
}
console.log('--- parsed tree ---');
const obj = new Reader(buf).tgReadObject();
const show = (n, d) => {
  if (n == null || typeof n !== 'object') return JSON.stringify(n);
  if (Buffer.isBuffer(n)) return 'bytes:' + n.toString('utf8');
  if (Array.isArray(n)) return '[' + n.map(x => show(x, d + 1)).join(', ') + ']';
  const keys = Object.keys(n).filter(k => !k.startsWith('_') && k !== 'className');
  return n.className + '{' + keys.map(k => `${k}=${show(n[k], d + 1)}`).join(', ') + '}';
};
console.log(show(obj, 0).slice(0, 4000));
