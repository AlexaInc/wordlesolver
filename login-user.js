/**
 * One-time interactive login for the READER session (your own Telegram
 * account). Bot sessions receive WordSeek pills stripped to plain letters
 * (server-side, per recipient), while user sessions get the full pill
 * buttons with states - so the bot pairs with a user session that reads
 * live boards and lets the bot answer in real time.
 *
 * Usage:  npm run login:user   then paste the printed line into .env as
 *         USER_SESSION=...
 */
require('dotenv').config();
const readline = require('readline');
const { TelegramClient } = require('teleproto');
const { StringSession } = require('teleproto/sessions');

const apiId = parseInt(process.env.API_ID);
const apiHash = process.env.API_HASH;
if (!apiId || !apiHash) {
  console.error('Set API_ID and API_HASH in .env first (https://my.telegram.org).');
  process.exit(1);
}

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise((res) => rl.question(q, res));

(async () => {
  const client = new TelegramClient(new StringSession(''), apiId, apiHash, {});
  await client.start({
    phoneNumber: () => ask('Phone number (international format, e.g. +9477...): '),
    phoneCode: () => ask('Login code sent to your Telegram app: '),
    password: async () => (await ask('2FA password (Enter to skip if none): ')) || undefined,
    onError: (err) => console.log('login error:', err.message),
  });
  const sess = client.session.save();
  // persist straight into .env so service restarts reuse the session
  const envPath = require('path').join(__dirname, '.env');
  const fs = require('fs');
  let env = '';
  try { env = fs.readFileSync(envPath, 'utf8'); } catch (e) { /* no .env yet */ }
  if (/^USER_SESSION=/m.test(env)) env = env.replace(/^USER_SESSION=.*$/m, 'USER_SESSION=' + sess);
  else env = (env ? env.replace(/\n?$/, '\n') : '') + 'USER_SESSION=' + sess + '\n';
  fs.writeFileSync(envPath, env);
  console.log('\nLogin OK. USER_SESSION saved to .env - it survives restarts.');
  console.log('Session string (backup copy):');
  console.log('USER_SESSION=' + sess);
  console.log('\nThen: sudo systemctl restart wordlesolver');
  await client.disconnect();
  rl.close();
  process.exit(0);
})().catch((e) => { console.error('Login failed:', e.message); process.exit(1); });
