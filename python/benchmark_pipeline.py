# -*- coding: utf-8 -*-
"""
Pipeline Benchmark: LLM (llama.cpp) + VieNeu-TTS (LoRA) running in parallel.

Tests the full voice pipeline speed:
  1. LLM generates text response (via llama-cpp-python)
  2. TTS converts response to audio (via VieNeu-TTS)
  3. Both models compete for GPU resources

Also logs CPU, RAM, GPU/CUDA core utilization throughout.
Includes detailed progress checkpoints to identify bottlenecks.

Usage:
    cd c:/Users/Admin/Workspace/bankAI/python
    ../VieNeu-TTS/.venv/Scripts/python.exe benchmark_pipeline.py

Requirements (install in .venv if missing):
    pip install llama-cpp-python psutil
"""

import sys
import os
import time
import threading
import json
import datetime
import subprocess
from pathlib import Path

# === PATHS ===
SCRIPT_DIR = Path(__file__).parent.absolute()
VIENEU_DIR = SCRIPT_DIR / "VieNeu-TTS"
MODELS_DIR = SCRIPT_DIR.parent / "models"
GGUF_MODEL = str(MODELS_DIR / "hf_Qwen_Qwen3-4B.Q4_K_M.gguf")

# VieNeu-TTS config (identical to reference)
BASE_MODEL = "pnnbao-ump/VieNeu-TTS-0.3B"
LORA_PATH = str(VIENEU_DIR / "finetune" / "output" / "VieNeu-TTS-0.3B-LoRA")
REF_AUDIO = str(VIENEU_DIR / "finetune" / "dataset" / "raw_audio" / "0001_voice.wav")
REF_TEXT = "Đang tìm kiếm một công cụ giúp quản lý tài chính thông minh? Ứng dụng này siêu dễ dùng, chỉ cần nhập số tiền và mục tiêu, nó sẽ tự động tính toán và đưa ra lời khuyên. Chắc chắn sẽ giúp bạn tiết kiệm hơn, không cần lo quá!"

# Test prompts
TEST_PROMPTS = [
    "ATM là gì?",
    "Lãi suất tiết kiệm hiện tại bao nhiêu?",
    "Làm sao để mở tài khoản ngân hàng?",
]

SYSTEM_PROMPT = "Bạn là trợ lý AI ngân hàng thông minh. Trả lời ngắn gọn, rõ ràng bằng tiếng Việt. Chỉ trả lời nội dung, không giải thích thêm."

import psutil

# Try GPU monitoring
try:
    import torch
    HAS_CUDA = torch.cuda.is_available()
except ImportError:
    HAS_CUDA = False
    torch = None

# GPU info via nvidia-smi (always available on NVIDIA systems)
def query_nvidia_smi():
    """Query GPU metrics via nvidia-smi. Returns dict or None."""
    try:
        result = subprocess.run(
            ["nvidia-smi", "--query-gpu=utilization.gpu,utilization.memory,"
             "clocks.current.sm,clocks.current.memory,clocks.max.sm,clocks.max.memory,"
             "temperature.gpu,power.draw,power.limit,"
             "memory.used,memory.total",
             "--format=csv,noheader,nounits"],
            capture_output=True, text=True, timeout=3
        )
        if result.returncode != 0:
            return None
        vals = [v.strip() for v in result.stdout.strip().split(",")]
        if len(vals) < 11:
            return None
        def safe_float(v):
            try: return float(v)
            except: return 0.0
        return {
            "gpu_util": safe_float(vals[0]),
            "mem_util": safe_float(vals[1]),
            "sm_clock": safe_float(vals[2]),
            "mem_clock": safe_float(vals[3]),
            "sm_clock_max": safe_float(vals[4]),
            "mem_clock_max": safe_float(vals[5]),
            "temp": safe_float(vals[6]),
            "power": safe_float(vals[7]),
            "power_limit": safe_float(vals[8]),
            "vram_used_mb": safe_float(vals[9]),
            "vram_total_mb": safe_float(vals[10]),
        }
    except Exception:
        return None

HAS_NVML = query_nvidia_smi() is not None

# GPU hardware info
GPU_SM_COUNT = 0
GPU_CUDA_CORES = 0
if HAS_CUDA:
    GPU_SM_COUNT = torch.cuda.get_device_properties(0).multi_processor_count
    # Blackwell (RTX 50xx) = 128 CUDA cores per SM
    # Ada Lovelace (RTX 40xx) = 128, Ampere (RTX 30xx) = 128, Turing (RTX 20xx) = 64
    GPU_CUDA_CORES = GPU_SM_COUNT * 128


# ============================================================
# CUDA Memory Snapshot
# ============================================================
def cuda_mem_snapshot():
    """Return current PyTorch CUDA memory in MB."""
    if not HAS_CUDA:
        return {"alloc_mb": 0, "reserved_mb": 0}
    return {
        "alloc_mb": torch.cuda.memory_allocated(0) / (1024 * 1024),
        "reserved_mb": torch.cuda.memory_reserved(0) / (1024 * 1024),
    }


# ============================================================
# Progress Checkpoint Logger
# ============================================================
def checkpoint(msg, t0=None):
    """Print a timestamped progress checkpoint with GPU snapshot."""
    ts = datetime.datetime.now().strftime("%H:%M:%S.%f")[:-3]
    elapsed = ""
    if t0 is not None:
        elapsed = f" [{time.time() - t0:.2f}s]"
    print(f"  🔖 [{ts}]{elapsed} {msg}")
    # Capture GPU snapshot at checkpoint via nvidia-smi
    gpu = query_nvidia_smi()
    if gpu:
        sm_pct = (gpu['sm_clock'] / gpu['sm_clock_max'] * 100) if gpu['sm_clock_max'] > 0 else 0
        active_cores = int(GPU_CUDA_CORES * gpu['gpu_util'] / 100) if GPU_CUDA_CORES > 0 else 0
        print(f"       GPU: {gpu['gpu_util']:.0f}% util (~{active_cores}/{GPU_CUDA_CORES} cores) | "
              f"SM {gpu['sm_clock']:.0f}/{gpu['sm_clock_max']:.0f}MHz ({sm_pct:.0f}%) | "
              f"{gpu['temp']:.0f}°C | {gpu['power']:.0f}W | "
              f"VRAM {gpu['vram_used_mb']/1024:.1f}/{gpu['vram_total_mb']/1024:.1f}GB")


# ============================================================
# Resource Monitor (nvidia-smi based for RTX 5070 compatibility)
# ============================================================
class ResourceMonitor:
    """Background thread monitoring CPU/RAM/GPU with CUDA core-level detail."""

    def __init__(self, interval=0.5):
        self.interval = interval
        self._running = False
        self._thread = None
        self.cpu = []
        self.ram = []
        # GPU metrics (from nvidia-smi)
        self.gpu_util = []       # GPU compute utilization %
        self.gpu_mem_util = []   # Memory controller utilization %
        self.gpu_mem = []        # VRAM used MB
        self.gpu_mem_total = 0
        self.sm_clock = []       # SM (Streaming Multiprocessor) clock MHz
        self.mem_clock = []      # Memory clock MHz
        self.gpu_temp = []       # Temperature °C
        self.gpu_power = []      # Power draw W
        self.proc = psutil.Process(os.getpid())

    def _collect(self):
        while self._running:
            self.cpu.append(self.proc.cpu_percent(interval=None))
            self.ram.append(self.proc.memory_info().rss / (1024 * 1024))
            if HAS_NVML:
                gpu = query_nvidia_smi()
                if gpu:
                    self.gpu_util.append(gpu["gpu_util"])
                    self.gpu_mem_util.append(gpu["mem_util"])
                    self.gpu_mem.append(gpu["vram_used_mb"])
                    self.gpu_mem_total = gpu["vram_total_mb"]
                    self.sm_clock.append(gpu["sm_clock"])
                    self.mem_clock.append(gpu["mem_clock"])
                    self.gpu_temp.append(gpu["temp"])
                    self.gpu_power.append(gpu["power"])
            time.sleep(self.interval)

    def start(self):
        self._running = True
        self.proc.cpu_percent(interval=None)  # prime
        self._thread = threading.Thread(target=self._collect, daemon=True)
        self._thread.start()

    def stop(self):
        self._running = False
        if self._thread:
            self._thread.join(timeout=2)

    def report(self, label=""):
        header = f"📊 {label}" if label else "📊 Resources"
        print(f"\n  {header}")
        print(f"  {'─' * 75}")
        if self.cpu:
            print(f"  🖥️  CPU:       avg {sum(self.cpu)/len(self.cpu):.1f}%  |  peak {max(self.cpu):.1f}%  ({len(self.cpu)} samples)")
        if self.ram:
            print(f"  🧠 RAM:       avg {sum(self.ram)/len(self.ram):.0f} MB  |  peak {max(self.ram):.0f} MB")
        if self.gpu_util:
            avg_util = sum(self.gpu_util) / len(self.gpu_util)
            peak_util = max(self.gpu_util)
            avg_cores = int(GPU_CUDA_CORES * avg_util / 100)
            peak_cores = int(GPU_CUDA_CORES * peak_util / 100)
            print(f"  🎮 GPU Util:  avg {avg_util:.0f}%  |  peak {peak_util:.0f}%")
            print(f"  🔥 CUDA Core: avg ~{avg_cores}/{GPU_CUDA_CORES}  |  peak ~{peak_cores}/{GPU_CUDA_CORES}")
        if self.gpu_mem_util:
            print(f"  📡 Mem Ctrl:  avg {sum(self.gpu_mem_util)/len(self.gpu_mem_util):.0f}%  |  peak {max(self.gpu_mem_util):.0f}%")
        if self.gpu_mem:
            print(f"  💾 VRAM:      avg {sum(self.gpu_mem)/len(self.gpu_mem):.0f} MB  |  peak {max(self.gpu_mem):.0f} MB  /  {self.gpu_mem_total:.0f} MB")
        if self.sm_clock:
            gpu0 = query_nvidia_smi()
            max_sm = gpu0['sm_clock_max'] if gpu0 else 0
            print(f"  ⚙️  SM Clock:  avg {sum(self.sm_clock)/len(self.sm_clock):.0f} MHz  |  peak {max(self.sm_clock):.0f} MHz  (max {max_sm:.0f} MHz)")
        if self.mem_clock:
            print(f"  ⚙️  Mem Clk:   avg {sum(self.mem_clock)/len(self.mem_clock):.0f} MHz  |  peak {max(self.mem_clock):.0f} MHz")
        if self.gpu_temp:
            print(f"  🌡️  Temp:      avg {sum(self.gpu_temp)/len(self.gpu_temp):.0f}°C  |  peak {max(self.gpu_temp):.0f}°C")
        if self.gpu_power:
            print(f"  ⚡ Power:     avg {sum(self.gpu_power)/len(self.gpu_power):.0f}W  |  peak {max(self.gpu_power):.0f}W")
        if HAS_CUDA:
            a = torch.cuda.memory_allocated(0) / (1024 * 1024)
            r = torch.cuda.memory_reserved(0) / (1024 * 1024)
            print(f"  🔧 PyTorch:   alloc {a:.0f} MB  |  reserved {r:.0f} MB")
        print(f"  {'─' * 75}")

    def reset(self):
        self.cpu.clear()
        self.ram.clear()
        self.gpu_util.clear()
        self.gpu_mem_util.clear()
        self.gpu_mem.clear()
        self.sm_clock.clear()
        self.mem_clock.clear()
        self.gpu_temp.clear()
        self.gpu_power.clear()


# ============================================================
# System Info
# ============================================================
def print_system_info():
    print("=" * 60)
    print("🔬 Pipeline Benchmark: LLM + TTS (CUDA Core Monitor)")
    print("=" * 60)
    print(f"\n🖥️  CPU: {psutil.cpu_count(logical=True)} logical cores")
    print(f"🧠 RAM: {psutil.virtual_memory().total / (1024**3):.1f} GB total")
    if HAS_CUDA:
        print(f"🎮 GPU: {torch.cuda.get_device_name(0)}")
        props = torch.cuda.get_device_properties(0)
        print(f"💾 VRAM: {props.total_memory / (1024**3):.1f} GB")
        print(f"⚙️  SM Count: {GPU_SM_COUNT} multiprocessors")
        print(f"🔥 CUDA Cores: {GPU_CUDA_CORES} ({GPU_SM_COUNT} SMs × 128 cores/SM)")
        print(f"🔧 CUDA: {torch.version.cuda}, PyTorch: {torch.__version__}")
    else:
        print("⚠️  No CUDA GPU detected")
    if HAS_NVML:
        gpu = query_nvidia_smi()
        if gpu:
            print(f"⚙️  Max Clocks: SM {gpu['sm_clock_max']:.0f} MHz | Mem {gpu['mem_clock_max']:.0f} MHz")
            print(f"⚡ Power Limit: {gpu['power_limit']:.0f}W")
            print(f"🌡️  Current: {gpu['temp']:.0f}°C | {gpu['power']:.0f}W | SM {gpu['sm_clock']:.0f}MHz | VRAM {gpu['vram_used_mb']/1024:.1f}/{gpu['vram_total_mb']/1024:.1f}GB")
    print(f"\n📦 LLM: {Path(GGUF_MODEL).name}")
    print(f"📦 TTS: {BASE_MODEL} + LoRA")
    print(f"🎤 Ref: {Path(REF_AUDIO).name}")


# ============================================================
# Load Models
# ============================================================
def load_tts():
    """Load VieNeu-TTS (identical to reference)."""
    load_t0 = time.time()
    checkpoint("TTS: importing VieNeu module...", load_t0)
    sys.path.insert(0, str(VIENEU_DIR / "src"))
    sys.path.insert(0, str(VIENEU_DIR))
    from vieneu import Vieneu
    checkpoint("TTS: import complete", load_t0)

    mem_before = cuda_mem_snapshot()
    print("\n⏳ Loading TTS base model (CUDA)...")
    checkpoint("TTS: initializing base model (downloading/loading weights)...", load_t0)
    t0 = time.time()
    tts = Vieneu(
        mode="standard",
        backbone_repo=BASE_MODEL,
        backbone_device="cuda",
        codec_device="cpu",
    )
    mem_after_base = cuda_mem_snapshot()
    base_vram = mem_after_base['alloc_mb'] - mem_before['alloc_mb']
    checkpoint(f"TTS: base model loaded in {time.time() - t0:.1f}s", load_t0)
    print(f"✅ TTS base model loaded in {time.time() - t0:.1f}s (VRAM: +{base_vram:.0f} MB)")

    print("⏳ Loading LoRA adapter...")
    checkpoint("TTS: loading LoRA adapter...", load_t0)
    t0 = time.time()
    tts.load_lora_adapter(LORA_PATH)
    mem_after_lora = cuda_mem_snapshot()
    lora_vram = mem_after_lora['alloc_mb'] - mem_after_base['alloc_mb']
    checkpoint(f"TTS: LoRA adapter loaded in {time.time() - t0:.1f}s", load_t0)
    print(f"✅ LoRA loaded in {time.time() - t0:.1f}s (VRAM: +{lora_vram:.0f} MB)")
    total_tts = mem_after_lora['alloc_mb'] - mem_before['alloc_mb']
    print(f"📊 TTS total VRAM: {total_tts:.0f} MB")
    return tts, {'base_vram': base_vram, 'lora_vram': lora_vram, 'total_vram': total_tts}


def load_llm():
    """Load llama.cpp model."""
    load_t0 = time.time()
    checkpoint("LLM: importing llama_cpp...", load_t0)
    try:
        from llama_cpp import Llama
    except ImportError:
        print("⚠️  llama-cpp-python not installed. Install with:")
        print("    pip install llama-cpp-python")
        return None, {'pytorch_vram': 0}
    checkpoint("LLM: import complete", load_t0)

    if not os.path.isfile(GGUF_MODEL):
        print(f"⚠️  GGUF model not found: {GGUF_MODEL}")
        return None, {'pytorch_vram': 0}

    mem_before = cuda_mem_snapshot()
    print(f"\n⏳ Loading LLM: {Path(GGUF_MODEL).name}...")
    checkpoint("LLM: loading GGUF model to GPU...", load_t0)
    t0 = time.time()
    llm = Llama(
        model_path=GGUF_MODEL,
        n_ctx=4096,
        n_gpu_layers=-1,  # offload all to GPU
        verbose=False,
    )
    mem_after = cuda_mem_snapshot()
    llm_vram = mem_after['alloc_mb'] - mem_before['alloc_mb']
    # LLM via llama.cpp uses its own CUDA allocator, check nvidia-smi for real usage
    gpu_now = query_nvidia_smi()
    checkpoint(f"LLM: model loaded in {time.time() - t0:.1f}s", load_t0)
    print(f"✅ LLM loaded in {time.time() - t0:.1f}s (PyTorch VRAM: +{llm_vram:.0f} MB)")
    if gpu_now:
        print(f"📊 LLM total VRAM (nvidia-smi): {gpu_now['vram_used_mb']:.0f} MB total GPU usage")
    return llm, {'pytorch_vram': llm_vram}


# ============================================================
# Benchmark Functions
# ============================================================
def bench_tts_only(tts, text, monitor):
    """Benchmark TTS generation only."""
    monitor.reset()
    monitor.start()
    t0 = time.time()
    checkpoint("TTS-bench: starting inference...", t0)
    audio = tts.infer(text=text, ref_audio=REF_AUDIO, ref_text=REF_TEXT)
    checkpoint("TTS-bench: inference complete", t0)
    elapsed = time.time() - t0
    monitor.stop()
    dur = len(audio) / 24000
    return {"elapsed": elapsed, "audio_dur": dur, "rtf": elapsed / dur, "samples": len(audio)}


def bench_llm_only(llm, prompt):
    """Benchmark LLM generation only."""
    t0 = time.time()
    checkpoint("LLM-bench: sending prompt...", t0)
    result = llm.create_chat_completion(
        messages=[
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": prompt},
        ],
        max_tokens=256,
        temperature=0.5,
        top_p=0.9,
    )
    checkpoint("LLM-bench: response received", t0)
    elapsed = time.time() - t0
    text = result["choices"][0]["message"]["content"].strip()
    tokens = result["usage"]["completion_tokens"]
    return {"elapsed": elapsed, "text": text, "tokens": tokens, "tok_s": tokens / elapsed}


def bench_pipeline(llm, tts, prompt, monitor):
    """Benchmark full pipeline: LLM → TTS (sequential)."""
    monitor.reset()
    monitor.start()
    t0 = time.time()

    # LLM
    checkpoint("Pipeline: starting LLM phase...", t0)
    llm_start = time.time()
    llm_result = bench_llm_only(llm, prompt)
    llm_time = time.time() - llm_start
    checkpoint(f"Pipeline: LLM done ({llm_time:.2f}s), starting TTS phase...", t0)

    # TTS on LLM output
    tts_start = time.time()
    checkpoint("Pipeline: TTS inference starting...", t0)
    audio = tts.infer(text=llm_result["text"], ref_audio=REF_AUDIO, ref_text=REF_TEXT)
    tts_time = time.time() - tts_start
    checkpoint(f"Pipeline: TTS done ({tts_time:.2f}s)", t0)
    audio_dur = len(audio) / 24000

    total = time.time() - t0
    monitor.stop()

    return {
        "total": total,
        "llm_time": llm_time,
        "tts_time": tts_time,
        "llm_text": llm_result["text"],
        "llm_tokens": llm_result["tokens"],
        "llm_tok_s": llm_result["tok_s"],
        "audio_dur": audio_dur,
        "tts_rtf": tts_time / audio_dur if audio_dur > 0 else 0,
    }


def bench_tts_stream(tts, text, monitor):
    """Benchmark TTS streaming."""
    monitor.reset()
    monitor.start()
    t0 = time.time()
    chunks = []
    first_chunk_time = None

    checkpoint("TTS-stream: starting stream inference...", t0)
    for chunk in tts.infer_stream(text=text, ref_audio=REF_AUDIO, ref_text=REF_TEXT):
        if len(chunk) > 0:
            if first_chunk_time is None:
                first_chunk_time = time.time() - t0
                checkpoint(f"TTS-stream: first chunk received at {first_chunk_time:.2f}s", t0)
            chunks.append(chunk)

    checkpoint(f"TTS-stream: all {len(chunks)} chunks received", t0)
    total = time.time() - t0
    monitor.stop()

    import numpy as np
    total_samples = sum(len(c) for c in chunks)
    audio_dur = total_samples / 24000

    return {
        "total": total,
        "first_chunk": first_chunk_time or 0,
        "chunks": len(chunks),
        "audio_dur": audio_dur,
        "rtf": total / audio_dur if audio_dur > 0 else 0,
    }


# ============================================================
# Main
# ============================================================
def main():
    print_system_info()
    monitor = ResourceMonitor(interval=0.3)  # Faster sampling for better resolution

    # --- Load models ---
    print(f"\n{'═' * 60}")
    print("Phase 1: Loading Models")
    print(f"{'═' * 60}")
    monitor.reset()
    monitor.start()
    load_start = time.time()
    checkpoint("Phase 1 START: Loading models", load_start)

    tts, tts_stats = load_tts()
    checkpoint("TTS model ready, starting LLM load", load_start)
    llm, llm_stats = load_llm()
    checkpoint("All models loaded", load_start)

    load_time = time.time() - load_start
    monitor.stop()
    print(f"\n⏱ Total model load time: {load_time:.1f}s")
    monitor.report("Model Loading")

    # --- VRAM Breakdown ---
    print(f"\n  📊 VRAM Breakdown (per component)")
    print(f"  {'─' * 55}")
    print(f"  🔊 TTS Base Model:  {tts_stats.get('base_vram', 0):>8.0f} MB")
    print(f"  🔊 TTS LoRA:        {tts_stats.get('lora_vram', 0):>8.0f} MB")
    print(f"  🤖 LLM (PyTorch):   {llm_stats.get('pytorch_vram', 0):>8.0f} MB")
    total_pt = cuda_mem_snapshot()
    gpu_now = query_nvidia_smi()
    print(f"  {'─' * 55}")
    print(f"  🔧 PyTorch Total:   {total_pt['alloc_mb']:>8.0f} MB alloc / {total_pt['reserved_mb']:.0f} MB reserved")
    if gpu_now:
        print(f"  💾 nvidia-smi:      {gpu_now['vram_used_mb']:>8.0f} MB / {gpu_now['vram_total_mb']:.0f} MB total")
        non_pt = gpu_now['vram_used_mb'] - total_pt['reserved_mb']
        if non_pt > 50:
            print(f"  ⚙️  Non-PyTorch GPU: {non_pt:>8.0f} MB (llama.cpp CUDA allocator)")
    print(f"  {'─' * 55}")

    # --- Baseline: TTS only ---
    print(f"\n{'═' * 60}")
    print("Phase 2: TTS Only (baseline)")
    print(f"{'═' * 60}")
    test_text = "Xin chào, tôi là trợ lý AI ngân hàng. Tôi có thể giúp gì cho bạn?"
    print(f"Text: \"{test_text}\"")
    phase2_t0 = time.time()
    checkpoint("Phase 2 START: TTS Only benchmark", phase2_t0)

    r = bench_tts_only(tts, test_text, monitor)
    print(f"  ⏱ Time: {r['elapsed']:.2f}s")
    print(f"  🎵 Audio: {r['audio_dur']:.1f}s ({r['samples']} samples)")
    print(f"  ⚡ RTF: {r['rtf']:.2f}x")
    checkpoint("Phase 2 END", phase2_t0)
    monitor.report("TTS Only")

    # --- Baseline: TTS Streaming ---
    print(f"\n{'═' * 60}")
    print("Phase 3: TTS Streaming (baseline)")
    print(f"{'═' * 60}")
    print(f"Text: \"{test_text}\"")
    phase3_t0 = time.time()
    checkpoint("Phase 3 START: TTS Streaming benchmark", phase3_t0)

    r = bench_tts_stream(tts, test_text, monitor)
    print(f"  ⏱ Total: {r['total']:.2f}s")
    print(f"  🚀 First chunk: {r['first_chunk']:.2f}s")
    print(f"  📦 Chunks: {r['chunks']}")
    print(f"  🎵 Audio: {r['audio_dur']:.1f}s")
    print(f"  ⚡ RTF: {r['rtf']:.2f}x")
    checkpoint("Phase 3 END", phase3_t0)
    monitor.report("TTS Streaming")

    if llm is None:
        print("\n⚠️  Skipping LLM benchmarks (llama-cpp-python not available)")
        print("    Install with: pip install llama-cpp-python")
    else:
        # --- LLM only ---
        print(f"\n{'═' * 60}")
        print("Phase 4: LLM Only (baseline)")
        print(f"{'═' * 60}")
        phase4_t0 = time.time()
        checkpoint("Phase 4 START: LLM Only benchmark", phase4_t0)
        for i, prompt in enumerate(TEST_PROMPTS):
            print(f"\n  Q: \"{prompt}\"")
            checkpoint(f"LLM prompt {i+1}/{len(TEST_PROMPTS)}: starting...", phase4_t0)
            monitor.reset()
            monitor.start()
            r = bench_llm_only(llm, prompt)
            monitor.stop()
            print(f"  A: \"{r['text'][:100]}...\"")
            print(f"  ⏱ {r['elapsed']:.2f}s | {r['tokens']} tokens | {r['tok_s']:.1f} tok/s")

        checkpoint("Phase 4 END", phase4_t0)
        monitor.report("LLM Only")

        # --- Full Pipeline: LLM → TTS ---
        print(f"\n{'═' * 60}")
        print("Phase 5: Full Pipeline (LLM → TTS)")
        print(f"{'═' * 60}")
        phase5_t0 = time.time()
        checkpoint("Phase 5 START: Full Pipeline benchmark", phase5_t0)
        for i, prompt in enumerate(TEST_PROMPTS):
            print(f"\n  Q: \"{prompt}\"")
            checkpoint(f"Pipeline prompt {i+1}/{len(TEST_PROMPTS)}: starting...", phase5_t0)
            r = bench_pipeline(llm, tts, prompt, monitor)
            print(f"  A: \"{r['llm_text'][:80]}...\"")
            print(f"  ⏱ LLM: {r['llm_time']:.2f}s ({r['llm_tokens']} tok, {r['llm_tok_s']:.1f} tok/s)")
            print(f"  ⏱ TTS: {r['tts_time']:.2f}s ({r['audio_dur']:.1f}s audio, RTF={r['tts_rtf']:.2f}x)")
            print(f"  ⚡ Total: {r['total']:.2f}s")

        checkpoint("Phase 5 END", phase5_t0)
        monitor.report("Full Pipeline")

    # --- Summary ---
    print(f"\n{'═' * 60}")
    print("📈 BENCHMARK COMPLETE")
    print(f"{'═' * 60}")

    # Current system snapshot (detailed CUDA core status)
    print("\n📊 Final System Resources:")
    print(f"  CPU: {psutil.cpu_percent(interval=1):.1f}%")
    mem = psutil.virtual_memory()
    print(f"  RAM: {mem.used / (1024**3):.1f} / {mem.total / (1024**3):.1f} GB ({mem.percent}%)")
    if HAS_NVML:
        gpu = query_nvidia_smi()
        if gpu:
            active_cores = int(GPU_CUDA_CORES * gpu['gpu_util'] / 100)
            print(f"  GPU Util: {gpu['gpu_util']:.0f}% (~{active_cores}/{GPU_CUDA_CORES} CUDA cores active)")
            print(f"  Mem Ctrl: {gpu['mem_util']:.0f}%")
            print(f"  SM Clock: {gpu['sm_clock']:.0f} / {gpu['sm_clock_max']:.0f} MHz")
            print(f"  Mem Clock: {gpu['mem_clock']:.0f} / {gpu['mem_clock_max']:.0f} MHz")
            print(f"  Temperature: {gpu['temp']:.0f}°C")
            print(f"  Power: {gpu['power']:.0f} / {gpu['power_limit']:.0f} W")
            print(f"  VRAM: {gpu['vram_used_mb']/1024:.1f} / {gpu['vram_total_mb']/1024:.1f} GB ({gpu['vram_used_mb']/gpu['vram_total_mb']*100:.0f}%)")
    if HAS_CUDA:
        print(f"  PyTorch CUDA: {torch.cuda.memory_allocated(0)/(1024**3):.2f} GB allocated")
        print(f"  PyTorch CUDA: {torch.cuda.memory_reserved(0)/(1024**3):.2f} GB reserved")

    print(f"\n{'═' * 60}")

    # Cleanup
    tts.close()


if __name__ == "__main__":
    main()
