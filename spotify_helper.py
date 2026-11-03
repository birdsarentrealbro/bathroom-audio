#!/usr/bin/env python3
"""
Bathroom Party Video Maker — Spotify playlist helper
====================================================

Downloads the songs of a Spotify playlist (or album / single track)
from YouTube — the classic "Spotify metadata + YouTube audio" method,
the same idea as spotify-dl — so you can drop them into the web app
and get the FULL songs in your bathroom-party video (not just the
30-second Spotify previews).

How it works:
  1. Reads the track list from Spotify's public embed page
     (no Spotify account, no API keys, no login needed).
  2. For each track, searches YouTube for "artist - title" and keeps
     the audio stream, via yt-dlp.

SETUP (once):
    pip install yt-dlp

USE:
    python3 spotify_helper.py "https://open.spotify.com/playlist/...."

Then drop the created "spotify-tracks" folder into step 2 of the web
app — the files are matched to the playlist order automatically.

OPTIONS:
    --out DIR              where to save audio (default: spotify-tracks)
    --limit N              only process the first N tracks
    --no-download          only read the track list and save playlist.json
    --format FMT           re-encode to mp3 / m4a / ... (needs ffmpeg);
                           by default YouTube's original audio is kept
    --cookies-from-browser B
                           e.g. chrome, firefox, edge, safari — pass your
                           logged-in YouTube cookies through to yt-dlp
                           (needed when YouTube asks to "confirm you're
                           not a bot")

Intended for personal use — please respect Spotify's and YouTube's
terms of service and support the artists.
"""

import argparse
import json
import os
import re
import sys
import time
import urllib.request

UA = ("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/126.0 Safari/537.36")
EMBED_URL = "https://open.spotify.com/embed/{kind}/{pid}"
ID_RE = r"[A-Za-z0-9]{16,}"

try:  # keep unicode titles from crashing weird console encodings
    sys.stdout.reconfigure(errors="replace")
except Exception:
    pass


# ------------------------------------------------------------------ links

def parse_link(raw):
    """Return (kind, id) for playlist/album/track links & URIs."""
    raw = (raw or "").strip()
    if not raw:
        return None, "empty"
    m = re.search(r"spotify:(playlist|album|track):(" + ID_RE + ")", raw)
    if m:
        return m.group(1), m.group(2)
    m = re.search(
        r"open\.spotify\.com/(?:intl-[a-z-]+/)?(?:user/[^/]+/)?"
        r"(embed/)?(playlist|album|track)/(" + ID_RE + ")", raw)
    if m:
        return m.group(2), m.group(3)
    if re.fullmatch(ID_RE, raw):            # bare id -> assume playlist
        return "playlist", raw
    if re.search(r"spotify", raw, re.I):
        return None, "unrecognized"
    return None, "notspotify"


# ------------------------------------------------------------------ fetch

def http_get(url, timeout=25):
    last = None
    for attempt in (1, 2, 3):
        try:
            req = urllib.request.Request(url, headers={
                "User-Agent": UA,
                "Accept": "text/html,application/xhtml+xml",
                "Accept-Language": "en-US,en;q=0.9",
            })
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return r.read().decode("utf-8", "replace")
        except Exception as e:
            last = e
            time.sleep(1.2 * attempt)
    raise last


def fetch_tracklist(kind, pid):
    """Read name/cover/tracks from Spotify's public embed page."""
    html = http_get(EMBED_URL.format(kind=kind, pid=pid))
    m = re.search(
        r'<script id="__NEXT_DATA__" type="application/json">(.*?)</script>',
        html, re.S)
    if not m:
        raise RuntimeError(
            "Spotify's page changed or blocked this request — "
            "wait a moment and try again.")
    data = json.loads(m.group(1))
    try:
        ent = data["props"]["pageProps"]["state"]["data"]["entity"]
    except (KeyError, TypeError):
        ent = None
    if not ent or not ent.get("trackList"):
        raise RuntimeError(
            "Nothing playable there — the playlist may be private, "
            "deleted or empty.")

    attrs = {}
    for a in ent.get("attributes") or []:
        if isinstance(a, dict) and a.get("key"):
            attrs[a["key"]] = a.get("value")

    tracks = []
    for t in ent["trackList"]:
        if not isinstance(t, dict) or not t.get("title"):
            continue
        prev = t.get("audioPreview") or {}
        tracks.append({
            "title": t["title"],
            "artist": t.get("subtitle") or "",
            "durMs": t.get("duration") or 0,
            "previewUrl": prev.get("url"),
            "uri": t.get("uri"),
        })
    if not tracks:
        raise RuntimeError("No tracks found on that page.")
    return {
        "name": ent.get("name") or "Spotify playlist",
        "cover": attrs.get("image_url"),
        "url": "https://open.spotify.com/%s/%s" % (kind, pid),
        "tracks": tracks,
    }


# ------------------------------------------------------------------ files

def sanitize(text, cap=90):
    text = re.sub(r'[\\/:*?"<>|\x00-\x1f]', " ", str(text or ""))
    text = re.sub(r"\s+", " ", text).strip(" .")
    return text[:cap].rstrip(" .") or "unknown"


def out_base(i, t):
    artist = sanitize(t["artist"])
    title = sanitize(t["title"])
    return "%02d - %s - %s" % (i + 1, artist, title)


def already_done(outdir, base):
    """True if a finished file for this track number exists (any ext)."""
    try:
        names = os.listdir(outdir)
    except OSError:
        return False
    for n in names:
        if n.startswith(base + ".") and not n.endswith(".part"):
            return True
    return False


# ------------------------------------------------------------------ dl

def queries_for(t):
    q = []
    if t["artist"]:
        q.append("%s - %s audio" % (t["artist"], t["title"]))
        q.append("%s %s" % (t["artist"], t["title"]))
    q.append(t["title"])
    seen, out = set(), []
    for s in q:
        if s.lower() not in seen:
            seen.add(s.lower())
            out.append(s)
    return out


class _Quiet:
    """Swallow yt-dlp's console spam, keep the last error for reporting."""

    def __init__(self):
        self.last = ""

    def debug(self, msg):
        pass

    def warning(self, msg):
        pass

    def error(self, msg):
        self.last = str(msg).strip()


def looks_like_botblock(err):
    s = str(err)
    return ("not a bot" in s or "Sign in to confirm" in s or
            "consent" in s.lower() or "cookies" in s.lower())


def download_track(outdir, base, t, fmt, cookies_browser=None):
    import yt_dlp  # imported lazily: --no-download works without it

    opts = {
        "format": "bestaudio/best",
        "outtmpl": os.path.join(outdir, base + ".%(ext)s"),
        "default_search": "ytsearch1",
        "noplaylist": True,
        "quiet": True,
        "no_warnings": True,
        "noprogress": True,
        "retries": 2,
        "socket_timeout": 25,
        "overwrites": False,
        "logger": _Quiet(),
    }
    if cookies_browser:
        opts["cookiesfrombrowser"] = (cookies_browser, None, None, None)
    if fmt and fmt != "best":
        opts["postprocessors"] = [{
            "key": "FFmpegExtractAudio",
            "preferredcodec": fmt,
        }]

    last_err = None
    for q in queries_for(t):
        quiet = _Quiet()
        opts["logger"] = quiet
        try:
            with yt_dlp.YoutubeDL(opts) as ydl:
                ydl.download([q])
            return True, None
        except Exception as e:
            last_err = quiet.last or e
    return False, last_err


# ------------------------------------------------------------------ main

def main():
    ap = argparse.ArgumentParser(
        description="Download a Spotify playlist's songs from YouTube "
                    "for the Bathroom Party Video Maker.")
    ap.add_argument("link", help="Spotify playlist/album/track link or URI")
    ap.add_argument("--out", default="spotify-tracks",
                    help="output folder (default: spotify-tracks)")
    ap.add_argument("--limit", type=int, default=0,
                    help="only process the first N tracks")
    ap.add_argument("--no-download", action="store_true",
                    help="only save the track list (playlist.json)")
    ap.add_argument("--format", default="best",
                    help="re-encode (mp3, m4a, ...; needs ffmpeg). "
                         "Default: keep YouTube's original audio")
    ap.add_argument("--cookies-from-browser", dest="cookies_browser",
                    default=None, metavar="BROWSER",
                    help="pass logged-in YouTube cookies from chrome, "
                         "firefox, edge, safari... (for bot-checks)")
    args = ap.parse_args()

    kind, info = parse_link(args.link)
    if not kind:
        msgs = {
            "empty": "Paste a Spotify link: python3 spotify_helper.py "
                     "\"https://open.spotify.com/playlist/...\"",
            "unrecognized": "That looks like a Spotify link, but not a "
                            "playlist, album or track link.",
            "notspotify": "That doesn't look like a Spotify link.",
        }
        sys.exit("Error: " + msgs.get(info, "Could not read that link."))

    print("Reading %s from Spotify..." % kind)
    try:
        pl = fetch_tracklist(kind, info)
    except Exception as e:
        sys.exit("Error: %s" % e)

    tracks = pl["tracks"]
    if args.limit and args.limit > 0:
        tracks = tracks[:args.limit]

    total_ms = sum(t["durMs"] for t in tracks)
    print('Playlist: "%s" — %d track(s), %s' % (
        pl["name"], len(tracks),
        time.strftime("%H:%M:%S", time.gmtime(total_ms / 1000))))

    os.makedirs(args.out, exist_ok=True)
    manifest = {
        "name": pl["name"],
        "url": pl["url"],
        "cover": pl["cover"],
        "tracks": [{k: t[k] for k in
                    ("title", "artist", "durMs", "previewUrl")}
                   for t in tracks],
    }
    json_path = os.path.join(args.out, "playlist.json")
    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(manifest, f, ensure_ascii=False, indent=1)
    print('Track list saved to "%s"' % json_path)

    if args.no_download:
        print("\n--no-download given: skipping the YouTube downloads.")
        print("Next: load playlist.json in the web app (step 1 \u2192 "
              '"load playlist.json") to see the tracks.')
        return

    try:
        import yt_dlp  # noqa: F401
    except ImportError:
        sys.exit('Error: yt-dlp is needed for downloads — install it with:\n'
                 "    pip install yt-dlp")

    if total_ms > 30 * 60 * 1000:
        print("\nHeads-up: that's over 30 minutes of audio. The video app "
              "records in real time, so consider --limit or a shorter "
              "playlist.")

    ok = fail = skip = 0
    botblocked = False
    print("")
    for i, t in enumerate(tracks):
        label = "%2d/%d  %s — %s" % (i + 1, len(tracks), t["artist"],
                                     t["title"])
        base = out_base(i, t)
        if already_done(args.out, base):
            skip += 1
            print("%s  [already downloaded, skipping]" % label)
            continue
        print("%s  [searching YouTube...]" % label)
        good, err = download_track(args.out, base, t, args.format,
                                    args.cookies_browser)
        if good:
            ok += 1
        else:
            fail += 1
            if err and looks_like_botblock(err):
                botblocked = True
            print("      !! download failed (%s)" %
                  (str(err).strip().splitlines()[-1][:160]
                   if err else "unknown error"))

    print("")
    print("Done: %d downloaded, %d skipped, %d failed." % (ok, skip, fail))
    if ok + skip:
        print('Next: open the web app and drag the "%s" folder into '
              "step 2 —\nthe tracks snap into playlist order automatically. "
              "Then pick a picture and make the video!"
              % args.out)
    if fail:
        if botblocked:
            print("\nYouTube asked this connection to \"confirm it's not a "
                  "bot\". Fix: re-run with your browser's YouTube "
                  "cookies, e.g.:\n    python3 spotify_helper.py \"%s\" "
                  "--cookies-from-browser chrome" % args.link)
        print("Tip: re-run the same command — already-downloaded tracks "
              "are skipped, only the failed ones are retried.")
        sys.exit(1)


if __name__ == "__main__":
    main()
