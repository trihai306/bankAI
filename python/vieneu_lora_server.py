#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
VieNeu-TTS LoRA Server — Exactly matching the working reference pattern.

Follows the same approach as test_lora_tts.py:
  1. Load base model with backbone on CUDA, codec on CPU
  2. Apply LoRA adapter via tts.load_lora_adapter()
  3. Generate with tts.infer(text, ref_audio, ref_text)

Usage:
    python vieneu_lora_server.py
    Open http://127.0.0.1:8180/
"""

import os
import sys
import io
import json
import time
import struct
import base64
from pathlib import Path
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse

os.environ["PYTHONUTF8"] = "1"
os.environ["PYTHONIOENCODING"] = "utf-8"

# === PATHS (same structure as reference) ===
SCRIPT_DIR = Path(__file__).parent.absolute()
VIENEU_DIR = SCRIPT_DIR / "VieNeu-TTS"
UI_FILE = SCRIPT_DIR / "vieneu_test_ui.html"

# === CONFIG (identical to test_lora_tts.py) ===
BASE_MODEL = "pnnbao-ump/VieNeu-TTS-0.3B"
LORA_PATH = str(VIENEU_DIR / "finetune" / "output" / "VieNeu-TTS-0.3B-LoRA")
REF_AUDIO = str(VIENEU_DIR / "finetune" / "dataset" / "raw_audio" / "0001_voice.wav")
REF_TEXT = "Đang tìm kiếm một công cụ giúp quản lý tài chính thông minh? Ứng dụng này siêu dễ dùng, chỉ cần nhập số tiền và mục tiêu, nó sẽ tự động tính toán và đưa ra lời khuyên. Chắc chắn sẽ giúp bạn tiết kiệm hơn, không cần lo quá!"
SAMPLE_RATE = 24000

HOST = "127.0.0.1"
PORT = 8180

# === GLOBAL STATE ===
tts = None
is_loaded = False
lora_loaded = False


def load_model():
    """Load model exactly like test_lora_tts.py."""
    global tts, is_loaded, lora_loaded

    if is_loaded:
        return

    # Add VieNeu-TTS src to path (same as reference)
    sys.path.insert(0, str(VIENEU_DIR / "src"))
    sys.path.insert(0, str(VIENEU_DIR))

    from vieneu import Vieneu

    # Step 1: Load base model (identical to reference)
    print(f"\n📦 Base model: {BASE_MODEL}", flush=True)
    print(f"🎯 LoRA path:  {LORA_PATH}", flush=True)
    print(f"🎤 Ref audio:  {REF_AUDIO}", flush=True)

    print("\n⏳ Loading base model...", flush=True)
    t0 = time.time()
    tts = Vieneu(
        mode="standard",
        backbone_repo=BASE_MODEL,
        backbone_device="cuda",
        codec_device="cpu",
    )
    print(f"✅ Base model loaded in {time.time() - t0:.1f}s", flush=True)

    # Step 2: Load LoRA adapter (identical to reference)
    print(f"\n⏳ Loading LoRA adapter...", flush=True)
    t0 = time.time()
    tts.load_lora_adapter(LORA_PATH)
    lora_loaded = True
    print(f"✅ LoRA adapter loaded in {time.time() - t0:.1f}s", flush=True)

    is_loaded = True


def encode_wav_bytes(audio_data, sample_rate):
    """Encode numpy audio to WAV bytes (PCM 16-bit mono)."""
    import numpy as np

    if audio_data.dtype in (np.float32, np.float64):
        audio_int16 = np.clip(audio_data * 32767, -32768, 32767).astype(np.int16)
    else:
        audio_int16 = audio_data.astype(np.int16)

    buf = io.BytesIO()
    n = len(audio_int16)
    data_size = n * 2

    buf.write(b"RIFF")
    buf.write(struct.pack("<I", 36 + data_size))
    buf.write(b"WAVE")
    buf.write(b"fmt ")
    buf.write(struct.pack("<I", 16))
    buf.write(struct.pack("<H", 1))  # PCM
    buf.write(struct.pack("<H", 1))  # Mono
    buf.write(struct.pack("<I", sample_rate))
    buf.write(struct.pack("<I", sample_rate * 2))
    buf.write(struct.pack("<H", 2))  # Block align
    buf.write(struct.pack("<H", 16))  # Bits per sample
    buf.write(b"data")
    buf.write(struct.pack("<I", data_size))
    buf.write(audio_int16.tobytes())

    return buf.getvalue()


def generate_audio(gen_text):
    """Generate audio — identical call pattern to test_lora_tts.py.

    tts.infer(text=text, ref_audio=REF_AUDIO, ref_text=REF_TEXT)
    No temperature, no top_k — use VieNeu-TTS defaults.
    """
    t0 = time.time()

    audio = tts.infer(
        text=gen_text,
        ref_audio=REF_AUDIO,
        ref_text=REF_TEXT,
    )

    gen_time = time.time() - t0
    wav_bytes = encode_wav_bytes(audio, SAMPLE_RATE)
    duration = len(audio) / SAMPLE_RATE

    timings = {
        "generate": round(gen_time, 3),
        "duration_sec": round(duration, 2),
        "samples": len(audio),
    }

    return wav_bytes, timings


def generate_audio_stream(gen_text):
    """Stream audio chunks — same ref_audio/ref_text pattern."""
    idx = 0
    for chunk in tts.infer_stream(
        text=gen_text,
        ref_audio=REF_AUDIO,
        ref_text=REF_TEXT,
    ):
        if len(chunk) > 0:
            yield encode_wav_bytes(chunk, SAMPLE_RATE), idx
            idx += 1


class Handler(BaseHTTPRequestHandler):

    def log_message(self, fmt, *args):
        print(f"[Server] {args[0]}", flush=True)

    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def do_OPTIONS(self):
        self.send_response(200)
        self._cors()
        self.end_headers()

    def do_GET(self):
        path = urlparse(self.path).path
        if path in ("/", "/index.html"):
            self._serve_ui()
        elif path == "/health":
            self._json(200, {
                "status": "ready" if is_loaded else "loading",
                "engine": "VieNeu-TTS",
                "base_model": BASE_MODEL,
                "lora_loaded": lora_loaded,
                "lora_adapter": Path(LORA_PATH).name,
                "device": "cuda",
                "ref_audio": Path(REF_AUDIO).name,
                "sample_rate": SAMPLE_RATE,
            })
        elif path == "/voices":
            voices = []
            try:
                for desc, vid in tts.list_preset_voices():
                    voices.append({"id": vid, "description": desc})
            except Exception:
                pass
            self._json(200, {"voices": voices})
        else:
            self._json(404, {"error": "Not found"})

    def do_POST(self):
        path = urlparse(self.path).path
        if path == "/generate":
            self._handle_generate()
        elif path == "/generate-stream":
            self._handle_stream()
        else:
            self._json(404, {"error": "Not found"})

    def _serve_ui(self):
        if not UI_FILE.exists():
            self._json(404, {"error": "UI file not found"})
            return
        html = UI_FILE.read_text(encoding="utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self._cors()
        self.end_headers()
        self.wfile.write(html.encode("utf-8"))

    def _handle_generate(self):
        try:
            data = self._read_body()
            gen_text = data.get("gen_text", "").strip()
            if not gen_text:
                self._json(400, {"error": "Missing gen_text"})
                return

            print(f"[Server] Generating: '{gen_text[:80]}...'", flush=True)
            wav_bytes, timings = generate_audio(gen_text)
            print(f"[Server] Done in {timings['generate']}s ({timings['duration_sec']}s audio)", flush=True)

            self.send_response(200)
            self.send_header("Content-Type", "audio/wav")
            self.send_header("Content-Length", str(len(wav_bytes)))
            self.send_header("X-TTS-Timings", json.dumps(timings))
            self._cors()
            self.end_headers()
            self.wfile.write(wav_bytes)

        except Exception as e:
            import traceback
            traceback.print_exc()
            self._json(500, {"error": str(e)})

    def _handle_stream(self):
        try:
            data = self._read_body()
            gen_text = data.get("gen_text", "").strip()
            if not gen_text:
                self._json(400, {"error": "Missing gen_text"})
                return

            print(f"[Server] Streaming: '{gen_text[:80]}...'", flush=True)

            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.send_header("Cache-Control", "no-cache")
            self.send_header("Connection", "keep-alive")
            self._cors()
            self.end_headers()

            start = time.time()
            for wav_bytes, idx in generate_audio_stream(gen_text):
                event = json.dumps({
                    "chunk_index": idx,
                    "audio_base64": base64.b64encode(wav_bytes).decode("ascii"),
                    "sample_rate": SAMPLE_RATE,
                    "elapsed": round(time.time() - start, 3),
                })
                self.wfile.write(f"event: audio-chunk\ndata: {event}\n\n".encode("utf-8"))
                self.wfile.flush()

            done = json.dumps({"total_time": round(time.time() - start, 3)})
            self.wfile.write(f"event: done\ndata: {done}\n\n".encode("utf-8"))
            self.wfile.flush()
            print(f"[Server] Stream done in {round(time.time() - start, 2)}s", flush=True)

        except Exception as e:
            import traceback
            traceback.print_exc()

    def _read_body(self):
        length = int(self.headers.get("Content-Length", 0))
        return json.loads(self.rfile.read(length).decode("utf-8"))

    def _json(self, status, data):
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self._cors()
        self.end_headers()
        self.wfile.write(json.dumps(data, ensure_ascii=False).encode("utf-8"))


def main():
    print("=" * 60, flush=True)
    print("  🦜 VieNeu-TTS LoRA Server", flush=True)
    print("=" * 60, flush=True)

    load_model()

    server = HTTPServer((HOST, PORT), Handler)
    print(f"\n✅ Ready! http://{HOST}:{PORT}/", flush=True)
    print(f"   GET  /              — Test UI", flush=True)
    print(f"   GET  /health        — Status", flush=True)
    print(f"   POST /generate      — Generate WAV", flush=True)
    print(f"   POST /generate-stream — SSE stream", flush=True)

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down...", flush=True)
        server.shutdown()


if __name__ == "__main__":
    main()
