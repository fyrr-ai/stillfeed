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

The images in `docs/assets/` are generated, not drawn by hand. `docs/assets/src/demo.ts` builds a demo state with
invented, neutral news and locally drawn pictures, `shots.ts` runs the real server on it and screenshots the app
with every outside request blocked, and `compose.ts` places the screenshots in phone and browser frames and draws
the architecture diagram.

```sh
PW=<path to playwright-core> CHROME=<chromium binary> bun run docs:shots
```

Images are reduced to a 256-colour palette with `pngquant` when it is installed, else with Pillow's
libimagequant; without either they are written as Chromium produces them.
