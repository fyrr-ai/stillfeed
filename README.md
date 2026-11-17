# Stillfeed

A personal AI news feed for your phone.

Stillfeed collects posts from X, YouTube channels, RSS feeds and Reddit into one feed you can scroll like
Twitter. It checks your sources on a schedule. With an AI provider connected, it picks posts based on your
interests and prepares short summaries of articles and videos with available transcripts.

Open it a few times a day, read what looks useful, and save what you want to keep. When you're done,
Hide seen clears the posts you've reviewed. Your bookmarks stay saved.

You run Stillfeed on your own server and open it in a browser, or add it to your phone's home screen as a PWA.

![Stillfeed. AI news in one feed, with posts, videos and articles from the sources you follow.](docs/assets/stillfeed-banner.png)

[Quick start](#quick-start) · [Configuration](docs/configuration.md) · [Development](docs/development.md) · [MIT license](LICENSE)

## A quick look

The screenshots below use example content in the actual app.

### Your sources in one feed

Read posts, articles and videos together. Follow X accounts, add RSS feeds and YouTube channels, or subscribe
to a subreddit's feed. Refresh runs every two hours by default; you can change the schedule in settings.

<img src="docs/assets/stillfeed-feed.png" width="476" alt="The Feed tab mixes an article, a post from X and a YouTube video in the same list.">

### Hot picks for your interests

Describe what you care about. Hot selects matching posts from your current feed and gives a short reason
for each pick. It shares the same read and hidden state as Feed.

<img src="docs/assets/stillfeed-hot.png" width="476" alt="Hot shows a coding-agent video and a local-model article, each with a reason it matches the reader's interests.">

### A summary before the full article

Open an article for a three-point summary and clean text. Videos with available transcripts can be read and
summarized too. Choose the summary language in your configuration.

<img src="docs/assets/stillfeed-reader.png" width="476" alt="The reader shows three summary points followed by the original article text.">

### Save things you want to come back to

Bookmark articles and posts as you browse. Saved groups them by topic automatically. Reading an item or
hiding it from Feed does not remove its bookmark.

<img src="docs/assets/stillfeed-saved.png" width="476" alt="Saved has a topic picker with Coding agents, Models and Evaluations, above bookmarked articles.">

### Ask about what you're reading

Open Discuss to ask a follow-up question about an article or the current batch. The conversation stays in
Stillfeed, alongside the content you're reading.

<img src="docs/assets/stillfeed-discuss.png" width="476" alt="Discuss answers a follow-up question using the article about running a coding model locally.">

### Clear the posts you've seen when you're ready

The counter shows seen items out of the current batch. Tap it and choose Hide seen to clear those posts,
with Undo if you change your mind. Opening or scrolling past an item never removes it by itself.

<img src="docs/assets/stillfeed-hide-seen.png" width="476" alt="Animation: open the seen counter, choose Hide seen, and use Undo to restore the hidden posts. Bookmarks remain saved.">

## Quick start

You need [Bun](https://bun.sh) 1.4 or newer.

```sh
git clone https://github.com/fyrr-ai/stillfeed && cd stillfeed
bun install --frozen-lockfile
cp .env.example .env    # optional: choose an AI provider and summary language
bun start               # open http://127.0.0.1:3200
```

The first collection starts on its own. Add an AI provider to enable summaries, Hot, topic grouping and
chat. Stillfeed supports Anthropic, OpenAI-compatible APIs, local models through compatible endpoints, and
the Codex CLI. Collection and reading still work without AI.

X uses an optional paid [SocialData](https://socialdata.tools) API connection. Other sources work without it.
Setup, provider options and refresh settings are in [Configuration](docs/configuration.md).

Stillfeed has no login. Reach it from your phone through Tailscale, an SSH tunnel or your own reverse proxy.
Docker instructions are in [Configuration](docs/configuration.md#running-it).

## Documentation

- [Configuration](docs/configuration.md) covers sources, AI providers, summaries, interests, chat and deployment.
- [Development](docs/development.md) covers the code, tests, build and screenshot generator.
- [Contributing](CONTRIBUTING.md) covers changes and translations.

## License

[MIT](LICENSE). The web collectors and keyword filter started as a port of
[LearnPrompt/ai-news-radar](https://github.com/LearnPrompt/ai-news-radar). Third-party notices are in [NOTICE](NOTICE).
