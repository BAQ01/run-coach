#!/usr/bin/env python3
import os, re, json, subprocess, shlex, tempfile, pathlib

REPO_ROOT = pathlib.Path(__file__).resolve().parents[1]
INDEX = REPO_ROOT / "index.html"
AUDIO_DIR = REPO_ROOT / "audio"
TMP_DIR = REPO_ROOT / "tools" / ".tmp_audio"

AUDIO_DIR.mkdir(exist_ok=True, parents=True)
TMP_DIR.mkdir(exist_ok=True, parents=True)

# ---------- Helpers ----------
def slugify(title: str) -> str:
    s = title.lower()
    s = re.sub(r"[^a-z0-9]+", "-", s).strip("-")
    return s[:80]  # keep it short-ish

def run(cmd: str):
    # print(cmd)
    subprocess.check_call(cmd, shell=True)

def make_silence(path: pathlib.Path, seconds: float):
    seconds = max(0.0, float(seconds))
    # 48kHz mono PCM
    run(f"ffmpeg -y -f lavfi -i anullsrc=r=48000:cl=mono -t {seconds:.3f} -c:a pcm_s16le {shlex.quote(str(path))} -loglevel error")

def make_beep(path: pathlib.Path, seconds: float = 0.08, freq: int = 880):
    run(f"ffmpeg -y -f lavfi -i sine=frequency={freq}:beep_factor=2:duration={seconds:.3f} -c:a pcm_s16le {shlex.quote(str(path))} -loglevel error")

def tts_wav(text: str, out_path: pathlib.Path, voice: str = "nl", speed_wpm: int = 170):
    # espeak-ng: Dutch voice "nl" (installed via apt)
    # -s is speed in words per minute (approx)
    cmd = f'espeak-ng -v {shlex.quote(voice)} -s {speed_wpm} -w {shlex.quote(str(out_path))} -- {shlex.quote(text)}'
    run(cmd)

def concat_wavs_to_mp3(parts, out_mp3: pathlib.Path):
    # concat demuxer: write list file
    listfile = TMP_DIR / "concat.txt"
    with open(listfile, "w", encoding="utf-8") as f:
        for p in parts:
            f.write(f"file '{p.as_posix()}'\n")
    run(f"ffmpeg -y -f concat -safe 0 -i {shlex.quote(str(listfile))} -c:a libmp3lame -b:a 128k {shlex.quote(str(out_mp3))} -loglevel error")

# ---------- Extract SESSIONS from index.html ----------
html = INDEX.read_text(encoding="utf-8", errors="ignore")
m = re.search(r"const\s+SESSIONS\s*=\s*(\[\s*{.*?}\s*\])\s*;", html, re.S)
if not m:
    raise SystemExit("Kon const SESSIONS niet vinden in index.html")
SESSIONS = json.loads(m.group(1))

# ---------- Build MP3 per sessie ----------
print(f"Gevonden sessies: {len(SESSIONS)}")
beep_wav = TMP_DIR / "beep.wav"
if not beep_wav.exists():
    make_beep(beep_wav)

for sess in SESSIONS:
    title = sess.get("title", "sessie")
    cues  = sess.get("cues", [])
    slug  = slugify(title)
    out_mp3 = AUDIO_DIR / f"{slug}.mp3"

    # Skip if already exists and newer than index.html (speed up CI)
    if out_mp3.exists() and out_mp3.stat().st_mtime > INDEX.stat().st_mtime:
        print(f"⌁ Skip (up-to-date): {out_mp3.name}")
        continue

    print(f"🎧 Bouwen: {title} → {out_mp3.name}")
    parts = []
    now_t = 0.0  # seconds along the final timeline

    for i, cue in enumerate(cues):
        t = float(cue.get("t", 0.0))  # absolute time (s)
        txt = str(cue.get("text", "")).strip()
        if not txt:
            continue

        # 1) Silence until (t - 1s) for pre-beep
        pre_gap = (t - 1.0) - now_t
        if pre_gap > 0.001:
            sil = TMP_DIR / f"sil_{i:04d}.wav"
            make_silence(sil, pre_gap)
            parts.append(sil)
            now_t += pre_gap

        # 2) Beep (80ms) at t-1s
        parts.append(beep_wav)
        now_t += 0.08

        # 3) Fill remainder to exactly t (0.92s minus beep)
        fill = (t - now_t)
        if fill > 0.001:
            sil2 = TMP_DIR / f"sil2_{i:04d}.wav"
            make_silence(sil2, fill)
            parts.append(sil2)
            now_t += fill

        # 4) TTS for the cue
        seg = TMP_DIR / f"seg_{i:04d}.wav"
        tts_wav(txt, seg)
        parts.append(seg)

        # advance pointer by approximate speech dur (we don't measure exactly;
        # concat will naturally add the segment's real duration)
        # We'll update now_t by probing duration via ffprobe:
        try:
            import json as _json
            import subprocess as sp
            probe = sp.check_output(
                f"ffprobe -v quiet -of json -show_streams {shlex.quote(str(seg))}",
                shell=True
            )
            info = _json.loads(probe)
            dur = float(info["streams"][0]["duration"])
            now_t += dur
        except Exception:
            # fallback: estimate 0
            pass

    # Concat all wav parts into one MP3
    concat_wavs_to_mp3(parts, out_mp3)

print("Klaar.")
