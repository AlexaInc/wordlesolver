/**
 * Shared parsing utilities for Wordle Solver (Bot & Web)
 *
 * Three input formats are supported:
 *
 *  1. NEW WordSeek feedback messages: every letter arrives as an inline
 *     pill button (<tg-button>) whose callback data is
 *     "wh:{correct|present|absent}:{LETTER}" - recovered exactly here,
 *     zero-width anti-copy noise stripped.
 *  2. Screenshots of those pill messages: pill colours + a tiny built-in
 *     A-Z template OCR (res/ocr-templates.json), no external services.
 *  3. LEGACY emoji / styled-unicode boards (old @WordSeekBot format).
 */

const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');

/* ------------------------------------------------------------------ */
/* legacy: styled unicode + emoji boards                               */
/* ------------------------------------------------------------------ */

function forceNormalize(text) {
    const STYLED_RANGES = [
        [0x1D400, 65], [0x1D41A, 97], [0x1D434, 65], [0x1D44E, 97],
        [0x1D468, 65], [0x1D482, 97], [0x1D5A0, 65], [0x1D5BA, 97],
        [0x1D5D4, 65], [0x1D5EE, 97], [0x1D608, 65], [0x1D622, 97],
        [0x1D63C, 65], [0x1D656, 97], [0x1D670, 65], [0x1D68A, 97],
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

const EMOJI_REG = /[🟩🟨🟥⬛🟫🟦]/gu;
const EMOJI_MAP = {
    '🟩': 'G', '🟨': 'Y', '🟥': 'R', '⬛': 'R', '⬜': 'R', '🟫': 'R', '🟦': 'R', '🟧': 'R'
};

function parseLine(line, lastSuggestion) {
    const emojis = line.match(EMOJI_REG);
    if (!emojis || emojis.length < 4 || emojis.length > 6) {
        return { error: `Invalid emojis (found ${emojis ? emojis.length : 0})` };
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

/* ------------------------------------------------------------------ */
/* NEW format: rich pill buttons with wh: callback data                */
/* ------------------------------------------------------------------ */

const ZERO_WIDTH = new Set(['\u200B', '\u200C', '\u200D', '\u2060', '\uFEFF']);
const STATE_TO_CHAR = { correct: 'G', present: 'Y', absent: 'R' };

function stripZeroWidth(text) {
    let out = '';
    for (const ch of text) if (!ZERO_WIDTH.has(ch)) out += ch;
    return out;
}

function _decodeWh(value) {
    let txt = null;
    if (Buffer.isBuffer(value)) txt = value.toString('utf8');
    else if (typeof value === 'string') {
        // telethon-style base64 or plain
        if (value.startsWith('wh:')) txt = value;
        else {
            try {
                const buf = Buffer.from(value, 'base64');
                const s = buf.toString('utf8');
                if (s.startsWith('wh:')) txt = s;
            } catch (e) { /* ignore */ }
        }
    }
    if (!txt || !txt.startsWith('wh:')) return null;
    const parts = txt.split(':');
    if (parts.length !== 3) return null;
    if (!STATE_TO_CHAR[parts[1]]) return null;
    const letter = (parts[2] || '').toUpperCase();
    if (!/^[A-Z]$/.test(letter)) return null;
    return { state: parts[1], letter };
}

function _scanWh(node, out, depth = 0) {
    if (!node || depth > 6 || out.length > 200) return;
    if (Array.isArray(node)) {
        for (const v of node) _scanWh(v, out, depth + 1);
        return;
    }
    if (typeof node !== 'object') return;
    for (const key of ['data', 'callback_data']) {
        if (key in node) {
            const dec = _decodeWh(node[key]);
            if (dec) {
                out.push({ offset: typeof node.offset === 'number' ? node.offset : null, ...dec });
                return;
            }
        }
    }
    for (const v of Object.values(node)) _scanWh(v, out, depth + 1);
}

function _richTextPlain(node) {
    if (!node) return '';
    if (typeof node === 'string') return node;
    if (Array.isArray(node.texts)) return node.texts.map(_richTextPlain).join('');
    if (node.text !== undefined) return _richTextPlain(node.text);
    return '';
}

/**
 * Bot API shape: message.rich_message.blocks[] with type "buttons"
 * (RichBlockButtons) holding RichMessageButton {callback_data, style, text}.
 */
function parseRichBlocks(rich) {
    if (!rich || !Array.isArray(rich.blocks)) return null;
    const rows = [];
    for (const block of rich.blocks) {
        if (!block || block.type !== 'buttons' || !Array.isArray(block.buttons)) continue;
        let word = '', result = '';
        for (const btn of block.buttons) {
            const dec = btn.callback_data ? _decodeWh(btn.callback_data) : null;
            let letter, state;
            if (dec) {
                letter = dec.letter;
                state = dec.state;
            } else {
                letter = (stripZeroWidth(_richTextPlain(btn.text))
                    .replace(/[^a-zA-Z]/g, '').toUpperCase()).slice(-1);
                state = btn.style === 'success' ? 'correct'
                    : btn.style === 'danger' ? 'absent' : 'present';
            }
            if (!letter) continue;
            word += letter;
            result += STATE_TO_CHAR[state];
        }
        if (word) rows.push({ word, result });
    }
    return rows.length ? rows : null;
}

function _tlRichTextPlain(node) {
    if (!node || typeof node !== 'object') return '';
    if (Array.isArray(node.texts)) return node.texts.map(_tlRichTextPlain).join('');
    if (typeof node.text === 'string') return node.text;
    if (node.text && typeof node.text === 'object') return _tlRichTextPlain(node.text);
    return '';
}

/**
 * MTProto shape (teleproto): message.richMessage = RichMessage whose blocks
 * contain PageBlockButtonRow { buttons: PageButton[] } with
 * PageButton { text: RichText, type: InlineButtonTypeCallback{data}, style: RichButtonStyle }.
 */
function parseRichTL(rich) {
    if (!rich) return null;
    const rows = [];
    const walk = (node) => {
        if (!node || typeof node !== 'object') return;
        if (Array.isArray(node)) { node.forEach(walk); return; }
        if (Array.isArray(node.buttons)) {
            let word = '', result = '';
            for (const btn of node.buttons) {
                const data = btn && btn.type && btn.type.data;
                const dec = data ? _decodeWh(data) : null;
                let letter, state;
                if (dec) {
                    letter = dec.letter;
                    state = dec.state;
                } else {
                    letter = (stripZeroWidth(_tlRichTextPlain(btn && btn.text))
                        .replace(/[^a-zA-Z]/g, '').toUpperCase()).slice(-1);
                    const st = btn && btn.style;
                    state = st && st.bgSuccess ? 'correct'
                        : st && st.bgDanger ? 'absent' : 'present';
                }
                if (!letter) continue;
                word += letter;
                result += STATE_TO_CHAR[state];
            }
            if (word) rows.push({ word, result });
            return;
        }
        if (Array.isArray(node.blocks)) { node.blocks.forEach(walk); return; }
    };
    walk(rich);
    return rows.length ? rows : null;
}

/**
 * Recover the whole board from a Telegram message (teleproto/gramjs Message,
 * Bot API update JSON, plain object or JSON dump).  Returns [{word, result}] or null.
 */
function parseRichMessage(message) {
    if (!message) return null;
    if (message.rich_message) {
        const rows = parseRichBlocks(message.rich_message);
        if (rows) return rows;
    }
    if (message.richMessage) {
        const rows = parseRichTL(message.richMessage);
        if (rows) return rows;
    }
    const text = message.message || message.text || '';
    const found = [];
    _scanWh(message, found);
    if (!found.length) return null;

    let rows = [];
    if (found.every(f => f.offset !== null) && text) {
        const buckets = [];
        for (const f of found) {
            const idx = text.slice(0, f.offset).split('\n').length - 1;
            while (buckets.length <= idx) buckets.push([]);
            buckets[idx].push(f);
        }
        rows = buckets.filter(b => b.length).map(b => ({
            word: b.map(f => f.letter).join(''),
            result: b.map(f => STATE_TO_CHAR[f.state]).join(''),
        }));
    } else {
        const lines = stripZeroWidth(text).split('\n')
            .map(l => l.trim()).filter(l => /^[a-zA-Z]+$/.test(l));
        let it = 0;
        for (const ln of lines) {
            const row = { word: '', result: '' };
            for (let i = 0; i < ln.length; i++) {
                const f = found[it++];
                if (!f) return null;
                row.word += f.letter;
                row.result += STATE_TO_CHAR[f.state];
            }
            rows.push(row);
        }
    }
    rows = rows.filter(r => r.word.length >= 4 && r.word.length <= 6);
    return rows.length ? rows : null;
}

/* ------------------------------------------------------------------ */
/* NEW format: screenshots of the pill grid                            */
/* ------------------------------------------------------------------ */

const PILL_COLOURS = [
    ['absent', [51, 45, 58]],
    ['correct', [37, 60, 61]],
    ['present', [34, 54, 74]],
    ['absent', [226, 148, 148]],
    ['correct', [158, 207, 158]],
    ['present', [163, 188, 224]],
];
const TOLERANCE = 26;

let _templates = null;
function _loadTemplates() {
    if (_templates) return _templates;
    const raw = JSON.parse(fs.readFileSync(path.join(__dirname, 'res', 'ocr-templates.json'), 'utf8'));
    const data = {};
    for (const [key, glyphs] of Object.entries(raw.data)) {
        data[key] = glyphs.map(b64 => {
            const buf = Buffer.from(b64, 'base64');
            const f = new Float32Array(raw.canvas * raw.canvas);
            for (let i = 0; i < f.length; i++) f[i] = ((buf[i >> 2] >> (6 - 2 * (i & 3))) & 3) / 3;
            return f;
        });
    }
    _templates = { canvas: raw.canvas, inner: raw.inner, heights: raw.heights, fonts: raw.fonts, data };
    return _templates;
}

let _allWordsCache = {};
function _allWords(length) {
    if (!(length in _allWordsCache)) {
        const map = { 4: 'four', 5: 'five', 6: 'six' };
        try {
            _allWordsCache[length] = new Set(JSON.parse(fs.readFileSync(
                path.join(__dirname, 'res', `all-${map[length]}.json`), 'utf8'))
                .map(w => w.toUpperCase()));
        } catch (e) {
            _allWordsCache[length] = new Set();
        }
    }
    return _allWordsCache[length];
}

function _median(arr) {
    if (!arr.length) return 0;
    const s = Array.from(arr).sort((a, b) => a - b);
    return s[s.length >> 1];
}

function _normaliseProbe(mask, w, h, canvas, inner) {
    // bbox crop
    let y0 = h, y1 = -1, x0 = w, x1 = -1;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        if (mask[y * w + x] > 0.15) {
            if (y < y0) y0 = y; if (y > y1) y1 = y;
            if (x < x0) x0 = x; if (x > x1) x1 = x;
        }
    }
    const out = new Float32Array(canvas * canvas);
    if (y1 < 0) return out;
    const ch = y1 - y0 + 1, cw = x1 - x0 + 1;
    const scale = Math.min(inner / ch, inner / cw);
    const nh = Math.max(1, Math.round(ch * scale));
    const nw = Math.max(1, Math.round(cw * scale));
    // bilinear resize into centred canvas
    const oy = (canvas - nh) >> 1, ox = (canvas - nw) >> 1;
    for (let y = 0; y < nh; y++) {
        const sy = (y + 0.5) / scale - 0.5;          // crop-relative source row
        const sy0 = Math.max(0, Math.min(ch - 1, Math.floor(sy)));
        const sy1 = Math.max(0, Math.min(ch - 1, sy0 + 1));
        const fy = Math.max(0, Math.min(1, sy - sy0));
        for (let x = 0; x < nw; x++) {
            const sx = (x + 0.5) / scale - 0.5;      // crop-relative source col
            const sx0 = Math.max(0, Math.min(cw - 1, Math.floor(sx)));
            const sx1 = Math.max(0, Math.min(cw - 1, sx0 + 1));
            const fx = Math.max(0, Math.min(1, sx - sx0));
            const v00 = mask[(y0 + sy0) * w + x0 + sx0];
            const v01 = mask[(y0 + sy0) * w + x0 + sx1];
            const v10 = mask[(y0 + sy1) * w + x0 + sx0];
            const v11 = mask[(y0 + sy1) * w + x0 + sx1];
            out[(oy + y) * canvas + ox + x] =
                (v00 * (1 - fx) + v01 * fx) * (1 - fy) + (v10 * (1 - fx) + v11 * fx) * fy;
        }
    }
    return out;
}

function _ncc(a, b) {
    let ma = 0, mb = 0;
    for (let i = 0; i < a.length; i++) { ma += a[i]; mb += b[i]; }
    ma /= a.length; mb /= b.length;
    let dot = 0, da = 0, db = 0;
    for (let i = 0; i < a.length; i++) {
        const ua = a[i] - ma, ub = b[i] - mb;
        dot += ua * ub; da += ua * ua; db += ub * ub;
    }
    const den = Math.sqrt(da * db);
    return den > 1e-6 ? dot / den : 0;
}

function _ocrGlyph(soft, w, h) {
    const T = _loadTemplates();
    const probe = _normaliseProbe(soft, w, h, T.canvas, T.inner);
    // best score per letter over every font x height bucket
    const best = new Float32Array(26).fill(-2);
    for (let fi = 0; fi < T.fonts.length; fi++) {
        for (const hh of T.heights) {
            const glyphs = T.data[`${fi}:${hh}`];
            if (!glyphs) continue;
            for (let ci = 0; ci < 26; ci++) {
                const s = _ncc(probe, glyphs[ci]);
                if (s > best[ci]) best[ci] = s;
            }
        }
    }
    const scores = [];
    for (let ci = 0; ci < 26; ci++) scores.push([String.fromCharCode(65 + ci), best[ci]]);
    scores.sort((a, b) => b[1] - a[1]);
    return scores.slice(0, 3);
}

function _components(mask, w, h, minSize) {
    const lab = new Int32Array(w * h);
    const boxes = [];
    const stack = [];
    for (let start = 0; start < w * h; start++) {
        if (!mask[start] || lab[start]) continue;
        lab[start] = boxes.length + 1;
        stack.length = 0; stack.push(start);
        let x0 = w, x1 = -1, y0 = h, y1 = -1;
        while (stack.length) {
            const p = stack.pop();
            const px = p % w, py = (p / w) | 0;
            if (px < x0) x0 = px; if (px > x1) x1 = px;
            if (py < y0) y0 = py; if (py > y1) y1 = py;
            const nb = [p - w, p + w, p - 1, p + 1];
            const ok = [py > 0, py < h - 1, px > 0, px < w - 1];
            for (let k = 0; k < 4; k++) {
                const q = nb[k];
                if (ok[k] && mask[q] && !lab[q]) { lab[q] = lab[start]; stack.push(q); }
            }
        }
        if ((x1 - x0 + 1) * (y1 - y0 + 1) >= minSize) boxes.push([x0, y0, x1, y1]);
    }
    return boxes;
}

function _fixWithDictionary(word, alts) {
    // Maximum-likelihood pick among dictionary words reachable by swapping
    // tiles with their OCR runner-ups (catches E/C, I/J style confusions).
    const dict = _allWords(word.length);
    if (!dict.size) return word;
    const top = p => (alts[p] && alts[p][0] ? alts[p][0][1] : 0);
    const base = alts.reduce((s, a) => s + (a[0] ? a[0][1] : 0), 0);
    const cands = [];
    if (dict.has(word)) cands.push([word, base]);
    for (let p = 0; p < word.length; p++) {
        for (const [ch, sc] of alts[p] || []) {
            if (ch === word[p]) continue;
            const cand = word.slice(0, p) + ch + word.slice(p + 1);
            if (dict.has(cand)) cands.push([cand, base - top(p) + sc]);
        }
    }
    for (let p = 0; p < word.length; p++) {
        for (let q = p + 1; q < word.length; q++) {
            for (const [c1, s1] of alts[p] || []) for (const [c2, s2] of alts[q] || []) {
                if (c1 === word[p] && c2 === word[q]) continue;
                const cand = word.slice(0, p) + c1 + word.slice(p + 1, q) + c2 + word.slice(q + 1);
                if (dict.has(cand)) cands.push([cand, base - top(p) - top(q) + s1 + s2]);
            }
        }
    }
    if (!cands.length) return word;
    cands.sort((a, b) => b[1] - a[1]);
    return cands[0][0];
}

/**
 * Parse a PNG/JPEG-decoded screenshot buffer of a WordSeek pill board.
 * Returns [{word, result}] (result over G/Y/R) or [].
 */
function parseImageBuffer(buffer) {
    const png = PNG.sync.read(buffer);
    const W = png.width, H = png.height, D = png.data;
    const lum = new Float32Array(W * H);
    const pill = new Uint8Array(W * H);
    for (let p = 0; p < W * H; p++) {
        const r = D[p * 4], g = D[p * 4 + 1], b = D[p * 4 + 2];
        lum[p] = 0.299 * r + 0.587 * g + 0.114 * b;
        for (const [, c] of PILL_COLOURS) {
            const d = Math.sqrt((r - c[0]) ** 2 + (g - c[1]) ** 2 + (b - c[2]) ** 2);
            if (d < TOLERANCE) { pill[p] = 1; break; }
        }
    }

    // row bands
    const bands = [];
    let inRow = false, by0 = 0;
    for (let y = 0; y < H; y++) {
        let v = 0;
        for (let x = 0; x < W; x++) v += pill[y * W + x];
        if (v > 3 && !inRow) { inRow = true; by0 = y; }
        else if (v <= 3 && inRow) { inRow = false; if (y - by0 >= 6) bands.push([by0, y]); }
    }
    if (inRow && H - by0 >= 6) bands.push([by0, H]);

    const pitches = [], rowInfo = [];
    for (const [y0, y1] of bands) {
        const xs = new Float32Array(W);
        for (let y = y0; y < y1; y++) for (let x = 0; x < W; x++) xs[x] += pill[y * W + x];
        let x0 = -1, x1 = -1;
        for (let x = 0; x < W; x++) if (xs[x] > 0) { if (x0 < 0) x0 = x; x1 = x; }
        if (x0 < 0 || x1 - x0 + 1 < 6) continue;
        const span = x1 - x0 + 1;
        const prof = new Float32Array(span);
        let mean = 0;
        for (let i = 0; i < span; i++) { prof[i] = xs[x0 + i]; mean += prof[i]; }
        mean /= span;
        for (let i = 0; i < span; i++) prof[i] -= mean;
        let bestLag = 0, bestC = -Infinity;
        for (let lag = 10; lag < Math.min(40, span - 6); lag++) {
            let c = 0;
            for (let i = 0; i < span - lag; i++) c += prof[i] * prof[i + lag];
            if (c > bestC) { bestC = c; bestLag = lag; }
        }
        if (bestLag < 10) continue;
        pitches.push(bestLag);
        rowInfo.push([y0, y1, x0, span]);
    }
    if (!rowInfo.length) return [];
    pitches.sort((a, b) => a - b);
    const pitch = pitches[pitches.length >> 1];

    const rows = [];
    for (const [y0, y1, xStart, span] of rowInfo) {
        const n = Math.max(1, Math.round(span / pitch));
        const rh = y1 - y0;
        let word = '', result = '';
        const alts = [];
        let tiles = 0;
        for (let i = 0; i < n; i++) {
            const cx0 = Math.round(xStart + i * pitch);
            const cx1 = Math.round(xStart + (i + 1) * pitch) - 1;
            const trim = Math.max(1, Math.round(pitch * 0.18));
            const ix0 = cx0 + trim, ix1 = cx1 - trim;
            // background median over pill pixels of the core
            const rs = [], gs = [], bs = [];
            let pmCount = 0;
            for (let y = y0; y < y1; y++) for (let x = ix0; x <= ix1; x++) {
                if (pill[y * W + x]) {
                    const p = y * W + x;
                    rs.push(D[p * 4]); gs.push(D[p * 4 + 1]); bs.push(D[p * 4 + 2]);
                    pmCount++;
                }
            }
            const coreArea = rh * (ix1 - ix0 + 1);
            if (!pmCount || pmCount < 0.40 * coreArea) continue;
            const bg = [_median(rs), _median(gs), _median(bs)];
            let state = 'absent', bd = Infinity;
            for (const [st, c] of PILL_COLOURS) {
                const d = (c[0] - bg[0]) ** 2 + (c[1] - bg[1]) ** 2 + (c[2] - bg[2]) ** 2;
                if (d < bd) { bd = d; state = st; }
            }
            const bgLum = 0.299 * bg[0] + 0.587 * bg[1] + 0.114 * bg[2];

            // glyph: bright pixels in a slightly wider window, centred comps
            const wx0 = Math.max(0, cx0 - 4), wx1 = Math.min(W - 1, cx1 + 4);
            const ww = wx1 - wx0 + 1;
            const hard = new Uint8Array(ww * rh);
            const winLum = new Float32Array(ww * rh);
            for (let y = 0; y < rh; y++) for (let x = 0; x < ww; x++) {
                const p = (y0 + y) * W + wx0 + x;
                winLum[y * ww + x] = lum[p];
                if (lum[p] > Math.max(bgLum + 30, 75)) hard[y * ww + x] = 1;
            }
            const comps = _components(hard, ww, rh, 3);
            if (!comps.length) continue;
            const wcentre = (wx0 + wx1) / 2;
            const sel = new Uint8Array(ww * rh);
            let kept = 0, any = 0;
            for (const [bx0, byy0, bx1, byy1] of comps) {
                const ccentre = wx0 + (bx0 + bx1) / 2;
                const size = (bx1 - bx0 + 1) * (byy1 - byy0 + 1);
                if (Math.abs(ccentre - wcentre) <= pitch * 0.45 && size >= 4) {
                    kept = Math.max(kept, size);
                    for (let y = byy0; y <= byy1; y++) for (let x = bx0; x <= bx1; x++) {
                        if (hard[y * ww + x]) { sel[y * ww + x] = 1; any++; }
                    }
                }
            }
            if (kept < 4 || any < 6) continue;
            const vals = [];
            for (let p = 0; p < sel.length; p++) if (sel[p]) vals.push(winLum[p]);
            vals.sort((a, b) => a - b);
            const fgLum = vals[Math.floor(vals.length * 0.9)] || bgLum + 60;
            const denom = Math.max(fgLum - bgLum, 20);
            const soft = new Float32Array(ww * rh);
            let gy0 = rh, gy1 = -1;
            for (let p = 0; p < sel.length; p++) if (sel[p]) {
                soft[p] = Math.max(0, Math.min(1, (winLum[p] - bgLum - 8) / denom));
                const y = (p / ww) | 0;
                if (y < gy0) gy0 = y; if (y > gy1) gy1 = y;
            }
            const top3 = _ocrGlyph(soft, ww, rh);
            word += top3[0][0];
            result += STATE_TO_CHAR[state];
            alts.push(top3);
            tiles++;
        }
        if (tiles >= 4 && tiles <= 6) {
            word = _fixWithDictionary(word, alts);
            rows.push({ word, result });
        }
    }
    return rows;
}

module.exports = {
    forceNormalize,
    parseLine,
    EMOJI_REG,
    stripZeroWidth,
    parseRichMessage,
    parseRichBlocks,
    parseRichTL,
    parseImageBuffer,
    STATE_TO_CHAR,
};
