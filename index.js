require('dotenv').config();
const express = require('express');
const path = require('path');
require('./bot'); // This starts the Telegraf bot

const app = express();
const PORT = process.env.PORT || 7860;

// Serve static files from the 'public' folder
app.use(express.static(path.join(__dirname, 'public')));

// Basic health check endpoint
app.get('/health', (req, res) => {
    res.json({ status: 'ok', time: new Date().toISOString() });
});

app.listen(PORT, () => {
    console.log(`Web interface running at http://localhost:${PORT}`);
    console.log(`Bot is active and listening for messages...`);
});
