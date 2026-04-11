/**
 * Shared parsing utilities for Wordle Solver (Bot & Web)
 */

function forceNormalize(text) {
    const STYLED_RANGES = [
        [0x1D400, 65], // Serif Bold A-Z
        [0x1D41A, 97], // Serif Bold a-z
        [0x1D434, 65], // Serif Italic A-Z
        [0x1D44E, 97], // Serif Italic a-z
        [0x1D468, 65], // Serif Bold Italic A-Z
        [0x1D482, 97], // Serif Bold Italic a-z
        [0x1D5A0, 65], // Sans-Serif A-Z
        [0x1D5BA, 97], // Sans-Serif a-z
        [0x1D5D4, 65], // Sans-Serif Bold A-Z (WORDSEEK)
        [0x1D5EE, 97], // Sans-Serif Bold a-z
        [0x1D608, 65], // Sans-Serif Italic A-Z
        [0x1D622, 97], // Sans-Serif Italic a-z
        [0x1D63C, 65], // Sans-Serif Bold Italic A-Z
        [0x1D656, 97], // Sans-Serif Bold Italic a-z
        [0x1D670, 65], // Monospace A-Z
        [0x1D68A, 97], // Monospace a-z
    ];

    let result = "";
    for (const char of text) {
        const code = char.codePointAt(0);
        let mapped = false;
        for (const [start, asciiStart] of STYLED_RANGES) {
            if (code >= start && code < start + 26) {
                result += String.fromCharCode(code - start + asciiStart);
                mapped = true;
                break;
            }
        }
        if (!mapped) {
            const norm = char.normalize('NFKD');
            result += norm.replace(/[^\x00-\x7F]/g, '');
        }
    }
    return result.replace(/[^a-zA-Z]/g, '');
}

const EMOJI_REG = /[🟩🟨🟥⬛⬜🟫🟦🟧]/gu;
const EMOJI_MAP = {
    '🟩': 'G', '🟨': 'Y', '🟥': 'R', '⬛': 'R', '⬜': 'R', '🟫': 'R', '🟦': 'R', '🟧': 'R'
};

function parseLine(line, lastSuggestion) {
    const emojis = line.match(EMOJI_REG);
    if (!emojis || emojis.length < 4 || emojis.length > 6) {
        return { error: `Invalid emojis` };
    }

    const result = emojis.map(e => EMOJI_MAP[e] || 'R').join('');
    const lineWithoutEmojis = line.replace(EMOJI_REG, '');
    const normalizedLine = forceNormalize(lineWithoutEmojis);

    if (normalizedLine.length === result.length) {
        return { success: true, word: normalizedLine.toLowerCase(), result };
    }

    if (normalizedLine.length > result.length) {
        const endWord = normalizedLine.slice(-result.length);
        return { success: true, word: endWord.toLowerCase(), result };
    }

    if (lastSuggestion && lastSuggestion.length === result.length) {
        return { success: true, word: lastSuggestion.toLowerCase(), result };
    }

    return { error: "Word not found" };
}

module.exports = {
    forceNormalize,
    parseLine,
    EMOJI_REG
};
