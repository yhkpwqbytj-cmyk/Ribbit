/*
 * Ribbit clone — puzzle generator.
 *
 * Levels are generated constructively: real dictionary words are laid onto the
 * grid as self-avoiding 8-way paths (diagonals allowed, crossings not) that
 * must reuse letters already on the board, until every cell is covered. The
 * required word list *is* the construction, so every generated level is
 * solvable by definition — finding all placed words clears every letter.
 *
 * Works in the browser (window.RibbitGen) and in Node (module.exports) so the
 * same code can be unit-tested headlessly.
 */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else root.RibbitGen = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var MIN_LEN = 4;
  var MAX_LEN = 8;
  var FROG_COLOR_COUNT = 4;

  // ---- seeded RNG (xmur3 hash -> mulberry32) ----
  function hashSeed(str) {
    var h = 1779033703 ^ str.length;
    for (var i = 0; i < str.length; i++) {
      h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
      h = (h << 13) | (h >>> 19);
    }
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return (h ^= h >>> 16) >>> 0;
  }

  function mulberry32(a) {
    return function () {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function makeRng(seedStr) {
    return mulberry32(hashSeed(String(seedStr)));
  }

  function randInt(rng, n) {
    return Math.floor(rng() * n);
  }

  function pick(rng, arr) {
    return arr[randInt(rng, arr.length)];
  }

  // Weighted word-length choice; short words dominate so boards stay dense
  // with crossings rather than one long snake.
  function pickLen(rng, maxLen) {
    var weights = { 4: 34, 5: 30, 6: 20, 7: 11, 8: 5 };
    var total = 0;
    var len;
    for (len = MIN_LEN; len <= maxLen; len++) total += weights[len];
    var roll = rng() * total;
    for (len = MIN_LEN; len <= maxLen; len++) {
      roll -= weights[len];
      if (roll <= 0) return len;
    }
    return maxLen;
  }

  // Orthogonal neighbors (used for frog-group popping).
  function neighborsOf(cell, size) {
    var r = Math.floor(cell / size);
    var c = cell % size;
    var out = [];
    if (r > 0) out.push(cell - size);
    if (r < size - 1) out.push(cell + size);
    if (c > 0) out.push(cell - 1);
    if (c < size - 1) out.push(cell + 1);
    return out;
  }

  // All 8 neighbors — word paths may run diagonally.
  function neighbors8(cell, size) {
    var r = Math.floor(cell / size);
    var c = cell % size;
    var out = [];
    for (var dr = -1; dr <= 1; dr++) {
      for (var dc = -1; dc <= 1; dc++) {
        if (!dr && !dc) continue;
        var nr = r + dr, nc = c + dc;
        if (nr >= 0 && nr < size && nc >= 0 && nc < size) out.push(nr * size + nc);
      }
    }
    return out;
  }

  function isDiagonal(a, b, size) {
    return Math.floor(a / size) !== Math.floor(b / size) && a % size !== b % size;
  }

  // For a diagonal step a-b, the key of the opposite diagonal of the same
  // 2x2 square. Two crossing diagonal connections are never allowed — they
  // would overlap visually and read as one X.
  function crossKey(a, b, size) {
    var ra = Math.floor(a / size), ca = a % size;
    var rb = Math.floor(b / size), cb = b % size;
    return edgeKey(ra * size + cb, rb * size + ca);
  }

  function edgeKey(a, b) {
    return a < b ? a + '-' + b : b + '-' + a;
  }

  // Random self-avoiding 8-way walk of the given length. During the coverage
  // phase the walk is biased toward empty cells so the board fills quickly and
  // words are forced to cross existing letters. Diagonal steps are weighted
  // below orthogonal ones and may never cross an existing diagonal connection
  // (edgeSet holds every connection placed so far).
  function randomPath(rng, size, len, letters, preferEmpty, edgeSet) {
    var cellCount = size * size;
    var start;
    if (preferEmpty && rng() < 0.65) {
      var empties = [];
      for (var i = 0; i < cellCount; i++) if (letters[i] === null) empties.push(i);
      start = empties.length ? pick(rng, empties) : randInt(rng, cellCount);
    } else {
      start = randInt(rng, cellCount);
    }
    var path = [start];
    var inPath = {};
    var pathEdges = {};
    inPath[start] = true;
    while (path.length < len) {
      var last = path[path.length - 1];
      var options = [];
      var nbs = neighbors8(last, size);
      for (var j = 0; j < nbs.length; j++) {
        var nb = nbs[j];
        if (inPath[nb]) continue;
        var weight = 3;
        if (isDiagonal(last, nb, size)) {
          var ck = crossKey(last, nb, size);
          if (edgeSet[ck] || pathEdges[ck]) continue;
          weight = 2;
        }
        // Empty cells get extra tickets in the draw during coverage.
        if (preferEmpty && letters[nb] === null) weight *= 2;
        for (var t = 0; t < weight; t++) options.push(nb);
      }
      if (!options.length) return null;
      var next = pick(rng, options);
      pathEdges[edgeKey(last, next)] = true;
      path.push(next);
      inPath[next] = true;
    }
    return path;
  }

  function wordFitsPath(word, path, letters) {
    for (var i = 0; i < path.length; i++) {
      var have = letters[path[i]];
      if (have !== null && have !== word[i]) return false;
    }
    return true;
  }

  function parseDict(text) {
    var byLen = {};
    var byLenSet = {};
    for (var len = MIN_LEN; len <= MAX_LEN; len++) {
      byLen[len] = [];
      byLenSet[len] = {};
    }
    var words = text.split(/\s+/);
    for (var i = 0; i < words.length; i++) {
      var w = words[i];
      if (w.length < MIN_LEN || w.length > MAX_LEN) continue;
      if (!byLenSet[w.length][w]) {
        byLenSet[w.length][w] = true;
        byLen[w.length].push(w);
      }
    }
    return { byLen: byLen, byLenSet: byLenSet };
  }

  /**
   * Generate a puzzle.
   * @param {string} seedStr deterministic seed
   * @param {number} size grid side length (4-6)
   * @param {string} dictText whitespace-separated word list used for placement
   * @returns {{size, seed, letters, words, frogColors}}
   *   words: [{word, path, star}] — the required solution set.
   */
  function generate(seedStr, size, dictText) {
    var dict = parseDict(dictText);
    var rng = makeRng(seedStr);
    var cellCount = size * size;
    var maxLen = Math.min(MAX_LEN, cellCount);

    for (var restart = 0; restart < 60; restart++) {
      var letters = new Array(cellCount).fill(null);
      var placed = [];
      var usedWords = {};
      var edgeSet = {};
      var emptyCount = cellCount;
      var attempts = 0;
      var stuck = false;

      var recordEdges = function (path) {
        for (var e = 1; e < path.length; e++) edgeSet[edgeKey(path[e - 1], path[e])] = true;
      };

      // Coverage phase: place words until every cell holds a letter. Each
      // placement after the first must both touch an empty cell and (when
      // possible) reuse a filled one, so the board forms one crossing web.
      while (emptyCount > 0) {
        if (++attempts > 5000) {
          stuck = true;
          break;
        }
        var len = pickLen(rng, maxLen);
        var path = randomPath(rng, size, len, letters, true, edgeSet);
        if (!path) continue;
        var coversEmpty = false;
        var touchesFilled = false;
        for (var i = 0; i < path.length; i++) {
          if (letters[path[i]] === null) coversEmpty = true;
          else touchesFilled = true;
        }
        if (!coversEmpty) continue;
        // After the first word, require overlap with existing letters so the
        // puzzle is interlocked (matching Ribbit's shared-letter feel).
        if (placed.length > 0 && !touchesFilled && emptyCount < cellCount) continue;

        var candidates = [];
        var pool = dict.byLen[len];
        for (var k = 0; k < pool.length; k++) {
          var w = pool[k];
          if (usedWords[w]) continue;
          if (wordFitsPath(w, path, letters)) candidates.push(w);
        }
        if (!candidates.length) continue;

        var word = pick(rng, candidates);
        for (var p = 0; p < path.length; p++) {
          if (letters[path[p]] === null) emptyCount--;
          letters[path[p]] = word[p];
        }
        placed.push({ word: word, path: path });
        usedWords[word] = true;
        recordEdges(path);
      }
      if (stuck) continue;

      // Bonus phase: a few extra words traced entirely over existing letters,
      // adding crossings and word count without changing the board.
      var extraCap = Math.max(1, Math.floor(cellCount / 8));
      var extras = 0;
      for (var t = 0; t < cellCount * 40 && extras < extraCap; t++) {
        var elen = pickLen(rng, maxLen);
        var epath = randomPath(rng, size, elen, letters, false, edgeSet);
        if (!epath) continue;
        var s = '';
        for (var q = 0; q < epath.length; q++) s += letters[epath[q]];
        if (!dict.byLenSet[elen][s] || usedWords[s]) continue;
        placed.push({ word: s, path: epath });
        usedWords[s] = true;
        recordEdges(epath);
        extras++;
      }

      // Star words: the longest word(s) in the puzzle.
      var longest = 0;
      for (var m = 0; m < placed.length; m++) longest = Math.max(longest, placed[m].word.length);
      for (var n = 0; n < placed.length; n++) placed[n].star = placed[n].word.length === longest;

      // Pre-rolled frog colors keep daily puzzles fully deterministic.
      var frogColors = [];
      for (var f = 0; f < cellCount; f++) frogColors.push(randInt(rng, FROG_COLOR_COUNT));

      return {
        seed: String(seedStr),
        size: size,
        letters: letters,
        words: placed,
        frogColors: frogColors
      };
    }
    throw new Error('Ribbit generator: could not build a solvable board for seed ' + seedStr);
  }

  // ---- verification helpers (used by tests and available at runtime) ----

  // Simulates finding every required word and confirms the board fully clears:
  // valid paths, letters consistent, every cell and every edge owned by at
  // least one word (so nothing can be left stranded).
  function verifySolvable(puz) {
    var size = puz.size;
    var cellCount = size * size;
    var cellOwners = new Array(cellCount).fill(0);
    var allEdges = {};
    var seen = {};
    for (var i = 0; i < puz.words.length; i++) {
      var entry = puz.words[i];
      var word = entry.word;
      var path = entry.path;
      if (word.length < MIN_LEN) return 'word too short: ' + word;
      if (word.length !== path.length) return 'path length mismatch: ' + word;
      if (seen[word]) return 'duplicate word: ' + word;
      seen[word] = true;
      var inPath = {};
      for (var j = 0; j < path.length; j++) {
        var cell = path[j];
        if (cell < 0 || cell >= cellCount) return 'cell out of range: ' + word;
        if (inPath[cell]) return 'path revisits cell: ' + word;
        inPath[cell] = true;
        if (puz.letters[cell] !== word[j]) return 'letter mismatch: ' + word;
        cellOwners[cell]++;
        if (j > 0) {
          var a = path[j - 1];
          var ra = Math.floor(a / size), ca = a % size;
          var rb = Math.floor(cell / size), cb = cell % size;
          if (Math.max(Math.abs(ra - rb), Math.abs(ca - cb)) !== 1) return 'non-adjacent step: ' + word;
          allEdges[edgeKey(a, cell)] = true;
        }
      }
    }
    for (var c = 0; c < cellCount; c++) {
      if (puz.letters[c] === null) return 'uncovered cell ' + c;
      if (cellOwners[c] === 0) return 'cell ' + c + ' belongs to no word';
    }
    // No two diagonal connections may cross each other.
    var edgeList = Object.keys(allEdges);
    for (var k2 = 0; k2 < edgeList.length; k2++) {
      var ends = edgeList[k2].split('-');
      var e1 = +ends[0], e2 = +ends[1];
      if (isDiagonal(e1, e2, size) && allEdges[crossKey(e1, e2, size)]) {
        return 'crossing diagonal connections at ' + edgeList[k2];
      }
    }
    return null; // solvable
  }

  return {
    MIN_LEN: MIN_LEN,
    MAX_LEN: MAX_LEN,
    FROG_COLOR_COUNT: FROG_COLOR_COUNT,
    makeRng: makeRng,
    edgeKey: edgeKey,
    neighborsOf: neighborsOf,
    neighbors8: neighbors8,
    isDiagonal: isDiagonal,
    crossKey: crossKey,
    parseDict: parseDict,
    generate: generate,
    verifySolvable: verifySolvable
  };
});
