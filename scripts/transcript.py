#!/usr/bin/env python3
"""Print a YouTube video's transcript as JSON: {"segments": [[start_seconds, text], ...]}.

Prefers English captions (manual or automatic), then any language. Exit 2 means the video has no transcript.
"""
import json, sys
from youtube_transcript_api import YouTubeTranscriptApi

video = sys.argv[1]
api = YouTubeTranscriptApi()
try:
    transcript = api.fetch(video, languages=["en", "en-US", "en-GB"])
except Exception:
    try:
        transcript = next(iter(api.list(video))).fetch()
    except Exception as error:
        print(json.dumps({"error": type(error).__name__}), file=sys.stderr)
        sys.exit(2)
print(json.dumps({"segments": [[round(s.start), s.text] for s in transcript]}, ensure_ascii=False))
