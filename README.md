# Ribbit 🐸

A fan-made, personal-use homage to Puzzmo's *Ribbit* word puzzle. Original code
and art; not affiliated with Puzzmo. Runs entirely in the browser with no build
step, no server, and no dependencies.

## Play

Open `index.html` in a browser, or serve the folder:

```sh
python3 -m http.server 8000
# then visit http://localhost:8000
```

## How it plays

- The board is a grid of letter circles joined by visible paths, including
  diagonals (two diagonal paths never cross each other).
- **Drag along the paths** to trace words of 4+ letters. Every path belongs to
  at least one hidden word; the side panel shows how many words of each length
  remain, and **★** marks the longest word in the puzzle.
- The segmented arc around each circle shows the letter's remaining uses —
  one segment per unfound word, disappearing as words are found.
- When a letter's last word is found it turns into a **frog**, and paths vanish
  once every word using them is found — the board simplifies as you go.
- **Tap groups of 2+ same-colored frogs** to pop them for bonus points
  (score scales with the square of the group size).
- Real dictionary words that aren't part of the puzzle earn a small bonus.
- Find every word to clear the pond.

Modes: **Daily** (seeded from today's date — same puzzle every time) and
**New** (random). Board sizes 4×4, 5×5, 6×6. Progress is saved in
`localStorage`, so you can close the tab and resume.

## Levels are generated on the fly — and always solvable

There is no level bank. Every puzzle is built at load time by
`js/generator.js`:

1. A seeded RNG (xmur3 + mulberry32) drives everything, so a seed uniquely
   determines the puzzle.
2. Real dictionary words are laid onto the grid as self-avoiding 8-way paths
   (diagonals allowed, but two diagonal connections never cross). After the
   first word, each placement must cross letters already on the board, so the
   puzzle forms one interlocking web.
3. Placement repeats until **every cell is covered by at least one word**;
   a few extra words traced over existing letters are added for density.
4. The required word list *is* the construction — solvability is guaranteed
   by definition, not by search. At runtime, a path or letter is only removed
   once *all* words using it are found, so no remaining word can ever be
   stranded mid-game either.

`Gen.verifySolvable()` re-checks any generated puzzle (path validity, full
coverage, no orphaned letters). The test suite generates hundreds of boards
across all sizes and asserts each one verifies:

```sh
node test/generator.test.js
```

## Word lists

- `js/data-common.js` — common English words (from the public
  [google-10000-english](https://github.com/first20hours/google-10000-english)
  list, intersected with ENABLE to drop proper nouns), used to build puzzles.
- `js/data-valid.js` — the public-domain
  [ENABLE](https://github.com/dolph/dictionary) word list, used to validate
  bonus words.

## Files

| File | Purpose |
| --- | --- |
| `index.html` | page shell |
| `style.css` | pond theme |
| `js/generator.js` | seeded, always-solvable level generator (browser + Node) |
| `js/game.js` | board rendering, tracing input, frogs, scoring, saving |
| `js/data-*.js` | word lists |
| `test/generator.test.js` | headless solvability tests |
