#!/usr/bin/env python3
"""The single source of truth for clip context tags.

This file exists because the same bug shipped twice. `analyze.py` started emitting
`production`/`vocal`/`advice` while `build_strategy.py` still only knew
`gaming`/`roast`/`freestyle`; later `select_music_clips.py` started emitting
`singing`/`beat` and `build_strategy.py` knew neither. Both times the failure was
silent — clips went out with "One of those moments you had to clip" and a bare
`#ViralClip` — because a tag can be emitted in one file and unknown in another
with nothing coupling them.

So: selectors import the NAMES from here, build_strategy imports the COPY from
here, and `require_known()` turns a missing entry into a loud startup failure
instead of generic copy on a deliverable.

Adding a tag means adding one entry below. Nothing else.
"""

BASE_HASHTAGS = "#YanchanProduced #Yanchan #KickStream #Streamer #ViralClip"

# tag -> (primary platform, cross-post, hook A, hook B, tag-specific hashtags)
TAGS = {
    # --- music-first selection (select_music_clips.py) -----------------------
    "singing": (
        "TikTok / Reels / Shorts", "X",
        "The moment the vocal idea landed",
        "Listen to this take come together in real time",
        "#Singing #Vocals #Songwriting #Ableton #InTheStudio",
    ),
    "beat": (
        "TikTok / Reels / Shorts", "X",
        "Watch Yanchan cook this beat up in real time \U0001F525",
        "This is how a session becomes a song",
        "#ProducerLife #Ableton #BeatMaker #MusicProducer #InTheStudio",
    ),
    # --- speech-first selection (analyze.py) ---------------------------------
    "production": (
        "TikTok / Reels / Shorts", "X",
        "Watch Yanchan cook this beat up in real time \U0001F525",
        "This is how a session becomes a song",
        "#ProducerLife #Ableton #BeatMaker #MusicProducer #InTheStudio",
    ),
    "vocal": (
        "TikTok / Reels / Shorts", "X",
        "The moment the vocal idea landed",
        "Listen to this take come together",
        "#ProducerLife #Ableton #Vocals #Songwriting #InTheStudio",
    ),
    "collab": (
        "TikTok / Reels / Shorts", "X / Threads",
        "Studio session energy is unmatched ⚡",
        "This loop hit different once they both touched it",
        "#ProducerLife #Ableton #Collaboration #StudioSession",
    ),
    "culture": (
        "YouTube Shorts / TikTok", "Threads",
        "Tamil roots, Toronto sound \U0001F3B6",
        "Where the sound actually comes from",
        "#TamilMusic #Toronto #Scarborough #SouthAsianArtist",
    ),
    "advice": (
        "YouTube Shorts / TikTok", "X / Threads",
        "Producer tip you can use tonight",
        "Beat breakdown you actually learn from",
        "#ProducerTips #Ableton #MusicProduction #LearnMusic",
    ),
    "freestyle": (
        "TikTok / Reels / Shorts", "X",
        "Yanchan went OFF on this freestyle \U0001F525",
        "When the beat drops and the bars just keep coming",
        "#Freestyle #Rap #Bars #HipHop",
    ),
    "roast": (
        "TikTok / Reels / Shorts", "X / Threads",
        "He thought he was safe... he was NOT \U0001F62D",
        "The roast was so clean chat had to clip it",
        "#Roast #Comedy #Funny",
    ),
    "reaction": (
        "TikTok / Reels / Shorts", "X",
        "His reaction says everything \U0001F480",
        "When the moment hits different and you have no words",
        "#Reaction #FunnyReaction #Clip",
    ),
    "story": (
        "YouTube Shorts / TikTok", "Threads",
        "Story time from the studio",
        "You had to be there — the clip is the next best thing",
        "#StoryTime #StreamerLife #Kick",
    ),
    "banter": (
        "TikTok / Reels", "X / Threads",
        "Chat was WILDIN in this moment",
        "The back-and-forth energy was unmatched",
        "#Banter #Funny #LiveStream",
    ),
    "laugh": (
        "TikTok / Reels / Shorts", "X / Threads",
        "This one got everybody",
        "Could not keep it together",
        "#Funny #Laugh #Comedy",
    ),
    "energy": (
        "TikTok / Reels / Shorts", "X",
        "Pure chaos. Pure entertainment.",
        "The volume went up and chat lost it",
        "#Energy #Vibes #Viral",
    ),
    "fasttalk": (
        "TikTok / Reels", "X",
        "He did not take a breath once",
        "Try keeping up with this",
        "#Bars #Rap #FastTalk",
    ),
    "moment": (
        "TikTok / Reels", "X",
        "One of those moments you had to clip",
        "Short, loud, impossible to scroll past",
        "#ViralClip #Streamer #Moment",
    ),
}

# Names the selectors are allowed to emit.
MUSIC_TAGS = ("singing", "beat")
SPEECH_TAGS = tuple(t for t in TAGS if t not in MUSIC_TAGS)


def platforms(tag):
    e = TAGS.get(tag) or TAGS["moment"]
    return e[0], e[1]


def hooks(tag):
    e = TAGS.get(tag) or TAGS["moment"]
    return e[2], e[3]


def hashtags(tag):
    e = TAGS.get(tag) or TAGS["moment"]
    return f"{e[4]} {BASE_HASHTAGS}"


def require_known(used_tags):
    """Fail loudly if anything emitted a tag we have no copy for.

    Silent fallback is what let generic copy ship twice. Raising here means a new
    tag is a startup error, not a discovery made by reading the delivered clips.
    """
    missing = sorted(set(used_tags) - set(TAGS))
    if missing:
        raise SystemExit(
            "Unknown context tag(s) with no copy defined: "
            + ", ".join(missing)
            + f"\nAdd them to {__file__} (platform, 2 hooks, hashtags)."
        )
