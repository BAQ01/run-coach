#!/usr/bin/env python3
import os, json, re, subprocess, shlex, pathlib, tempfile

REPO_ROOT = pathlib.Path(__file__).resolve().parents[1]
SESSIONS_JSON = REPO_ROOT / "tools" / "sessions.json"
AUDIO_DIR = REPO_ROOT / "audio"
TMP_DIR = REPO_ROOT / "tools" / ".tmp_audio"

AUDIO_DIR.mkdir(parents=True, exist_ok=True)
TMP_DIR.mkdir(parents=True, exist_ok=True)
for p in TMP_DIR.glob("*.wav"):
    try: p.unlink()
    except: pass

# ===== TTS instellingen (te overriden via env in CI) =====
ESPEAK_VOICE = os.getenv("ESPEAK_VOICE", "nl")
ESPEAK_RATE  = int(os.getenv("ESPEAK_RATE", "140"))
ESPEAK_PITCH = int(os.getenv("ESPEAK_PITCH", "30"))
ESPEAK_GAIN  = int(os.getenv("ESPEAK_GAIN", "175"))

def run(cmd: str):
    subprocess.check_call(cmd, shell=True)

def slugify(title: str) -> str:
    s = title.lower()
    s = re.sub(r"[^a-z0-9]+", "-", s).strip("-")
    return s[:80]

def make_silence(path: pathlib.Path, seconds: float):
    seconds = max(0.0, float(seconds))
    run(f"ffmpeg -y -f lavfi -i anullsrc=r=48000:cl=mono -t {seconds:.3f} -c:a pcm_s16le -loglevel error {shlex.quote(str(path))}")

def make_beep(path: pathlib.Path, seconds: float = 0.08, freq: int = 880):
    run(f"ffmpeg -y -f lavfi -i sine=frequency={freq}:beep_factor=2:duration={seconds:.3f} -c:a pcm_s16le -loglevel error {shlex.quote(str(path))}")

def tts_wav(text: str, out_path: pathlib.Path):
    tmp_raw = out_path.with_suffix(".raw.wav")
    cmd = [
        "espeak-ng",
        "-v", str(ESPEAK_VOICE),
        "-s", str(ESPEAK_RATE),
        "-p", str(ESPEAK_PITCH),
        "-a", str(ESPEAK_GAIN),
        "-w", str(tmp_raw),
        "--", text
    ]
    subprocess.check_call(cmd)
    # normaliseer naar 48k mono PCM
    run(
        f"ffmpeg -y -hide_banner -loglevel error -i {shlex.quote(str(tmp_raw))} "
        f"-ar 48000 -ac 1 -c:a pcm_s16le {shlex.quote(str(out_path))}"
    )
    try: tmp_raw.unlink()
    except: pass

def concat_wavs_to_mp3(parts, out_mp3: pathlib.Path):
    listfile = TMP_DIR / "concat.txt"
    with open(listfile, "w", encoding="utf-8") as f:
        for p in parts:
            f.write(f"file '{p.as_posix()}'\n")
    # MP3 direct met libmp3lame (VBR off via re-encode stap in CI ook oké)
    run(f"ffmpeg -y -f concat -safe 0 -i {shlex.quote(str(listfile))} -c:a libmp3lame -b:a 128k -loglevel error {shlex.quote(str(out_mp3))}")

# ===== Sessies laden =====
if not SESSIONS_JSON.exists():
    raise SystemExit("tools/sessions.json niet gevonden")
SESSIONS = json.loads(SESSIONS_JSON.read_text(encoding="utf-8"))
if not isinstance(SESSIONS, list) or not SESSIONS:
    raise SystemExit("tools/sessions.json is leeg of ongeldig")

print(f"Gevonden sessies: {len(SESSIONS)}")
print(f"TTS → voice={ESPEAK_VOICE}, rate={ESPEAK_RATE}, pitch={ESPEAK_PITCH}, gain={ESPEAK_GAIN}")

beep_wav = TMP_DIR / "beep.wav"
if not beep_wav.exists(): make_beep(beep_wav)

for sess in SESSIONS:
    title = sess.get("title","sessie")
    cues  = sess.get("cues",[])
    slug  = slugify(title)
    out_mp3 = AUDIO_DIR / f"{slug}.mp3"

    print(f"🎧 Bouwen: {title} → {out_mp3.name}")
    parts=[]; now_t=0.0

    for i,c in enumerate(cues):
        t = float(c.get("t",0.0))
        txt = str(c.get("text","")).strip()
        if not txt: continue

        pre_gap = (t - 1.0) - now_t
        if pre_gap > 1e-3:
            sil = TMP_DIR / f"sil_{i:04d}.wav"; make_silence(sil, pre_gap); parts.append(sil); now_t += pre_gap

        parts.append(beep_wav); now_t += 0.08

        fill = t - now_t
        if fill > 1e-3:
            sil2 = TMP_DIR / f"sil2_{i:04d}.wav"; make_silence(sil2, fill); parts.append(sil2); now_t += fill

        seg = TMP_DIR / f"seg_{i:04d}.wav"; tts_wav(txt, seg); parts.append(seg)

        # update pointer met echte duur
        try:
            probe = subprocess.check_output(f"ffprobe -v quiet -of json -show_streams {shlex.quote(str(seg))}", shell=True)
            dur = float(json.loads(probe)["streams"][0]["duration"]); now_t += dur
        except Exception: pass

    concat_wavs_to_mp3(parts, out_mp3)

print("Klaar.")
