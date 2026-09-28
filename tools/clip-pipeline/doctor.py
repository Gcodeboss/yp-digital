#!/usr/bin/env python3
"""Preflight check for the Yanchan clip pipeline.

Run this when something will not start, or straight after installing:

    ./install.sh            runs it for you at the end
    python3 tools/clip-pipeline/doctor.py

It prints one row per thing the pipeline needs, and for anything that is not OK
it prints the exact command that fixes it. It exits non-zero if something
essential is broken, so install.sh can stop rather than pretend it worked.

Two deliberate constraints:

  * STANDARD LIBRARY ONLY. This has to be able to run BEFORE the virtual
    environment exists — that is the moment you most need it to tell you what is
    missing. A doctor that needs the thing it is diagnosing is not a doctor.

  * IT CHECKS THE VENV, NOT ITSELF. If you launch it with the system python but
    tools/clip-pipeline/.venv exists, it re-launches itself inside that venv, so
    the packages it reports on are the ones the pipeline will actually import.
"""
import os
import re
import shutil
import subprocess
import sys
from datetime import date
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parent.parent
VENV_PY = HERE / ".venv" / "bin" / "python"
REQUIREMENTS = HERE / "requirements.txt"
YT_DLP_STALE_DAYS = 60     # Kick changes its player often; a stale pin is the usual cause

# A stream capture is about 2.8 GB. Extracting audio, building a browser-playable
# proxy and rendering a batch of clips on top of that needs real headroom.
DISK_COMFORTABLE_GB = 15
DISK_MINIMUM_GB = 5

# Lowest and highest Python the pinned requirements have wheels for. See the
# PYTHON VERSION note in requirements.txt.
PY_MIN = (3, 9)
PY_MAX = (3, 12)

# import name -> pip distribution name, in the order a person would care about.
PACKAGES = [
    ("numpy", "numpy", "audio analysis"),
    ("scipy", "scipy", "audio analysis"),
    ("imageio_ffmpeg", "imageio-ffmpeg", "video (vendored ffmpeg)"),
    ("cv2", "opencv-python", "video (frame measurement)"),
    ("PIL", "pillow", "video (watermark)"),
    ("torch", "torch", "transcription engine"),
    ("whisper", "openai-whisper", "transcription"),
    ("faster_whisper", "faster-whisper", "transcription (windows)"),
    ("tqdm", "tqdm", "progress bars"),
]

# Directories the pipeline and the dashboard read and write. install.sh makes
# these; the pipeline also creates most of them on demand, so a missing one is a
# warning rather than a failure.
EXPECTED_DIRS = [
    REPO / "clips",
    REPO / "streams",
    REPO / "streams" / "prepare",
    REPO / "streams" / "proxy",
    REPO / "streams" / "waveform",
    REPO / "transcripts",
    HERE / "work",
    HERE / "work" / "preview",
    REPO / "site" / "data",
]

# compose.py burns captions with this face out of the macOS system font folder.
CAPTION_FONT = Path("/System/Library/Fonts/Supplemental/Arial Black.ttf")

GREEN, RED, YELLOW, DIM, BOLD, OFF = "", "", "", "", "", ""
if sys.stdout.isatty() and os.environ.get("NO_COLOR") is None:
    GREEN, RED, YELLOW = "\033[32m", "\033[31m", "\033[33m"
    DIM, BOLD, OFF = "\033[2m", "\033[1m", "\033[0m"

rows = []
failures = 0
warnings = 0


def record(status, name, detail, fix=None):
    """status is 'PASS', 'FAIL' or 'WARN'. `fix` is printed under a bad row."""
    global failures, warnings
    if status == "FAIL":
        failures += 1
    elif status == "WARN":
        warnings += 1
    rows.append((status, name, detail, fix))


def human_bytes(n):
    for unit in ("B", "KB", "MB", "GB", "TB"):
        if n < 1024 or unit == "TB":
            return f"{n:.0f} {unit}" if unit in ("B", "KB") else f"{n:.1f} {unit}"
        n /= 1024.0


def pinned_versions():
    """What requirements.txt asks for, so this file never drifts from that one."""
    pins = {}
    if not REQUIREMENTS.exists():
        return pins
    for line in REQUIREMENTS.read_text().splitlines():
        line = line.split("#", 1)[0].strip()
        if "==" in line:
            dist, version = line.split("==", 1)
            pins[dist.strip().lower()] = version.strip()
    return pins


# --------------------------------------------------------------------------
# Re-launch inside the venv, so the packages reported are the ones that matter.
# --------------------------------------------------------------------------
def in_project_venv():
    """True when this interpreter IS the project's venv.

    Compares sys.prefix, not the executable path. A venv's bin/python is a
    symlink to the base interpreter, so two DIFFERENT venvs built from the same
    Python resolve to the same real file — resolving the symlink would call any
    venv on this machine "the project venv". sys.prefix is the venv's own root
    and is the only thing that actually distinguishes them.
    """
    try:
        return Path(sys.prefix).resolve() == (VENV_PY.parent.parent).resolve()
    except OSError:
        return False


def reexec_into_venv():
    if os.environ.get("YP_DOCTOR_REEXEC") == "1":
        return
    if not VENV_PY.exists() or in_project_venv():
        return
    env = dict(os.environ, YP_DOCTOR_REEXEC="1")
    os.execve(str(VENV_PY), [str(VENV_PY), str(Path(__file__).resolve()), *sys.argv[1:]], env)


# --------------------------------------------------------------------------
# Checks
# --------------------------------------------------------------------------
def check_python():
    v = sys.version_info
    label = f"{v.major}.{v.minor}.{v.micro}"
    where = "in .venv" if in_project_venv() else sys.executable
    if (v.major, v.minor) < PY_MIN:
        record("FAIL", "Python version", f"{label} — too old",
               "macOS ships a usable Python. Install Apple's command line tools with:\n"
               "    xcode-select --install\n"
               "  then run ./install.sh again.")
    elif (v.major, v.minor) > PY_MAX:
        record("FAIL", "Python version", f"{label} — too new for the pinned packages",
               f"The pipeline needs Python {PY_MIN[0]}.{PY_MIN[1]}–{PY_MAX[0]}.{PY_MAX[1]}.\n"
               "  macOS has a suitable one built in. Rebuild the environment with it:\n"
               "    rm -rf tools/clip-pipeline/.venv && PYTHON=/usr/bin/python3 ./install.sh")
    else:
        record("PASS", "Python version", f"{label}  ({where})")


def check_venv():
    if VENV_PY.exists():
        record("PASS", "Virtual environment", str(VENV_PY.parent.parent))
    else:
        record("FAIL", "Virtual environment", "not created yet",
               "Run the installer from the repo root:\n    ./install.sh")


# Really imported, in a child process, for two reasons. One: a package that is
# present but half-written only shows up on import, and `find_spec` would call it
# fine. Two: opencv and av each ship their own copy of libavdevice, so importing
# both in one process makes the macOS Objective-C runtime print a paragraph about
# "mysterious crashes" that is loud, harmless, and exactly the wrong thing to show
# someone on a screen headed "preflight check". The child's stderr is discarded.
IMPORT_PROBE = r"""
import json, sys
try:
    from importlib import metadata
except ImportError:
    metadata = None
import importlib
out = {}
for module, dist in json.loads(sys.argv[1]):
    try:
        importlib.import_module(module)
    except Exception as exc:
        out[dist] = {"ok": False, "error": type(exc).__name__}
        continue
    version = "?"
    if metadata is not None:
        try:
            version = metadata.version(dist)
        except Exception:
            pass
    out[dist] = {"ok": True, "version": version}
print("@@" + json.dumps(out))
"""


def probe_imports():
    """{dist: {"ok": bool, ...}} — or None if the probe itself could not run."""
    import json
    payload = json.dumps([[m, d] for m, d, _ in PACKAGES])
    try:
        proc = subprocess.run(
            [sys.executable, "-c", IMPORT_PROBE, payload],
            capture_output=True, text=True, timeout=300,
        )
    except Exception:
        return None
    for line in proc.stdout.splitlines():
        if line.startswith("@@"):
            try:
                return json.loads(line[2:])
            except ValueError:
                return None
    return None


def check_packages():
    results = probe_imports()
    if results is None:
        record("FAIL", "Packages", "could not be checked — the environment will not start",
               "Rebuild it from scratch:\n"
               "    rm -rf tools/clip-pipeline/.venv && ./install.sh")
        return

    pins = pinned_versions()
    for module, dist, purpose in PACKAGES:
        info = results.get(dist, {"ok": False, "error": "missing"})
        if not info.get("ok"):
            record("FAIL", f"{dist}", f"cannot import ({info.get('error', 'missing')})",
                   "The environment is incomplete or half-built. Rebuild it:\n"
                   "    rm -rf tools/clip-pipeline/.venv && ./install.sh")
            continue

        version = info.get("version", "?")
        want = pins.get(dist.lower())
        if want and version != "?" and version != want:
            record("WARN", f"{dist}", f"{version} installed, {want} pinned  [{purpose}]",
                   "Not necessarily broken, but it is not what was tested. To match:\n"
                   f"    tools/clip-pipeline/.venv/bin/pip install {dist}=={want}")
        else:
            record("PASS", f"{dist}", f"{version}  {DIM}[{purpose}]{OFF}")


def check_ffmpeg():
    """The pipeline uses the ffmpeg INSIDE imageio-ffmpeg, not a system one."""
    try:
        import imageio_ffmpeg
    except Exception:
        record("FAIL", "ffmpeg", "imageio-ffmpeg is not installed",
               "ffmpeg is bundled inside that package. Install it:\n"
               "    ./install.sh")
        return
    try:
        exe = imageio_ffmpeg.get_ffmpeg_exe()
    except Exception as exc:
        record("FAIL", "ffmpeg", f"could not be located ({exc})",
               "Reinstall the bundled binary:\n"
               "    tools/clip-pipeline/.venv/bin/pip install --force-reinstall imageio-ffmpeg")
        return
    if not Path(exe).exists():
        record("FAIL", "ffmpeg", f"missing at {exe}",
               "Reinstall the bundled binary:\n"
               "    tools/clip-pipeline/.venv/bin/pip install --force-reinstall imageio-ffmpeg")
        return
    try:
        out = subprocess.run([exe, "-version"], capture_output=True, text=True, timeout=30)
        first = out.stdout.splitlines()[0] if out.stdout else ""
        version = first.split(" ")[2] if len(first.split(" ")) > 2 else "runs"
    except Exception as exc:
        record("FAIL", "ffmpeg", f"found but will not run ({type(exc).__name__})",
               "macOS may have quarantined it. Clear that and try again:\n"
               f"    xattr -dr com.apple.quarantine '{exe}'")
        return
    record("PASS", "ffmpeg", f"{version}  {DIM}(bundled — no Homebrew needed){OFF}")


def check_yt_dlp():
    """fetch_vod.py looks on PATH first, then in this venv's bin/."""
    found = shutil.which("yt-dlp") or shutil.which("yt-dlp_macos")
    if not found:
        for name in ("yt-dlp", "yt-dlp_macos"):
            candidate = HERE / ".venv" / "bin" / name
            if candidate.exists():
                found = str(candidate)
                break
    if not found:
        record("FAIL", "yt-dlp", "not found",
               "Needed to download a VOD from Kick. Install it into the venv:\n"
               "    tools/clip-pipeline/.venv/bin/pip install yt-dlp")
        return
    try:
        out = subprocess.run([found, "--version"], capture_output=True, text=True, timeout=60)
        version = out.stdout.strip().splitlines()[-1] if out.stdout.strip() else "runs"
    except Exception:
        version = "found, version unknown"
    # yt-dlp's version IS a date. Kick changes its player often, and a pin that
    # was fine when it shipped is the single most likely thing to stop the
    # capture months from now -- with an error about the download, never about
    # the pin. Say the age out loud before that happens.
    age = _ytdlp_age_days(version)
    if age is not None and age > YT_DLP_STALE_DAYS:
        record("WARN", "yt-dlp", f"{version} — {age} days old",
               "Kick changes its player often and this is the package that\n"
               "tracks it. If a download starts failing, update this first:\n"
               "    tools/clip-pipeline/.venv/bin/pip install -U yt-dlp")
    else:
        detail = version + (f" ({age} days old)" if age is not None else "")
        record("PASS", "yt-dlp", detail)


def _ytdlp_age_days(version):
    m = re.match(r"(\d{4})\.(\d{2})\.(\d{2})", version.strip())
    if not m:
        return None
    try:
        released = date(*(int(g) for g in m.groups()))
    except ValueError:
        return None
    return (date.today() - released).days


def check_capture_schedule():
    """Is anything going to look for new streams while nobody is here?

    Every stream lost so far was lost to nobody running the scan. Not having the
    agent is a deliberate, supported choice -- so this is a warning that names the
    consequence, never a failure.
    """
    label = "com.yanchan.capture"
    plist = Path.home() / "Library" / "LaunchAgents" / f"{label}.plist"
    try:
        loaded = subprocess.run(["launchctl", "print", f"gui/{os.getuid()}/{label}"],
                                capture_output=True, text=True, timeout=15).returncode == 0
    except Exception:
        loaded = False

    if loaded:
        record("PASS", "Daily capture", "LaunchAgent loaded — runs at 04:00")
    elif plist.exists():
        record("WARN", "Daily capture", "installed but not loaded",
               f"launchctl bootstrap gui/{os.getuid()} {plist}")
    else:
        record("WARN", "Daily capture", "not installed — nothing scans Kick on its own",
               "Kick deletes streams after ~30 days. Either install the agent:\n"
               "    ./install.sh\n"
               "or remember to run this yourself:\n"
               "    ./tools/clip-pipeline/capture.sh")


def check_scan_freshness():
    """How old is the answer the dashboard is showing?

    A scan result with no age is the failure this check exists for: on
    2026-09-06 the dashboard read `AT RISK 0` off a 19-day-old scan while three
    streams sat uncaptured on Kick.
    """
    try:
        sys.path.insert(0, str(HERE))
        import archive
        state = archive.scan_state(archive.load())
    except Exception as exc:
        record("WARN", "Kick scan", f"could not be read ({type(exc).__name__})")
        return

    if state["state"] == "fresh":
        record("PASS", "Kick scan", state["message"])
    elif state["state"] == "at_risk":
        record("WARN", "Kick scan", state["message"],
               "Open the dashboard's Streams screen and press 'Archive now' on\n"
               "each amber row, or run:\n"
               "    ./tools/clip-pipeline/capture.sh")
    else:
        record("WARN", "Kick scan", state["message"],
               "Scan now:\n    tools/clip-pipeline/.venv/bin/python "
               "tools/clip-pipeline/scan_kick.py")


def check_discovery_key():
    """Whether speech discovery has an API key. NEITHER state is an error.

    Discovery ships off (yp-dash-handoff 6b.2): analyze.py already selects on
    speech with no model at all and produced every clip of the 2026-07-31 IRL
    stream. A missing key must therefore never read as broken -- it is the
    shipped configuration, and the reason the guide can say nothing leaves the
    machine.
    """
    if os.environ.get("OPENROUTER_API_KEY"):
        record("PASS", "Speech discovery", "key set — transcripts are sent to openrouter.ai",
               "This is opt-in. To turn it off again, unset OPENROUTER_API_KEY.")
    else:
        record("PASS", "Speech discovery", "off (no key) — selection is fully local")


def check_whisper_model():
    model = os.environ.get("WHISPER_MODEL", "small")
    cache = Path(os.environ.get("XDG_CACHE_HOME", Path.home() / ".cache")) / "whisper"
    target = cache / f"{model}.pt"
    if target.exists():
        record("PASS", f"Whisper model '{model}'", f"cached, {human_bytes(target.stat().st_size)}")
        return
    others = sorted(cache.glob("*.pt")) if cache.exists() else []
    if others:
        names = ", ".join(p.stem for p in others)
        record("WARN", f"Whisper model '{model}'", f"not cached (you do have: {names})",
               f"It downloads itself on the first transcription — 'small' is about 480 MB.\n"
               f"  To use one you already have instead:  export WHISPER_MODEL=<name>")
    else:
        record("WARN", f"Whisper model '{model}'", "not downloaded yet",
               "Nothing to do — it downloads itself the first time you transcribe\n"
               "  ('small' is about 480 MB). Just be on wifi for that first run.")


def check_disk():
    try:
        usage = shutil.disk_usage(REPO)
    except OSError as exc:
        record("WARN", "Disk space", f"could not be read ({exc})")
        return
    free_gb = usage.free / (1024 ** 3)
    detail = f"{free_gb:.1f} GB free  {DIM}(one stream capture is ~2.8 GB){OFF}"
    if free_gb < DISK_MINIMUM_GB:
        record("FAIL", "Disk space", detail,
               f"A single VOD is about 2.8 GB before any clips are rendered, and you have\n"
               f"  {free_gb:.1f} GB. Free up space — aim for {DISK_COMFORTABLE_GB} GB. Old captures live in\n"
               f"  {REPO / 'streams'} and are the usual culprit.")
    elif free_gb < DISK_COMFORTABLE_GB:
        record("WARN", "Disk space", detail,
               f"Enough for one stream, tight for a session. {DISK_COMFORTABLE_GB} GB is comfortable.")
    else:
        record("PASS", "Disk space", detail)


def check_dirs():
    missing = [d for d in EXPECTED_DIRS if not d.is_dir()]
    if not missing:
        record("PASS", "Working folders", f"all {len(EXPECTED_DIRS)} present")
        return
    shown = ", ".join(str(d.relative_to(REPO)) for d in missing[:4])
    if len(missing) > 4:
        shown += f", +{len(missing) - 4} more"
    record("WARN", "Working folders", f"{len(missing)} missing: {shown}",
           "Most get created on demand, but the installer makes them all:\n"
           "    ./install.sh")


def check_font():
    if CAPTION_FONT.exists():
        record("PASS", "Caption font", "Arial Black")
    else:
        record("WARN", "Caption font", "Arial Black not found",
               "Captions will still render, but in a substitute face that is not the\n"
               "  approved look. Arial Black ships with macOS — on a Mac that has had\n"
               "  fonts removed, restore it from Font Book.")


def check_node():
    """The dashboard is a Next.js app. install.sh gates on this properly; here it
    is a warning so `doctor.py` stays a verdict on the Python pipeline."""
    node = shutil.which("node")
    if not node:
        record("WARN", "Node.js", "not installed",
               "Only the dashboard needs it; the pipeline runs without it. To install:\n"
               "    brew install node        (or download from https://nodejs.org)")
        return
    try:
        out = subprocess.run([node, "--version"], capture_output=True, text=True, timeout=30)
        version = out.stdout.strip()
    except Exception:
        version = "unknown"
    major = 0
    if version.startswith("v") and version[1:].split(".")[0].isdigit():
        major = int(version[1:].split(".")[0])
    if major and major < 20:
        record("WARN", "Node.js", f"{version} — the dashboard needs 20 or newer",
               "Update it:\n    brew upgrade node        (or download from https://nodejs.org)")
        return
    if not (REPO / "site" / "node_modules").is_dir():
        record("WARN", "Node.js", f"{version}, but the dashboard's packages are missing",
               "Install them:\n    ./install.sh")
        return
    record("PASS", "Node.js", f"{version}  {DIM}(dashboard){OFF}")


# --------------------------------------------------------------------------
def main():
    reexec_into_venv()

    print()
    print(f"{BOLD}Yanchan clip pipeline — preflight check{OFF}")
    print(f"{DIM}{REPO}{OFF}")
    print(f"{DIM}checking (loading the video and speech libraries takes a few seconds)…{OFF}")

    check_python()
    check_venv()
    if VENV_PY.exists():
        check_packages()
        check_ffmpeg()
    else:
        record("FAIL", "Packages", "skipped — no virtual environment to check",
               "Run the installer from the repo root:\n    ./install.sh")
    check_yt_dlp()
    check_capture_schedule()
    check_scan_freshness()
    check_discovery_key()
    check_whisper_model()
    check_disk()
    check_dirs()
    check_font()
    check_node()

    width = max(len(name) for _, name, _, _ in rows) + 2
    print()
    for status, name, detail, fix in rows:
        colour = {"PASS": GREEN, "FAIL": RED, "WARN": YELLOW}[status]
        print(f"  {colour}{status:<4}{OFF}  {name:<{width}}{detail}")
        if fix:
            # Hang the whole fix under the row, so a two-line command reads as one
            # block rather than falling back to column zero.
            pad = " " * (8 + width)
            lines = fix.split("\n")
            print(f"{pad}{DIM}fix:{OFF} {lines[0]}")
            for extra in lines[1:]:
                print(f"{pad}     {extra.strip()}")
    print()

    passed = sum(1 for r in rows if r[0] == "PASS")
    if failures:
        print(f"  {RED}{BOLD}{failures} problem(s) must be fixed{OFF}"
              f"   ({passed} OK, {warnings} warning(s))")
        print("  Each one above has a 'fix:' line. Run them, then run this again:")
        print("      python3 tools/clip-pipeline/doctor.py")
        print()
        return 1

    if warnings:
        print(f"  {GREEN}{BOLD}Ready.{OFF}  {passed} OK, {warnings} warning(s) — "
              f"nothing blocking, read them if something behaves oddly.")
    else:
        print(f"  {GREEN}{BOLD}Ready.{OFF}  All {passed} checks passed.")
    print()
    return 0


if __name__ == "__main__":
    sys.exit(main())
