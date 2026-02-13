#!/usr/bin/env python3
"""
F5-TTS Persistent Server
Keeps the model loaded in GPU memory for fast inference.
HTTP API on localhost for Electron to call.
"""

import os
import sys
import json
import time
import tempfile
import platform
from pathlib import Path
from http.server import HTTPServer, BaseHTTPRequestHandler

# Force UTF-8
os.environ["PYTHONUTF8"] = "1"
os.environ["PYTHONIOENCODING"] = "utf-8"

# Ensure F5-TTS package is importable (avoid shadow by local f5_tts.py)
SCRIPT_DIR = Path(__file__).parent.absolute()
F5_SRC = str(SCRIPT_DIR / "F5-TTS-Vietnamese" / "src")

# Remove cwd from sys.path to prevent f5_tts.py shadowing the f5_tts package
cwd = str(SCRIPT_DIR)
sys.path = [p for p in sys.path if p not in ("", ".", cwd)]
sys.path.insert(0, F5_SRC)

MODEL_DIR = SCRIPT_DIR / "F5-TTS-Vietnamese-ViVoice"
OUTPUT_DIR = SCRIPT_DIR / "outputs"
VOCAB_FILE = MODEL_DIR / "vocab.txt"
CKPT_FILE = MODEL_DIR / "model_last.pt"

HOST = "127.0.0.1"
PORT = 8179  # TTS server port

# Global model references (loaded once)
model_obj = None
vocoder = None
is_loaded = False
device_name = "cpu"


def load_model():
    """Load F5-TTS model and vocoder into GPU memory (once)."""
    global model_obj, vocoder, is_loaded, device_name

    if is_loaded:
        return

    import torch
    import torchaudio
    import warnings
    # Force soundfile backend (torchcodec has DLL issues on Windows)
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        torchaudio.set_audio_backend("soundfile")
    from omegaconf import OmegaConf
    from f5_tts.model.backbones.dit import DiT
    from f5_tts.infer.utils_infer import (
        load_vocoder,
        load_model as f5_load_model,
        device,
    )

    device_name = device
    print(f"[TTS-Server] Device: {device}", flush=True)
    print(f"[TTS-Server] Loading vocoder...", flush=True)

    vocoder = load_vocoder("vocos", device=device)

    print(f"[TTS-Server] Loading model from {CKPT_FILE}...", flush=True)

    # Load model config from YAML (same as CLI does)
    config_path = SCRIPT_DIR / "F5-TTS-Vietnamese" / "src" / "f5_tts" / "configs" / "F5TTS_Base.yaml"
    model_cfg = OmegaConf.load(str(config_path)).model.arch

    model_obj = f5_load_model(
        DiT,
        model_cfg,
        str(CKPT_FILE),
        mel_spec_type="vocos",
        vocab_file=str(VOCAB_FILE),
        device=device,
    )

    is_loaded = True
    print(f"[TTS-Server] Model loaded successfully on {device}!", flush=True)


def generate_audio(ref_audio_path, ref_text, gen_text, speed=1.0):
    """Generate audio using loaded model."""
    from f5_tts.infer.utils_infer import (
        infer_process,
        preprocess_ref_audio_text,
        device,
    )
    import soundfile as sf

    start = time.time()

    # Preprocess reference audio
    ref_audio, ref_text = preprocess_ref_audio_text(
        ref_audio_path, ref_text, device=device
    )

    preprocess_time = time.time() - start

    # Generate
    gen_start = time.time()
    audio, sr, _ = infer_process(
        ref_audio,
        ref_text,
        gen_text,
        model_obj,
        vocoder,
        mel_spec_type="vocos",
        speed=speed,
        device=device,
    )
    gen_time = time.time() - gen_start

    # Save output
    OUTPUT_DIR.mkdir(exist_ok=True)
    output_path = str(OUTPUT_DIR / f"generated_{int(time.time() * 1000)}.wav")
    sf.write(output_path, audio, sr)

    total_time = time.time() - start

    return {
        "success": True,
        "output": output_path,
        "gen_text": gen_text[:50],
        "timings": {
            "preprocess": round(preprocess_time, 2),
            "generate": round(gen_time, 2),
            "total": round(total_time, 2),
        },
    }


class TTSHandler(BaseHTTPRequestHandler):
    """HTTP request handler for TTS server."""

    def log_message(self, format, *args):
        # Custom log format
        print(f"[TTS-Server] {args[0]}", flush=True)

    def do_GET(self):
        """Health check endpoint."""
        if self.path == "/health":
            response = {
                "status": "ready" if is_loaded else "loading",
                "device": device_name,
                "model": str(CKPT_FILE),
            }
            self._send_json(200, response)
        else:
            self._send_json(404, {"error": "Not found"})

    def do_POST(self):
        """Generate audio endpoint."""
        if self.path != "/generate":
            self._send_json(404, {"error": "Not found"})
            return

        try:
            content_length = int(self.headers.get("Content-Length", 0))
            body = self.rfile.read(content_length)
            data = json.loads(body.decode("utf-8"))

            ref_audio = data.get("ref_audio")
            ref_text = data.get("ref_text", "")
            gen_text = data.get("gen_text")
            speed = data.get("speed", 1.0)

            if not ref_audio or not gen_text:
                self._send_json(400, {"error": "Missing ref_audio or gen_text"})
                return

            print(f"[TTS-Server] Generating: '{gen_text[:60]}...'", flush=True)

            result = generate_audio(ref_audio, ref_text, gen_text, speed)

            print(
                f"[TTS-Server] Done in {result['timings']['total']}s "
                f"(preprocess: {result['timings']['preprocess']}s, "
                f"generate: {result['timings']['generate']}s)",
                flush=True,
            )

            self._send_json(200, result)

        except Exception as e:
            import traceback
            traceback.print_exc()
            self._send_json(500, {"success": False, "error": str(e)})

    def _send_json(self, status, data):
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.end_headers()
        self.wfile.write(json.dumps(data, ensure_ascii=False).encode("utf-8"))


def main():
    print(f"[TTS-Server] Starting F5-TTS server on {HOST}:{PORT}...", flush=True)
    print(f"[TTS-Server] Loading model (this takes ~10-15s first time)...", flush=True)

    load_model()

    server = HTTPServer((HOST, PORT), TTSHandler)
    print(f"[TTS-Server] Ready! Listening on http://{HOST}:{PORT}", flush=True)
    print(f"[TTS-Server] Endpoints:", flush=True)
    print(f"[TTS-Server]   GET  /health   - Health check", flush=True)
    print(f"[TTS-Server]   POST /generate - Generate audio", flush=True)

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print(f"\n[TTS-Server] Shutting down...", flush=True)
        server.shutdown()


if __name__ == "__main__":
    main()
