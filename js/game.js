/* Ribbit clone — game UI and state. Original implementation. */
(function () {
  'use strict';

  var Gen = window.RibbitGen;
  var SAVE_KEY = 'ribbit-state-v1';
  var FROG_FILLS = ['var(--frog-0)', 'var(--frog-1)', 'var(--frog-2)', 'var(--frog-3)'];

  // Validation set for bonus words (any real word the puzzle didn't ask for).
  var validSet = (function () {
    var set = {};
    var words = RIBBIT_VALID_WORDS.split(/\s+/);
    for (var i = 0; i < words.length; i++) set[words[i]] = true;
    return set;
  })();

  // ---- DOM ----
  var boardEl = document.getElementById('board');
  var edgeLayer = document.getElementById('edge-layer');
  var traceLayer = document.getElementById('trace-layer');
  var traceWordEl = document.getElementById('trace-word');
  var scoreEl = document.getElementById('score');
  var progressEl = document.getElementById('progress');
  var wordGroupsEl = document.getElementById('word-groups');
  var bonusCountEl = document.getElementById('bonus-count');
  var bonusListEl = document.getElementById('bonus-list');
  var seedLabelEl = document.getElementById('seed-label');
  var toastEl = document.getElementById('toast');
  var sizeSelect = document.getElementById('size-select');
  var winOverlay = document.getElementById('win-overlay');
  var winSummary = document.getElementById('win-summary');
  var helpOverlay = document.getElementById('help-overlay');

  // ---- game state ----
  var puz = null;          // {seed,size,letters,words,frogColors}
  var found = {};          // word -> true
  var foundCount = 0;
  var bonusWords = [];     // claimed bonus words (order found)
  var popped = {};         // cellIdx -> true
  var score = 0;

  // derived
  var cellOwners = [];     // cellIdx -> [word indices]
  var edgeOwners = {};     // edgeKey -> [word indices]
  var wordIndex = {};      // word -> index in puz.words
  var tiles = [];          // cellIdx -> tile element
  var edgeLines = {};      // edgeKey -> svg line

  // interaction
  var tracing = false;
  var trace = [];          // cell indices in trace order
  var toastTimer = null;
  var hintTimer = null;

  // ---------------------------------------------------------------- helpers
  function cs() { return 100 / puz.size; }

  function center(cell) {
    var s = cs();
    return {
      x: (cell % puz.size + 0.5) * s,
      y: (Math.floor(cell / puz.size) + 0.5) * s
    };
  }

  function unfoundOwnerCount(cell) {
    var n = 0;
    var owners = cellOwners[cell];
    for (var i = 0; i < owners.length; i++) {
      if (!found[puz.words[owners[i]].word]) n++;
    }
    return n;
  }

  function edgeLive(key) {
    var owners = edgeOwners[key];
    if (!owners) return false;
    for (var i = 0; i < owners.length; i++) {
      if (!found[puz.words[owners[i]].word]) return true;
    }
    return false;
  }

  function cellState(cell) {
    if (popped[cell]) return 'pad';
    if (unfoundOwnerCount(cell) === 0) return 'frog';
    return 'letter';
  }

  function dailySeed(size) {
    var d = new Date();
    var iso = d.getFullYear() + '-' +
      String(d.getMonth() + 1).padStart(2, '0') + '-' +
      String(d.getDate()).padStart(2, '0');
    return 'daily-' + iso + '-' + size;
  }

  function randomSeed() {
    return 'pond-' + Date.now().toString(36) + '-' + Math.floor(Math.random() * 1e6).toString(36);
  }

  // ---------------------------------------------------------------- setup
  function newGame(seed, size) {
    puz = Gen.generate(seed, size, RIBBIT_COMMON_WORDS);
    found = {};
    foundCount = 0;
    bonusWords = [];
    popped = {};
    score = 0;
    deriveOwners();
    buildBoard();
    refreshAll();
    save();
  }

  function deriveOwners() {
    cellOwners = [];
    edgeOwners = {};
    wordIndex = {};
    for (var c = 0; c < puz.size * puz.size; c++) cellOwners.push([]);
    for (var w = 0; w < puz.words.length; w++) {
      var entry = puz.words[w];
      wordIndex[entry.word] = w;
      for (var i = 0; i < entry.path.length; i++) {
        cellOwners[entry.path[i]].push(w);
        if (i > 0) {
          var key = Gen.edgeKey(entry.path[i - 1], entry.path[i]);
          (edgeOwners[key] = edgeOwners[key] || []).push(w);
        }
      }
    }
  }

  function frogSVG(colorIdx) {
    var fill = FROG_FILLS[colorIdx];
    return '<svg class="frog-svg" viewBox="0 0 100 100">' +
      '<ellipse cx="50" cy="62" rx="34" ry="26" fill="' + fill + '"/>' +
      '<circle cx="33" cy="34" r="13" fill="' + fill + '"/>' +
      '<circle cx="67" cy="34" r="13" fill="' + fill + '"/>' +
      '<circle cx="33" cy="33" r="7" fill="#fff"/>' +
      '<circle cx="67" cy="33" r="7" fill="#fff"/>' +
      '<circle cx="34" cy="34" r="3.2" fill="#222"/>' +
      '<circle cx="66" cy="34" r="3.2" fill="#222"/>' +
      '<path d="M36 66 Q50 76 64 66" stroke="#1e3b1a" stroke-width="3.5" fill="none" stroke-linecap="round"/>' +
      '<ellipse cx="26" cy="82" rx="9" ry="5" fill="' + fill + '"/>' +
      '<ellipse cx="74" cy="82" rx="9" ry="5" fill="' + fill + '"/>' +
      '</svg>';
  }

  function buildBoard() {
    boardEl.querySelectorAll('.tile').forEach(function (t) { t.remove(); });
    edgeLayer.innerHTML = '';
    traceLayer.innerHTML = '';
    tiles = [];
    edgeLines = {};

    var s = cs();
    var tileFrac = 0.82;

    // edges first (under tiles visually since SVG is behind tiles in stacking)
    Object.keys(edgeOwners).forEach(function (key) {
      var parts = key.split('-');
      var a = center(+parts[0]);
      var b = center(+parts[1]);
      var line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('x1', a.x); line.setAttribute('y1', a.y);
      line.setAttribute('x2', b.x); line.setAttribute('y2', b.y);
      line.setAttribute('stroke-width', s * 0.16);
      edgeLayer.appendChild(line);
      edgeLines[key] = line;
    });

    for (var cell = 0; cell < puz.size * puz.size; cell++) {
      var tile = document.createElement('div');
      tile.className = 'tile';
      tile.dataset.cell = cell;
      var pt = center(cell);
      tile.style.width = (s * tileFrac) + '%';
      tile.style.height = (s * tileFrac) + '%';
      tile.style.left = (pt.x - s * tileFrac / 2) + '%';
      tile.style.top = (pt.y - s * tileFrac / 2) + '%';
      boardEl.appendChild(tile);
      tiles.push(tile);
    }
    fitFonts();
  }

  function fitFonts() {
    if (!puz) return;
    var px = boardEl.clientWidth / puz.size;
    boardEl.style.fontSize = Math.max(12, px * 0.42) + 'px';
  }

  // ---------------------------------------------------------------- rendering
  function polar(r, deg) {
    var rad = ((deg - 90) * Math.PI) / 180;
    return { x: 50 + r * Math.cos(rad), y: 50 + r * Math.sin(rad) };
  }

  // Segmented arc around the tile: one segment per unfound word still using
  // this letter, out of the letter's total word count. Segments disappear
  // clockwise from the top as words are found.
  function ringSVG(remaining, total) {
    var r = 44.5;
    var step = 360 / total;
    var gap = total === 1 ? 10 : Math.min(20, step * 0.28);
    var paths = '';
    for (var i = 0; i < remaining; i++) {
      var a0 = i * step + gap / 2;
      var a1 = (i + 1) * step - gap / 2;
      var p0 = polar(r, a0);
      var p1 = polar(r, a1);
      var large = a1 - a0 > 180 ? 1 : 0;
      paths += '<path d="M ' + p0.x.toFixed(2) + ' ' + p0.y.toFixed(2) +
        ' A ' + r + ' ' + r + ' 0 ' + large + ' 1 ' +
        p1.x.toFixed(2) + ' ' + p1.y.toFixed(2) + '"/>';
    }
    return '<svg class="ring" viewBox="0 0 100 100">' + paths + '</svg>';
  }

  function renderTile(cell) {
    var tile = tiles[cell];
    var state = cellState(cell);
    var inTrace = trace.indexOf(cell) !== -1;
    tile.className = 'tile' +
      (state === 'frog' ? ' frog' : state === 'pad' ? ' pad' : '') +
      (inTrace ? ' selected' : '');
    if (state === 'letter') {
      tile.innerHTML = ringSVG(unfoundOwnerCount(cell), cellOwners[cell].length) +
        '<span class="letter">' + puz.letters[cell] + '</span>';
    } else if (state === 'frog') {
      tile.innerHTML = frogSVG(puz.frogColors[cell]);
    } else {
      tile.innerHTML = '';
    }
  }

  function renderEdges() {
    Object.keys(edgeLines).forEach(function (key) {
      edgeLines[key].classList.toggle('gone', !edgeLive(key));
    });
  }

  function renderTrace() {
    traceLayer.innerHTML = '';
    if (trace.length > 1) {
      var pts = trace.map(function (cell) {
        var p = center(cell);
        return p.x + ',' + p.y;
      }).join(' ');
      var poly = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
      poly.setAttribute('points', pts);
      poly.setAttribute('stroke-width', cs() * 0.3);
      traceLayer.appendChild(poly);
    }
    var word = trace.map(function (c) { return puz.letters[c]; }).join('');
    traceWordEl.textContent = word || ' ';
  }

  function renderSide() {
    // group required words by length
    var byLen = {};
    puz.words.forEach(function (entry) {
      (byLen[entry.word.length] = byLen[entry.word.length] || []).push(entry);
    });
    var html = '';
    Object.keys(byLen).map(Number).sort(function (a, b) { return a - b; }).forEach(function (len) {
      var group = byLen[len].slice().sort(function (a, b) {
        var fa = found[a.word] ? 0 : 1, fb = found[b.word] ? 0 : 1;
        return fa - fb || a.word.localeCompare(b.word);
      });
      var foundHere = group.filter(function (e) { return found[e.word]; }).length;
      html += '<div class="word-group"><h3>' + len + ' letters · ' +
        foundHere + '/' + group.length + '</h3><div class="word-chips">';
      group.forEach(function (entry) {
        var star = entry.star ? ' <span class="star-mark">★</span>' : '';
        if (found[entry.word]) {
          html += '<span class="chip found">' + entry.word + star + '</span>';
        } else {
          html += '<span class="chip unfound">' + new Array(len + 1).join('·') + star + '</span>';
        }
      });
      html += '</div></div>';
    });
    wordGroupsEl.innerHTML = html;

    bonusCountEl.textContent = bonusWords.length;
    bonusListEl.innerHTML = bonusWords.map(function (w) { return '<span>' + w + '</span>'; }).join('');
    seedLabelEl.textContent = puz.seed + ' · ' + puz.size + '×' + puz.size;
  }

  function refreshAll() {
    for (var c = 0; c < tiles.length; c++) renderTile(c);
    renderEdges();
    renderTrace();
    renderSide();
    scoreEl.textContent = score;
    progressEl.textContent = foundCount + '/' + puz.words.length;
  }

  function toast(msg, cls) {
    toastEl.textContent = msg;
    toastEl.className = 'toast show' + (cls ? ' ' + cls : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.className = 'toast'; }, 1600);
  }

  // ---------------------------------------------------------------- gameplay
  // Finding a plural also clears its unfound singular (walls -> wall,
  // dishes -> dish) so near-duplicate slots never linger.
  function pluralSiblings(word) {
    var sibs = [];
    if (word.charAt(word.length - 1) === 's') {
      var s1 = word.slice(0, -1);
      if (wordIndex.hasOwnProperty(s1) && !found[s1]) sibs.push(s1);
      if (word.slice(-2) === 'es') {
        var s2 = word.slice(0, -2);
        if (wordIndex.hasOwnProperty(s2) && !found[s2]) sibs.push(s2);
      }
    }
    return sibs;
  }

  function wordPoints(entry) {
    return entry.word.length * 10 + (entry.star ? 25 : 0);
  }

  // Draw the completed trace once more so it can flash and fade with the
  // tiles; cleared by the next refreshAll().
  function resultLine(cells, cls) {
    traceLayer.innerHTML = '';
    if (cells.length < 2) return;
    var pts = cells.map(function (cell) {
      var p = center(cell);
      return p.x + ',' + p.y;
    }).join(' ');
    var poly = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
    poly.setAttribute('points', pts);
    poly.setAttribute('stroke-width', cs() * 0.3);
    poly.setAttribute('class', cls);
    traceLayer.appendChild(poly);
  }

  function flashTiles(cells, cls, stagger) {
    cells.forEach(function (cell, i) {
      var tile = tiles[cell];
      tile.classList.remove('selected');
      if (stagger) tile.style.animationDelay = (i * 45) + 'ms';
      tile.classList.add(cls);
    });
  }

  function claimWord(word, cells) {
    var entry = puz.words[wordIndex[word]];
    found[word] = true;
    foundCount++;
    var pts = wordPoints(entry);
    var also = pluralSiblings(word);
    also.forEach(function (sib) {
      found[sib] = true;
      foundCount++;
      pts += wordPoints(puz.words[wordIndex[sib]]);
    });
    score += pts;

    var label = (entry.star ? '★ ' : '') + word.toUpperCase() + ' +' + pts;
    if (also.length) label += ' · also ' + also.join(', ').toUpperCase();
    toast(label, entry.star ? 'star' : 'good');
    scoreEl.textContent = score;
    progressEl.textContent = foundCount + '/' + puz.words.length;

    resultLine(cells, 'correct-line');
    flashTiles(cells, 'correct', true);
    setTimeout(function () {
      cells.forEach(function (c) { tiles[c].style.animationDelay = ''; });
      refreshAll();
      save();
      if (foundCount === puz.words.length) setTimeout(showWin, 500);
    }, 480 + cells.length * 45);
  }

  function rejectTrace(cells, msg) {
    toast(msg);
    resultLine(cells, 'wrong-line');
    flashTiles(cells, 'wrong', false);
    setTimeout(refreshAll, 460);
  }

  function submitTrace() {
    var cells = trace.slice();
    trace = [];
    tracing = false;
    if (cells.length < 2) { renderTrace(); refreshAll(); return; }
    var word = cells.map(function (c) { return puz.letters[c]; }).join('');
    if (word.length < Gen.MIN_LEN) {
      rejectTrace(cells, 'Words need ' + Gen.MIN_LEN + '+ letters');
    } else if (wordIndex.hasOwnProperty(word) && !found[word]) {
      claimWord(word, cells);
    } else if (found[word]) {
      toast('Already found');
      refreshAll();
    } else if (validSet[word] && bonusWords.indexOf(word) === -1) {
      bonusWords.push(word);
      score += 5;
      toast('Bonus! ' + word.toUpperCase() + ' +5', 'good');
      scoreEl.textContent = score;
      resultLine(cells, 'correct-line');
      flashTiles(cells, 'correct', false);
      setTimeout(function () { refreshAll(); save(); }, 480);
    } else if (bonusWords.indexOf(word) !== -1) {
      toast('Bonus already found');
      refreshAll();
    } else {
      rejectTrace(cells, 'Not a word in this pond');
    }
  }

  function popFrogs(cell) {
    var color = puz.frogColors[cell];
    var group = [];
    var seen = {};
    var stack = [cell];
    while (stack.length) {
      var cur = stack.pop();
      if (seen[cur]) continue;
      seen[cur] = true;
      if (cellState(cur) !== 'frog' || puz.frogColors[cur] !== color) continue;
      group.push(cur);
      Gen.neighborsOf(cur, puz.size).forEach(function (nb) { stack.push(nb); });
    }
    if (group.length < 2) {
      tiles[cell].classList.add('wiggle');
      setTimeout(function () { tiles[cell].classList.remove('wiggle'); }, 320);
      toast('Frogs pop in groups of 2+');
      return;
    }
    var pts = 5 * group.length * group.length;
    score += pts;
    group.forEach(function (c) { tiles[c].classList.add('popping'); });
    toast('Pop ×' + group.length + '! +' + pts, 'good');
    setTimeout(function () {
      group.forEach(function (c) { popped[c] = true; });
      refreshAll();
      save();
    }, 340);
    scoreEl.textContent = score;
  }

  function showWin() {
    var frogsLeft = 0;
    for (var c = 0; c < tiles.length; c++) if (cellState(c) === 'frog') frogsLeft++;
    winSummary.innerHTML =
      'You found all <strong>' + puz.words.length + '</strong> words' +
      (bonusWords.length ? ' plus ' + bonusWords.length + ' bonus word' + (bonusWords.length > 1 ? 's' : '') : '') +
      '.<br>Score: <strong>' + score + '</strong>' +
      (frogsLeft ? '<br><small>' + frogsLeft + ' frogs are still on the pond — pop them for extra points!</small>' : '');
    winOverlay.classList.remove('hidden');
  }

  // ---------------------------------------------------------------- hint
  function giveHint() {
    var unfound = puz.words.filter(function (e) { return !found[e.word]; });
    if (!unfound.length) { toast('Nothing left to hint!'); return; }
    var entry = unfound[Math.floor(Math.random() * unfound.length)];
    score = Math.max(0, score - 15);
    scoreEl.textContent = score;
    save();

    clearTimeout(hintTimer);
    traceLayer.innerHTML = '';
    var pts = entry.path.map(function (cell) {
      var p = center(cell);
      return p.x + ',' + p.y;
    }).join(' ');
    var poly = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
    poly.setAttribute('points', pts);
    poly.setAttribute('stroke-width', cs() * 0.3);
    poly.setAttribute('class', 'hint-line');
    traceLayer.appendChild(poly);
    tiles[entry.path[0]].classList.add('hint-glow');
    toast('A word starts at ' + puz.letters[entry.path[0]].toUpperCase() + '… (−15)');
    hintTimer = setTimeout(function () {
      traceLayer.innerHTML = '';
      tiles[entry.path[0]].classList.remove('hint-glow');
    }, 2600);
  }

  // ---------------------------------------------------------------- input
  function cellAtPoint(clientX, clientY) {
    var rect = boardEl.getBoundingClientRect();
    var x = (clientX - rect.left) / rect.width * 100;
    var y = (clientY - rect.top) / rect.height * 100;
    if (x < 0 || y < 0 || x >= 100 || y >= 100) return -1;
    var s = cs();
    var col = Math.floor(x / s);
    var row = Math.floor(y / s);
    var cell = row * puz.size + col;
    var p = center(cell);
    var dx = x - p.x, dy = y - p.y;
    // require the pointer near the tile center so diagonal swipes don't
    // accidentally grab corner tiles
    if (Math.sqrt(dx * dx + dy * dy) > s * 0.4) return -1;
    return cell;
  }

  function tryExtend(cell) {
    if (cell < 0 || cellState(cell) !== 'letter') return;
    var idx = trace.indexOf(cell);
    var last = trace[trace.length - 1];
    if (idx !== -1) {
      // backtracking: sliding back onto the previous tile trims the trace
      if (trace.length >= 2 && cell === trace[trace.length - 2]) {
        trace.pop();
        renderTile(last);
        renderTrace();
      }
      return;
    }
    if (edgeLive(Gen.edgeKey(last, cell))) {
      trace.push(cell);
      renderTile(cell);
      renderTrace();
    }
  }

  boardEl.addEventListener('pointerdown', function (e) {
    e.preventDefault();
    var cell = cellAtPoint(e.clientX, e.clientY);
    if (cell < 0) return;
    var state = cellState(cell);
    if (state === 'frog') { popFrogs(cell); return; }
    if (state !== 'letter') return;
    boardEl.setPointerCapture(e.pointerId);
    tracing = true;
    trace = [cell];
    renderTile(cell);
    renderTrace();
  });

  boardEl.addEventListener('pointermove', function (e) {
    if (!tracing) return;
    tryExtend(cellAtPoint(e.clientX, e.clientY));
  });

  boardEl.addEventListener('pointerup', function () {
    if (tracing) submitTrace();
  });
  boardEl.addEventListener('pointercancel', function () {
    if (tracing) { trace = []; tracing = false; refreshAll(); }
  });

  // ---------------------------------------------------------------- save/load
  function save() {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify({
        seed: puz.seed,
        size: puz.size,
        found: Object.keys(found),
        bonus: bonusWords,
        popped: Object.keys(popped).map(Number),
        score: score
      }));
    } catch (err) { /* private mode etc. — play without saving */ }
  }

  function tryRestore() {
    var raw;
    try { raw = localStorage.getItem(SAVE_KEY); } catch (err) { return false; }
    if (!raw) return false;
    try {
      var data = JSON.parse(raw);
      puz = Gen.generate(data.seed, data.size, RIBBIT_COMMON_WORDS);
      deriveOwners();
      found = {};
      foundCount = 0;
      data.found.forEach(function (w) {
        if (wordIndex.hasOwnProperty(w)) { found[w] = true; foundCount++; }
      });
      bonusWords = data.bonus || [];
      popped = {};
      (data.popped || []).forEach(function (c) { popped[c] = true; });
      score = data.score || 0;
      sizeSelect.value = String(data.size);
      buildBoard();
      refreshAll();
      return true;
    } catch (err) {
      return false;
    }
  }

  // ---------------------------------------------------------------- controls
  document.getElementById('btn-new').addEventListener('click', function () {
    newGame(randomSeed(), +sizeSelect.value);
  });
  document.getElementById('btn-daily').addEventListener('click', function () {
    newGame(dailySeed(+sizeSelect.value), +sizeSelect.value);
  });
  sizeSelect.addEventListener('change', function () {
    newGame(randomSeed(), +sizeSelect.value);
  });
  document.getElementById('btn-hint').addEventListener('click', giveHint);
  document.getElementById('btn-help').addEventListener('click', function () {
    helpOverlay.classList.remove('hidden');
  });
  document.getElementById('btn-close-help').addEventListener('click', function () {
    helpOverlay.classList.add('hidden');
  });
  document.getElementById('btn-keep-popping').addEventListener('click', function () {
    winOverlay.classList.add('hidden');
  });
  document.getElementById('btn-play-again').addEventListener('click', function () {
    winOverlay.classList.add('hidden');
    newGame(randomSeed(), +sizeSelect.value);
  });

  window.addEventListener('resize', fitFonts);

  // ---------------------------------------------------------------- boot
  if (!tryRestore()) {
    newGame(dailySeed(+sizeSelect.value), +sizeSelect.value);
  }
})();
