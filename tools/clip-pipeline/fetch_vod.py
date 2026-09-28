#!/usr/bin/env python3
"""Discover or download Yanchan's latest Kick stream VOD.

Usage:
    fetch_vod.py                          # auto-find newest local VOD
    fetch_vod.py --url <kick_video_url>   # download from Kick (needs yt-dlp)
    fetch_vod.py --file </path/to/vod.mp4># use a specific local file

Prints JSON: {"path": "...", "date": "YYYY-MM-DD", "title": "...", "source": "local|download|file"}
"""
import argparse
import json
import re
import shutil
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parent
PROJECT_ROOT = ROOT.parent.parent  # the repo root, wherever it was installed
DEFAULT_INCOMING = PROJECT_ROOT

# Filename patterns we expect from local recordings or Kick downloads.
# Examples:
#   YanchanProduced_Just Chatting_2026-06-26_720p30.mp4
#   YanchanProduced_Live Session w Kiki Rowe_2026-07-08_720p30.mp4
VOD_PATTERNS = [
    re.compile(r"YanchanProduced_.*_(\d{4}-\d{2}-\d{2})_.*\.mp4", re.IGNORECASE),
    re.compile(r"YanchanProduced_.*?(\d{4}-\d{2}-\d{2})\.mp4", re.IGNORECASE),
]

DATE_RE = re.compile(r"(\d{4}-\d{2}-\d{2})")
DATE_RE_COMPACT = re.compile(r"(\d{4})(\d{2})(\d{2})")


def find_yt_dlp() -> Optional[Path]:
    """Return yt-dlp executable path if available."""
    exe = shutil.which("yt-dlp") or shutil.which("yt-dlp_macos")
    if exe:
        return Path(exe)
    # Maybe it's installed in the project venv.
    venv_bin = ROOT / ".venv" / "bin"
    for name in ("yt-dlp", "yt-dlp_macos"):
        candidate = venv_bin / name
        if candidate.exists():
            return candidate
    return None


def extract_date_from_filename(filename: str) -> Optional[str]:
    for pat in VOD_PATTERNS:
        m = pat.search(filename)
        if m:
            return m.group(1)
    # Fallback: grab first YYYY-MM-DD anywhere in the name.
    m = DATE_RE.search(filename)
    if m:
        return m.group(1)
    # yt-dlp upload_date uses YYYYMMDD.
    m = DATE_RE_COMPACT.search(filename)
    if m:
        return f"{m.group(1)}-{m.group(2)}-{m.group(3)}"
    return None


def extract_title_from_filename(filename: str) -> str:
    """Derive a human title from the VOD filename."""
    # Drop extension, replace %20 with spaces, strip known prefix/suffix.
    name = Path(filename).stem
    name = name.replace("%20", " ")
    # Dash date or yt-dlp upload_date + trailing UUID.
    name = re.sub(r"_?\d{4}-\d{2}-\d{2}_?", " ", name)
    name = re.sub(r"_?\d{8}_[a-f0-9\-]+_?", " ", name, flags=re.IGNORECASE)
    name = re.sub(r"_?720p30$", "", name, flags=re.IGNORECASE)
    name = re.sub(r"_?1080p60$", "", name, flags=re.IGNORECASE)
    name = re.sub(r"^YanchanProduced_", "", name)
    return name.strip() or "Yanchan Kick Stream"


def find_local_vods(dirs: list[Path]) -> list[Path]:
    vods = []
    for d in dirs:
        if not d.exists():
            continue
        for f in d.iterdir():
            if not f.is_file():
                continue
            if f.suffix.lower() != ".mp4":
                continue
            if any(p.search(f.name) for p in VOD_PATTERNS) or DATE_RE.search(f.name):
                vods.append(f)
    return vods


def pick_latest_local_vod(dirs: list[Path]) -> Optional[Path]:
    vods = find_local_vods(dirs)
    if not vods:
        return None
    # Prefer files with YanchanProduced in the name, then newest mtime.
    yanchan_vods = [v for v in vods if "YanchanProduced" in v.name]
    candidates = yanchan_vods if yanchan_vods else vods
    return max(candidates, key=lambda p: p.stat().st_mtime)


def is_kick_url(url: str) -> bool:
    host = urlparse(url).netloc.lower()
    return "kick.com" in host


def same_broadcast(page_url: str) -> Optional[tuple]:
    r"""The HLS URL of a VOD we already know, reached by a different video id.

    Kick can carry more than one video record for one broadcast. `01a03af3-...`
    and `493946da-...` are both the 2026-08-25 "Live Session w/ S.A.M & Justice
    Case": yt-dlp resolves the second through `api/v1/video/<id>` and gets a 404
    on the first, so a link a person copied straight off a live VOD page failed
    with "no VOD with that id" while the footage was sitting right there.

    What ties them together is the recording itself. The page's `og:image` is
    `images.kick.com/video_thumbnails/<ivs_channel>/<recording>/720.webp`, and the
    scanned `source_hls` for the same broadcast contains both of those ids:

        .../ivs/v1/196233775518/3kjUd8PcBCnJ/2026/8/25/22/4/nsOljjEha0x3/media/...
                                ^^^^^^^^^^^^                ^^^^^^^^^^^^

    So: read the ids off the page, and if a stream already in the archive shares
    both, use the record that is known to work. Returns `(uuid, record)` or None.

    The whole record, not just its URL, because the identity is the point. An HLS
    URL carries no metadata: downloading through one while keeping the unknown id
    produced a second archive entry titled `NA_master_20260825_master` beside the
    original, still-at-risk one, and slipped past the 0.90 completeness guard --
    with no known record there was no advertised duration to check 70% against.
    """
    import json
    import re
    import urllib.request

    try:
        req = urllib.request.Request(page_url, headers={
            "User-Agent": ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                           "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 "
                           "Safari/537.36")})
        with urllib.request.urlopen(req, timeout=30) as resp:
            page = resp.read().decode("utf-8", "replace")
    except Exception:
        return None

    m = re.search(r"video_thumbnails/([A-Za-z0-9]+)/([A-Za-z0-9]+)", page)
    if not m:
        return None
    ivs_channel, recording = m.group(1), m.group(2)

    archive_path = PROJECT_ROOT / "streams" / "archive.json"
    try:
        data = json.loads(archive_path.read_text())
    except Exception:
        return None
    for uuid, rec in (data.get("streams") or {}).items():
        hls = rec.get("source_hls") or ""
        if ivs_channel in hls and recording in hls:
            return uuid, rec
    return None


def explain_yt_dlp_failure(code: int, output: list) -> str:
    """Turn yt-dlp's output into the one sentence the operator needs.

    Written against a real failure: pasting a VOD id that does not exist showed
    `yt-dlp exited 1`, a Python traceback, and a Python-3.9 deprecation notice —
    none of which say "there is no such VOD". The deprecation line in particular
    reads like the cause and is not even related.
    """
    text = "\n".join(output)
    err = next((l for l in reversed(output) if l.startswith("ERROR:")), "")

    if "404" in text and ("JSON metadata" in text or "Unable to download" in text):
        # Deliberately not "the VOD does not exist". Kick's page can be live while
        # `api/v1/video/<id>` 404s for that id, because a broadcast can carry more
        # than one video record and yt-dlp only resolves one of them. Saying it was
        # deleted sent the operator to check a link that was already correct.
        return ("Kick's API does not resolve that video id (404), though the page "
                "may well load — a broadcast can have more than one video record. "
                "If the stream is in the at-risk list, use Archive now: it "
                "downloads the same footage through the URL the scan recorded.")
    if "403" in text or "Forbidden" in text:
        return ("Kick refused the request (403) — this is the Cloudflare block on "
                "kick.com/api. The stream's HLS URL from the last scan still works; "
                "archive it from the at-risk list instead of by URL.")
    if "Unable to download webpage" in text or "Temporary failure" in text:
        return "Could not reach kick.com — check the network and try again."
    if "No space left" in text:
        return "The disk filled up mid-download. Free space and try again."
    if err:
        # Strip yt-dlp's own prefix noise but keep what it actually said.
        return err.replace("ERROR: ", "", 1).strip()
    return f"yt-dlp exited {code} — its own output is in the log below"


def download_with_yt_dlp(url: str, output_dir: Path) -> Path:
    yt_dlp = find_yt_dlp()
    if not yt_dlp:
        raise RuntimeError(
            "yt-dlp is not installed. To download from Kick, install it:\n"
            "  tools/clip-pipeline/.venv/bin/pip install yt-dlp\n"
            "Or download the VOD manually and place it in the project root."
        )

    output_dir.mkdir(parents=True, exist_ok=True)
    template = str(output_dir / "%(uploader)s_%(title)s_%(upload_date)s_%(id)s.%(ext)s")
    # Pin the format. calibrate.py measures the layout in source pixel
    # coordinates, so an unannounced 1080p60 download would invalidate every
    # one of them. Prefer 720p30 to match the existing VODs; if Kick ever
    # serves higher, re-calibrate deliberately rather than by surprise.
    cmd = [
        str(yt_dlp),
        "--no-warnings",
        "--no-playlist",
        "--no-progress",
        "-f", "bestvideo[height<=720][fps<=30]+bestaudio/best[height<=720]/best",
        "-o", template,
        url,
    ]
    print(f"Downloading with yt-dlp: {url}", file=sys.stderr)
    print(f"Command: {' '.join(cmd)}", file=sys.stderr)
    # yt-dlp prints progress/info to stdout; it goes to stderr so only our final
    # JSON reaches the caller that captures stdout. Tee'd rather than simply
    # redirected: on a failure the operator was shown "yt-dlp exited 1" plus a
    # Python traceback and a 3.9 deprecation notice, and had to read raw
    # extractor output to learn the one fact that mattered — whether the VOD
    # exists. Keep every line in the log; interpret the failure.
    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                            text=True, bufsize=1)
    output = []
    for line in proc.stdout:                       # type: ignore[union-attr]
        sys.stderr.write(line)
        output.append(line.rstrip())
    code = proc.wait()
    if code != 0:
        # Before giving up on a 404: the same broadcast may already be known under
        # a different video id, and its recorded HLS URL bypasses the API entirely.
        text = "\n".join(output)
        if "404" in text and is_kick_url(url) and not url.endswith(".m3u8"):
            match = same_broadcast(url)
            alt = match[1].get("source_hls") if match else None
            if alt:
                print("That video id does not resolve, but this is a broadcast we "
                      "already have a stream URL for — retrying with it.",
                      file=sys.stderr)
                return download_with_yt_dlp(alt, output_dir)
        raise RuntimeError(explain_yt_dlp_failure(code, output))

    # Find the file yt-dlp just wrote.
    mp4s = sorted(output_dir.glob("*.mp4"), key=lambda p: p.stat().st_mtime, reverse=True)
    if not mp4s:
        raise RuntimeError("yt-dlp finished but no MP4 was found in the output directory.")
    return mp4s[0]


def guess_date_from_downloaded_file(path: Path) -> str:
    date = extract_date_from_filename(path.name)
    if date:
        return date
    # Fallback: use today.
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")


def main():
    parser = argparse.ArgumentParser(description="Fetch or locate Yanchan's latest Kick VOD")
    parser.add_argument("--url", help="Kick video URL to download")
    parser.add_argument("--file", dest="file_path", type=Path, help="Use a specific local MP4 file")
    parser.add_argument("--incoming", type=Path, nargs="*", default=[DEFAULT_INCOMING],
                        help="Directories to scan for local VOD files")
    parser.add_argument("--output-dir", type=Path, default=PROJECT_ROOT,
                        help="Directory to save downloaded VODs")
    args = parser.parse_args()

    source_type = "local"
    vod_path: Optional[Path] = None
    title: Optional[str] = None
    date: Optional[str] = None

    if args.url:
        if not is_kick_url(args.url):
            print(f"WARNING: URL does not look like a Kick URL: {args.url}", file=sys.stderr)
        vod_path = download_with_yt_dlp(args.url, args.output_dir)
        source_type = "download"
        title = extract_title_from_filename(vod_path.name)
        date = guess_date_from_downloaded_file(vod_path)

    elif args.file_path:
        vod_path = args.file_path.resolve()
        if not vod_path.exists():
            print(json.dumps({"error": f"File not found: {vod_path}"}))
            sys.exit(1)
        source_type = "file"
        title = extract_title_from_filename(vod_path.name)
        date = extract_date_from_filename(vod_path.name)

    else:
        vod_path = pick_latest_local_vod(args.incoming)
        if vod_path is None:
            print(json.dumps({
                "error": "No local VOD found. Drop a Kick VOD MP4 in the project root, "
                         "or pass --url/--file.",
                "searched": [str(d) for d in args.incoming],
            }))
            sys.exit(1)
        title = extract_title_from_filename(vod_path.name)
        date = extract_date_from_filename(vod_path.name)

    if date is None:
        # Final fallback: file modification date.
        mtime = datetime.fromtimestamp(vod_path.stat().st_mtime, tz=timezone.utc)
        date = mtime.strftime("%Y-%m-%d")

    result = {
        "path": str(vod_path),
        "date": date,
        "title": title or "Yanchan Kick Stream",
        "source": source_type,
    }
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
