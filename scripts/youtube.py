#!/usr/bin/env python3
"""New videos of YouTube channels through yt-dlp (YouTube's RSS feeds stopped answering).

stdin:  {"channels": [{"feed_id", "channel_id"}], "known": [video ids already checked], "cutoff": unix seconds}
stdout: {"channels": [{"feed_id", "videos": [record], "checked": [ids], "error": str|null}]}

Only the newest few uploads are listed (fast, no dates); full metadata is fetched only for ids not checked before.
"""
import html, json, sys
import yt_dlp

LATEST = 5
request = json.load(sys.stdin)
known = set(request.get("known", []))
cutoff = request.get("cutoff", 0)
quiet = {"quiet": True, "no_warnings": True, "skip_download": True}
out = []
with yt_dlp.YoutubeDL({**quiet, "extract_flat": "in_playlist", "playlistend": LATEST}) as lister, yt_dlp.YoutubeDL(quiet) as reader:
    for channel in request["channels"]:
        entry = {"feed_id": channel["feed_id"], "videos": [], "checked": [], "error": None}
        try:
            listing = lister.extract_info(f"https://www.youtube.com/channel/{channel['channel_id']}/videos", download=False)
            for item in (listing.get("entries") or [])[:LATEST]:
                video = item.get("id")
                if not video or video in known:
                    continue
                entry["checked"].append(video)
                try:
                    info = reader.extract_info(f"https://www.youtube.com/watch?v={video}", download=False)
                except yt_dlp.utils.DownloadError:
                    continue  # members-only, private or removed: skip this video, keep the channel
                if (info.get("timestamp") or 0) < cutoff or info.get("live_status") in ("is_upcoming", "is_live"):
                    continue
                description = info.get("description") or ""
                entry["videos"].append({
                    "url": f"https://www.youtube.com/watch?v={video}",
                    "guid": f"yt:video:{video}",
                    "title": info.get("title") or "Untitled video",
                    "published_at": info["timestamp"],
                    "author": info.get("channel") or "",
                    "summary": description[:20000],
                    "content": "".join(f"<p>{html.escape(p)}</p>" for p in description.split("\n\n") if p.strip())[:40000],
                    "image_url": f"https://i.ytimg.com/vi/{video}/hqdefault.jpg",
                })
        except Exception as error:  # one channel failing must not stop the others
            entry["error"] = f"{type(error).__name__}: {str(error)[:200]}"
        out.append(entry)
print(json.dumps({"channels": out}, ensure_ascii=False))
