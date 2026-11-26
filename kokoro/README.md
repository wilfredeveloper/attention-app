# Kokoro text-to-speech, for Watch

`say.py` reads a line of narration aloud into a `.wav` with [kokoro-onnx](https://github.com/thewh1teagle/kokoro-onnx).
Watch (`scripts/watch-job.mjs`) runs it as `uv run say.py …` in this folder.

To turn Watch on, install [uv](https://docs.astral.sh/uv/) and `ffmpeg`, then download the two model files (about 350 MB):

```bash
cd kokoro
mkdir -p models
curl -L -o models/kokoro-v1.0.onnx https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/kokoro-v1.0.onnx
curl -L -o models/voices-v1.0.bin  https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/voices-v1.0.bin
uv run say.py "Hello." -o out/hello.wav   # first run installs the Python packages
```

Restart the app; Watch appears on highlights. To keep Kokoro elsewhere, set `KOKORO_DIR` to that folder.
