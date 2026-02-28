#!/usr/bin/env python3
"""
F5-TTS Persistent Server
Keeps the model loaded in GPU memory for fast inference.
HTTP API on localhost for Electron to call.

Features:
  - Ref audio caching (avoids re-preprocessing same reference)
  - Binary WAV response mode (skip file I/O)
  - SSE streaming endpoint for long text
"""

import os
import sys
import io
import json
import time
import hashlib
import struct
import base64
from pathlib import Path
from http.server import HTTPServer, BaseHTTPRequestHandler
from collections import OrderedDict

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

# --- Ref Audio Cache ---
# Cache preprocessed ref audio to avoid re-loading + re-processing same file
# Key: (file_path, file_mtime, ref_text) → Value: (ref_audio_tensor, ref_text_processed)
_ref_cache = OrderedDict()
_REF_CACHE_MAX = 4


def _ref_cache_key(ref_audio_path, ref_text):
    """Generate cache key based on file path, mtime, and ref_text."""
    try:
        mtime = os.path.getmtime(ref_audio_path)
    except OSError:
        mtime = 0
    raw = f"{ref_audio_path}|{mtime}|{ref_text}"
    return hashlib.md5(raw.encode("utf-8")).hexdigest()


def get_cached_ref(ref_audio_path, ref_text):
    """Get preprocessed ref audio from cache, or preprocess and cache it."""
    from f5_tts.infer.utils_infer import preprocess_ref_audio_text, device

    key = _ref_cache_key(ref_audio_path, ref_text)

    if key in _ref_cache:
        _ref_cache.move_to_end(key)
        print(f"[TTS-Server] ✓ Ref audio cache HIT", flush=True)
        return _ref_cache[key]

    print(f"[TTS-Server] ✗ Ref audio cache MISS — preprocessing...", flush=True)
    ref_audio, processed_text = preprocess_ref_audio_text(
        ref_audio_path, ref_text, device=device
    )

    _ref_cache[key] = (ref_audio, processed_text)
    if len(_ref_cache) > _REF_CACHE_MAX:
        _ref_cache.popitem(last=False)

    return ref_audio, processed_text


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


def encode_wav_bytes(audio_data, sample_rate):
    """Encode numpy audio array to WAV bytes (PCM 16-bit mono) in-memory."""
    import numpy as np

    # Normalize to int16 range
    if audio_data.dtype == np.float32 or audio_data.dtype == np.float64:
        audio_int16 = np.clip(audio_data * 32767, -32768, 32767).astype(np.int16)
    else:
        audio_int16 = audio_data.astype(np.int16)

    buf = io.BytesIO()
    num_samples = len(audio_int16)
    data_size = num_samples * 2  # 16-bit = 2 bytes per sample

    # WAV header (44 bytes)
    buf.write(b"RIFF")
    buf.write(struct.pack("<I", 36 + data_size))
    buf.write(b"WAVE")
    buf.write(b"fmt ")
    buf.write(struct.pack("<I", 16))          # chunk size
    buf.write(struct.pack("<H", 1))           # PCM
    buf.write(struct.pack("<H", 1))           # mono
    buf.write(struct.pack("<I", sample_rate))  # sample rate
    buf.write(struct.pack("<I", sample_rate * 2))  # byte rate
    buf.write(struct.pack("<H", 2))           # block align
    buf.write(struct.pack("<H", 16))          # bits per sample
    buf.write(b"data")
    buf.write(struct.pack("<I", data_size))
    buf.write(audio_int16.tobytes())

    return buf.getvalue()


def generate_audio(ref_audio_path, ref_text, gen_text, speed=1.0, response_format="json"):
    """Generate audio using loaded model. Returns dict or WAV bytes."""
    from f5_tts.infer.utils_infer import infer_process, device
    import soundfile as sf

    start = time.time()

    # Preprocess reference audio (with caching)
    ref_audio, ref_text = get_cached_ref(ref_audio_path, ref_text)
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
        nfe_step=16,  # Default 32 → 16: ~50% faster, modest quality trade-off
        speed=speed,
        device=device,
    )
    gen_time = time.time() - gen_start

    timings = {
        "preprocess": round(preprocess_time, 3),
        "generate": round(gen_time, 3),
        "total": round(time.time() - start, 3),
    }

    if response_format == "wav":
        wav_bytes = encode_wav_bytes(audio, sr)
        return wav_bytes, timings

    # Legacy JSON format: save to file
    OUTPUT_DIR.mkdir(exist_ok=True)
    output_path = str(OUTPUT_DIR / f"generated_{int(time.time() * 1000)}.wav")
    sf.write(output_path, audio, sr)

    return {
        "success": True,
        "output": output_path,
        "gen_text": gen_text[:50],
        "timings": timings,
    }, None


def generate_audio_stream(ref_audio_path, ref_text, gen_text, speed=1.0):
    """Generator: yield (wav_bytes, chunk_index) for each batch in long text."""
    from f5_tts.infer.utils_infer import (
        preprocess_ref_audio_text,
        infer_batch_process,
        chunk_text,
        device,
    )
    import torchaudio
    import numpy as np

    # Preprocess (cached)
    ref_audio_processed, ref_text_processed = get_cached_ref(ref_audio_path, ref_text)

    # Load raw audio for batch process
    audio_tensor, sr = torchaudio.load(ref_audio_processed)

    # Chunk text into batches
    ref_text_len = len(ref_text_processed.encode("utf-8"))
    audio_len = audio_tensor.shape[-1] / sr
    max_chars = int(ref_text_len / audio_len * (22 - audio_len))
    gen_text_batches = chunk_text(gen_text, max_chars=max_chars)

    chunk_index = 0
    for audio_chunk, sample_rate in infer_batch_process(
        (audio_tensor, sr),
        ref_text_processed,
        gen_text_batches,
        model_obj,
        vocoder,
        mel_spec_type="vocos",
        nfe_step=16,
        speed=speed,
        device=device,
        streaming=True,
        chunk_size=8192,
    ):
        wav_bytes = encode_wav_bytes(audio_chunk, sample_rate)
        yield wav_bytes, chunk_index
        chunk_index += 1


class TTSHandler(BaseHTTPRequestHandler):
    """HTTP request handler for TTS server."""

    def log_message(self, format, *args):
        print(f"[TTS-Server] {args[0]}", flush=True)

    def do_GET(self):
        """Health check endpoint."""
        if self.path == "/health":
            response = {
                "status": "ready" if is_loaded else "loading",
                "device": device_name,
                "model": str(CKPT_FILE),
                "cache_size": len(_ref_cache),
            }
            self._send_json(200, response)
        else:
            self._send_json(404, {"error": "Not found"})

    def do_POST(self):
        """Route POST requests."""
        if self.path == "/generate":
            self._handle_generate()
        elif self.path == "/generate-stream":
            self._handle_generate_stream()
        else:
            self._send_json(404, {"error": "Not found"})

    def _handle_generate(self):
        """Generate audio — supports JSON (legacy) and WAV binary response."""
        try:
            content_length = int(self.headers.get("Content-Length", 0))
            body = self.rfile.read(content_length)
            data = json.loads(body.decode("utf-8"))

            ref_audio = data.get("ref_audio")
            ref_text = data.get("ref_text", "")
            gen_text = data.get("gen_text")
            speed = data.get("speed", 1.0)
            response_format = data.get("response_format", "json")

            if not ref_audio or not gen_text:
                self._send_json(400, {"error": "Missing ref_audio or gen_text"})
                return

            print(f"[TTS-Server] Generating ({response_format}): '{gen_text[:60]}...'", flush=True)

            result, timings = generate_audio(ref_audio, ref_text, gen_text, speed, response_format)

            if response_format == "wav":
                # Binary WAV response
                print(
                    f"[TTS-Server] Done in {timings['total']}s "
                    f"(preprocess: {timings['preprocess']}s, "
                    f"generate: {timings['generate']}s)",
                    flush=True,
                )
                self.send_response(200)
                self.send_header("Content-Type", "audio/wav")
                self.send_header("Content-Length", str(len(result)))
                self.send_header("X-TTS-Timings", json.dumps(timings))
                self.end_headers()
                self.wfile.write(result)
            else:
                # Legacy JSON response
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

    def _handle_generate_stream(self):
        """SSE streaming: yield audio chunks as they're generated."""
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

            print(f"[TTS-Server] Streaming: '{gen_text[:60]}...'", flush=True)

            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.send_header("Cache-Control", "no-cache")
            self.send_header("Connection", "keep-alive")
            self.end_headers()

            start = time.time()
            for wav_bytes, chunk_idx in generate_audio_stream(ref_audio, ref_text, gen_text, speed):
                event_data = json.dumps({
                    "chunk_index": chunk_idx,
                    "audio_base64": base64.b64encode(wav_bytes).decode("ascii"),
                    "sample_rate": 24000,
                    "elapsed": round(time.time() - start, 3),
                })
                sse = f"event: audio-chunk\ndata: {event_data}\n\n"
                self.wfile.write(sse.encode("utf-8"))
                self.wfile.flush()
                print(f"[TTS-Server] Streamed chunk {chunk_idx} (t={round(time.time() - start, 2)}s)", flush=True)

            # Done event
            done_data = json.dumps({"total_time": round(time.time() - start, 3)})
            sse_done = f"event: done\ndata: {done_data}\n\n"
            self.wfile.write(sse_done.encode("utf-8"))
            self.wfile.flush()

            print(f"[TTS-Server] Stream done in {round(time.time() - start, 2)}s", flush=True)

        except Exception as e:
            import traceback
            traceback.print_exc()
            try:
                error_data = json.dumps({"error": str(e)})
                sse_err = f"event: error\ndata: {error_data}\n\n"
                self.wfile.write(sse_err.encode("utf-8"))
                self.wfile.flush()
            except Exception:
                pass

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
    print(f"[TTS-Server]   GET  /health           - Health check", flush=True)
    print(f"[TTS-Server]   POST /generate          - Generate audio (json|wav)", flush=True)
    print(f"[TTS-Server]   POST /generate-stream   - SSE streaming (long text)", flush=True)

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print(f"\n[TTS-Server] Shutting down...", flush=True)
        server.shutdown()


if __name__ == "__main__":
    main()
