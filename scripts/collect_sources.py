#!/usr/bin/env python3
"""Stateless web-source adapters, derived from the vendored LearnPrompt/ai-news collectors.
Persistence and feed parsing are owned by the Bun/SQLite application.
"""
from __future__ import annotations

import argparse


from concurrent.futures import ThreadPoolExecutor, as_completed


from email.utils import parseaddr


import hashlib


import json


import math


import os


import random


import re


import subprocess


import time


import xml.etree.ElementTree as ET


from dataclasses import dataclass


from datetime import date, datetime, timedelta, timezone


from difflib import SequenceMatcher


from pathlib import Path


from typing import Any


from urllib.parse import parse_qsl, unquote, urlencode, urljoin, urlparse, urlunparse


from zoneinfo import ZoneInfo


import requests


from bs4 import BeautifulSoup


from dateutil import parser as dtparser


from requests.adapters import HTTPAdapter


from urllib3.util.retry import Retry


from project_sources import fetch_github_projects, fetch_producthunt_projects


try:
    import feedparser
except ModuleNotFoundError:
    feedparser = None


UTC = timezone.utc


TZINFOS = {"CET": 3600, "CEST": 7200, "EST": -18000, "EDT": -14400,
           "PST": -28800, "PDT": -25200, "CST": -21600, "CDT": -18000,
           "MST": -25200, "MDT": -21600, "BST": 3600, "JST": 32400}


BROWSER_UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
)


SH_TZ = ZoneInfo("Asia/Shanghai")


WAYTOAGI_DEFAULT = (
    "https://waytoagi.feishu.cn/wiki/QPe5w5g7UisbEkkow8XcDmOpn8e?fromScene=spaceOverview"
)


WAYTOAGI_HISTORY_FALLBACK = "https://waytoagi.feishu.cn/wiki/FjiOwWp2giA7hRk6jjfcPioCnAc"


OPENAI_STATUS_API_URL = "https://status.openai.com/api/v2/incidents.json"


OPENAI_STATUS_PAGE_URL = "https://status.openai.com/"


OPENAI_INCIDENT_URL = "https://status.openai.com/incidents/{incident_id}"


ACTIVE_SERVICE_INCIDENT_STATUSES = {"investigating", "identified", "monitoring"}


RSS_FEED_REPLACEMENTS: dict[str, str] = {
    "https://rsshub.app/infoq/recommend": "https://www.infoq.cn/feed",
    "https://rsshub.app/huggingface/blog-zh": "https://huggingface.co/blog/feed.xml",
    "https://rsshub.app/readhub/daily": "https://readhub.cn/rss",
    "https://rsshub.app/36kr/hot-list": "https://36kr.com/feed",
    "https://rsshub.app/sspai/index": "https://sspai.com/feed",
    "https://rsshub.app/sspai/matrix": "https://sspai.com/feed",
    "https://rsshub.app/meituan/tech": "https://tech.meituan.com/feed",
    "https://mjg59.dreamwidth.org/data/rss": "http://mjg59.dreamwidth.org/data/rss",
}


RSS_FEED_SKIP_PREFIXES: tuple[str, ...] = (
    "https://rsshub.app/telegram/channel/",
    "https://rsshub.app/jike/",
    "https://rsshub.app/bilibili/",
    "https://rsshub.app/zhihu/",
    "https://rsshub.app/xiaoyuzhou/podcast/",
    "https://rsshub.app/xyzrank",
    "https://rsshub.app/mittrchina/hot",
    "https://wechat2rss.bestblogs.dev/",
    "https://werss.bestblogs.dev/",
    "http://47.122.94.119:18080/",
)


RSS_FEED_SKIP_EXACT: set[str] = {
    "https://rachelbythebay.com/w/atom.xml",
    "https://flak.tedunangst.com/rss",
}


OFFICIAL_AI_FEEDS: tuple[dict[str, str], ...] = (
    {
        "title": "OpenAI News",
        "xml_url": "https://openai.com/news/rss.xml",
        "html_url": "https://openai.com/news",
    },
    {
        "title": "Google DeepMind",
        "xml_url": "https://deepmind.google/blog/rss.xml",
        "html_url": "https://deepmind.google/blog",
    },
    {
        "title": "Google AI Blog",
        "xml_url": "https://blog.google/innovation-and-ai/technology/ai/rss/",
        "html_url": "https://blog.google/innovation-and-ai/technology/ai/",
    },
    {
        "title": "Hugging Face Blog",
        "xml_url": "https://huggingface.co/blog/feed.xml",
        "html_url": "https://huggingface.co/blog",
    },
    {
        "title": "GitHub AI & ML",
        "xml_url": "https://github.blog/ai-and-ml/feed/",
        "html_url": "https://github.blog/ai-and-ml/",
    },
    {
        "title": "GitHub Changelog",
        "xml_url": "https://github.blog/changelog/feed/",
        "html_url": "https://github.blog/changelog/",
    },
    {
        "title": "OpenAI Skills",
        "xml_url": "https://github.com/openai/skills/commits/main.atom",
        "html_url": "https://github.com/openai/skills",
        "include_keywords": "hatch,pet,migrate-to-codex",
    },
)


OFFICIAL_AI_MAX_AGE_DAYS = 45


CURATED_AI_MEDIA_MAX_AGE_DAYS = 30


DISCUSSION_FETCH_CAP = int(os.environ.get("DISCUSSION_FETCH_CAP", "50"))


CURATED_AI_MEDIA_FEEDS: tuple[dict[str, Any], ...] = (
    {
        "title": "The Decoder AI News",
        "xml_url": "https://the-decoder.com/feed/",
        "html_url": "https://the-decoder.com/",
        "max_entries": 10,
    },
    {
        "title": "TechCrunch AI",
        "xml_url": "https://techcrunch.com/category/artificial-intelligence/feed/",
        "html_url": "https://techcrunch.com/category/artificial-intelligence/",
        "max_entries": 8,
    },
    {
        # The Verge's AI topic RSS endpoint is not currently public/stable;
        # keep the all-site RSS behind strict title-level AI filtering.
        "title": "The Verge",
        "xml_url": "https://www.theverge.com/rss/index.xml",
        "html_url": "https://www.theverge.com/ai-artificial-intelligence",
        "include_keywords": "ai,artificial intelligence,openai,anthropic,claude,chatgpt,gpt,gemini,llm,agent,copilot",
        "max_entries": 6,
        "strict_title_filter": True,
    },
    {
        "title": "MarkTechPost Research",
        "xml_url": "https://www.marktechpost.com/feed/",
        "html_url": "https://www.marktechpost.com/",
        "include_keywords": "paper,research,arxiv,benchmark,dataset,model,llm,agent,diffusion,transformer,multimodal,reasoning,inference,training,open-source",
        "max_entries": 6,
        "strict_title_filter": True,
        "research_only": True,
    },
    {
        "title": "VentureBeat AI",
        "xml_url": "https://venturebeat.com/category/ai/feed",
        "html_url": "https://venturebeat.com/category/ai/",
        "max_entries": 8,
    },
    {
        "title": "Artificial Intelligence News",
        "xml_url": "https://www.artificialintelligence-news.com/feed/",
        "html_url": "https://www.artificialintelligence-news.com/",
        "max_entries": 8,
    },
    {
        "title": "Claude Code Releases",
        "xml_url": "https://github.com/anthropics/claude-code/releases.atom",
        "html_url": "https://github.com/anthropics/claude-code/releases",
        "max_entries": 6,
    },
)


AIBREAKFAST_JINA_URL = "https://r.jina.ai/https://aibreakfast.beehiiv.com/"


AIHOT_ITEMS_API_URL = "https://aihot.virxact.com/api/public/items"


AIHOT_MIN_SCORE = 60


AIHOT_API_TAKE = 100


AIHOT_API_MAX_PAGES = 5


AIHOT_API_UA = f"{BROWSER_UA} aihot-skill/0.2.0 AI-News-Radar/0.7"


AIHOT_FEED_URL = "https://aihot.virxact.com/feed.xml"


AIHOT_FALLBACK_FEED_URLS = (
    "https://aihot.virxact.com/rss.xml",
    "https://aihot.virxact.com/feed",
    "https://aihot.virxact.com/feed/daily.xml",
)


FOLLOW_BUILDERS_FEED_BASE = "https://raw.githubusercontent.com/zarazhangrui/follow-builders/main"


HN_ALGOLIA_URL = "https://hn.algolia.com/api/v1/search_by_date"


HN_ALGOLIA_QUERIES: tuple[str, ...] = (
    "OpenAI",
    "Anthropic",
    "Claude Code",
    "Claude",
    "Gemini",
    "Google AI",
    "DeepSeek",
    "Qwen",
    "AI agent",
    "AI coding",
    "Codex",
    "Cursor",
    "MCP",
    "LLM",
    "GPT",
    "Sora",
    "Copilot",
    "Nvidia AI",
)


HN_ALGOLIA_KEYWORDS: tuple[str, ...] = (
    "openai",
    "anthropic",
    "claude",
    "claude code",
    "codex",
    "cursor",
    "mcp",
    "gemini",
    "deepseek",
    "qwen",
    "llm",
    "gpt",
    "sora",
    "copilot",
    "agent",
    "ai coding",
    "benchmark",
    "eval",
    "paper",
    "model",
    "inference",
)


HN_ALGOLIA_HITS_PER_QUERY = 35


HN_ALGOLIA_MIN_KEYWORD_SCORE = 0.38


HN_ALGOLIA_MIN_COMMENTS = 2


HN_ALGOLIA_MIN_POINTS = 10


HN_ALGOLIA_QUERY_PAUSE_SECONDS = 0.1


AGENTMAIL_API_BASE_DEFAULT = "https://api.agentmail.to"


AGENTMAIL_DIGEST_FILE = "email-digest.json"


AGENTMAIL_DEFAULT_LIMIT = 50


AGENTMAIL_PROVIDER_DEFAULT = "agently_cli"


AGENTMAIL_CLI_DEFAULT = "agently-cli"


AGENTMAIL_PUBLIC_LINK_TEXT_RE = re.compile(
    r"\b(read\s+online|view\s+in\s+browser|read\s+in\s+browser|open\s+in\s+browser|"
    r"read\s+on\s+web|view\s+online|web\s+version)\b",
    re.I,
)


AGENTMAIL_PUBLIC_LINK_REJECT_RE = re.compile(
    r"\b(unsubscribe|manage\s+preferences|privacy|terms|sponsor|advertise|"
    r"feedback|rate\s+this|log\s+in|subscribe)\b",
    re.I,
)


AGENTMAIL_PUBLIC_URL_REJECT_HOSTS = (
    "agent.qq.com",
    "email.beehiivstatus.com",
)


AGENTMAIL_TRACKING_QUERY_PREFIXES = ("utm_",)


AGENTMAIL_TRACKING_QUERY_KEYS = {
    "_bhlid",
    "email",
    "email_id",
    "mc_cid",
    "mc_eid",
    "ref",
    "subscriber",
    "subscriber_id",
}


PAID_SOURCE_STATE_FILE = "paid-source-state.json"


PAID_SOURCE_DEFAULT_INTERVAL_HOURS = 24


PAID_SOURCE_DEFAULT_INTERVAL_HOURS_BY_PREFIX = {
    "SOCIALDATA": 12,
    "TIKHUB": 24,
}


PAID_SOURCE_MAX_INTERVAL_HOURS = 24 * 14


X_API_BASE_DEFAULT = "https://api.x.com"


X_API_POST_READ_COST_USD = 0.005


X_API_DEFAULT_QUERY = '(AI OR "artificial intelligence" OR "large language model" OR LLM) lang:en -is:retweet has:links'


X_API_DEFAULT_MAX_RESULTS = 20


X_API_MAX_QUERY_CHARS = 512


SOCIALDATA_API_BASE_DEFAULT = "https://api.socialdata.tools"


SOCIALDATA_TWEET_READ_COST_USD = 0.0002


SOCIALDATA_DEFAULT_QUERY = '(AI OR "artificial intelligence" OR LLM OR "large language model" OR 人工智能 OR 大模型 OR 大语言模型 OR AIGC OR 智能体 OR Agent) (lang:en OR lang:zh) -filter:retweets'


SOCIALDATA_DEFAULT_MAX_RESULTS = 20


SOCIALDATA_MAX_QUERY_CHARS = 512


SOCIALDATA_LIST_ID_DEFAULT = "1695376776867062037"


SOCIALDATA_LIST_DEFAULT_MAX_RESULTS = 50


SOCIALDATA_LIST_DEFAULT_EXCLUDE = ""


SOCIALDATA_LIST_MAX_PAGES = 10


SOCIALDATA_RECENCY_DAYS = 4


SOCIALDATA_LIST_ALLOWED_TYPES = frozenset({"tweet", "quote"})


TIKHUB_API_BASE_DEFAULT = "https://api.tikhub.io"


TIKHUB_DEFAULT_QUERY = "OpenAI,Claude,大模型,Agent,AI工具,人工智能,AI"


TIKHUB_DEFAULT_PLATFORMS = "douyin,xiaohongshu"


TIKHUB_DEFAULT_MAX_RESULTS = 20


TIKHUB_MAX_QUERY_CHARS = 256


TIKHUB_RESPONSE_SCAN_LIMIT = 100


CREATOR_HOT_WINDOW_DAYS = 7


CREATOR_FRESHNESS_BONUS_HOURS = 24


CREATOR_FRESHNESS_BONUS_POINTS = 15.0


CREATOR_SITE_IDS = frozenset({"tikhub_douyin", "tikhub_xiaohongshu"})


TIKHUB_RECENCY_DAYS = 7              # keep only current-week posts


TIKHUB_DOUYIN_SORT_TYPE = "1"        # 最多点赞 / most likes


TIKHUB_DOUYIN_PUBLISH_TIME = "7"     # 一周内; real cap = TIKHUB_RECENCY_DAYS


TIKHUB_XHS_SORT = "popularity_descending"  # 最多点赞 / most likes


TIKHUB_XHS_NOTE_TYPE = "不限"               # all note types


TIKHUB_XHS_TIME_FILTER = "一周内"           # 一周内; real cap = TIKHUB_RECENCY_DAYS


@dataclass
class RawItem:
    site_id: str
    site_name: str
    source: str
    title: str
    url: str
    published_at: datetime | None
    meta: dict[str, Any]


PUBLIC_RAW_META_FIELDS: tuple[str, ...] = (
    "aihot_score",
    "aihot_category",
    "aihot_selected",
    "provided_title_en",
    "provided_title_zh",
    "creator_metrics",
    "search_surface",
    "summary",
    "updated_at",
    "recency_basis",
)


def iso(dt: datetime | None) -> str | None:
    if not dt:
        return None
    return dt.astimezone(UTC).isoformat().replace("+00:00", "Z")


def normalize_url(raw_url: str) -> str:
    try:
        parsed = urlparse(raw_url.strip())
        if not parsed.scheme:
            return raw_url.strip()
        query = []
        for k, v in parse_qsl(parsed.query, keep_blank_values=True):
            lk = k.lower()
            if lk.startswith("utm_"):
                continue
            if lk in {
                "ref",
                "spm",
                "fbclid",
                "gclid",
                "igshid",
                "mkt_tok",
                "mc_cid",
                "mc_eid",
                "_hsenc",
                "_hsmi",
            }:
                continue
            query.append((k, v))
        parsed = parsed._replace(
            scheme=parsed.scheme.lower(),
            netloc=parsed.netloc.lower(),
            fragment="",
            query=urlencode(query, doseq=True),
        )
        normalized = urlunparse(parsed)
        return normalized.rstrip("/")
    except Exception:
        return raw_url.strip()


def first_non_empty(*values: Any) -> str:
    for value in values:
        if value is None:
            continue
        s = str(value).strip()
        if s:
            return s
    return ""


def maybe_fix_mojibake(text: str) -> str:
    s = (text or "").strip()
    if not s:
        return s
    # Common mojibake signature from UTF-8 bytes decoded as Latin-1.
    if re.search(r"[Ãâåèæïð]|[\x80-\x9f]|æ|ç|å|é", s) is None:
        return s
    for enc in ("latin1", "cp1252"):
        try:
            fixed = s.encode(enc).decode("utf-8")
            if fixed and fixed != s:
                return fixed
        except Exception:
            continue
    return s


def parse_feed_entries_via_xml(feed_xml: bytes) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    seen: set[tuple[str, str]] = set()
    try:
        root = ET.fromstring(feed_xml)
    except Exception:
        return out

    for tag in (".//item", ".//{*}item", ".//entry", ".//{*}entry"):
        for node in root.findall(tag):
            title = (
                node.findtext("title")
                or node.findtext("{*}title")
                or ""
            ).strip()
            link = ""
            link_node = node.find("link")
            if link_node is None:
                link_node = node.find("{*}link")
            if link_node is not None:
                link = (link_node.get("href") or link_node.text or "").strip()
            if not link:
                link = (node.findtext("{*}link") or node.findtext("link") or "").strip()
            published = (
                node.findtext("pubDate")
                or node.findtext("{*}pubDate")
                or node.findtext("published")
                or node.findtext("{*}published")
                or node.findtext("updated")
                or node.findtext("{*}updated")
            )
            if title and link:
                key = (title, link)
                if key in seen:
                    continue
                seen.add(key)
                out.append({"title": title, "link": link, "published": published})
    return out


def parse_unix_timestamp(value: Any) -> datetime | None:
    if value is None:
        return None
    try:
        n = float(value)
    except Exception:
        return None
    if n > 10_000_000_000:
        n /= 1000.0
    try:
        return datetime.fromtimestamp(n, tz=UTC)
    except Exception:
        return None


def parse_relative_time_zh(text: str, now: datetime) -> datetime | None:
    text = (text or "").strip()
    if not text:
        return None

    m = re.search(r"(\d+)\s*分钟前", text)
    if m:
        return now - timedelta(minutes=int(m.group(1)))

    m = re.search(r"(\d+)\s*小时前", text)
    if m:
        return now - timedelta(hours=int(m.group(1)))

    m = re.search(r"(\d+)\s*天前", text)
    if m:
        return now - timedelta(days=int(m.group(1)))

    if "刚刚" in text:
        return now

    if "昨天" in text:
        return now - timedelta(days=1)

    m = re.fullmatch(r"(?:今天)?\s*(\d{1,2}):(\d{2})", text)
    if m:
        hour = int(m.group(1))
        minute = int(m.group(2))
        candidate = now.replace(hour=hour, minute=minute, second=0, microsecond=0)
        if candidate > now + timedelta(minutes=5):
            candidate -= timedelta(days=1)
        return candidate

    m = re.fullmatch(r"昨天\s*(\d{1,2}):(\d{2})", text)
    if m:
        hour = int(m.group(1))
        minute = int(m.group(2))
        return (now - timedelta(days=1)).replace(hour=hour, minute=minute, second=0, microsecond=0)

    m = re.fullmatch(r"(?:\d{4}年\s*)?(\d{1,2})月(\d{1,2})日", text)
    if m:
        month = int(m.group(1))
        day = int(m.group(2))
        year = now.year
        try:
            candidate = datetime(year, month, day, tzinfo=UTC)
            if candidate > now + timedelta(days=2):
                candidate = datetime(year - 1, month, day, tzinfo=UTC)
            return candidate
        except Exception:
            return None

    return None


def parse_date_any(value: Any, now: datetime) -> datetime | None:
    if value is None:
        return None

    if isinstance(value, datetime):
        return value.astimezone(UTC)

    if isinstance(value, (int, float)):
        return parse_unix_timestamp(value)

    s = str(value).strip()
    if not s:
        return None

    if s.startswith("$D"):
        s = s[2:]

    if re.fullmatch(r"\d{12,}", s):
        return parse_unix_timestamp(int(s))

    if re.fullmatch(r"\d{9,11}", s):
        return parse_unix_timestamp(int(s))

    dt = parse_relative_time_zh(s, now)
    if dt:
        return dt

    # TechURLs format: 2026-02-19 11:54:21AM UTC
    m = re.search(r"(\d{4}-\d{2}-\d{2}\s+\d{1,2}:\d{2}:\d{2}[AP]M)\s+UTC", s)
    if m:
        try:
            dt = datetime.strptime(m.group(1), "%Y-%m-%d %I:%M:%S%p")
            return dt.replace(tzinfo=UTC)
        except Exception:
            pass

    try:
        dt = dtparser.parse(s, tzinfos={"UT": 0, "UTC": 0, "GMT": 0, **TZINFOS})
        if not dt.tzinfo:
            dt = dt.replace(tzinfo=UTC)
        return dt.astimezone(UTC)
    except Exception:
        return None


FUTURE_PUBLISH_SKEW = timedelta(hours=2)


CST_MISLABEL_OFFSET = timedelta(hours=8)


def create_session() -> requests.Session:
    session = requests.Session()
    retry = Retry(
        total=3,
        connect=3,
        read=3,
        backoff_factor=0.8,
        status_forcelist=[429, 500, 502, 503, 504],
        allowed_methods=frozenset(["GET", "POST"]),
    )
    adapter = HTTPAdapter(max_retries=retry)
    session.mount("http://", adapter)
    session.mount("https://", adapter)
    session.headers.update({"User-Agent": BROWSER_UA, "Accept-Language": "zh-CN,zh;q=0.9"})
    return session


def fetch_techurls(session: requests.Session, now: datetime) -> list[RawItem]:
    site_id = "techurls"
    site_name = "TechURLs"
    r = session.get("https://techurls.com/", timeout=30)
    r.raise_for_status()
    soup = BeautifulSoup(r.text, "html.parser")

    out: list[RawItem] = []
    for block in soup.select("div.publisher-block"):
        primary = (
            block.select_one(".publisher-text .primary").get_text(strip=True)
            if block.select_one(".publisher-text .primary")
            else block.get("data-publisher", "unknown")
        )
        secondary = (
            block.select_one(".publisher-text .secondary").get_text(strip=True)
            if block.select_one(".publisher-text .secondary")
            else ""
        )
        source = f"{primary} · {secondary}" if secondary and secondary != primary else primary

        for link_row in block.select("div.publisher-link"):
            a = link_row.select_one("a.article-link")
            if not a or not a.get("href"):
                continue
            title = a.get_text(" ", strip=True)
            url = a["href"].strip()

            time_hint = ""
            aside = link_row.select_one(".aside .text")
            if aside:
                time_hint = aside.get("title", "") or aside.get_text(" ", strip=True)

            published = parse_date_any(time_hint, now)
            out.append(
                RawItem(
                    site_id=site_id,
                    site_name=site_name,
                    source=source,
                    title=title,
                    url=url,
                    published_at=published,
                    meta={"time_hint": time_hint},
                )
            )

    return out


def fetch_zeli(session: requests.Session, now: datetime) -> list[RawItem]:
    site_id = "zeli"
    site_name = "Zeli"
    out: list[RawItem] = []

    url = "https://zeli.app/api/hacker-news?type=hot24h"
    r = session.get(url, timeout=30)
    r.raise_for_status()
    body = r.json()
    posts = body.get("posts", [])
    for p in posts:
        title = str(p.get("title", "")).strip()
        link = str(p.get("url", "")).strip()
        if not title or not link:
            continue
        published = parse_unix_timestamp(p.get("time")) or now
        out.append(
            RawItem(
                site_id=site_id,
                site_name=site_name,
                source="Hacker News · 24h最热",
                title=title,
                url=link,
                published_at=published,
                meta={"hn_id": p.get("id")},
            )
        )

    return out


def hn_algolia_keyword_score(title: str) -> float:
    blob = title.lower()
    hits = 0
    for keyword in HN_ALGOLIA_KEYWORDS:
        if re.search(rf"(?<![a-z0-9]){re.escape(keyword)}(?![a-z0-9])", blob):
            hits += 1
    return min(1.0, hits / 3)


def parse_hn_algolia_hits(payloads: list[tuple[str, dict[str, Any]]], now: datetime) -> list[RawItem]:
    seen_ids: set[str] = set()
    out: list[RawItem] = []

    for query, payload in payloads:
        hits = payload.get("hits")
        if not isinstance(hits, list):
            continue

        for hit in hits:
            if not isinstance(hit, dict):
                continue
            object_id = str(hit.get("objectID") or "").strip()
            if not object_id or object_id in seen_ids:
                continue
            seen_ids.add(object_id)

            title = maybe_fix_mojibake(str(first_non_empty(hit.get("title"), hit.get("story_title"))))
            if not title or hn_algolia_keyword_score(title) < HN_ALGOLIA_MIN_KEYWORD_SCORE:
                continue

            try:
                comments = int(hit.get("num_comments") or 0)
            except Exception:
                comments = 0
            try:
                points = int(hit.get("points") or 0)
            except Exception:
                points = 0
            if comments < HN_ALGOLIA_MIN_COMMENTS and points < HN_ALGOLIA_MIN_POINTS:
                continue

            item_url = str(hit.get("url") or "").strip()
            hn_url = f"https://news.ycombinator.com/item?id={object_id}"
            published = parse_date_any(hit.get("created_at"), now) or parse_unix_timestamp(hit.get("created_at_i")) or now

            out.append(
                RawItem(
                    site_id="hackernews",
                    site_name="Hacker News",
                    source="HN Algolia · AI 24h",
                    title=title,
                    url=item_url or hn_url,
                    published_at=published,
                    meta={
                        "hn_id": object_id,
                        "hn_url": hn_url,
                        "hn_query": query,
                        "hn_comments": comments,
                        "hn_points": points,
                    },
                )
            )

    out.sort(
        key=lambda item: (
            int(item.meta.get("hn_comments") or 0),
            int(item.meta.get("hn_points") or 0),
            item.published_at or datetime.min.replace(tzinfo=UTC),
        ),
        reverse=True,
    )
    return out


def fetch_hacker_news_algolia(session: requests.Session, now: datetime) -> list[RawItem]:
    start_ts = int((now - timedelta(hours=24)).timestamp())
    payloads: list[tuple[str, dict[str, Any]]] = []
    errors: list[str] = []

    for query in HN_ALGOLIA_QUERIES:
        try:
            response = session.get(
                HN_ALGOLIA_URL,
                params={
                    "query": query,
                    "tags": "story",
                    "numericFilters": f"created_at_i>{start_ts}",
                    "hitsPerPage": HN_ALGOLIA_HITS_PER_QUERY,
                },
                headers={"Accept": "application/json"},
                timeout=16,
            )
            response.raise_for_status()
            payloads.append((query, response.json()))
        except Exception as exc:
            errors.append(f"{query}: {exc}")
        time.sleep(HN_ALGOLIA_QUERY_PAUSE_SECONDS)

    if not payloads and errors:
        raise ValueError(f"HN Algolia queries failed: {'; '.join(errors[:3])}")

    return parse_hn_algolia_hits(payloads, now)


def parse_anthropic_news_items(page_html: str, now: datetime) -> list[RawItem]:
    site_id = "official_ai"
    site_name = "Official AI Updates"
    soup = BeautifulSoup(page_html, "html.parser")
    out: list[RawItem] = []
    seen: set[str] = set()

    for a in soup.select('a[href^="/news/"]'):
        href = str(a.get("href") or "").strip()
        if not href or href == "/news/" or href == "/news":
            continue

        title_tag = a.select_one("h1, h2, h3, h4")
        title = title_tag.get_text(" ", strip=True) if title_tag else ""
        title = maybe_fix_mojibake(title)
        if not title or title.lower() == "news":
            continue

        url = urljoin("https://www.anthropic.com", href)
        if url in seen:
            continue
        seen.add(url)

        time_tag = a.select_one("time")
        published = None
        if time_tag:
            published = parse_date_any(time_tag.get("datetime") or time_tag.get_text(" ", strip=True), now)
        if not published:
            continue
        if now and published < now - timedelta(days=OFFICIAL_AI_MAX_AGE_DAYS):
            continue

        out.append(
            RawItem(
                site_id=site_id,
                site_name=site_name,
                source="Anthropic News",
                title=title,
                url=url,
                published_at=published,
                meta={"provider": "Anthropic"},
            )
        )

    return out


def parse_openai_codex_changelog_items(page_html: str, now: datetime) -> list[RawItem]:
    site_id = "official_ai"
    site_name = "Official AI Updates"
    soup = BeautifulSoup(page_html, "html.parser")
    out: list[RawItem] = []
    seen: set[str] = set()

    for node in soup.select("#codex-changelog-content li[id], li[id]"):
        item_id = str(node.get("id") or "").strip()
        if not item_id or item_id in seen:
            continue

        time_tag = node.select_one("time")
        title_tag = node.select_one("h3")
        if not time_tag or not title_tag:
            continue

        title = maybe_fix_mojibake(title_tag.get_text(" ", strip=True))
        published = parse_date_any(time_tag.get("datetime") or time_tag.get_text(" ", strip=True), now)
        if not title or not published:
            continue
        if now and published < now - timedelta(days=OFFICIAL_AI_MAX_AGE_DAYS):
            continue

        seen.add(item_id)
        out.append(
            RawItem(
                site_id=site_id,
                site_name=site_name,
                source="OpenAI Codex Changelog",
                title=title,
                url=f"https://developers.openai.com/codex/changelog#{item_id}",
                published_at=published,
                meta={"provider": "OpenAI"},
            )
        )

    return out


def fetch_feed_as_official_items(
    session: requests.Session,
    feed: dict[str, str],
    now: datetime,
) -> list[RawItem]:
    site_id = "official_ai"
    site_name = "Official AI Updates"
    feed_url = feed["xml_url"]
    feed_title = feed["title"]

    resp = session.get(
        feed_url,
        timeout=20,
        headers={
            "User-Agent": BROWSER_UA,
            "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
            "Accept": "application/rss+xml, application/xml, text/xml, */*",
        },
    )
    resp.raise_for_status()

    entries: list[dict[str, Any]]
    if feedparser is not None:
        parsed = feedparser.parse(resp.content)
        entries = list(parsed.entries)
    else:
        entries = parse_feed_entries_via_xml(resp.content)

    out: list[RawItem] = []
    include_keywords = [
        keyword.strip().lower()
        for keyword in str(feed.get("include_keywords") or "").split(",")
        if keyword.strip()
    ]
    for entry in entries:
        title = str(entry.get("title", "")).strip()
        link = str(entry.get("link", "")).strip()
        if not title or not link:
            continue
        if include_keywords:
            haystack = f"{title} {link}".lower()
            if not any(keyword in haystack for keyword in include_keywords):
                continue
        published = (
            parse_date_any(entry.get("published"), now)
            or parse_date_any(entry.get("updated"), now)
            or parse_date_any(entry.get("pubDate"), now)
        )
        if not published:
            continue
        if published < now - timedelta(days=OFFICIAL_AI_MAX_AGE_DAYS):
            continue

        out.append(
            RawItem(
                site_id=site_id,
                site_name=site_name,
                source=feed_title,
                title=maybe_fix_mojibake(title),
                url=link,
                published_at=published,
                meta={
                    "feed_url": feed_url,
                    "feed_home": feed.get("html_url") or "",
                },
            )
        )

    return out


def feed_entry_title_link_published(entry: dict[str, Any], now: datetime) -> tuple[str, str, datetime | None]:
    title = maybe_fix_mojibake(str(entry.get("title", "")).strip())
    link = str(entry.get("link", "")).strip()
    published = (
        parse_date_any(entry.get("published"), now)
        or parse_date_any(entry.get("updated"), now)
        or parse_date_any(entry.get("pubDate"), now)
    )
    return title, link, published


def feed_keywords(feed: dict[str, Any]) -> list[str]:
    return [
        keyword.strip().lower()
        for keyword in str(feed.get("include_keywords") or "").split(",")
        if keyword.strip()
    ]


def curated_feed_entry_allowed(feed: dict[str, Any], title: str, link: str) -> bool:
    include_keywords = feed_keywords(feed)
    if not include_keywords:
        return True
    haystack = title.lower()
    if not feed.get("strict_title_filter"):
        haystack = f"{haystack} {link.lower()} {feed.get('title', '').lower()}"
    return any(keyword in haystack for keyword in include_keywords)


def parse_curated_ai_media_feed_items(
    feed_content: bytes,
    feed: dict[str, Any],
    now: datetime,
) -> list[RawItem]:
    site_id = "curated_media"
    site_name = "Curated Media"
    feed_url = str(feed["xml_url"])
    feed_title = str(feed["title"])

    if feedparser is not None:
        parsed = feedparser.parse(feed_content)
        entries = list(parsed.entries)
    else:
        entries = parse_feed_entries_via_xml(feed_content)

    out: list[RawItem] = []
    seen_urls: set[str] = set()
    max_entries = max(1, int(feed.get("max_entries") or 8))
    for entry in entries:
        title, link, published = feed_entry_title_link_published(entry, now)
        if not title or not link or not published:
            continue
        if published < now - timedelta(days=CURATED_AI_MEDIA_MAX_AGE_DAYS):
            continue
        if not curated_feed_entry_allowed(feed, title, link):
            continue
        normalized_url = normalize_url(link)
        if normalized_url in seen_urls:
            continue
        seen_urls.add(normalized_url)
        out.append(
            RawItem(
                site_id=site_id,
                site_name=site_name,
                source=feed_title,
                title=title,
                url=link,
                published_at=published,
                meta={
                    "feed_url": feed_url,
                    "feed_home": feed.get("html_url") or "",
                    "research_only": bool(feed.get("research_only")),
                    "strict_title_filter": bool(feed.get("strict_title_filter")),
                },
            )
        )
        if len(out) >= max_entries:
            break

    return out


def fetch_curated_ai_media(session: requests.Session, now: datetime) -> list[RawItem]:
    out: list[RawItem] = []
    failures: list[str] = []

    for feed in CURATED_AI_MEDIA_FEEDS:
        try:
            resp = session.get(
                str(feed["xml_url"]),
                timeout=20,
                headers={
                    "User-Agent": BROWSER_UA,
                    "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
                    "Accept": "application/rss+xml, application/atom+xml, application/xml, text/xml, */*",
                },
            )
            resp.raise_for_status()
            out.extend(parse_curated_ai_media_feed_items(resp.content, feed, now))
        except Exception:
            failures.append(str(feed.get("title") or feed.get("xml_url") or "unknown"))

    if not out and failures:
        raise ValueError(f"No curated media items parsed; failed feeds: {', '.join(failures[:4])}")
    return out


def fetch_official_ai_updates(session: requests.Session, now: datetime) -> list[RawItem]:
    out: list[RawItem] = []

    for feed in OFFICIAL_AI_FEEDS:
        try:
            out.extend(fetch_feed_as_official_items(session, feed, now))
        except Exception:
            continue

    try:
        r = session.get("https://www.anthropic.com/news", timeout=20)
        r.raise_for_status()
        out.extend(parse_anthropic_news_items(r.text, now))
    except Exception:
        pass

    try:
        r = session.get("https://developers.openai.com/codex/changelog", timeout=20)
        r.raise_for_status()
        out.extend(parse_openai_codex_changelog_items(r.text, now))
    except Exception:
        pass

    if not out:
        raise ValueError("No official AI update sources returned items")

    return out


def parse_ai_breakfast_items(markdown_text: str, now: datetime) -> list[RawItem]:
    site_id = "aibreakfast"
    site_name = "AI Breakfast"
    out: list[RawItem] = []
    seen: set[str] = set()
    pattern = re.compile(
        r"([A-Z][a-z]{2}\s+\d{1,2},\s+\d{4})\s+•\s+\d+\s+min read\s+###\s+\*\*(.*?)\*\*.*?"
        r"\]\((https?://aibreakfast\.beehiiv\.com/p/[^)]+)\)",
        re.S,
    )

    for date_text, title_text, url in pattern.findall(markdown_text or ""):
        url = url.strip()
        if not url or url in seen:
            continue
        published = parse_date_any(date_text, now)
        if not published:
            continue
        if now and published < now - timedelta(days=OFFICIAL_AI_MAX_AGE_DAYS):
            continue

        seen.add(url)
        title = re.sub(r"\s+", " ", title_text).strip()
        out.append(
            RawItem(
                site_id=site_id,
                site_name=site_name,
                source="AI Breakfast",
                title=maybe_fix_mojibake(title),
                url=url,
                published_at=published,
                meta={"feed_home": "https://aibreakfast.beehiiv.com/"},
            )
        )

    return out


def fetch_ai_breakfast(session: requests.Session, now: datetime) -> list[RawItem]:
    resp = session.get(
        AIBREAKFAST_JINA_URL,
        timeout=25,
        headers={
            "User-Agent": BROWSER_UA,
            "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
            "Accept": "text/plain, */*",
        },
    )
    resp.raise_for_status()
    out = parse_ai_breakfast_items(resp.text, now)
    if not out:
        raise ValueError("No AI Breakfast items parsed")
    return out


def parse_follow_builders_items(feeds: dict[str, dict[str, Any]], now: datetime) -> list[RawItem]:
    site_id = "followbuilders"
    site_name = "Follow Builders"
    out: list[RawItem] = []

    for builder in feeds.get("x", {}).get("x", []) or []:
        name = str(builder.get("name") or builder.get("handle") or "").strip()
        handle = str(builder.get("handle") or "").strip()
        source = f"Follow Builders · X · {name or handle}".strip(" ·")
        for tweet in builder.get("tweets", []) or []:
            text = str(tweet.get("text") or "").strip()
            url = str(tweet.get("url") or "").strip()
            published = parse_date_any(tweet.get("createdAt"), now)
            if not text or not url or not published:
                continue
            title = re.sub(r"\s+", " ", text)
            if len(title) > 220:
                title = title[:217].rstrip() + "..."
            out.append(
                RawItem(
                    site_id=site_id,
                    site_name=site_name,
                    source=source,
                    title=maybe_fix_mojibake(title),
                    url=url,
                    published_at=published,
                    meta={"handle": handle, "feed": "feed-x.json"},
                )
            )

    for article in feeds.get("blogs", {}).get("blogs", []) or []:
        title = str(article.get("title") or "").strip()
        url = str(article.get("url") or "").strip()
        published = parse_date_any(article.get("publishedAt"), now) or parse_date_any(
            feeds.get("blogs", {}).get("generatedAt"), now
        )
        if not title or not url or not published:
            continue
        out.append(
            RawItem(
                site_id=site_id,
                site_name=site_name,
                source=f"Follow Builders · Blog · {article.get('name') or 'Blog'}",
                title=maybe_fix_mojibake(title),
                url=url,
                published_at=published,
                meta={"feed": "feed-blogs.json"},
            )
        )

    for episode in feeds.get("podcasts", {}).get("podcasts", []) or []:
        title = str(episode.get("title") or "").strip()
        url = str(episode.get("url") or "").strip()
        published = parse_date_any(episode.get("publishedAt"), now) or parse_date_any(
            feeds.get("podcasts", {}).get("generatedAt"), now
        )
        if not title or not url or not published:
            continue
        out.append(
            RawItem(
                site_id=site_id,
                site_name=site_name,
                source=f"Follow Builders · Podcast · {episode.get('name') or 'Podcast'}",
                title=maybe_fix_mojibake(title),
                url=url,
                published_at=published,
                meta={"feed": "feed-podcasts.json"},
            )
        )

    return out


def fetch_follow_builders(session: requests.Session, now: datetime) -> list[RawItem]:
    feeds: dict[str, dict[str, Any]] = {}
    for key, filename in (
        ("x", "feed-x.json"),
        ("blogs", "feed-blogs.json"),
        ("podcasts", "feed-podcasts.json"),
    ):
        resp = session.get(
            f"{FOLLOW_BUILDERS_FEED_BASE}/{filename}",
            timeout=20,
            headers={
                "User-Agent": BROWSER_UA,
                "Accept": "application/json, */*",
            },
        )
        resp.raise_for_status()
        feeds[key] = resp.json()

    out = parse_follow_builders_items(feeds, now)
    if not out:
        raise ValueError("No Follow Builders items parsed")
    return out


AIHUBTODAY_RSS_URL = "https://hex2077.dev/rss-zh-CN.xml"


def project_raw_items(projects: list[dict[str, Any]]) -> list[RawItem]:
    return [RawItem(
        site_id=p["site_id"], site_name=p["site_name"], source=p["site_name"],
        title=f"{p['project_name']} — {p['summary']}" if p["summary"] else p["project_name"],
        url=p["url"], published_at=p["published_at"],
        meta={"summary": p["summary"], "project_candidate": p,
              "updated_at": iso(p.get("updated_at")), "recency_basis": p.get("recency_basis")},
    ) for p in projects]


def fetch_github_trending(session: requests.Session, now: datetime) -> list[RawItem]:
    return project_raw_items(fetch_github_projects(session, now))


def fetch_producthunt(session: requests.Session, now: datetime) -> list[RawItem]:
    return project_raw_items(fetch_producthunt_projects(session, now))


def collect_all(session: requests.Session, now: datetime) -> tuple[list[RawItem], list[dict[str, Any]]]:
    # AI Radar: no Chinese-language sources (Buzzing, AIbase, AI HubToday, NewsNow, Info Flow, BestBlogs, WaytoAGI).
    tasks = [
        ("official_ai", "Official AI Updates", fetch_official_ai_updates),
        ("curated_media", "Curated Media", fetch_curated_ai_media),
        ("aibreakfast", "AI Breakfast", fetch_ai_breakfast),
        ("followbuilders", "Follow Builders", fetch_follow_builders),
        ("techurls", "TechURLs", fetch_techurls),
        ("zeli", "Zeli", fetch_zeli),
        ("hackernews", "Hacker News", fetch_hacker_news_algolia),
        ("github_trending", "GitHub Trending", fetch_github_trending),
        ("producthunt", "Product Hunt", fetch_producthunt),
    ]

    # AI Radar: the sites are independent, so they run side by side, each with its own session. The order of the
    # items and of the statuses stays the order of the list above.
    def run_site(task: tuple[str, str, Any]) -> tuple[list[RawItem], dict[str, Any]]:
        site_id, site_name, fn = task
        start = time.perf_counter()
        error = None
        items: list[RawItem] = []
        try:
            items = fn(create_session(), now)
        except Exception as exc:
            error = str(exc)
        elapsed_ms = int((time.perf_counter() - start) * 1000)
        return items, {
            "site_id": site_id,
            "site_name": site_name,
            "ok": error is None,
            "item_count": len(items),
            "duration_ms": elapsed_ms,
            "error": error,
        }

    with ThreadPoolExecutor(max_workers=len(tasks)) as pool:
        results = list(pool.map(run_site, tasks))
    raw_items = [item for items, _ in results for item in items]
    statuses = [status for _, status in results]
    return raw_items, statuses


SOURCE_TIER_BY_SITE: dict[str, tuple[str, str, int]] = {
    "official_ai": ("official", "官方一手源", 0),
    "curated_media": ("ai_media", "精选AI媒体", 2),
    "aibreakfast": ("ai_vertical", "AI垂直源", 1),
    "aihubtoday": ("ai_vertical", "AI垂直源", 1),
    "aibase": ("ai_vertical", "AI垂直源", 1),
    "aihot": ("ai_vertical", "AI垂直源", 1),
    "bestblogs": ("ai_vertical", "AI垂直源", 1),
    "waytoagi": ("community", "社区更新", 2),
    "followbuilders": ("builders", "Builders/X源", 2),
    "opmlrss": ("user_opml", "RSS/OPML", 3),
    "tikhub_douyin": ("self_media", "自媒体源", 4),
    "tikhub_xiaohongshu": ("self_media", "自媒体源", 4),
    "xapi": ("advanced", "高级源", 4),
    "socialdata_x": ("advanced", "高级源", 4),
    "techurls": ("discussion", "热议参考", 5),
    "buzzing": ("discussion", "热议参考", 5),
    "iris": ("discussion", "热议参考", 5),
    "zeli": ("discussion", "热议参考", 5),
    "hackernews": ("discussion", "热议参考", 5),
    "newsnow": ("discussion", "热议参考", 5),
    "github_trending": ("community", "开源项目", 2),
    "producthunt": ("community", "新产品", 2),
}


SOURCE_TIER_IMPORTANCE = {
    "official": 1.0,
    "ai_vertical": 0.78,
    "ai_media": 0.58,
    "community": 0.54,
    "builders": 0.62,
    "user_opml": 0.5,
    "self_media": 0.48,
    "advanced": 0.45,
    "discussion": 0.32,
    "other": 0.25,
}


AIHOT_FIRST_PARTY_SOURCE_NAMES: frozenset[str] = frozenset({
    # --- OpenAI ---
    "OpenAI：官网动态（RSS · 排除企业/客户案例）",
    "X：OpenAI Developers (@OpenAIDevs)",
    "X：ChatGPT (@ChatGPTapp)",
    # --- Anthropic ---
    "Anthropic：Newsroom（网页）",
    "Claude Code：GitHub Releases（RSS）",
    "X：Claude Devs (@ClaudeDevs)",
    # --- Google ---
    "Google Developers Blog（RSS）",
    "Google Research：Blog（网页）",
    "X：Google DeepMind (@GoogleDeepMind)",
    "X：NotebookLM (@NotebookLM)",
    # --- Meta ---
    "X：AI at Meta (@AIatMeta)",
    # --- Mistral ---
    "Mistral AI：News（网页）",
    # --- Hugging Face ---
    "Hugging Face：Blog（RSS）",
    "HuggingFace Daily Papers（社区热门论文）",
    # --- Perplexity ---
    "X：Perplexity (@perplexity_ai)",
    # --- Runway ---
    "X：Runway (@runwayml)",
    # --- Alibaba / Qwen ---
    "X：阿里云 / Alibaba Cloud (@alibaba_cloud)",
    # --- ByteDance / Kling ---
    "X：可灵 Kling AI (@Kling_ai)",
})


TITLE_STOPWORDS = {
    "a",
    "an",
    "and",
    "are",
    "as",
    "at",
    "for",
    "from",
    "in",
    "into",
    "is",
    "new",
    "of",
    "on",
    "the",
    "to",
    "with",
    "发布",
    "推出",
    "上线",
    "更新",
}


VENDOR_ALIASES = {
    "openai": "openai",
    "anthropic": "anthropic",
    "claude": "anthropic",
    "google": "google",
    "deepmind": "google",
    "gemini": "google",
    "microsoft": "microsoft",
    "github": "github",
    "huggingface": "huggingface",
    "hugging face": "huggingface",
    "meta": "meta",
    "llama": "meta",
    "deepseek": "deepseek",
    "mistral": "mistral",
    "xai": "xai",
    "grok": "xai",
}


MODEL_RE = re.compile(
    r"(?i)\b("
    r"gpt[-\s]?\d+(?:\.\d+)?[a-z]*|"
    r"claude(?:[-\s]?(?:opus|sonnet|haiku))?[-\s]?\d+(?:\.\d+)?|"
    r"gemini[-\s]?\d+(?:\.\d+)?|"
    r"llama[-\s]?\d+(?:\.\d+)?|"
    r"deepseek[-\s]?[a-z0-9.]+|"
    r"grok[-\s]?\d+(?:\.\d+)?|"
    r"mistral[-\s]?[a-z0-9.]+"
    r")\b"
)


AI_KEYWORDS = [
    "aigc",
    "llm",
    "gpt",
    "claude",
    "gemini",
    "deepseek",
    "openai",
    "anthropic",
    "copilot",
    "codex",
    "mcp",
    "hugging face",
    "huggingface",
    "transformer",
    "prompt",
    "diffusion",
    "agent",
    "多模态",
    "大模型",
    "模型",
    "人工智能",
    "机器学习",
    "深度学习",
    "智能体",
    "算力",
    "推理",
    "微调",
]


TECH_KEYWORDS = [
    "robot",
    "robotics",
    "embodied",
    "autonomous",
    "vision",
    "chip",
    "semiconductor",
    "cuda",
    "npu",
    "gpu",
    "cloud",
    "developer",
    "开源",
    "技术",
    "编程",
    "软件",
    "芯片",
    "机器人",
    "具身",
]


NOISE_KEYWORDS = [
    "娱乐",
    "明星",
    "八卦",
    "足球",
    "篮球",
    "彩票",
    "情感",
    "旅游",
    "美食",
]


COMMERCE_NOISE_KEYWORDS = [
    "淘宝",
    "天猫",
    "京东",
    "拼多多",
    "券后",
    "热销总榜",
    "促销",
    "优惠",
    "补贴",
    "下单",
    "首发价",
]


EN_SIGNAL_RE = re.compile(
    r"(?i)(?<![a-z0-9])(ai|aigc|llm|gpt|openai|anthropic|deepseek|gemini|claude|robot|robotics|embodied|autonomous|machine learning|artificial intelligence|transformer|diffusion|agent)(?![a-z0-9])"
)


MEANINGFUL_EN_SIGNAL_RE = re.compile(
    r"(?i)(?<![a-z0-9])(ai|aigc|llm|gpt|openai|anthropic|deepseek|gemini|claude|robot|robotics|embodied|autonomous|machine learning|artificial intelligence|transformer|diffusion)(?![a-z0-9])"
)


EMAIL_RE = re.compile(r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b")


SECRET_LIKE_RE = re.compile(r"\b(sk-(?!hynix\b)[A-Za-z0-9_-]{12,}|(?:api[_-]?key|secret|token)=([^\s&]{6,}))\b", re.I)


BROAD_AI_TERMS = {"agent", "模型", "推理"}


ZH_CACHE_DS_PREFIX = "ds1|"


TRANSLATION_GLOSSARY_FILENAME = "translation-glossary.txt"


_GLOSSARY_CACHE: tuple[list[str], list[tuple[str, str, str | None]]] | None = None


ZH_TRANSLATION_REFUSAL_MARKERS = [
    "抱歉",
    "我无法处理",
    "我无法翻译",
    "我无法提供",
    "sorry",
    "cannot",
    "i can't",
    "无法处理",
    "请提供",
    "请直接提供",
]


_ZH_REFUSAL_LEADING_STRIP_RE = re.compile(r'^[\s"\'“”‘’「」『』(（,，.。:：]+')


_EN_FORBIDDEN_CHARS_RE = re.compile(r"[　-〿぀-ヿ㐀-鿿가-힯＀-￯]")


_EN_CJK_CHAR_RE = re.compile(r"[㐀-鿿]")


_EN_CJK_CHAR_WEIGHT = 2.5


EN_TRANSLATION_MIN_RATIO = 0.3


EN_TRANSLATION_MAX_RATIO = 3.0


TITLE_ENHANCE_CACHE_PREFIX = "te1|"


RECOMMEND_REASON_CACHE_PREFIX = "re1|"


_TITLE_ENHANCE_GATED_TIERS = {"discussion", "aggregate", "community"}


_TITLE_ENHANCE_EXEMPT_TIERS = {"official", "curated"}


_TITLE_ENHANCE_YEAR_SUFFIX_RE = re.compile(r"[(（]20\d{2}[)）]\s*$")


_TITLE_ENHANCE_ENTITY_RE = re.compile(r"[A-Za-z][A-Za-z0-9]+")


_JINA_MD_LINK_RE = re.compile(r"!?\[[^\]]*\]\([^)]*\)")


_JINA_MD_BULLET_RE = re.compile(r"^[*\-+]\s+|^\d+\.\s+")


FULL_TEXT_CONTEXT_CHAR_CAP = 3500


_TITLE_ENHANCE_TOKEN_RE = re.compile(r"[A-Za-z0-9.+-]+")


_EN_META_OPENER_RE = re.compile(
    r"^(This|The) (article|piece|post|story|report|item|update|note) "
    r"(details|explains|examines|profiles|reports|describes|covers|discusses|argues|notes|looks at|shows|says|highlights)"
    r"( that| how| why)?[,:]?\s+"
)


_EN_META_OPENER_MIN_REMAINDER_WORDS = 8


EN_CACHE_PREFIX = "en1|"


EN_CACHE_FILENAME = "en-cache.json"


EN_CACHE_MAX_AGE_DAYS = 21  # 超过 21 天未被命中的条目在保存时修剪


EN_NEGATIVE_TTL_DAYS = 1  # 失败（空文本）只负缓存 1 天，之后允许重试


EN_CACHE_TOUCH_DAYS = 7  # 命中且条目已超过 7 天时刷新 at，避免每轮都改写缓存文件


EN_KINDS = ("title", "summary", "reason")


EN_REASON_CACHE_PREFIX = "en2|"


EN_TITLE_MAX_CHARS = 200


_X_HOSTS = {"x.com", "twitter.com", "www.x.com", "www.twitter.com", "mobile.twitter.com", "mobile.x.com"}


_X_SITE_IDS = {"xapi", "socialdata_x"}


_EN_FIRST_SENTENCE_END_RE = re.compile(r"[。！？!?]|\n|\.(?=\s+[A-Z])")


BRIEF_SCORE_GATE = 0.72


