#!/usr/bin/env python3
import os, re, json, subprocess, shlex, pathlib

REPO_ROOT = pathlib.Path(__file__).resolve().parents[1]
INDEX = REPO_ROOT / "index.html"
AUDIO_DIR = REPO_ROOT / "audio"
TMP_DIR = REPO_ROOT / "tools" / ".tmp_audio"

AUDIO_DIR.mkdir(exist_ok=True, parents=True)
TMP_DIR.mkdir(exist_ok=True, parents=True)
# Opruimen van oude tijdelijke WAVs
for p in TMP_DIR.glob("*.wav"):
    try:
        p.unlink()
    except:
        pass

# ====== Instelbare TTS-parameters (ook via env-vars te overschrijven) ======
ESPEAK_VOICE = os.getenv("ESPEAK_VOICE", "nl")      # Nederlands
ESPEAK_RATE  = int(os.getenv("ESPEAK_RATE", "140")) # woorden/min (rustiger dan ~175)
ESPEAK_PITCH = int(os.getenv("ESPEAK_PITCH", "30")) # 0..99 (30 = neutraal)
ESPEAK_GAIN  = int(os.getenv("ESPEAK_GAIN", "175")) # 0..200 (volume)

# ---------- Helpers ----------
def slugify(title: str) -> str:
    s = title.lower()
    s = re.sub(r"[^a-z0-9]+", "-", s).strip("-")
    return s[:80]

def run(cmd: str):
    subprocess.check_call(cmd, shell=True)

def make_silence(path: pathlib.Path, seconds: float):
    seconds = max(0.0, float(seconds))
    # 48kHz mono PCM
    run(
        f"ffmpeg -y -f lavfi -i anullsrc=r=48000:cl=mono "
        f"-t {seconds:.3f} -c:a pcm_s16le {shlex.quote(str(path))} "
        f"-hide_banner -loglevel error"
    )

def make_beep(path: pathlib.Path, seconds: float = 0.08, freq: int = 880):
    run(
        f"ffmpeg -y -f lavfi -i sine=frequency={freq}:beep_factor=2:duration={seconds:.3f} "
        f"-c:a pcm_s16le {shlex.quote(str(path))} -hide_banner -loglevel error"
    )

def tts_wav(
    text: str,
    out_path: pathlib.Path,
    voice: str = ESPEAK_VOICE,
    speed_wpm: int = ESPEAK_RATE,
    pitch: int = ESPEAK_PITCH,
    gain: int = ESPEAK_GAIN,
):
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
        "--",
        text,
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

def concat_wavs(parts, out_wav: pathlib.Path):
    """
    Concat alle WAV-segmenten (pcm_s16le/48k/mono) tot één mix-WAV met dezelfde parameters.
    """
    listfile = TMP_DIR / f"{out_wav.stem}_concat.txt"
    with open(listfile, "w", encoding="utf-8") as f:
        for p in parts:
            f.write(f"file '{p.as_posix()}'\n")
    run(
        f"ffmpeg -y -hide_banner -loglevel error -f concat -safe 0 "
        f"-i {shlex.quote(str(listfile))} -ar 48000 -ac 1 -c:a pcm_s16le "
        f"{shlex.quote(str(out_wav))}"
    )

def encode_mp3(in_wav: pathlib.Path, out_mp3: pathlib.Path):
    """
    Encode naar iOS/Safari-veilige MP3: 44.1kHz, mono, CBR 128k, zonder Xing-header.
    """
    run(
        f"ffmpeg -y -hide_banner -loglevel error -i {shlex.quote(str(in_wav))} "
        f"-ar 44100 -ac 1 -c:a libmp3lame -b:a 128k -write_xing 0 -map_metadata -1 "
        f"{shlex.quote(str(out_mp3))}"
    )

def encode_m4a(in_wav: pathlib.Path, out_m4a: pathlib.Path):
    """
    Extra export: AAC/M4A 44.1kHz mono 96k met faststart (vaak nóg stabieler op iOS).
    """
    run(
        f"ffmpeg -y -hide_banner -loglevel error -i {shlex.quote(str(in_wav))} "
        f"-ar 44100 -ac 1 -c:a aac -b:a 96k -movflags +faststart -map_metadata -1 "
        f"{shlex.quote(str(out_m4a))}"
    )

# ---------- Extract SESSIONS from index.html ----------
html = INDEX.read_text(encoding="utf-8", errors="ignore")
m = re.search(r"const\s+SESSIONS\s*=\s*(\[\s*{.*?}\s*\])\s*;", html, re.S)
if not m:
    raise SystemExit("Kon const SESSIONS niet vinden in index.html")
SESSIONS = json.loads(m.group(1))

# ---------- Build per sessie ----------
print(f"Gevonden sessies: {len(SESSIONS)}")
print(
    f"TTS settings → voice={ESPEAK_VOICE}, rate={ESPEAK_RATE} wpm, pitch={ESPEAK_PITCH}, gain={ESPEAK_GAIN}"
)

beep_wav = TMP_DIR / "beep.wav"
if not beep_wav.exists():
    make_beep(beep_wav)

for sess in SESSIONS:
    title = sess.get("title", "sessie")
    cues = sess.get("cues", [])
    slug = slugify(title)
    out_mp3 = AUDIO_DIR / f"{slug}.mp3"
    out_m4a = AUDIO_DIR / f"{slug}.m4a"
    mix_wav = TMP_DIR / f"{slug}.mix.wav"

    # Skip als al nieuwer dan index.html (snellere CI)
    if out_mp3.exists() and out_mp3.stat().st_mtime > INDEX.stat().st_mtime:
        print(f"⌁ Skip (up-to-date): {out_mp3.name}")
        continue

    print(f"🎧 Bouwen: {title} → {out_mp3.name} (+ .m4a)")
    parts = []
    now_t = 0.0  # seconds op de uiteindelijke tijdlijn

    for i, cue in enumerate(cues):
        t = float(cue.get("t", 0.0))  # absolute time (s)
        txt = str(cue.get("text", "")).strip()
        if not txt:
            continue

        # 1) Stilte tot t-1s (pre-beep)
        pre_gap = (t - 1.0) - now_t
        if pre_gap > 0.001:
            sil = TMP_DIR / f"{slug}_sil_{i:04d}.wav"
            make_silence(sil, pre_gap)
            parts.append(sil)
            now_t += pre_gap

        # 2) Beep (80ms) op t-1s
        parts.append(beep_wav)
        now_t += 0.08

        # 3) Opvullen tot exact t
        fill = (t - now_t)
        if fill > 0.001:
            sil2 = TMP_DIR / f"{slug}_sil2_{i:04d}.wav"
            make_silence(sil2, fill)
            parts.append(sil2)
            now_t += fill

        # 4) TTS voor de cue (48kHz/mono/pcm_s16le)
        seg = TMP_DIR / f"{slug}_seg_{i:04d}.wav"
        tts_wav(txt, seg)
        parts.append(seg)

        # 5) (optioneel) je kunt hier now_t verhogen met echte duur indien nodig,
        #    maar de concat + encode bepalen toch de werkelijke tijdlijn.

    # Concat naar één mix-WAV en encode naar MP3 + M4A
    concat_wavs(parts, mix_wav)
    encode_mp3(mix_wav, out_mp3)
    encode_m4a(mix_wav, out_m4a)

    # opruimen van mix_wav (mag blijven staan voor debuggers)
    try:
        mix_wav.unlink(missing_ok=True)
    except Exception:
        pass

print("Klaar.")
