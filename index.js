require('dotenv').config();
const express = require('express');
const path = require('path');
const WordleSolver = require('./solver');
const { parseLine, parseImageBuffer, EMOJI_REG } = require('./parser');
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

app.post('/api/bulk-guess', (req, res) => {
    const { text, sessionId } = req.body;
    const solver = getWebSolver(sessionId || 'default');
    const lines = text.split('\n');

    let processed = 0;
    for (const line of lines) {
        if (!line.trim()) continue;

        // Detection
        const lengthMatch = line.match(/(\d)-letter/i);
        if (lengthMatch && solver.length === 0) {
            solver.loadWords(parseInt(lengthMatch[1]));
        }

        const parsed = parseLine(line, solver.getSuggestions(1)[0]);
        if (parsed.success) {
            if (solver.length === 0) {
                solver.loadWords(parsed.word.length);
            } else if (parsed.word.length !== solver.length) {
                continue;
            }

            if (solver.filter(parsed.word, parsed.result)) {
                processed++;
            }
        }
    }

    const suggestions = solver.getSuggestions(10);
    res.json({
        success: processed > 0,
        processedCount: solver.guesses.length,
        remainingCount: solver.possibleWords.length,
        suggestions: suggestions,
        guesses: solver.guesses, // Send back all guesses to sync the UI
        answer: solver.getAnswer()
    });
});

// Solve a screenshot of the new WordSeek pill-board in one shot
app.post('/api/solve-image', (req, res) => {
    const { image, sessionId } = req.body;
    if (!image) return res.status(400).json({ success: false, message: 'No image supplied' });
    try {
        const b64 = image.includes(',') ? image.split(',')[1] : image;
        const rows = parseImageBuffer(Buffer.from(b64, 'base64'));
        if (!rows.length) {
            return res.status(400).json({
                success: false,
                message: 'No WordSeek pill board found in that image.'
            });
        }
        const solver = getWebSolver(sessionId || 'default');
        if (!solver.length) solver.loadWords(rows[0].word.length);
        if (rows[0].word.length !== solver.length) {
            return res.status(400).json({
                success: false,
                message: `Board is ${rows[0].word.length}-letter but this session is ${solver.length}-letter. Reset first.`
            });
        }
        let processed = 0;
        for (const r of rows) if (solver.filter(r.word, r.result)) processed++;
        res.json({
            success: processed > 0,
            processedCount: solver.guesses.length,
            remainingCount: solver.possibleWords.length,
            suggestions: solver.getSuggestions(10),
            guesses: solver.guesses,
            answer: solver.getAnswer(),
            rows
        });
    } catch (err) {
        res.status(400).json({ success: false, message: 'Could not read image: ' + err.message });
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
