const fs = require('fs');
const path = require('path');

class WordleSolver {
  constructor() {
    this.allWords = [];
    this.commonWords = [];
    this.possibleWords = [];
    this.length = 0;
    this.guesses = [];
  }

  /**
   * Load word lists for a specific length
   * @param {number} length 4, 5, or 6
   */
  loadWords(length) {
    const lengthMap = { 4: 'four', 5: 'five', 6: 'six' };
    const suffix = lengthMap[length];
    if (!suffix) return false;

    const resDir = path.join(__dirname, 'res');
    const allPath = path.join(resDir, `all-${suffix}.json`);
    const commonPath = path.join(resDir, `common-${suffix}.json`);

    try {
      if (fs.existsSync(allPath)) {
        this.allWords = JSON.parse(fs.readFileSync(allPath, 'utf8'));
      }
      if (fs.existsSync(commonPath)) {
        this.commonWords = JSON.parse(fs.readFileSync(commonPath, 'utf8'));
      }

      this.possibleWords = [...this.allWords];
      this.length = length;
      this.guesses = [];
      return true;
    } catch (err) {
      console.error('Error loading words:', err);
      return false;
    }
  }

  /**
   * Filter possible words based on a guess and its result
   * @param {string} guess The guessed word
   * @param {string} result Result string using G (Green), Y (Yellow), R (Red)
   */
  filter(guess, result) {
    if (guess.length !== this.length || result.length !== this.length) return false;

    const lowerGuess = guess.toLowerCase();
    const upperResult = result.toUpperCase();

    this.possibleWords = this.possibleWords.filter(word => {
      return this.getWordleResult(lowerGuess, word.toLowerCase()) === upperResult;
    });

    this.guesses.push({ guess: lowerGuess, result: upperResult });
    return true;
  }

  /**
   * Simulates a Wordle result for a guess against an actual word
   */
  getWordleResult(guess, actual) {
    let result = new Array(guess.length).fill('R');
    let actualChars = actual.split('');
    let guessChars = guess.split('');

    // Pass 1: Greens
    for (let i = 0; i < guess.length; i++) {
      if (guessChars[i] === actualChars[i]) {
        result[i] = 'G';
        actualChars[i] = null;
        guessChars[i] = null;
      }
    }

    // Pass 2: Yellows
    for (let i = 0; i < guess.length; i++) {
      if (guessChars[i] !== null) {
        let index = actualChars.indexOf(guessChars[i]);
        if (index !== -1) {
          result[i] = 'Y';
          actualChars[index] = null;
        }
      }
    }
    return result.join('');
  }

  /**
   * The unique secret, once the candidates collapse to one word that
   * WordSeek could actually have picked (secrets come from common-*).
   */
  getAnswer() {
    if (this.possibleWords.length === 1) return this.possibleWords[0].toUpperCase();
    const common = new Set(this.commonWords);
    const inter = this.possibleWords.filter(w => common.has(w));
    if (inter.length === 1) return inter[0].toUpperCase();
    return null;
  }

  /**
   * Rank guesses by expected number of candidates left after playing them
   * (E = Σ |S_pattern|² / |S|).  Used while the candidate set is small
   * enough for an exact search; otherwise falls back to frequency scoring.
   */
  _expectedRanked(limit) {
    const S = this.possibleWords.map(w => w.toLowerCase());
    const guessed = new Set(this.guesses.map(g => g.guess));
    if (S.length <= 2) {
      return S.filter(w => !guessed.has(w)).map(w => w.toUpperCase()).slice(0, limit);
    }
    const pool = this.commonWords.filter(w => !guessed.has(w));
    if (!pool.length) return [];
    const scored = [];
    for (const g of pool) {
      const counts = new Map();
      for (const s of S) {
        const p = this.getWordleResult(g, s);
        counts.set(p, (counts.get(p) || 0) + 1);
      }
      let e = 0;
      for (const c of counts.values()) e += c * c;
      scored.push([g, e / S.length, S.includes(g)]);
    }
    scored.sort((a, b) => a[1] - b[1] || b[2] - a[2]);
    return scored.slice(0, limit).map(s => s[0].toUpperCase());
  }

  /**
   * Get suggestions for the next guess
   */
  getSuggestions(limit = 10) {
    if (this.possibleWords.length === 0) return [];

    if (this.possibleWords.length <= 400) {
      const exact = this._expectedRanked(limit);
      if (exact.length) return exact;
    }

    // Scoring based on character frequency in remaining possible words
    const charFreq = {};
    this.possibleWords.forEach(word => {
      const uniqueChars = new Set(word.toLowerCase());
      uniqueChars.forEach(char => {
        charFreq[char] = (charFreq[char] || 0) + 1;
      });
    });

    const scoreWord = (word) => {
      const lowerWord = word.toLowerCase();
      const uniqueChars = new Set(lowerWord);
      let score = 0;
      uniqueChars.forEach(char => {
        score += charFreq[char] || 0;
      });
      return score;
    };

    // Sort possible words
    const scored = this.possibleWords.map(word => {
      const isCommon = this.commonWords.includes(word.toLowerCase());
      return {
        word: word.toUpperCase(),
        // Common words get a massive boost to be prioritized
        score: scoreWord(word) + (isCommon ? 1000000 : 0)
      };
    });

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, limit).map(s => s.word);
  }

  reset() {
    this.possibleWords = [...this.allWords];
    this.guesses = [];
  }
}

module.exports = WordleSolver;
