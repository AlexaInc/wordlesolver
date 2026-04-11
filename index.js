require('dotenv').config();
const express = require('express');
const path = require('path');
const WordleSolver = require('./solver');
require('./bot'); // Starts the Telegram bot

const app = express();
const PORT = process.env.PORT || 7860;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// In-memory web sessions (Key: SessionID or IP)
const webSessions = new Map();

function getWebSolver(id) {
    if (!webSessions.has(id)) {
        webSessions.set(id, new WordleSolver());
    }
    return webSessions.get(id);
}

// REST API for Web Solver
app.post('/api/init', (req, res) => {
    const { length, sessionId } = req.body;
    const solver = getWebSolver(sessionId || 'default');
    if (solver.loadWords(length || 5)) {
        res.json({ success: true, length: solver.length });
    } else {
        res.status(400).json({ success: false, message: 'Invalid length' });
    }
});

app.post('/api/guess', (req, res) => {
    const { guess, result, sessionId } = req.body;
    const solver = getWebSolver(sessionId || 'default');

    if (solver.length === 0) return res.status(400).json({ error: 'Not initialized' });

    if (solver.filter(guess, result)) {
        const suggestions = solver.getSuggestions(10);
        res.json({
            success: true,
            processedCount: solver.guesses.length,
            remainingCount: solver.possibleWords.length,
            suggestions: suggestions,
            found: suggestions.length === 1 && solver.possibleWords.length === 1
        });
    } else {
        res.status(400).json({ success: false, message: 'Invalid guess or result' });
    }
});

app.post('/api/reset', (req, res) => {
    const { sessionId } = req.body;
    webSessions.delete(sessionId || 'default');
    res.json({ success: true });
});

app.get('/health', (req, res) => {
    res.json({ status: 'ok', time: new Date().toISOString() });
});

app.listen(PORT, () => {
    console.log(`Web interface running at http://localhost:${PORT}`);
});
