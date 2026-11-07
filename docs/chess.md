# LearnHarness Chess

Open **Chess** in the sidebar, or visit `/chess`. The existing non-chess lessons,
model settings, knowledge graph and practice flow remain in use. No provider key,
game import or platform account is needed to read the 24 concept cards or try the
board preview. Starting a guided lesson uses the existing configured LearnHarness
tutor and its normal readiness checks.

## Study and practice

The library covers opening principles, the Sicilian, king safety, tactical motifs,
pawn structure and endgames. Each card carries prerequisites, an exception,
illustrative FENs, objectives, editorial revision and source authority. Editorial
review does not certify a principle as an engine verdict. Six short, rule-checked
opening examples are attributed to the CC0 Lichess opening dataset; these are not
the entire ECO database and do not imply empirical move frequencies.

Teaching and probing have two additional reference tools and one answer modality.
Lessons launched from this workspace explicitly request chess and expose both MCQ
and recall beside the board. Other lessons retain their existing selected mechanic:

- `chess_reference`: versioned concept cards and named opening examples.
- `chess_analyze`: real, bounded Stockfish evaluations of a FEN or full UCI line.
- `chessboard`: a validated FEN, learner side, one to eight learner moves,
  fixed opponent replies, one or more acceptable learner-only lines, and a
  separately committed explanation rubric. Teaching validates its plan node.

Practice extends the existing `problem` contract with an optional `chess` field;
`thinking` and `conclude` retain ownership of the practice lifecycle. Ordinary
thinking and requests for hints remain available beside the board. A structured
board answer is validated again at the server's native input seam. No parallel
teacher or practice agent is introduced.

The board supports click/keyboard selection, orientation, castling, all four
promotion choices, en passant, check, terminal outcomes, undo, restart, SAN history,
explanation and confidence. Browser drafts preserve unsubmitted moves on reload;
submitted questions and answers live in the existing server-owned session record.
Drafts are local to the browser, rather than synchronised between devices.

All authored accepted lines are replayed with chess.js before posing or display.
UCI answers are replayed server-side; a client cannot submit a forged final FEN.
A legal deviation ends fixed replies and enables legal exploration. Lesson-line
matching is labelled explicitly: an alternative legal move is not automatically
bad. Use `chess_analyze` before claiming engine superiority, and include several
acceptable moves when the bounded analysis supports them. Move matching and
explanation quality are separate; explanation grades await the tutor's review,
which is conveyed in the normal conversation, not an invented numeric score.

## Import and review

Upload multiple PGNs, or paste them, and enter the learner's name as it appears in
White or Black. The shared importer accepts completed standard-chess games,
validates their moves, preserves the raw PGN and available clocks, and reports
rejected games individually. External game IDs and SHA-256 canonical fingerprints
deduplicate imports. Unknown dates and rated status remain unknown. Checkmate,
stalemate, resignation, timeout and abandonment remain distinct.

Original game records are immutable. Analysis is separate and records Stockfish
identity, settings, actual depth/nodes per position, evaluation perspective and
critical game/ply/FEN references. The current bounded search uses at most depth 12
or 100,000 nodes for each searched position, one thread and a 16 MiB hash. A game
is capped at 600 plies for interactive analysis. A failed retry preserves existing
successful analysis. Mate scores are kept separate rather than converted into
invented centipawn values.

Install an official Stockfish binary for your system and set, for example:

```sh
STOCKFISH_PATH=/absolute/path/to/stockfish npm run dev
```

If unset, the executable `stockfish` is searched on `PATH`. No executable is
downloaded by the app, and no binary is bundled. Missing or failed engines leave
import and study usable and produce an explicit unavailable result.

The first concept detector is deliberately narrow: **piece safety**. An opportunity
is a learner position containing an attacked, undefended non-pawn piece. A candidate
error requires exposed material after the move and at least 150 cp of bounded
engine loss. Centipawn loss alone does not attach a concept. Patterns include
supporting game positions, opportunity counts, examples and limitations; fewer
than three distinct supporting games are labelled insufficient evidence. This
rule-based detector is a hypothesis generator, not a diagnosis of understanding.

## Optional public accounts

Chess.com and Lichess connections use public usernames, without account passwords
or OAuth. Preview the completed-game count and time controls, then confirm before
the fetched data is committed. You can sync again, disconnect while keeping history,
or explicitly clear an account's synced local data. Read-only public API requests
never submit moves or provide live-game assistance. Optional Lichess account
verification through OAuth remains deferred.

- **Chess.com:** fetch the most recent 12 archive months on initial connection.
  Subsequent syncs fetch unseen months in that window and revisit the latest two
  months for delayed records. Per-game rated observations reconstruct history.
- **Lichess:** fetch at most 500 completed PGNs per request, oldest first, initially
  within one year. Subsequent syncs use a two-day overlap and preserve the cursor.
  API historical ratings are imported separately. A full 500-game window produces
  a coverage warning; high-volume overlap windows may require a manual export.
- The coverage limits are shown in the preview and saved connection diagnostics;
  older games can always be uploaded manually. Multiple identities are supported.
- API requests are sequential, have bounded response size and timeouts, and retry
  transient failures with backoff. `Retry-After` is honoured; a longer requested
  delay is surfaced for a later retry. Public archive URLs are validated before
  fetching, and redirects are refused.
- Optional auto-sync occurs when the chess workspace opens, at most once per
  account every 15 minutes. There is no background cloud scheduler or OAuth token
  storage. Manual **Sync now** is always available.
- Sync states are `idle`, `syncing`, `success`, `partial` and `failed`. Success is
  written only with committed data; errors retain history and the prior cursor.

Rating series are keyed by platform, username and time control. Chess.com and
Lichess ratings are never pooled. Charts show dated observations, rated game
counts, API versus game-reconstructed coverage and limitations. Unknown/unrated
games do not silently become rated observations.

## Evidence and persistence

Chess data lives in `<LH_DATA_DIR>/chess/history.json`, version 1, with restricted
file permissions and atomic temp-file replacement. Like the rest of LearnHarness,
use one server owner per data profile. Never run two servers against this file.
Normal session records remain the durable truth for lesson answers; the chess API
reconciles their structured board evidence idempotently when progress is read.
Projection failures are reported and leave original sessions intact.

Progress separates baseline and later games using recorded game dates and the
first targeted practice timestamp. Error rates require defined opportunities;
zero observed opportunities gives an unavailable rate, not evidence of mastery.
Held-out results require an explicitly held-out question and a previously unused
position. Known curriculum examples and repeated submitted positions are excluded.
The application does not certify that a position was unseen outside LearnHarness;
the tutor must avoid personal-game or previously taught examples when authoring a
transfer test. Practised previews do not count as independent transfer. Rating
changes never establish tutor efficacy.

## Validation

Use Node 26 and the standard repository checks:

```sh
npm ci
npm run typecheck
npm test
npm run lint
npm run build
```

The new `tests/chess.test.ts` covers legal lines, special moves, native question and
practice integration, PGN deduplication/termination/clocks, platform normalisation,
preview/commit, rating separation, failed sync preservation, held-out reuse,
engine failure and traceable hypotheses. Its platform traffic is synthetic.

For the browser smoke, start the app with a **disposable** data/auth profile and
an installed Stockfish, then run:

```sh
LH_SMOKE_URL=http://localhost:3000 \
CHROME_PATH=/usr/bin/chromium \
LH_CHESS_SMOKE_SCREENSHOTS=/absolute/path/to/scratch/screenshots \
node scripts/smoke-chess.mjs
```

This deliberately imports the synthetic PGN fixture. It checks actual move entry,
reload/resume, undo/restart, alternate accepted moves, feedback, duplicate import,
three real Stockfish analyses, traceable recurring errors, and a 390px mobile
viewport. It requires no model credentials or personal account. Model-authored
lesson quality and third-party uptime are not established by these fixtures.

## Dependencies and licences

- LearnHarness retains AGPL-3.0-only.
- chess.js **1.4.0** is BSD-2-Clause, includes its own TypeScript definitions, and
  runs in both the React 19 browser and the Node server. It is the only new runtime
  npm dependency. The board is a small native React view using Unicode pieces;
  no Chess.com assets or third-party board art are copied.
- Stockfish is an optional external UCI process, GPL-3.0. Obtain official releases
  and corresponding source from <https://github.com/official-stockfish/Stockfish>.
  Any later binary distribution must include its GPL licence and corresponding
  source obligations. This change redistributes no Stockfish binary.
- The named opening examples are derived from the CC0 Lichess chess-openings
  dataset: <https://github.com/lichess-org/chess-openings>.
- The FIDE Laws link is a source reference; the law text is not redistributed.
