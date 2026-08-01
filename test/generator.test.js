// Headless generator tests: every generated level must verify as solvable.
// Run with: node test/generator.test.js
'use strict';

const path = require('path');
const Gen = require(path.join(__dirname, '..', 'js', 'generator.js'));
const COMMON = require(path.join(__dirname, '..', 'js', 'data-common.js'));

const SIZES = [4, 5, 6];
const SEEDS_PER_SIZE = 80;

let failures = 0;
let totalWords = 0;
let totalPuzzles = 0;

for (const size of SIZES) {
  const start = Date.now();
  let words = 0;
  for (let i = 0; i < SEEDS_PER_SIZE; i++) {
    const seed = `test-${size}-${i}`;
    let puz;
    try {
      puz = Gen.generate(seed, size, COMMON);
    } catch (err) {
      console.error(`FAIL generate ${seed}: ${err.message}`);
      failures++;
      continue;
    }
    const problem = Gen.verifySolvable(puz);
    if (problem) {
      console.error(`FAIL verify ${seed}: ${problem}`);
      failures++;
      continue;
    }
    // Completeness: every common word traceable along the board's connections
    // must be a required word — the game never rejects a traceable word.
    const edgeSet = {};
    for (const entry of puz.words) {
      for (let j = 1; j < entry.path.length; j++) {
        edgeSet[Gen.edgeKey(entry.path[j - 1], entry.path[j])] = true;
      }
    }
    const inList = new Set(puz.words.map((w) => w.word));
    const traceable = Gen.sweepWords(puz.letters, edgeSet, size, Gen.parseDict(COMMON));
    const missing = traceable.filter((t) => !inList.has(t.word));
    if (missing.length) {
      console.error(`FAIL completeness ${seed}: traceable but unlisted: ${missing.map((m) => m.word).join(', ')}`);
      failures++;
      continue;
    }
    words += puz.words.length;
  }
  totalWords += words;
  totalPuzzles += SEEDS_PER_SIZE;
  const ms = Date.now() - start;
  console.log(
    `size ${size}x${size}: ${SEEDS_PER_SIZE} puzzles ok, ` +
      `avg ${(words / SEEDS_PER_SIZE).toFixed(1)} words, ` +
      `${(ms / SEEDS_PER_SIZE).toFixed(1)} ms/puzzle`
  );
}

// Determinism: the same seed must always produce the same puzzle.
const a = Gen.generate('determinism-check', 5, COMMON);
const b = Gen.generate('determinism-check', 5, COMMON);
if (JSON.stringify(a) !== JSON.stringify(b)) {
  console.error('FAIL: generation is not deterministic for identical seeds');
  failures++;
} else {
  console.log('determinism: identical seeds produce identical puzzles');
}

// Distinct seeds should produce distinct boards (sanity, not a guarantee).
const c = Gen.generate('determinism-check-2', 5, COMMON);
if (JSON.stringify(a) === JSON.stringify(c)) {
  console.error('FAIL: different seeds produced identical puzzles');
  failures++;
}

if (failures) {
  console.error(`\n${failures} failure(s) across ${totalPuzzles} puzzles`);
  process.exit(1);
}
console.log(`\nAll ${totalPuzzles} generated puzzles verified solvable (${totalWords} words placed).`);
