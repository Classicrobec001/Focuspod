#!/usr/bin/env python3
"""
Find where the LibriVox disclaimer ends in each chapter, so the app can skip it.

Most LibriVox chapters open with a standard notice:

    "This is a LibriVox recording. All LibriVox recordings are in the public
     domain. For more information or to volunteer, please visit librivox.org."

but not all of them, and its length varies with the reader (9-24 s measured).
A fixed "skip the first N seconds" would cut the story in chapters without
it, or leave half the notice in, so each chapter's opening is transcribed and the skip point
is set to the end of the word "librivox.org".

(A first measurement said 6 of 18 chapters had no notice. That was Whisper
dropping the opening sentences of longer clips; heard from the very start, 16
of 18 had it. Hence the multi-pass detect() below.) The reader credit and chapter
title that usually follow are kept — they tell the listener who is reading and
where they are.

Output: one JSON file per book, `<out>/<identifier>.json`:

    {"v": 1, "skips": {"<file base name>": <seconds>, ...}}

A value of 0 means "checked, no disclaimer" — the app then knows to leave the
chapter alone. A chapter missing from the file was not checked (download or
transcription failed) and is also left alone.

The file base name is the audio file name without its derivative suffix
(`_64kb.mp3`, `.mp3`), so one entry covers every bitrate of the same recording.
`introService.ts` in core derives the same key from a chapter's audio URL.

Usage (from the repo root):

    python3 -m venv .venv-intros
    .venv-intros/bin/pip install -r scripts/intro-skips/requirements.txt
    .venv-intros/bin/python scripts/intro-skips/build_intro_skips.py --top 100

Runs are incremental: books that already have a file are skipped unless
--force is given, so the catalogue can be extended a batch at a time.
"""

import argparse
import json
import os
import re
import sys
import tempfile
import time
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from typing import Dict, List, Optional

SEARCH_URL = "https://archive.org/advancedsearch.php"
METADATA_URL = "https://archive.org/metadata"
DOWNLOAD_URL = "https://archive.org/download"

# Same preference order as pickAudioFiles() in core/src/services/archiveService.ts,
# so the files checked here are the files the app actually plays.
MP3_FORMATS = ["64Kbps MP3", "VBR MP3", "128Kbps MP3", "MP3"]

# How much of each chapter to look at. The disclaimer ended between 9 and 24 s
# in every measured case; 45 s leaves room for slow readers and a title read
# before the notice.
CLIP_SECONDS = 45
# Bytes to fetch per format to cover CLIP_SECONDS with margin.
CLIP_BYTES = {"64Kbps MP3": 480_000, "VBR MP3": 1_100_000, "128Kbps MP3": 900_000, "MP3": 1_100_000}
# Word end timestamps run slightly early; land just after the word, not on it.
END_PADDING = 0.3

USER_AGENT = "FocusPod-intro-skips/1.0"


def http_get(url: str, byte_range: Optional[int] = None, retries: int = 3) -> bytes:
    headers = {"User-Agent": USER_AGENT}
    if byte_range:
        headers["Range"] = f"bytes=0-{byte_range - 1}"
    last: Optional[Exception] = None
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers=headers)
            with urllib.request.urlopen(req, timeout=60) as resp:  # follows redirects
                return resp.read()
        except Exception as error:  # noqa: BLE001 — retried, then re-raised
            last = error
            time.sleep(1.5 * (attempt + 1))
    raise RuntimeError(f"GET failed: {url}: {last}")


def top_identifiers(count: int) -> List[str]:
    query = urllib.parse.urlencode(
        [
            ("q", "collection:librivoxaudio"),
            ("fl[]", "identifier"),
            ("sort[]", "downloads desc"),
            ("rows", count),
            ("page", 1),
            ("output", "json"),
        ]
    )
    data = json.loads(http_get(f"{SEARCH_URL}?{query}"))
    return [d["identifier"] for d in data["response"]["docs"]]


def chapter_files(identifier: str) -> List[dict]:
    meta = json.loads(http_get(f"{METADATA_URL}/{urllib.parse.quote(identifier)}"))
    files = meta.get("files", [])
    for fmt in MP3_FORMATS:
        picked = [f for f in files if f.get("format") == fmt and f["name"].endswith(".mp3")]
        if picked:
            return picked
    return []


def base_name(file_name: str) -> str:
    """Mirror of introKey() in core/src/services/introService.ts."""
    name = file_name.rsplit("/", 1)[-1]
    return re.sub(r"(_(64|128)kb|_vbr)?\.mp3$", "", name, flags=re.IGNORECASE)


# Whisper hears the name many ways: LibriVox, LibraVox, Libra-Vox, Libervax,
# LibraVax. Anything shaped like "lib…vox/vax" counts.
LIBRIVOX = re.compile(r"^l[iy]b[a-z]{1,4}-?\s?v[aoe]x", re.IGNORECASE)
# The notice starts within the first 30 s and "librivox.org" follows its name
# within a few dozen words.
NOTICE_START_LIMIT = 30
NOTICE_SPAN_WORDS = 40


def _bare(token: str) -> str:
    return token.strip(" ,.;:!?\"'()").lower()


def find_disclaimer_end(words) -> float:
    """
    End time of "librivox.org" in the standard notice, or 0 when none is heard.

    Deliberately does not require the words "public domain": Whisper sometimes
    drops the middle sentence of the notice, and the name followed closely by
    ".org" in the opening seconds is specific enough on its own.
    """
    tokens = [(_bare(w.word), w.start, w.end) for w in words if w.start < CLIP_SECONDS]
    for i, (tok, start, _end) in enumerate(tokens):
        if start > NOTICE_START_LIMIT or not LIBRIVOX.search(tok):
            continue
        for j in range(i, min(len(tokens), i + NOTICE_SPAN_WORDS)):
            tok_j, _s, end_j = tokens[j]
            if tok_j.endswith("org") and tok_j != "organ":
                # Some readers spell it out straight after: "That's
                # L-I-B-R-I-V-O-X dot org". Skip that too when it follows.
                follow = tokens[j + 1 : j + 30]
                if any(t[0].startswith("l-i") or t[0] == "l" for t in follow[:6]):
                    for tok_k, _s2, end_k in follow:
                        if tok_k.endswith("org"):
                            end_j = end_k
                            break
                return round(end_j + END_PADDING, 1)
        return 0.0
    return 0.0


# Whisper sometimes skips the first sentences of a clip outright: on a 30-45 s
# clip it can emit nothing until ~20 s in, silently dropping the whole notice.
# Short windows leave it no room to do that, so the opening is read as
# overlapping 15 s windows (stopping as soon as the notice is found), with
# whole-clip passes as a fallback. Measured on 18 chapters: whole clips found 11
# notices, windows found 16, and a larger model (small.en) found none extra.
WINDOWS = [(0, 15), (10, 25), (20, 35), (30, 45)]
FALLBACK_PASSES = [
    dict(clip_timestamps=[0, 30], beam_size=1),
    dict(clip_timestamps=[0, CLIP_SECONDS], beam_size=5),
]


def detect(model, path: str) -> float:
    merged = []
    for a, b in WINDOWS:
        segments, _info = model.transcribe(
            path, word_timestamps=True, clip_timestamps=[a, b], beam_size=5
        )
        last = merged[-1].end if merged else -1.0
        # Overlapping windows repeat words; keep only what starts after the
        # last word already held.
        merged.extend(w for seg in segments for w in (seg.words or []) if w.start > last + 0.05)
        end = find_disclaimer_end(merged)
        if end > 0:
            return end
    for options in FALLBACK_PASSES:
        segments, _info = model.transcribe(path, word_timestamps=True, **options)
        end = find_disclaimer_end([w for seg in segments for w in (seg.words or [])])
        if end > 0:
            return end
    return 0.0


def process_book(model, identifier: str, out_dir: str, workdir: str) -> Optional[Dict[str, float]]:
    files = chapter_files(identifier)
    if not files:
        print(f"  {identifier}: no mp3 files, skipped", flush=True)
        return None

    def fetch(f):
        path = os.path.join(workdir, re.sub(r"[^\w.-]", "_", f["name"]))
        url = f"{DOWNLOAD_URL}/{urllib.parse.quote(identifier)}/{urllib.parse.quote(f['name'])}"
        try:
            data = http_get(url, CLIP_BYTES.get(f.get("format", ""), 1_100_000))
        except RuntimeError as error:
            print(f"  ! {error}", flush=True)
            return f, None
        with open(path, "wb") as fh:
            fh.write(data)
        return f, path

    skips: Dict[str, float] = {}
    with ThreadPoolExecutor(max_workers=6) as pool:
        for f, path in pool.map(fetch, files):
            if not path:
                continue
            try:
                skips[base_name(f["name"])] = detect(model, path)
            except Exception as error:  # noqa: BLE001 — a bad file must not stop the batch
                print(f"  ! transcribe failed {f['name']}: {error}", flush=True)
            finally:
                os.remove(path)

    with open(os.path.join(out_dir, f"{identifier}.json"), "w") as fh:
        json.dump({"v": 1, "skips": skips}, fh, separators=(",", ":"), sort_keys=True)
    found = sum(1 for v in skips.values() if v > 0)
    print(f"  {identifier}: {len(skips)}/{len(files)} chapters checked, {found} with a disclaimer", flush=True)
    return skips


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--top", type=int, default=100, help="most-downloaded books to process")
    parser.add_argument("--ids", nargs="*", help="process these identifiers instead of --top")
    parser.add_argument("--out", default=os.path.join("web", "public", "intros"))
    parser.add_argument("--model", default="base.en", help="faster-whisper model name")
    parser.add_argument("--force", action="store_true", help="redo books that already have a file")
    args = parser.parse_args()

    from faster_whisper import WhisperModel  # imported late so --help works without it

    os.makedirs(args.out, exist_ok=True)
    ids = args.ids or top_identifiers(args.top)
    model = WhisperModel(args.model, device="cpu", compute_type="int8")

    with tempfile.TemporaryDirectory(prefix="intro-skips-") as workdir:
        for n, identifier in enumerate(ids, 1):
            target = os.path.join(args.out, f"{identifier}.json")
            if os.path.exists(target) and not args.force:
                continue
            print(f"[{n}/{len(ids)}] {identifier}", flush=True)
            try:
                process_book(model, identifier, args.out, workdir)
            except Exception as error:  # noqa: BLE001 — log and move on to the next book
                print(f"  ! {identifier} failed: {error}", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
