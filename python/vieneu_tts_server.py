#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
VieNeu-TTS Server — FastAPI + uvicorn (async, high-performance).

Optimizations applied:
  - mode='fast' (LMDeploy TurbomindEngine) for GPU-optimized inference
  - FastAPI + uvicorn instead of http.server (async I/O, true concurrency)
  - codec on CUDA (no CPU↔GPU transfer overhead)
  - torch.inference_mode() for all inference paths
  - CUDA pre-warm at startup (eliminates cold-start latency)
  - NVIDIA persistence mode at startup
  - Triton-compiled codec if available
  - cudnn.benchmark for auto-tuned convolution kernels

API unchanged — same endpoints, same response format, same SSE protocol.
HTTP API on localhost:8179 for Electron to call.

Requires:
    pip install fastapi uvicorn
"""

import os
import sys
import io
import json
import time
import struct
import base64
import subprocess
import asyncio
import threading
from pathlib import Path

os.environ["PYTHONUTF8"] = "1"
os.environ["PYTHONIOENCODING"] = "utf-8"

SCRIPT_DIR = Path(__file__).parent.absolute()
VIENEU_DIR = SCRIPT_DIR / "VieNeu-TTS"
OUTPUT_DIR = SCRIPT_DIR / "outputs"

HOST = "127.0.0.1"
PORT = 8179

# === CONFIG ===
# GGUF backbone on CPU (frees GPU for chat LLM) + codec on CUDA
GGUF_MODEL = "pnnbao-ump/VieNeu-TTS-0.3B-q4-gguf"
BASE_MODEL = "pnnbao-ump/VieNeu-TTS-0.3B"
MERGED_MODEL = str(VIENEU_DIR / "finetune" / "output" / "VieNeu-TTS-0.3B-Merged")
LORA_PATH = str(VIENEU_DIR / "finetune" / "output" / "VieNeu-TTS-0.3B-LoRA")
REF_AUDIO = str(VIENEU_DIR / "finetune" / "dataset" / "raw_audio" / "0001_voice.wav")
REF_TEXT = "Đang tìm kiếm một công cụ giúp quản lý tài chính thông minh? Ứng dụng này siêu dễ dùng, chỉ cần nhập số tiền và mục tiêu, nó sẽ tự động tính toán và đưa ra lời khuyên. Chắc chắn sẽ giúp bạn tiết kiệm hơn, không cần lo quá!"
CODEC_REPO = "neuphonic/distill-neucodec"
SAMPLE_RATE = 24000

# Inference defaults — tuned for GGUF quantized models
# Lower temperature reduces repetition/noise artifacts common in q4 models
# Tighter top_k produces more stable speech token sequences
DEFAULT_TEMPERATURE = 0.7
DEFAULT_TOP_K = 35

# Global state
tts = None
is_loaded = False
lora_loaded = False
load_error = None
tts_mode = None  # 'standard-cpu' or 'fast' or 'standard'

# Thread lock for llama_cpp inference (NOT thread-safe)
_inference_lock = threading.Lock()


def set_nvidia_persistence_mode():
    """Enable NVIDIA persistence mode and max performance clocks."""
    try:
        subprocess.run(
            ["nvidia-smi", "-pm", "1"],
            capture_output=True, timeout=5
        )
        print("[TTS-Server] ✅ NVIDIA persistence mode enabled", flush=True)
    except Exception as e:
        print(f"[TTS-Server] ⚠️ Could not set persistence mode: {e}", flush=True)


def kill_port_owner(port):
    """Kill any process currently holding the given port (Windows)."""
    try:
        result = subprocess.run(
            ["netstat", "-ano"],
            capture_output=True, text=True, timeout=5
        )
        for line in result.stdout.splitlines():
            if f":{port}" in line and "LISTENING" in line:
                parts = line.split()
                pid = int(parts[-1])
                if pid > 0 and pid != os.getpid():
                    print(f"[TTS-Server] ⚠️ Killing zombie process PID={pid} on port {port}", flush=True)
                    subprocess.run(["taskkill", "/PID", str(pid), "/F"],
                                   capture_output=True, timeout=5)
                    import time as _t
                    _t.sleep(1)  # Wait for port release
    except Exception as e:
        print(f"[TTS-Server] ⚠️ Could not check/kill port owner: {e}", flush=True)


def set_torch_optimizations():
    """Apply PyTorch-level performance optimizations."""
    import torch
    if torch.cuda.is_available():
        # Auto-tune convolution algorithms for best performance
        torch.backends.cudnn.benchmark = True
        # Enable TF32 for faster matmul on Ampere+ GPUs
        torch.backends.cuda.matmul.allow_tf32 = True
        torch.backends.cudnn.allow_tf32 = True
        print("[TTS-Server] ✅ PyTorch optimizations: cudnn.benchmark, TF32 enabled", flush=True)


def load_model():
    """Load model — GGUF backbone on CPU + codec on CUDA."""
    global tts, is_loaded, lora_loaded, load_error, tts_mode

    if is_loaded:
        return

    # Add VieNeu-TTS src to path
    sys.path.insert(0, str(VIENEU_DIR / "src"))
    sys.path.insert(0, str(VIENEU_DIR))

    from vieneu import Vieneu

    # Apply torch optimizations before model load (for codec on CUDA)
    set_torch_optimizations()

    try:
        # Standard mode with GGUF backbone on CPU + codec on CUDA
        # GGUF uses llama.cpp — fast CPU inference with AVX/AVX2/AVX-512
        # Codec on CUDA — fast audio decoding without CPU overhead
        print(f"[TTS-Server] 🖥️ Loading VieNeu-TTS: GGUF backbone (CPU) + codec (CUDA)...", flush=True)
        print(f"[TTS-Server] Backbone: {GGUF_MODEL} (CPU)", flush=True)
        print(f"[TTS-Server] Codec: {CODEC_REPO} (CUDA)", flush=True)

        t0 = time.time()
        tts = Vieneu(
            mode="standard",
            backbone_repo=GGUF_MODEL,
            backbone_device="cpu",
            codec_repo=CODEC_REPO,
            codec_device="cuda",
        )
        tts_mode = "standard-cpu"
        lora_loaded = False  # GGUF does not support LoRA
        print(f"[TTS-Server] ✅ Model loaded in {time.time() - t0:.1f}s", flush=True)
        print(f"[TTS-Server] ℹ️ GGUF mode: no LoRA (using base voice)", flush=True)

        # Verify ref_audio exists
        if os.path.isfile(REF_AUDIO):
            print(f"[TTS-Server] ✅ Ref audio: {Path(REF_AUDIO).name}", flush=True)
        else:
            print(f"[TTS-Server] ⚠️ Ref audio not found: {REF_AUDIO}", flush=True)

        is_loaded = True
        load_error = None

    except Exception as e:
        import traceback
        traceback.print_exc()
        load_error = str(e)
        print(f"[TTS-Server] ❌ Model load error: {e}", flush=True)


def cuda_prewarm():
    """Run a dummy inference to pre-allocate CUDA kernels and memory."""
    if not is_loaded or tts is None:
        return

    import torch
    print("[TTS-Server] 🔥 CUDA pre-warm: running dummy inference...", flush=True)
    t0 = time.time()
    try:
        with torch.inference_mode():
            _ = tts.infer(
                text="xin chào",
                ref_audio=REF_AUDIO,
                ref_text=REF_TEXT,
                temperature=DEFAULT_TEMPERATURE,
                top_k=DEFAULT_TOP_K,
            )
        # Clear the dummy output from cache
        if torch.cuda.is_available():
            torch.cuda.empty_cache()
        print(f"[TTS-Server] ✅ CUDA pre-warm done in {time.time() - t0:.1f}s", flush=True)
    except Exception as e:
        print(f"[TTS-Server] ⚠️ CUDA pre-warm failed: {e}", flush=True)


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


def generate_audio(gen_text, ref_audio=None, ref_text=None, speed=1.0, response_format="json",
                   temperature=None, top_k=None):
    """Generate audio with torch.inference_mode() for maximum speed.

    If client sends ref_audio/ref_text, use those.
    Otherwise fall back to the training dataset reference (best quality).
    """
    import torch

    start = time.time()

    # Use provided values or fall back to optimized defaults
    actual_temperature = temperature if temperature is not None else DEFAULT_TEMPERATURE
    actual_top_k = top_k if top_k is not None else DEFAULT_TOP_K

    # Use provided ref or fall back to default (training dataset)
    actual_ref_audio = ref_audio if (ref_audio and os.path.isfile(ref_audio)) else REF_AUDIO
    actual_ref_text = ref_text if ref_text else REF_TEXT

    gen_start = time.time()
    with _inference_lock:  # llama_cpp is NOT thread-safe
        with torch.inference_mode():
            audio = tts.infer(
                text=gen_text,
                ref_audio=actual_ref_audio,
                ref_text=actual_ref_text,
                temperature=actual_temperature,
                top_k=actual_top_k,
            )
    gen_time = time.time() - gen_start

    timings = {
        "preprocess": 0,
        "generate": round(gen_time, 3),
        "total": round(time.time() - start, 3),
    }

    if response_format == "wav":
        wav_bytes = encode_wav_bytes(audio, SAMPLE_RATE)
        return wav_bytes, timings

    # Legacy JSON response with file path
    OUTPUT_DIR.mkdir(exist_ok=True)
    output_path = str(OUTPUT_DIR / f"generated_{int(time.time() * 1000)}.wav")

    import soundfile as sf
    sf.write(output_path, audio, SAMPLE_RATE)

    return {
        "success": True,
        "output": output_path,
        "gen_text": gen_text[:50],
        "timings": timings,
    }, None


def generate_audio_stream(gen_text, ref_audio=None, ref_text=None,
                          temperature=None, top_k=None):
    """Generator: yield (wav_bytes, chunk_index) with torch.inference_mode()."""
    import torch

    actual_temperature = temperature if temperature is not None else DEFAULT_TEMPERATURE
    actual_top_k = top_k if top_k is not None else DEFAULT_TOP_K

    actual_ref_audio = ref_audio if (ref_audio and os.path.isfile(ref_audio)) else REF_AUDIO
    actual_ref_text = ref_text if ref_text else REF_TEXT

    chunk_index = 0
    with _inference_lock:  # llama_cpp is NOT thread-safe
        with torch.inference_mode():
            for audio_chunk in tts.infer_stream(
                text=gen_text,
                ref_audio=actual_ref_audio,
                ref_text=actual_ref_text,
                temperature=actual_temperature,
                top_k=actual_top_k,
            ):
                if len(audio_chunk) > 0:
                    wav_bytes = encode_wav_bytes(audio_chunk, SAMPLE_RATE)
                    yield wav_bytes, chunk_index
                    chunk_index += 1


# ============================================================
# FastAPI Application
# ============================================================

from contextlib import asynccontextmanager
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, Response, StreamingResponse
from fastapi.middleware.cors import CORSMiddleware


@asynccontextmanager
async def lifespan(app):
    """FastAPI lifespan — print Ready! AFTER uvicorn is actually listening."""
    # Startup: model is already loaded in main(), just emit the ready signal
    print(f"[TTS-Server] Ready! Listening on http://{HOST}:{PORT}", flush=True)
    print(f"[TTS-Server] Mode: {tts_mode}", flush=True)
    print(f"[TTS-Server] Endpoints:", flush=True)
    print(f"[TTS-Server]   GET  /health           - Health check", flush=True)
    print(f"[TTS-Server]   POST /generate          - Generate audio (json|wav)", flush=True)
    print(f"[TTS-Server]   POST /generate-stream   - SSE streaming (chunked)", flush=True)
    yield
    # Shutdown
    print("[TTS-Server] Shutting down...", flush=True)


app = FastAPI(title="VieNeu-TTS Server", version="2.0", lifespan=lifespan)

# CORS — allow Electron and any localhost origin
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
async def health():
    """Health check endpoint."""
    response = {
        "status": "ready" if is_loaded else ("error" if load_error else "loading"),
        "engine": "VieNeu-TTS",
        "mode": tts_mode or "unknown",
        "base_model": GGUF_MODEL if tts_mode == "standard-cpu" else (MERGED_MODEL if tts_mode == "fast" else BASE_MODEL),
        "lora_loaded": lora_loaded,
        "lora_adapter": Path(LORA_PATH).name,
        "device": "cpu" if tts_mode == "standard-cpu" else "cuda",
        "codec_device": "cuda",
        "ref_audio": Path(REF_AUDIO).name,
        "sample_rate": SAMPLE_RATE,
    }
    if load_error:
        response["error"] = load_error
    return JSONResponse(content=response)


@app.post("/generate")
async def generate(request: Request):
    """Generate audio — supports JSON (legacy) and WAV binary response."""
    try:
        data = await request.json()

        gen_text = data.get("gen_text", "").strip()
        if not gen_text:
            return JSONResponse(status_code=400, content={"error": "Missing gen_text"})

        ref_audio = data.get("ref_audio")
        ref_text = data.get("ref_text")
        speed = float(data.get("speed", 1.0))
        response_format = data.get("response_format", "json")
        temperature = data.get("temperature")
        top_k = data.get("top_k")
        if temperature is not None:
            temperature = float(temperature)
        if top_k is not None:
            top_k = int(top_k)

        print(f"[TTS-Server] Generating: '{gen_text[:80]}...' (format={response_format}, temp={temperature or DEFAULT_TEMPERATURE}, top_k={top_k or DEFAULT_TOP_K})", flush=True)

        # Run blocking inference in thread pool to not block event loop
        loop = asyncio.get_event_loop()

        if response_format == "wav":
            wav_bytes, timings = await loop.run_in_executor(
                None, lambda: generate_audio(gen_text, ref_audio, ref_text, speed, "wav",
                                              temperature, top_k)
            )
            print(f"[TTS-Server] Done in {timings['total']}s", flush=True)

            return Response(
                content=wav_bytes,
                media_type="audio/wav",
                headers={
                    "X-TTS-Timings": json.dumps(timings),
                    "Content-Length": str(len(wav_bytes)),
                },
            )
        else:
            result, _ = await loop.run_in_executor(
                None, lambda: generate_audio(gen_text, ref_audio, ref_text, speed, "json",
                                              temperature, top_k)
            )
            print(f"[TTS-Server] Done: {result.get('output', 'N/A')}", flush=True)
            return JSONResponse(content=result)

    except Exception as e:
        import traceback
        traceback.print_exc()
        return JSONResponse(status_code=500, content={"error": str(e)})


@app.post("/generate-stream")
async def generate_stream(request: Request):
    """SSE streaming: yield audio chunks as they're generated."""
    try:
        data = await request.json()

        gen_text = data.get("gen_text", "").strip()
        if not gen_text:
            return JSONResponse(status_code=400, content={"error": "Missing gen_text"})

        ref_audio = data.get("ref_audio")
        ref_text = data.get("ref_text")
        temperature = data.get("temperature")
        top_k = data.get("top_k")
        if temperature is not None:
            temperature = float(temperature)
        if top_k is not None:
            top_k = int(top_k)

        print(f"[TTS-Server] Streaming: '{gen_text[:80]}...'", flush=True)

        start = time.time()

        async def event_generator():
            loop = asyncio.get_event_loop()

            # Run the blocking generator in a thread
            import queue
            import threading

            q = queue.Queue()

            def producer():
                try:
                    for wav_bytes, chunk_idx in generate_audio_stream(gen_text, ref_audio, ref_text,
                                                                       temperature, top_k):
                        q.put(("chunk", wav_bytes, chunk_idx))
                    q.put(("done", None, None))
                except Exception as e:
                    q.put(("error", str(e), None))

            thread = threading.Thread(target=producer, daemon=True)
            thread.start()

            while True:
                # Check queue with timeout to keep async loop responsive
                try:
                    item = await loop.run_in_executor(None, lambda: q.get(timeout=0.1))
                except Exception:
                    continue

                msg_type, payload, idx = item

                if msg_type == "chunk":
                    event_data = json.dumps({
                        "chunk_index": idx,
                        "audio_base64": base64.b64encode(payload).decode("ascii"),
                        "sample_rate": SAMPLE_RATE,
                        "elapsed": round(time.time() - start, 3),
                    })
                    yield f"event: audio-chunk\ndata: {event_data}\n\n"
                    print(f"[TTS-Server] Chunk {idx} (t={round(time.time() - start, 2)}s)", flush=True)

                elif msg_type == "done":
                    done_data = json.dumps({"total_time": round(time.time() - start, 3)})
                    yield f"event: done\ndata: {done_data}\n\n"
                    print(f"[TTS-Server] Stream done in {round(time.time() - start, 2)}s", flush=True)
                    break

                elif msg_type == "error":
                    error_data = json.dumps({"error": payload})
                    yield f"event: error\ndata: {error_data}\n\n"
                    break

            thread.join(timeout=5)

        return StreamingResponse(
            event_generator(),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
            },
        )

    except Exception as e:
        import traceback
        traceback.print_exc()
        return JSONResponse(status_code=500, content={"error": str(e)})


def main():
    import uvicorn

    print("=" * 60, flush=True)
    print("  🦜 VieNeu-TTS Server v2.0 (FastAPI + uvicorn)", flush=True)
    print("=" * 60, flush=True)
    print(f"[TTS-Server] Port: {PORT}", flush=True)

    # Step 1: NVIDIA persistence mode
    set_nvidia_persistence_mode()

    # Step 2: Load model (before uvicorn starts, so it's ready when server accepts connections)
    load_model()

    if not is_loaded:
        print(f"[TTS-Server] ⚠️ Model failed to load, server will start but /generate will fail", flush=True)

    # Step 3: CUDA pre-warm (dummy inference to allocate kernels)
    cuda_prewarm()

    # Step 4: Kill any zombie process holding our port
    kill_port_owner(PORT)

    # Step 5: Start uvicorn — lifespan startup event will print "Ready! Listening on"
    # which Electron's tts-server.js watches for to know the server is up
    config = uvicorn.Config(
        app,
        host=HOST,
        port=PORT,
        log_level="warning",
    )
    server = uvicorn.Server(config)

    # Handle graceful shutdown on SIGTERM (sent by Electron)
    import signal
    def handle_shutdown(sig, frame):
        print("[TTS-Server] Received shutdown signal, stopping...", flush=True)
        server.should_exit = True
    signal.signal(signal.SIGTERM, handle_shutdown)
    signal.signal(signal.SIGINT, handle_shutdown)

    server.run()


if __name__ == "__main__":
    main()
