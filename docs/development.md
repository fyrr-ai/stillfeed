# Development

```sh
bun install --frozen-lockfile
bun run dev          # the server with its own state in ./.dev, never your real Stillfeed
bun run check        # TypeScript
bun test src         # unit tests
bun run build        # rebuild assets/build and index.html after UI changes (they are committed)
bun run test:perf    # speed budgets
bun run test:ui      # browser tests (needs PW and CHROME, see below)
```

CI runs `check`, the unit tests, a stale-build check and `test:perf` on every push and pull request. Ground rules
for changes are in [CONTRIBUTING.md](../CONTRIBUTING.md).

## How the pieces fit

The server is `src/server.ts` (Bun, SQLite through `bun:sqlite`). SQLite is the only state: articles, seen and
saved items, sources, settings, Hot picks, suggestions, cached texts and summaries.

- **Collection** runs as a child process (`bun src/server.ts --collect`, `src/collect.ts`) on the schedule. It
  reads feeds (`src/feeds.ts`), YouTube (`src/youtube.ts`), X through SocialData (`src/tweets.ts`) and the web
  collectors (`src/web.ts`) side by side, keeps AI and data-engineering items with the keyword filter
  (`src/relevance.ts`) and an optional model check (`src/triage.ts`), then refreshes Hot (`src/hot.ts`) and
  suggestions (`src/suggest.ts`). A failing source or model never fails a collection.
- **The reader worker** (`src/reader_worker.ts`) downloads and cleans articles, transcripts and X Articles and
  writes summaries in batches, so no web request waits for a model.
- **The chat worker** (`src/chat_worker.ts`) processes the durable conversation queue in `src/chat.ts`.
  Questions and cancellations are persisted in SQLite; leases and tokens prevent duplicate or stale answers.
- **AI** goes through one function in `src/llm.ts` for Anthropic, OpenAI-compatible APIs and the Codex CLI.
- **The UI** is React and [UI SDK](https://www.npmjs.com/package/@ui-sdk/react) in `ui/`, code-split and built by
  `scripts/build.ts`; interface strings live in `ui/i18n.ts`.
  The on-demand chat panel uses assistant-ui primitives with an external-store runtime over the cached API.

## Speed budgets

`bun run test:perf` fails when a budget is exceeded, on a database the size of a month of real use:

| Measure | Budget |
|---|---|
| First-paint download (brotli) | 120 KB (about 110 KB today) |
| New feed snapshot (`/api/feed`) | 40 ms |
| Next page, `/api/status`, `/api/hot` | 15 ms each |

With `LIGHTHOUSE=<lighthouse cli>` and `CHROME_PATH=<chrome>` it also runs Lighthouse (median of three, mobile
and desktop) and requires 100 in every category.

## Browser tests

`tests/ui.mjs` starts the real server on synthetic data (`tests/fixture.ts`) in a temporary directory, with a
stub collection and no network:

```sh
PW=<path to playwright-core> CHROME=<chromium binary> bun run test:ui
PW=<path to playwright-core> CHROME=<chromium binary> bun run test:chat-ui
```

The chat suite uses the real server and chat worker with a fake Codex executable on an isolated PATH. It
checks answer delivery, saved history, cancellation, context separation, bookmarks, Undo and reading position
on phone and desktop layouts. It does not use account credentials or make model requests.

## README images

`docs/assets/src/demo.ts` builds an isolated SQLite database with fictional AI stories, cached summaries,
Hot ratings, saved topics and a sample chat. `shots.ts` captures the real application and blocks outbound
server requests, browser requests to outside sites and all background workers. It needs no credentials
and makes no model calls. Demo thumbnails and avatars are local SVGs.

```sh
PW=<path to playwright-core> CHROME=<chromium binary> bun run docs:shots
```

`compose.ts` puts the captured interface in an iPhone-style frame. It builds the README banner as a dark
grid with the feed on a phone beside crops of Hot, Read and Saved, and places the feature screenshots and the
social banner over Raycast's Glaze 2 wallpaper in `docs/assets/raycast-glaze-2.png`. Keep the wallpaper file
when regenerating screenshots.

`animate.ts` combines captured Hide seen / Undo states into a lossless animated PNG, with a useful first
frame for viewers that do not play APNG. The generator uses Bun and Chromium, without Python or an image
conversion dependency. `KEEP_RAW=<directory>` also keeps the five unframed phone screenshots.

The presentation uses the lighting and depth of [Raycast's website presentation by Stuart Regan](https://dribbble.com/shots/17031722--New-Raycast-website) as a visual reference. The wallpaper is from [Raycast Wallpapers](https://www.raycast.com/wallpapers); interface screenshots and demo thumbnails are our own.
