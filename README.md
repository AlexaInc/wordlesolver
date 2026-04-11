# Wordle Solver Telegram Bot 🤖

A powerful and flexible Telegram bot that helps you solve Wordle puzzles. Supports multiple word lengths (4, 5, and 6 letters) and works with forwarded messages from various Wordle-style games (like Wordseek).

## 🚀 Features

- **Multi-Length Support**: Solves 4, 5, and 6-letter Wordle puzzles.
- **Smart Parsing**: Handles emoji-only inputs, styled Unicode text (like 𝗧𝗥𝗨𝗖𝗞), and forwarded messages.
- **Session Locking**: Automatically locks the word length for a game session based on your first guess.
- **Vast Dictionary**: Knows thousands of words, from common day-to-day vocabulary to rare terms.
- **Web Interface**: Ready for deployment on Hugging Face Spaces.

## 🛠️ Setup

### Prerequisites
- [Node.js](https://nodejs.org/) installed.
- A Telegram Bot Token (from [@BotFather](https://t.me/BotFather)).

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
   ```
4. Start the bot:
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
