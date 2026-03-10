# -*- coding: utf-8 -*-
"""
VieNeu-TTS CPU Benchmark — Comprehensive TTS performance test on CPU-only mode.

Tests VieNeu-TTS inference speed, latency, and resource usage WITHOUT GPU.
Useful for evaluating CPU-only deployment scenarios and comparing with GPU performance.

Benchmark Phases:
  1. Model Loading (GGUF backbone + codec on CPU)
  2. Warm-up Inference (first run — JIT, cache priming)
  3. Single Inference (varying text lengths)
  4. Streaming Inference (first-chunk latency + total time)
  5. Batch Throughput (multiple sequential inferences)
  6. Concurrent Stress Test (threading)

Usage:
    cd c:/Users/Admin/Workspace/bankAI/python
    python benchmark_tts_cpu.py

    # Or with VieNeu-TTS .venv
    ../VieNeu-TTS/.venv/Scripts/python.exe benchmark_tts_cpu.py

Requirements:
    pip install psutil soundfile numpy
"""

import sys
import os
import time
import json
import threading
import datetime
import statistics
from pathlib import Path

os.environ["PYTHONUTF8"] = "1"
os.environ["PYTHONIOENCODING"] = "utf-8"

# NOTE: CPU-only mode is enforced by backbone_device="cpu" + codec_device="cpu"
# Do NOT set CUDA_VISIBLE_DEVICES="" — it breaks PyTorch/torchao initialization.

import psutil
import numpy as np

# === PATHS ===
SCRIPT_DIR = Path(__file__).parent.absolute()
VIENEU_DIR = SCRIPT_DIR / "VieNeu-TTS"
OUTPUT_DIR = SCRIPT_DIR / "outputs" / "benchmarks"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

# === CONFIG ===
GGUF_MODEL = "pnnbao-ump/VieNeu-TTS-0.3B-q4-gguf"
BASE_MODEL = "pnnbao-ump/VieNeu-TTS-0.3B"
CODEC_REPO = "neuphonic/distill-neucodec"
SAMPLE_RATE = 24000

REF_AUDIO = str(VIENEU_DIR / "finetune" / "dataset" / "raw_audio" / "0001_voice.wav")
REF_TEXT = (
    "Đang tìm kiếm một công cụ giúp quản lý tài chính thông minh? "
    "Ứng dụng này siêu dễ dùng, chỉ cần nhập số tiền và mục tiêu, "
    "nó sẽ tự động tính toán và đưa ra lời khuyên. "
    "Chắc chắn sẽ giúp bạn tiết kiệm hơn, không cần lo quá!"
)

# Test texts — varying lengths
TEST_TEXTS = {
    "short": "Xin chào, tôi có thể giúp gì cho bạn?",
    "medium": "Xin chào, tôi là trợ lý AI ngân hàng. Tôi có thể giúp bạn kiểm tra số dư, chuyển tiền, hoặc tư vấn các sản phẩm tài chính phù hợp.",
    "long": (
        "Xin chào, tôi là trợ lý AI ngân hàng thông minh. "
        "Tôi có thể giúp bạn thực hiện nhiều giao dịch khác nhau như kiểm tra số dư tài khoản, "
        "chuyển tiền nội bộ và liên ngân hàng, thanh toán hóa đơn điện nước, "
        "đăng ký các sản phẩm tiết kiệm với lãi suất ưu đãi. "
        "Ngoài ra, tôi cũng có thể tư vấn cho bạn về các gói vay cá nhân, "
        "thẻ tín dụng phù hợp với nhu cầu của bạn. "
        "Hãy cho tôi biết bạn cần hỗ trợ gì nhé!"
    ),
}

# Number of iterations for batch throughput test
BATCH_ITERATIONS = 3
# Number of concurrent threads for stress test
CONCURRENT_THREADS = 2


# ============================================================
# CPU Resource Monitor
# ============================================================
class CPUResourceMonitor:
    """Background thread monitoring CPU and RAM usage during inference."""

    def __init__(self, interval=0.3):
        self.interval = interval
        self._running = False
        self._thread = None
        self.cpu_percent = []
        self.cpu_freq = []
        self.ram_used_mb = []
        self.ram_percent = []
        self.process_cpu = []
        self.process_ram_mb = []
        self.proc = psutil.Process(os.getpid())
        # Per-core CPU tracking
        self.per_core_cpu = []

    def _collect(self):
        while self._running:
            # System-wide CPU
            self.cpu_percent.append(psutil.cpu_percent(interval=None))
            freq = psutil.cpu_freq()
            if freq:
                self.cpu_freq.append(freq.current)

            # Per-core usage
            per_core = psutil.cpu_percent(interval=None, percpu=True)
            self.per_core_cpu.append(per_core)

            # System RAM
            vm = psutil.virtual_memory()
            self.ram_used_mb.append(vm.used / (1024 * 1024))
            self.ram_percent.append(vm.percent)

            # Process-level
            self.process_cpu.append(self.proc.cpu_percent(interval=None))
            self.process_ram_mb.append(self.proc.memory_info().rss / (1024 * 1024))

            time.sleep(self.interval)

    def start(self):
        self._running = True
        self.proc.cpu_percent(interval=None)  # Prime the counter
        psutil.cpu_percent(interval=None)
        psutil.cpu_percent(interval=None, percpu=True)
        self._thread = threading.Thread(target=self._collect, daemon=True)
        self._thread.start()

    def stop(self):
        self._running = False
        if self._thread:
            self._thread.join(timeout=3)

    def report(self, label=""):
        header = f"📊 {label}" if label else "📊 CPU Resources"
        print(f"\n  {header}")
        print(f"  {'─' * 70}")

        if self.cpu_percent:
            avg_cpu = statistics.mean(self.cpu_percent)
            peak_cpu = max(self.cpu_percent)
            print(f"  🖥️  System CPU:  avg {avg_cpu:.1f}%  |  peak {peak_cpu:.1f}%  ({len(self.cpu_percent)} samples)")

        if self.cpu_freq:
            avg_freq = statistics.mean(self.cpu_freq)
            peak_freq = max(self.cpu_freq)
            print(f"  ⚡ CPU Freq:    avg {avg_freq:.0f} MHz  |  peak {peak_freq:.0f} MHz")

        if self.per_core_cpu:
            # Find hot cores (avg > 50%)
            n_cores = len(self.per_core_cpu[0]) if self.per_core_cpu else 0
            if n_cores > 0:
                core_avgs = []
                for c in range(n_cores):
                    vals = [sample[c] for sample in self.per_core_cpu if c < len(sample)]
                    core_avgs.append(statistics.mean(vals) if vals else 0)
                active_cores = sum(1 for a in core_avgs if a > 20)
                hot_cores = sum(1 for a in core_avgs if a > 50)
                print(f"  🔥 Cores:      {active_cores}/{n_cores} active (>20%)  |  {hot_cores}/{n_cores} hot (>50%)")

        if self.process_cpu:
            avg_proc = statistics.mean(self.process_cpu)
            peak_proc = max(self.process_cpu)
            print(f"  🔧 Process CPU: avg {avg_proc:.1f}%  |  peak {peak_proc:.1f}%")

        if self.process_ram_mb:
            avg_ram = statistics.mean(self.process_ram_mb)
            peak_ram = max(self.process_ram_mb)
            print(f"  🧠 Process RAM: avg {avg_ram:.0f} MB  |  peak {peak_ram:.0f} MB")

        if self.ram_percent:
            print(f"  💾 System RAM:  avg {statistics.mean(self.ram_percent):.1f}%  |  peak {max(self.ram_percent):.1f}%")

        print(f"  {'─' * 70}")

    def reset(self):
        self.cpu_percent.clear()
        self.cpu_freq.clear()
        self.ram_used_mb.clear()
        self.ram_percent.clear()
        self.process_cpu.clear()
        self.process_ram_mb.clear()
        self.per_core_cpu.clear()

    def snapshot(self):
        """Return current resource usage as a dict."""
        vm = psutil.virtual_memory()
        freq = psutil.cpu_freq()
        return {
            "system_cpu_pct": psutil.cpu_percent(interval=None),
            "process_cpu_pct": self.proc.cpu_percent(interval=None),
            "process_ram_mb": self.proc.memory_info().rss / (1024 * 1024),
            "system_ram_pct": vm.percent,
            "cpu_freq_mhz": freq.current if freq else 0,
        }


# ============================================================
# Progress Checkpoint
# ============================================================
def checkpoint(msg, t0=None):
    """Print a timestamped progress checkpoint."""
    ts = datetime.datetime.now().strftime("%H:%M:%S.%f")[:-3]
    elapsed = ""
    if t0 is not None:
        elapsed = f" [{time.time() - t0:.2f}s]"
    print(f"  🔖 [{ts}]{elapsed} {msg}")


# ============================================================
# System Info
# ============================================================
def print_system_info():
    print("=" * 65)
    print("  🔬 VieNeu-TTS CPU Benchmark")
    print("  🖥️  CPU-Only Mode — No GPU Required")
    print("=" * 65)
    cpu_count = psutil.cpu_count(logical=True)
    cpu_physical = psutil.cpu_count(logical=False)
    freq = psutil.cpu_freq()
    ram = psutil.virtual_memory()
    print(f"\n  🖥️  CPU: {cpu_physical} physical / {cpu_count} logical cores")
    if freq:
        print(f"  ⚡ Freq: {freq.current:.0f} MHz (max {freq.max:.0f} MHz)")
    print(f"  🧠 RAM: {ram.total / (1024**3):.1f} GB total ({ram.available / (1024**3):.1f} GB available)")
    print(f"  🐍 Python: {sys.version.split()[0]}")
    print(f"\n  📦 GGUF Model: {GGUF_MODEL}")
    print(f"  📦 Codec: {CODEC_REPO}")
    print(f"  🎤 Ref Audio: {Path(REF_AUDIO).name}")
    ref_exists = os.path.isfile(REF_AUDIO)
    print(f"  {'✅' if ref_exists else '❌'} Ref audio {'found' if ref_exists else 'NOT FOUND'}")


# ============================================================
# Benchmark Functions
# ============================================================
def bench_single_inference(tts, text, label, monitor):
    """Benchmark a single TTS inference call."""
    monitor.reset()
    monitor.start()
    t0 = time.time()
    checkpoint(f"Inference [{label}]: starting...", t0)

    audio = tts.infer(text=text, ref_audio=REF_AUDIO, ref_text=REF_TEXT)

    elapsed = time.time() - t0
    checkpoint(f"Inference [{label}]: complete", t0)
    monitor.stop()

    audio_dur = len(audio) / SAMPLE_RATE
    rtf = elapsed / audio_dur if audio_dur > 0 else float("inf")

    return {
        "label": label,
        "text_len": len(text),
        "elapsed_s": round(elapsed, 3),
        "audio_dur_s": round(audio_dur, 2),
        "audio_samples": len(audio),
        "rtf": round(rtf, 3),
        "chars_per_sec": round(len(text) / elapsed, 1) if elapsed > 0 else 0,
    }


def bench_streaming(tts, text, label, monitor):
    """Benchmark TTS streaming inference  — measures first-chunk latency."""
    monitor.reset()
    monitor.start()
    t0 = time.time()
    chunks = []
    first_chunk_time = None

    checkpoint(f"Stream [{label}]: starting...", t0)
    for chunk in tts.infer_stream(text=text, ref_audio=REF_AUDIO, ref_text=REF_TEXT):
        if len(chunk) > 0:
            if first_chunk_time is None:
                first_chunk_time = time.time() - t0
                checkpoint(f"Stream [{label}]: first chunk at {first_chunk_time:.3f}s", t0)
            chunks.append(chunk)

    total = time.time() - t0
    checkpoint(f"Stream [{label}]: all {len(chunks)} chunks received", t0)
    monitor.stop()

    total_samples = sum(len(c) for c in chunks)
    audio_dur = total_samples / SAMPLE_RATE
    rtf = total / audio_dur if audio_dur > 0 else float("inf")

    return {
        "label": label,
        "text_len": len(text),
        "total_s": round(total, 3),
        "first_chunk_s": round(first_chunk_time, 3) if first_chunk_time else None,
        "num_chunks": len(chunks),
        "audio_dur_s": round(audio_dur, 2),
        "audio_samples": total_samples,
        "rtf": round(rtf, 3),
    }


def bench_batch_throughput(tts, text, iterations, monitor):
    """Benchmark multiple sequential inferences for throughput measurement."""
    monitor.reset()
    monitor.start()
    t0 = time.time()
    results = []

    for i in range(iterations):
        iter_start = time.time()
        checkpoint(f"Batch {i+1}/{iterations}: starting...", t0)
        audio = tts.infer(text=text, ref_audio=REF_AUDIO, ref_text=REF_TEXT)
        iter_time = time.time() - iter_start
        audio_dur = len(audio) / SAMPLE_RATE
        results.append({
            "iteration": i + 1,
            "elapsed_s": round(iter_time, 3),
            "audio_dur_s": round(audio_dur, 2),
            "rtf": round(iter_time / audio_dur, 3) if audio_dur > 0 else float("inf"),
        })
        checkpoint(f"Batch {i+1}/{iterations}: done in {iter_time:.2f}s (RTF={iter_time/audio_dur:.2f}x)", t0)

    total = time.time() - t0
    monitor.stop()

    times = [r["elapsed_s"] for r in results]
    rtfs = [r["rtf"] for r in results]

    return {
        "iterations": iterations,
        "total_s": round(total, 3),
        "avg_time_s": round(statistics.mean(times), 3),
        "median_time_s": round(statistics.median(times), 3),
        "min_time_s": round(min(times), 3),
        "max_time_s": round(max(times), 3),
        "stdev_s": round(statistics.stdev(times), 3) if len(times) > 1 else 0,
        "avg_rtf": round(statistics.mean(rtfs), 3),
        "per_iteration": results,
    }


def bench_concurrent(tts, text, n_threads, monitor):
    """Benchmark concurrent TTS inference with threading."""
    monitor.reset()
    monitor.start()
    results = [None] * n_threads
    errors = [None] * n_threads

    def worker(idx):
        try:
            t0 = time.time()
            audio = tts.infer(text=text, ref_audio=REF_AUDIO, ref_text=REF_TEXT)
            elapsed = time.time() - t0
            audio_dur = len(audio) / SAMPLE_RATE
            results[idx] = {
                "thread": idx,
                "elapsed_s": round(elapsed, 3),
                "audio_dur_s": round(audio_dur, 2),
                "rtf": round(elapsed / audio_dur, 3) if audio_dur > 0 else float("inf"),
            }
        except Exception as e:
            errors[idx] = str(e)

    t0 = time.time()
    threads = [threading.Thread(target=worker, args=(i,)) for i in range(n_threads)]
    for t in threads:
        t.start()
    for t in threads:
        t.join(timeout=300)
    total = time.time() - t0
    monitor.stop()

    valid = [r for r in results if r is not None]
    failed = [e for e in errors if e is not None]

    return {
        "n_threads": n_threads,
        "total_wall_time_s": round(total, 3),
        "completed": len(valid),
        "failed": len(failed),
        "errors": failed,
        "avg_time_s": round(statistics.mean([r["elapsed_s"] for r in valid]), 3) if valid else 0,
        "per_thread": valid,
    }


# ============================================================
# Main
# ============================================================
def main():
    print_system_info()
    monitor = CPUResourceMonitor(interval=0.3)
    all_results = {
        "timestamp": datetime.datetime.now().isoformat(),
        "mode": "cpu-only",
        "model": GGUF_MODEL,
        "codec": CODEC_REPO,
        "system": {
            "cpu_cores_physical": psutil.cpu_count(logical=False),
            "cpu_cores_logical": psutil.cpu_count(logical=True),
            "ram_total_gb": round(psutil.virtual_memory().total / (1024**3), 1),
            "python": sys.version.split()[0],
        },
    }

    # ── Phase 1: Load Model ──
    print(f"\n{'═' * 65}")
    print("  Phase 1: Loading Model (CPU-Only)")
    print(f"{'═' * 65}")

    sys.path.insert(0, str(VIENEU_DIR / "src"))
    sys.path.insert(0, str(VIENEU_DIR))

    monitor.reset()
    monitor.start()
    load_t0 = time.time()
    checkpoint("Importing VieNeu module...", load_t0)

    from vieneu import Vieneu

    checkpoint("Import complete, initializing model...", load_t0)
    print(f"  📦 Backbone: {GGUF_MODEL} (CPU)")
    print(f"  📦 Codec: {CODEC_REPO} (CPU)")

    tts = Vieneu(
        mode="standard",
        backbone_repo=GGUF_MODEL,
        backbone_device="cpu",
        codec_repo=CODEC_REPO,
        codec_device="cpu",
    )
    load_time = time.time() - load_t0
    checkpoint(f"Model loaded in {load_time:.1f}s", load_t0)
    monitor.stop()

    print(f"\n  ✅ Model loaded in {load_time:.1f}s")
    monitor.report("Model Loading")
    all_results["load_time_s"] = round(load_time, 2)

    # ── Phase 2: Warm-up (first inference is always slower) ──
    print(f"\n{'═' * 65}")
    print("  Phase 2: Warm-up Inference")
    print(f"{'═' * 65}")

    warmup_t0 = time.time()
    checkpoint("Running warm-up inference...", warmup_t0)
    monitor.reset()
    monitor.start()
    _ = tts.infer(text="xin chào", ref_audio=REF_AUDIO, ref_text=REF_TEXT)
    warmup_time = time.time() - warmup_t0
    monitor.stop()

    print(f"  ✅ Warm-up done in {warmup_time:.2f}s")
    checkpoint("Warm-up complete", warmup_t0)
    monitor.report("Warm-up")
    all_results["warmup_s"] = round(warmup_time, 2)

    # ── Phase 3: Single Inference (varying text lengths) ──
    print(f"\n{'═' * 65}")
    print("  Phase 3: Single Inference — Varying Text Lengths")
    print(f"{'═' * 65}")

    inference_results = {}
    for label, text in TEST_TEXTS.items():
        print(f"\n  📝 [{label.upper()}] ({len(text)} chars): \"{text[:60]}...\"")
        r = bench_single_inference(tts, text, label, monitor)
        inference_results[label] = r
        print(f"  ⏱  Time: {r['elapsed_s']:.2f}s")
        print(f"  🎵 Audio: {r['audio_dur_s']:.1f}s ({r['audio_samples']} samples)")
        print(f"  ⚡ RTF: {r['rtf']:.2f}x (real-time factor)")
        print(f"  📊 Throughput: {r['chars_per_sec']:.1f} chars/sec")
        monitor.report(f"Inference [{label}]")

    all_results["single_inference"] = inference_results

    # ── Phase 4: Streaming Inference ──
    print(f"\n{'═' * 65}")
    print("  Phase 4: Streaming Inference — First-Chunk Latency")
    print(f"{'═' * 65}")

    stream_results = {}
    for label, text in TEST_TEXTS.items():
        print(f"\n  📝 [{label.upper()}] ({len(text)} chars): \"{text[:60]}...\"")
        r = bench_streaming(tts, text, label, monitor)
        stream_results[label] = r
        print(f"  ⏱  Total: {r['total_s']:.2f}s")
        first = r['first_chunk_s']
        print(f"  🚀 First chunk: {first:.3f}s" if first else "  🚀 First chunk: N/A")
        print(f"  📦 Chunks: {r['num_chunks']}")
        print(f"  🎵 Audio: {r['audio_dur_s']:.1f}s")
        print(f"  ⚡ RTF: {r['rtf']:.2f}x")
        monitor.report(f"Streaming [{label}]")

    all_results["streaming"] = stream_results

    # ── Phase 5: Batch Throughput ──
    print(f"\n{'═' * 65}")
    print(f"  Phase 5: Batch Throughput — {BATCH_ITERATIONS} Iterations")
    print(f"{'═' * 65}")

    batch_text = TEST_TEXTS["medium"]
    print(f"  📝 Text: \"{batch_text[:60]}...\"")
    r = bench_batch_throughput(tts, batch_text, BATCH_ITERATIONS, monitor)
    print(f"\n  📊 Batch Results:")
    print(f"  ⏱  Total: {r['total_s']:.2f}s for {r['iterations']} iterations")
    print(f"  ⏱  Avg: {r['avg_time_s']:.2f}s  |  Median: {r['median_time_s']:.2f}s")
    print(f"  ⏱  Min: {r['min_time_s']:.2f}s  |  Max: {r['max_time_s']:.2f}s")
    if r['stdev_s'] > 0:
        print(f"  📊 Stdev: {r['stdev_s']:.3f}s")
    print(f"  ⚡ Avg RTF: {r['avg_rtf']:.2f}x")
    monitor.report("Batch Throughput")
    all_results["batch_throughput"] = r

    # ── Phase 6: Concurrent Stress Test ──
    print(f"\n{'═' * 65}")
    print(f"  Phase 6: Concurrent Stress Test — {CONCURRENT_THREADS} Threads")
    print(f"{'═' * 65}")

    concurrent_text = TEST_TEXTS["short"]
    print(f"  📝 Text: \"{concurrent_text}\"")
    print(f"  🔄 Threads: {CONCURRENT_THREADS}")
    r = bench_concurrent(tts, concurrent_text, CONCURRENT_THREADS, monitor)
    print(f"\n  📊 Concurrent Results:")
    print(f"  ⏱  Wall time: {r['total_wall_time_s']:.2f}s")
    print(f"  ✅ Completed: {r['completed']}/{r['n_threads']}")
    if r['failed'] > 0:
        print(f"  ❌ Failed: {r['failed']}")
        for err in r['errors']:
            print(f"     Error: {err}")
    if r['per_thread']:
        for t_result in r['per_thread']:
            print(f"     Thread {t_result['thread']}: {t_result['elapsed_s']:.2f}s (RTF={t_result['rtf']:.2f}x)")
    monitor.report("Concurrent Stress")
    all_results["concurrent"] = r

    # ── Summary ──
    print(f"\n{'═' * 65}")
    print("  📈 BENCHMARK SUMMARY")
    print(f"{'═' * 65}")

    print(f"\n  🖥️  Mode: CPU-Only (GGUF backbone)")
    print(f"  📦 Model: {GGUF_MODEL}")
    print(f"  ⏱  Load Time: {all_results['load_time_s']:.1f}s")
    print(f"  🔥 Warm-up: {all_results['warmup_s']:.1f}s")

    print(f"\n  {'─' * 60}")
    print(f"  {'Text':<10} {'Chars':<7} {'Infer(s)':<10} {'Audio(s)':<10} {'RTF':<8} {'Chr/s':<8}")
    print(f"  {'─' * 60}")
    for label, r in inference_results.items():
        print(f"  {label:<10} {r['text_len']:<7} {r['elapsed_s']:<10.2f} {r['audio_dur_s']:<10.1f} {r['rtf']:<8.2f} {r['chars_per_sec']:<8.1f}")
    print(f"  {'─' * 60}")

    print(f"\n  🔗 Streaming First-Chunk Latency:")
    for label, r in stream_results.items():
        fcl = r['first_chunk_s']
        print(f"     {label:<10} → {fcl:.3f}s" if fcl else f"     {label:<10} → N/A")

    print(f"\n  📊 Batch ({BATCH_ITERATIONS}x): avg {all_results['batch_throughput']['avg_time_s']:.2f}s  |  RTF {all_results['batch_throughput']['avg_rtf']:.2f}x")

    # Final system resources
    print(f"\n  📊 Final System State:")
    proc = psutil.Process(os.getpid())
    print(f"  🖥️  CPU: {psutil.cpu_percent(interval=0.5):.1f}%")
    mem = psutil.virtual_memory()
    print(f"  🧠 RAM: {mem.used / (1024**3):.1f} / {mem.total / (1024**3):.1f} GB ({mem.percent}%)")
    print(f"  🔧 Process RAM: {proc.memory_info().rss / (1024**2):.0f} MB")

    # Save JSON report
    report_path = str(OUTPUT_DIR / f"benchmark_cpu_{datetime.datetime.now().strftime('%Y%m%d_%H%M%S')}.json")
    with open(report_path, "w", encoding="utf-8") as f:
        json.dump(all_results, f, indent=2, ensure_ascii=False, default=str)
    print(f"\n  💾 Report saved: {report_path}")

    print(f"\n{'═' * 65}")
    print("  ✅ Benchmark Complete!")
    print(f"{'═' * 65}")

    # Cleanup
    tts.close()


if __name__ == "__main__":
    main()
