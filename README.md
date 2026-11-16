# Stillfeed

A personal, self-hosted reader for AI and data-engineering news. Stillfeed collects articles, YouTube videos and
X posts from the sources you follow into one quiet, phone-friendly timeline, keeps only what is relevant, and
lets an AI summarize what you open, in your language.

- **Feed**: one timeline of articles, videos and X posts. What you have seen leaves on the next load, so
  the feed always shows what is new.
- **Hot**: a handful of items you should not miss today, picked by AI against a plain-language description of
  your interests. An item stays until you open or dismiss it.
- **Saved**: bookmarks, kept forever with their text.
- **Reader**: clean article text, YouTube transcripts and X Articles, with a three-point AI summary in the
  language you choose.
- **Sources**: about 70 AI and data blogs, 50 YouTube channels and nine news aggregators out of the box
  (Hacker News, GitHub Trending, Product Hunt and others). Add any RSS/Atom/JSON feed, website or YouTube
  channel from the sidebar, or follow X accounts.
- **Relevance**: a keyword filter keeps AI and data-engineering items; an optional model rescues what the
  keywords miss.
- **Suggestions**: accounts and sites your sources keep citing, rated by AI, added only when you say so.
- **Private by default**: one process and one SQLite file on your machine. No account, no telemetry.

## Quick start

Requires [Bun](https://bun.sh) 1.4 or newer.

```sh
git clone https://github.com/<you>/stillfeed && cd stillfeed
bun install --frozen-lockfile
cp .env.example .env        # optional: add an AI key, pick a summary language
bun start                   # http://127.0.0.1:3200
```

The first collection starts on its own; afterwards Stillfeed refreshes every two hours (configurable, with an
optional night pause) and you can pull to refresh at any time. Open it on your phone through your own
reverse proxy, Tailscale or SSH tunnel; Stillfeed has no login, so do not expose it to the internet directly.

With Docker:

```sh
docker build -t stillfeed .
docker run -d -p 127.0.0.1:3200:3200 -v stillfeed:/data --env-file .env stillfeed
```

## Configuration

Everything is optional. Settings come from environment variables or a `.env` file in `STILLFEED_HOME`
(default `~/.local/share/stillfeed`) or the working directory; see [.env.example](.env.example).

### AI provider

| Provider | Set | Default model |
|---|---|---|
| Anthropic | `ANTHROPIC_API_KEY` | `claude-opus-5-5` |
| OpenAI or any OpenAI-compatible server (OpenRouter, Ollama, vLLM, LM Studio) | `OPENAI_API_KEY`, `STILLFEED_LLM_MODEL`, optionally `OPENAI_BASE_URL` | none, set one |
| [Codex CLI](https://github.com/openai/codex) (uses your ChatGPT plan) | `STILLFEED_LLM=codex` | `gpt-6-luna` |

`STILLFEED_LLM_MODEL` chooses the model for summaries, Hot and suggestions, and `STILLFEED_LLM_FAST_MODEL` the one
for the relevance triage, which runs on every refresh (for example `claude-haiku-5-5` to keep it cheap). With
Anthropic models that support it, Stillfeed opts into the API's server-side fallback, so a request the model
declines is retried on a fallback model in the same call. Without any provider Stillfeed still collects, filters
by keywords and shows articles; summaries, Hot and suggestions stay off.

### Summary language

`STILLFEED_LANGUAGE` sets the language of summaries, Hot reasons and suggestion reasons, for example `Czech`,
`German` or `Japanese` (default `English`). The interface itself is English and ready for translation
(`ui/i18n.ts`).

### Your interests

Copy [interests.example.md](interests.example.md) to `~/.local/share/stillfeed/interests.md` and describe what
you care about in your own words. Hot and the source suggestions read it on each refresh.

### Sources

- Default feeds: [feeds/follow.opml](feeds/follow.opml) and YouTube channels in
  [feeds/channels.json](feeds/channels.json). Feeds marked `ai="1"` are trusted as AI sources; others go
  through the relevance filter.
- Your own feeds: add them in the sidebar, or put an OPML file at `~/.local/share/stillfeed/feeds.opml`.
- X accounts: add handles in the sidebar or one per line in `~/.local/share/stillfeed/x-accounts.txt`. X needs a
  [SocialData](https://socialdata.tools) key (`SOCIALDATA_API_KEY`); following ~150 accounts costs about
  $3 a month.

Every source is added once: if you switch a default off or remove it, it stays that way.

## Development

```sh
bun install --frozen-lockfile
bun run check      # TypeScript
bun test src       # unit tests
bun run build      # rebuild assets/main.js after UI changes (it is committed)
bun run dev        # server with a separate state directory
```

The server is `src/server.ts` (Bun, SQLite through `bun:sqlite`). A collection runs as a child process
(`bun src/server.ts --collect`) and a reader worker (`src/reader_worker.ts`) prepares articles and summaries
in the background, so no HTTP request ever waits for a model. The UI is React and
[UI SDK](https://www.npmjs.com/package/@ui-sdk/react) in `ui/`. See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE). The web collectors and the keyword filter started as a port of
[LearnPrompt/ai-news-radar](https://github.com/LearnPrompt/ai-news-radar) (MIT). Third-party notices are in
[NOTICE](NOTICE).
