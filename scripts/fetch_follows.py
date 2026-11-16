#!/usr/bin/env python3
"""Turn the accounts I follow on X into one RSS feed, through the paid SocialData API.

Reads the handles from --handles (a JSON list of {"name", "handle"}), asks SocialData for
the original posts of those accounts since the previous run, and writes two files:

- data/follows.xml: a feed that update_news.py reads through the OPML entry like any other feed, so the AI
  relevance filter, ranking and translation apply to the tweets as well. Its titles are cut to 280 characters.
- data/follows-posts.json: the whole tweets for the page ({id: record}), with the full text, the author's name and
  picture, the counts, photos, links and the quoted tweet, so the page can show a tweet as a tweet.

Cost: SocialData bills $0.0002 per tweet returned. An empty request is free only up to 3
requests per minute and costs $0.0002 beyond that, so a run of about 30 requests adds at most
$0.006 for the empty ones. That buys speed: the queries run WORKERS at a time (the limit is 120
requests per minute) and a run takes seconds instead of minutes. Only tweets newer than the last
run are requested, and --max-tweets caps one run (approximately, as queries run side by side).
Without SOCIALDATA_API_KEY nothing is requested and the feed keeps its current content.
Exit code 1 means a request failed; what was fetched so far is still written.
"""
import argparse
import email.utils
import html
import json
import os
import re
import sys
import tempfile
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from pathlib import Path
from xml.sax.saxutils import escape

import requests

API_BASE = "https://api.socialdata.tools"
MAX_QUERY_CHARS = 480  # SocialData accepts what X search accepts; 512 is the upstream limit
RECENCY_SECONDS = 4 * 24 * 3600
# The first run (and the run after a change of the record format) fetches as far back as the page shows.
FIRST_RUN_SECONDS = 72 * 3600
SCHEMA = 2
MAX_TEXT = 5000
MAX_QUOTE_TEXT = 800
OVERLAP_SECONDS = 600
MAX_PAGES_PER_QUERY = 5
WORKERS = 4
FEED_FILE = "follows.xml"
POSTS_FILE = "follows-posts.json"
STATE_FILE = "follows-state.json"


def build_queries(handles, since):
    suffix = f" -filter:replies since_time:{since}"
    queries, group = [], []
    for handle in handles:
        term = f"from:{handle}"
        candidate = "(" + " OR ".join(group + [term]) + ")" + suffix
        if group and len(candidate) > MAX_QUERY_CHARS:
            queries.append("(" + " OR ".join(group) + ")" + suffix)
            group = []
        group.append(term)
    if group:
        queries.append("(" + " OR ".join(group) + ")" + suffix)
    return queries


def fetch_query(session, base_url, key, query, budget):
    tweets, cursor = [], ""
    for _ in range(MAX_PAGES_PER_QUERY):
        params = {"query": query, "type": "Latest"}
        if cursor:
            params["cursor"] = cursor
        response = session.get(
            f"{base_url.rstrip('/')}/twitter/search", params=params, timeout=30,
            headers={"Authorization": f"Bearer {key}", "Accept": "application/json"},
        )
        response.raise_for_status()
        payload = response.json()
        page = payload.get("tweets") or []
        tweets.extend(page)
        cursor = str(payload.get("next_cursor") or "")
        if not page or not cursor or len(tweets) >= budget:
            break
    return tweets


def photos(tweet):
    entities = tweet.get("extended_entities") or tweet.get("entities") or {}
    out = []
    for media in entities.get("media") or []:
        src = media.get("media_url_https")
        if not (isinstance(src, str) and src.startswith("https://")):
            continue
        size = media.get("original_info") or {}
        out.append({"type": media.get("type") or "photo", "src": src, "w": size.get("width"), "h": size.get("height")})
    return out[:4]


def text_and_links(tweet, hidden=()):
    """The text with HTML entities decoded and its newlines kept, the links to show and the t.co links to remove."""
    text = html.unescape(str(tweet.get("full_text") or tweet.get("text") or "")).strip()[:MAX_TEXT]
    entities = tweet.get("entities") or {}
    media = tweet.get("extended_entities", {}).get("media") or entities.get("media") or []
    drop = [m["url"] for m in media if isinstance(m.get("url"), str)]
    links = []
    for link in entities.get("urls") or []:
        url, href = link.get("url"), link.get("expanded_url")
        if not (isinstance(url, str) and isinstance(href, str) and href.startswith(("http://", "https://"))):
            continue
        if any(f"/status/{quoted}" in href for quoted in hidden if quoted):
            drop.append(url)  # the permalink of the quoted tweet: the quote box shows it
        else:
            links.append({"url": url, "href": href, "text": link.get("display_url") or href})
    return text, links, drop


def author_fields(user):
    user = user if isinstance(user, dict) else {}
    avatar = user.get("profile_image_url_https")
    return {
        "handle": str(user.get("screen_name") or "").lstrip("@"),
        "name": str(user.get("name") or ""),
        "avatar": avatar if isinstance(avatar, str) and avatar.startswith("https://") else "",
    }


def to_record(tweet):
    tweet_id = str(tweet.get("id_str") or tweet.get("id") or "")
    user = tweet.get("user") if isinstance(tweet.get("user"), dict) else {}
    handle = str(user.get("screen_name") or "").lstrip("@")
    created = str(tweet.get("tweet_created_at") or tweet.get("created_at") or "")
    try:
        published = datetime.fromisoformat(created.replace("Z", "+00:00")).timestamp()
    except ValueError:
        return None
    # A repost shows the original tweet; the record keeps the reposting tweet's id and handle (the feed link).
    reposted = tweet.get("retweeted_status") if isinstance(tweet.get("retweeted_status"), dict) else None
    shown = reposted or tweet
    quoted = shown.get("quoted_status") if isinstance(shown.get("quoted_status"), dict) else None
    quoted_id = str((quoted or {}).get("id_str") or shown.get("quoted_status_id_str") or "")
    text, links, drop = text_and_links(shown, hidden=(quoted_id,))
    if not (tweet_id and text and handle):
        return None
    author = author_fields(shown.get("user"))
    record = {
        "id": tweet_id, "handle": handle, "text": text, "published": published,
        "author": author["handle"] or handle, "name": author["name"], "avatar": author["avatar"],
        "kind": "retweet" if reposted else ("quote" if quoted else "tweet"),
        "likes": shown.get("favorite_count"), "replies": shown.get("reply_count"),
        "reposts": shown.get("retweet_count"), "views": shown.get("views_count"),
        "media": photos(shown), "links": links, "drop": drop,
    }
    article = shown.get("radar_article")
    if isinstance(article, dict) and article.get("title"):
        record["article"] = article
        # The card replaces the bare https://t.co link to the article.
        for link in [l for l in links if "/i/article" in str(l.get("href", ""))]:
            record["drop"] = list(record["drop"] or []) + [link.get("url")]
            record["links"] = [l for l in record["links"] if l is not link]
    if reposted:
        record["by"] = author_fields(user)["name"] or handle
    if quoted:
        q_text, q_links, q_drop = text_and_links(quoted)
        q_author = author_fields(quoted.get("user"))
        record["quote"] = {
            "id": quoted_id, "handle": q_author["handle"], "name": q_author["name"], "avatar": q_author["avatar"],
            "text": q_text[:MAX_QUOTE_TEXT], "links": q_links, "drop": q_drop, "media": photos(quoted),
        }
    return record


def render_feed(records):
    items = []
    for record in sorted(records, key=lambda r: r["published"], reverse=True):
        flat = re.sub(r"\s+", " ", record["text"])
        title = f"@{record['handle']}: {flat}"
        link = f"https://x.com/{record['handle']}/status/{record['id']}"
        items.append(
            "<item>"
            f"<title>{escape(title[:280])}</title><link>{escape(link)}</link>"
            f"<guid isPermaLink=\"true\">{escape(link)}</guid>"
            f"<pubDate>{email.utils.formatdate(record['published'], usegmt=True)}</pubDate>"
            f"<description>{escape(flat)}</description></item>"
        )
    return (
        '<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0"><channel>'
        "<title>X follows</title><link>https://x.com/</link><description>Posts from the accounts I follow</description>"
        + "".join(items) + "</channel></rss>\n"
    )


def write_atomic(path, text, mode):
    fd, tmp = tempfile.mkstemp(dir=path.parent, prefix=path.name + ".")
    with os.fdopen(fd, "w", encoding="utf-8") as handle:
        handle.write(text)
    os.chmod(tmp, mode)
    os.replace(tmp, path)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--handles", required=True, type=Path)
    parser.add_argument("--data-dir", required=True, type=Path)
    parser.add_argument("--base-url", default=API_BASE)
    parser.add_argument("--max-tweets", type=int, default=int(os.environ.get("SOCIALDATA_FOLLOWS_MAX_TWEETS", "1000")))
    args = parser.parse_args()

    state_path, feed_path = args.data_dir / STATE_FILE, args.data_dir / FEED_FILE
    state = json.loads(state_path.read_text(encoding="utf-8")) if state_path.exists() else {"tweets": {}, "last_run": 0}
    if state.get("schema") != SCHEMA:
        # Records of an older format lack the picture, counts and photos: fetch the whole window again.
        state["last_run"], state["schema"] = 0, SCHEMA
    now = time.time()
    state["tweets"] = {k: v for k, v in state["tweets"].items() if now - v["published"] < RECENCY_SECONDS}

    key = os.environ.get("SOCIALDATA_API_KEY", "").strip()
    failed = False
    if key and args.handles.exists():
        handles = [a["handle"] for a in json.loads(args.handles.read_text(encoding="utf-8"))]
        since = int(state["last_run"] - OVERLAP_SECONDS) if state["last_run"] else int(now - FIRST_RUN_SECONDS)
        lock, stop, fetched, failed_flag = threading.Lock(), threading.Event(), [0], [False]

        def run(query):
            if stop.is_set():
                return
            with lock:
                budget = args.max_tweets - fetched[0]
            if budget <= 0:
                stop.set()
                return
            try:
                tweets = fetch_query(requests.Session(), args.base_url, key, query, budget)
            except requests.RequestException as error:
                with lock:
                    failed_flag[0] = True
                    print(f"fetch_follows: request failed: {error}", file=sys.stderr)
                if isinstance(error, requests.HTTPError) and error.response is not None and error.response.status_code == 402:
                    stop.set()  # the balance is empty; the other queries would fail too
                return
            with lock:
                for tweet in tweets:
                    record = to_record(tweet)
                    if record and now - record["published"] < RECENCY_SECONDS:
                        state["tweets"][record["id"]] = record
                        fetched[0] += 1

        with ThreadPoolExecutor(WORKERS) as pool:
            list(pool.map(run, build_queries(handles, since)))
        fetched, failed = fetched[0], failed_flag[0]
        if not failed:
            state["last_run"] = now
        print(f"fetch_follows: {fetched} tweets fetched, {len(state['tweets'])} in the feed")
    else:
        print("fetch_follows: no SOCIALDATA_API_KEY or no handles file; the feed is unchanged")

    args.data_dir.mkdir(parents=True, exist_ok=True)
    write_atomic(state_path, json.dumps(state, ensure_ascii=False), 0o600)
    write_atomic(feed_path, render_feed(state["tweets"].values()), 0o644)
    write_atomic(args.data_dir / POSTS_FILE, json.dumps(state["tweets"], ensure_ascii=False, separators=(",", ":")), 0o644)
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
