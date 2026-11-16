# Contributing

Thanks for helping. Radar is small on purpose: one Bun process, one SQLite file, a React UI.

## Setup

```sh
bun install --frozen-lockfile
bun run dev          # state goes to ./.dev, not your real Radar
```

Before a pull request:

```sh
bun run check && bun test src && bun run build
```

`assets/main.js` is committed, so rebuild it when you change anything under `ui/`; CI fails if it is stale.

## Ground rules

- SQLite is the only state. Schema changes must migrate an existing database in place.
- No HTTP handler runs a model or a slow download; the reader worker and the collection process do that.
- A failing source, model or network call never fails a whole collection; previous articles stay.
- Tests never touch a real Radar home and never need a network or an API key.
- Interface text lives in `ui/i18n.ts`; controls stay monochrome (colour belongs to content).
- Adding a default source: add it to `feeds/follow.opml` (or `feeds/channels.json` for YouTube); mark it
  `ai="1"` only when nearly everything it publishes is about AI.

## Translations

The interface is English. To add a language, copy the English table in `ui/i18n.ts`, translate the
values and register it. The summary language is separate (`RADAR_LANGUAGE`).
