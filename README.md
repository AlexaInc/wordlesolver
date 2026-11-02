# Wordle Solver Telegram Bot 🤖

A powerful and flexible Telegram bot that helps you solve Wordle puzzles. Supports multiple word lengths (4, 5, and 6 letters) and works with forwarded messages from various Wordle-style games (like Wordseek).

## 🚀 Features

- **Multi-Length Support**: Solves 4, 5, and 6-letter Wordle puzzles.
- **New WordSeek pill format**: reads the inline pill buttons of the new
  @WordSeekBot feedback messages exactly (green / blue / red pills), including
  the zero-width anti-copy noise.
- **Screenshot solving**: send the bot (or the web UI) a screenshot of the
  WordSeek pill board — pill colours are detected and the letters are read
  with a built-in A-Z template OCR (`res/ocr-templates.json`), no external
  services. A dictionary pass fixes any residual letter confusion.
- **Smart Parsing**: Handles emoji-only inputs, styled Unicode text (like 𝗧𝗥𝗨𝗖𝗞), and forwarded messages.
- **Session Locking**: Automatically locks the word length for a game session based on your first guess.
- **Exact answers**: once only one WordSeek-possible secret remains
  (`common-*.json`), the bot announces it instead of a guess.
- **Optimal guesses**: while few candidates remain, guesses are ranked by
  expected candidates-left; otherwise by letter frequency with a common-word boost.
- **Vast Dictionary**: Knows thousands of words, from common day-to-day vocabulary to rare terms.
- **Web Interface**: Ready for deployment on Hugging Face Spaces — now with a
   Screenshot button that solves a whole board in one upload.

### How the new WordSeek feedback is read

WordSeek now renders every guessed letter as an inline pill button whose
callback data is `wh:{correct|present|absent}:{LETTER}`:

| pill | meaning |
|---|---|
| green (`style="success"`) | right letter, right spot |
| blue (no style) | right letter, wrong spot |
| red (`style="danger"`) | letter not in the word |

`parser.js` recovers those states straight from the message (exact), or from
a screenshot via colour + OCR (fallback), or from legacy emoji boards.

## 🛠️ Setup

### Prerequisites
- [Node.js](https://nodejs.org/) installed.
- A Telegram Bot Token (from [@BotFather](https://t.me/BotFather)).
- `API_ID` / `API_HASH` from <https://my.telegram.org> (MTProto login).

### Real-time pill reading (USER_SESSION)
See above section...

### Transport: MTProto via teleproto (not gramjs, not Bot API)
WordSeek's pill feedback arrives inside the message's `richMessage`
(RichBlockButtons, TL layer 228+). GramJS is **archived on layer 198**, so
Telegram silently stripped the pills before the bot ever saw them - the
cause of the "bot stays silent on forwards" bug. The HTTP Bot API would fix
that but adds polling latency. [teleproto](https://github.com/sanyok12345/teleproto)
(the maintained GramJS fork, same API shape) ships **layer 232** with full
RichMessage support: forwarded boards arrive with exact `wh:{state}:{letter}`
callback data, pushed over MTProto with zero polling delay.
A byte-level round-trip test (`npm test`) proves the pill constructors
serialize/deserialize correctly.

### Groups
In groups/supergroups Telegram's **privacy mode** hides normal messages from
bots. Either disable it once via @BotFather → `/setprivacy` → *Disable*, or
make the bot an admin of the group - then forwarded WordSeek boards and
screenshots work there exactly like in private chat.

### Local Installation
1. Clone the repository:
   ```bash
   git clone https://github.com/your-username/wordle-solver-bot.git
   cd wordle-solver-bot
   ```
2. Install dependencies:
   ```bash
   npm install
   ```
3. Create a `.env` file in the root directory and add your token:
   ```env
   BOT_TOKEN=your_telegram_bot_token_here
   API_ID=your_api_id
   API_HASH=your_api_hash
   ```
4. Start the bot (+ web UI):
   ```bash
   npm start
   ```

## 🎮 How to Use

Simply send the bot your guess result using emojis:
- 🟩 = Correct letter, correct position
- 🟨 = Correct letter, wrong position
- 🟥 = Letter not in the word

Example format:
- `🟨 🟩 🟥 🟥 🟨 LAMAR`
- `🟥 🟥 🟥 🟥 🟥 TRUCK`

Commands:
- `/reset` - Clear current session and start a new game (allows changing word length).
- `/other` - Get alternative word suggestions if the best guess isn't what you're looking for.

## 🌍 Deployment on Hugging Face

This bot is designed to run seamlessly on [Hugging Face Spaces](https://huggingface.co/spaces).
- **Runtime**: Node.js
- **Entry point**: `index.js`
- **Exposed port**: 7860 (Express server)

## 📄 License
ISC

## 🧪 Tests

```bash
npm test
```

Covers legacy emoji parsing, rich pill-button parsing, and a full screenshot
(`examples/sample-board.png`) that must parse to the unique answer `PICK`.
