"""Kokoro TTS: uv run say.py "text" [-v voice] [-s speed] [-o out.wav] | --list"""
import argparse
from pathlib import Path

import soundfile as sf
from kokoro_onnx import Kokoro

HERE = Path(__file__).parent
p = argparse.ArgumentParser()
p.add_argument("text", nargs="?")
p.add_argument("-v", "--voice", default="af_heart")
p.add_argument("-s", "--speed", type=float, default=1.0)
p.add_argument("-l", "--lang", default="en-us")
p.add_argument("-o", "--out", default="out/clip.wav")
p.add_argument("--list", action="store_true", help="list voices")
a = p.parse_args()

k = Kokoro(str(HERE / "models/kokoro-v1.0.onnx"), str(HERE / "models/voices-v1.0.bin"))
if a.list:
    print(" ".join(sorted(k.get_voices())))
else:
    samples, sr = k.create(a.text, voice=a.voice, speed=a.speed, lang=a.lang)
    Path(a.out).parent.mkdir(parents=True, exist_ok=True)
    sf.write(a.out, samples, sr)
    print(f"{a.out}  ({len(samples) / sr:.1f}s audio)")
