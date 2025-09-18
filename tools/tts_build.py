#!/usr/bin/env python3
import os, re, json, subprocess, shlex, tempfile, pathlib

REPO_ROOT = pathlib.Path(__file__).resolve().parents[1]
INDEX = REPO_ROOT / "index.html"
AUDIO_DIR = REPO_ROOT / "audio"
TMP_DIR = REPO_ROOT / "tools" / ".tmp_audio"

AUDIO_DIR.mkdir(exist_ok=True, parents=True)
TMP_DIR.mkdir(exist_ok=True, parents=True)

# ====== Instelbare TTS-parameters (ook via env-vars te overschrijven) ======
ESPEAK_VOICE = os.getenv("ESPEAK_VOICE", "nl")     # Nederlands
ESPEAK_RATE  = int(os.getenv("ESPEAK_RATE", "140"))# woorden/min (rustiger dan ~175)
ESPEAK_PITCH = int(os.getenv("ESPEAK_PITCH", "30"))# 0..99 (30 = neutraal)
ESPEAK_GAIN  = int(os.getenv("ESPEAK_GAIN", "175"))# 0..200 (volume)

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
    # 48kHz mono PCM (matcht onze beep; ffmpeg concat vereist identieke stream params)
    run(f"ffmpeg -y -f lavfi -i anullsrc=r=48000:cl=mono -t {seconds:.3f} -c:a pcm_s16le {shlex.quote(str(path))} -loglevel error")

def make_beep(path: pathlib.Path, seconds: float = 0.08, freq: int = 880):
    run(f"ffmpeg -y -f lavfi -i sine=frequency={freq}:beep_factor=2:duration={seconds:.3f} -c:a pcm_s16le {shlex.quote(str(path))} -loglevel error")

def tts_wav(text: str, out_path: pathlib.Path, voice: str = ESPEAK_VOICE,
            speed_wpm: int = ESPEAK_RATE, pitch: int = ESPEAK_PITCH, gain: int = ESPEAK_GAIN):
    """
    Genereer WAV met espeak-ng, daarna normeer naar 48kHz mono pcm_s16le
    zodat alle delen identieke audioparameters hebben vóór concat.
    """
    tmp_raw = out_path.with_suffix(".raw.wav")
    # 1) TTS naar tijdelijke WAV (espeak-ng bepaalt zelf sample rate)
    cmd = [
        "espeak-ng",
        "-v", str(voice),
        "-s", str(speed_wpm),
        "-p", str(pitch),
        "-a", str(gain),
        "-w", str(tmp_raw),
        "--", text
    ]
    subprocess.check_call(cmd)

    # 2) Resample/convert naar 48kHz mono PCM (matcht beep/silence)
    run(
        f"ffmpeg -y -hide_banner -loglevel error -i {shlex.quote(str(tmp_raw))} "
        f"-ar 48000 -ac 1 -c:a pcm_s16le {shlex.quote(str(out_path))}"
    )

    try:
        tmp_raw.unlink(missing_ok=True)
    except Exception:
        pass

def concat_wavs_to_mp3(parts, out_mp3: pathlib.Path):
    # concat demuxer: alle WAVs moeten dezelfde audioparameters hebben (pcm_s16le/48k/mono)
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
print(f"TTS settings → voice={ESPEAK_VOICE}, rate={ESPEAK_RATE} wpm, pitch={ESPEAK_PITCH}, gain={ESPEAK_GAIN}")

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

        # 1) Silence tot (t - 1s) voor pre-beep
        pre_gap = (t - 1.0) - now_t
        if pre_gap > 0.001:
            sil = TMP_DIR / f"sil_{i:04d}.wav"
            make_silence(sil, pre_gap)
            parts.append(sil)
            now_t += pre_gap

        # 2) Beep (80ms) op t-1s
        parts.append(beep_wav)
        now_t += 0.08

        # 3) Opvullen tot exact t
        fill = (t - now_t)
        if fill > 0.001:
            sil2 = TMP_DIR / f"sil2_{i:04d}.wav"
            make_silence(sil2, fill)
            parts.append(sil2)
            now_t += fill

        # 4) TTS voor de cue
        seg = TMP_DIR / f"seg_{i:04d}.wav"
        tts_wav(txt, seg)  # gebruikt defaults/ENV hierboven
        parts.append(seg)

        # 5) Werk pointer bij o.b.v. echte duur (ffprobe)
        try:
            probe = subprocess.check_output(
                f"ffprobe -v quiet -of json -show_streams {shlex.quote(str(seg))}",
                shell=True
            )
            info = json.loads(probe)
            dur = float(info["streams"][0]["duration"])
            now_t += dur
        except Exception:
            pass

    # Concat alle WAVs tot één MP3
    concat_wavs_to_mp3(parts, out_mp3)

print("Klaar.")
