#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Test TTS Pipeline — simulate app flow with long multi-sentence text.

Mirrors the exact flow used by voice-engine.js:
  1. Split text into sentences (same SENTENCE_DELIMITERS regex)
  2. Call POST /generate (response_format=wav) for each sentence
  3. Concurrency limit = 2 (same as MAX_TTS_CONCURRENT in app)
  4. Collect WAV chunks, check for duplicates, merge into final audio

Usage:
    cd python
    .\\VieNeu-TTS\\.venv\\Scripts\\python.exe test_tts_pipeline.py
"""

import os
import sys
import time
import json
import hashlib
import re
import struct
import urllib.request
import urllib.error
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

# === CONFIG ===
TTS_SERVER_URL = "http://127.0.0.1:8179"
MAX_CONCURRENT = 2  # same as MAX_TTS_CONCURRENT in voice-engine.js
OUTPUT_DIR = Path(__file__).parent / "test_tts_output"

# Same sentence delimiters as voice-engine.js
SENTENCE_DELIMITERS = re.compile(r'[.!?;。！？\n]')

# Long multi-paragraph test text (Vietnamese banking context)
TEST_TEXT = """Xin chào quý khách. Tôi là trợ lý AI ngân hàng, rất vui được hỗ trợ bạn hôm nay.

Về dịch vụ tiết kiệm, ngân hàng chúng tôi hiện đang có nhiều gói tiết kiệm hấp dẫn. Gói tiết kiệm linh hoạt cho phép bạn gửi từ một triệu đồng trở lên với lãi suất cạnh tranh. Bạn có thể rút tiền bất kỳ lúc nào mà không bị phạt.

Đối với dịch vụ chuyển tiền quốc tế, chúng tôi hỗ trợ chuyển tiền đến hơn năm mươi quốc gia trên toàn thế giới. Phí chuyển tiền được tính theo biểu phí hiện hành và thường thấp hơn so với các ngân hàng khác.

Nếu bạn quan tâm đến thẻ tín dụng, chúng tôi có nhiều loại thẻ phù hợp với nhu cầu khác nhau. Thẻ Visa Platinum có hạn mức cao và nhiều ưu đãi hoàn tiền. Thẻ Mastercard Gold phù hợp với chi tiêu hàng ngày với phí thường niên thấp.

Bạn cần tôi tư vấn thêm về dịch vụ nào không?"""


def split_into_sentences(text: str) -> list:
    """Split text using same regex as voice-engine.js SENTENCE_DELIMITERS."""
    sentences = []
    buffer = ""

    for char in text:
        buffer += char
        if SENTENCE_DELIMITERS.match(char):
            trimmed = buffer.strip()
            if trimmed and len(trimmed) >= 2:
                sentences.append(trimmed)
            buffer = ""

    # Flush remaining
    trimmed = buffer.strip()
    if trimmed and len(trimmed) >= 2:
        sentences.append(trimmed)

    return sentences


def wav_duration_sec(wav_bytes: bytes) -> float:
    """Calculate WAV duration in seconds from raw bytes."""
    if len(wav_bytes) < 44:
        return 0.0
    sample_rate = struct.unpack_from("<I", wav_bytes, 24)[0]
    data_size = struct.unpack_from("<I", wav_bytes, 40)[0]
    bits_per_sample = struct.unpack_from("<H", wav_bytes, 34)[0]
    channels = struct.unpack_from("<H", wav_bytes, 22)[0]
    if sample_rate == 0 or bits_per_sample == 0 or channels == 0:
        return 0.0
    bytes_per_sample = bits_per_sample // 8
    num_samples = data_size // (bytes_per_sample * channels)
    return num_samples / sample_rate


def generate_wav(sentence: str, idx: int, ref_audio: str = "", ref_text: str = "") -> dict:
    """Call TTS server /generate endpoint with wav format (same as app flow)."""
    payload = json.dumps({
        "gen_text": sentence,
        "ref_audio": ref_audio,
        "ref_text": ref_text,
        "speed": 1.0,
        "response_format": "wav",
    }).encode("utf-8")

    req = urllib.request.Request(
        f"{TTS_SERVER_URL}/generate",
        data=payload,
        headers={
            "Content-Type": "application/json; charset=utf-8",
        },
        method="POST",
    )

    start = time.time()
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            content_type = resp.headers.get("Content-Type", "")
            duration = time.time() - start

            if "audio/wav" in content_type:
                wav_bytes = resp.read()
                timings_header = resp.headers.get("X-TTS-Timings", "{}")
                server_timings = json.loads(timings_header)

                return {
                    "idx": idx,
                    "success": True,
                    "wav_bytes": wav_bytes,
                    "wav_size": len(wav_bytes),
                    "wav_hash": hashlib.md5(wav_bytes).hexdigest(),
                    "wav_duration_sec": wav_duration_sec(wav_bytes),
                    "request_duration": round(duration, 2),
                    "server_timings": server_timings,
                    "sentence": sentence[:60],
                }
            else:
                body = resp.read().decode("utf-8", errors="replace")
                return {
                    "idx": idx,
                    "success": False,
                    "error": f"Expected audio/wav, got {content_type}: {body[:200]}",
                    "duration": time.time() - start,
                }
    except Exception as e:
        return {
            "idx": idx,
            "success": False,
            "error": str(e),
            "duration": time.time() - start,
        }


def merge_wav_chunks(wav_bytes_list: list, output_path: Path):
    """Merge multiple WAV files into one (assume same format: PCM 16-bit mono 24kHz)."""
    if not wav_bytes_list:
        return

    first = wav_bytes_list[0]
    sample_rate = struct.unpack_from("<I", first, 24)[0]
    bits_per_sample = struct.unpack_from("<H", first, 34)[0]
    channels = struct.unpack_from("<H", first, 22)[0]

    all_pcm = b""
    for wav in wav_bytes_list:
        if len(wav) > 44:
            all_pcm += wav[44:]

    data_size = len(all_pcm)
    with open(output_path, "wb") as f:
        f.write(b"RIFF")
        f.write(struct.pack("<I", 36 + data_size))
        f.write(b"WAVE")
        f.write(b"fmt ")
        f.write(struct.pack("<I", 16))
        f.write(struct.pack("<H", 1))  # PCM
        f.write(struct.pack("<H", channels))
        f.write(struct.pack("<I", sample_rate))
        f.write(struct.pack("<I", sample_rate * channels * (bits_per_sample // 8)))
        f.write(struct.pack("<H", channels * (bits_per_sample // 8)))
        f.write(struct.pack("<H", bits_per_sample))
        f.write(b"data")
        f.write(struct.pack("<I", data_size))
        f.write(all_pcm)

    print(f"  Merged WAV: {output_path.name} ({data_size} bytes PCM, {data_size / (sample_rate * channels * bits_per_sample // 8):.1f}s)")


def run_pipeline():
    """Simulate voice-engine.js streaming pipeline with concurrency-limited TTS."""
    print("=" * 70)
    print("  🧪 TTS Pipeline Test — Simulating App Flow")
    print("=" * 70)

    # Step 1: Check health
    print("\n[1/4] Checking TTS server health...")
    try:
        with urllib.request.urlopen(f"{TTS_SERVER_URL}/health", timeout=5) as resp:
            health = json.loads(resp.read().decode())
            print(f"  Status: {health.get('status')}")
            print(f"  Mode: {health.get('mode')}")
            print(f"  Device: {health.get('device')} (codec: {health.get('codec_device')})")
            if health.get("status") != "ready":
                print("  ❌ Server not ready! Aborting.")
                return
    except Exception as e:
        print(f"  ❌ Cannot reach TTS server: {e}")
        print(f"  Make sure the server is running on {TTS_SERVER_URL}")
        return

    # Step 2: Split text into sentences (same as voice-engine.js)
    print(f"\n[2/4] Splitting text into sentences...")
    sentences = split_into_sentences(TEST_TEXT)
    print(f"  Total sentences: {len(sentences)}")
    for i, s in enumerate(sentences):
        print(f"  [{i:>2}] \"{s[:70]}{'...' if len(s) > 70 else ''}\"")

    # Step 3: Generate TTS with concurrency limit (same as app)
    print(f"\n[3/4] Generating TTS (concurrency={MAX_CONCURRENT}, same as app)...")
    print(f"  Server serializes via _inference_lock anyway, but this tests the HTTP pipeline.\n")
    pipeline_start = time.time()

    results = [None] * len(sentences)

    with ThreadPoolExecutor(max_workers=MAX_CONCURRENT) as executor:
        futures = {}
        for idx, sentence in enumerate(sentences):
            future = executor.submit(generate_wav, sentence, idx)
            futures[future] = idx

        for future in as_completed(futures):
            idx = futures[future]
            result = future.result()
            results[idx] = result
            if result["success"]:
                print(f"  ✅ Chunk {idx:>2} DONE: {result['request_duration']:>6.2f}s, "
                      f"{result['wav_size']:>8} bytes, audio={result['wav_duration_sec']:.1f}s, "
                      f"hash={result['wav_hash'][:8]}")
            else:
                print(f"  ❌ Chunk {idx:>2} FAILED: {result.get('error', 'unknown')[:80]}")

    pipeline_duration = time.time() - pipeline_start

    # Step 4: Analyze results
    print(f"\n[4/4] Analyzing results...")
    OUTPUT_DIR.mkdir(exist_ok=True)

    successful = [r for r in results if r and r["success"]]
    failed = [r for r in results if r and not r["success"]]

    # Check for duplicates by hash
    hash_map = {}
    duplicates = []
    for r in successful:
        h = r["wav_hash"]
        if h in hash_map:
            duplicates.append((hash_map[h], r["idx"]))
        else:
            hash_map[h] = r["idx"]

    # Save individual chunks
    for r in successful:
        chunk_path = OUTPUT_DIR / f"chunk_{r['idx']:02d}.wav"
        with open(chunk_path, "wb") as f:
            f.write(r["wav_bytes"])

    # Merge all chunks into single WAV
    if successful:
        sorted_wavs = [r["wav_bytes"] for r in sorted(successful, key=lambda x: x["idx"])]
        merge_wav_chunks(sorted_wavs, OUTPUT_DIR / "merged_output.wav")

    # Print summary
    print("\n" + "=" * 70)
    print("  📊 Pipeline Test Results")
    print("=" * 70)
    print(f"\n  Sentences:     {len(sentences)}")
    print(f"  Successful:    {len(successful)}")
    print(f"  Failed:        {len(failed)}")
    print(f"  Pipeline time: {pipeline_duration:.2f}s")
    print(f"  Concurrency:   {MAX_CONCURRENT}")

    if duplicates:
        print(f"\n  ⚠️  DUPLICATE AUDIO DETECTED ({len(duplicates)} pairs):")
        for orig, dup in duplicates:
            print(f"    Chunk {orig} == Chunk {dup} (identical audio!)")
    else:
        print(f"\n  ✅ No duplicate audio detected")

    # Check for similar-size chunks that might indicate replay
    print(f"\n  Size similarity analysis (detecting potential replays):")
    if len(successful) >= 2:
        for i in range(len(successful)):
            for j in range(i + 1, len(successful)):
                ri, rj = successful[i], successful[j]
                size_ratio = min(ri["wav_size"], rj["wav_size"]) / max(ri["wav_size"], rj["wav_size"])
                if size_ratio > 0.95 and ri["wav_hash"] != rj["wav_hash"]:
                    print(f"    ⚠️  Chunk {ri['idx']} ({ri['wav_size']}B) ≈ Chunk {rj['idx']} ({rj['wav_size']}B) "
                          f"— {size_ratio:.1%} similar size (different content)")

    print(f"\n  {'─' * 66}")
    print(f"  {'Chunk':>5} │ {'TTS Time':>8} │ {'Wav Size':>10} │ {'Audio':>6} │ {'Hash':>8} │ Text")
    print(f"  {'─' * 66}")
    for r in sorted(successful, key=lambda x: x["idx"]):
        print(f"  {r['idx']:>5} │ {r['request_duration']:>7.2f}s │ {r['wav_size']:>9} B │ "
              f"{r['wav_duration_sec']:>5.1f}s │ {r['wav_hash'][:8]} │ {r['sentence'][:30]}")

    if failed:
        print(f"\n  Failed chunks:")
        for r in failed:
            print(f"    Chunk {r['idx']}: {r.get('error', 'unknown')[:80]}")

    total_audio_sec = sum(r["wav_duration_sec"] for r in successful)
    print(f"\n  Total audio duration: {total_audio_sec:.1f}s")
    print(f"  Output saved to: {OUTPUT_DIR}")
    print(f"\n  ▶ Play merged:   start \"{OUTPUT_DIR / 'merged_output.wav'}\"")
    print(f"  ▶ Play chunk N:  start \"{OUTPUT_DIR / 'chunk_00.wav'}\"")
    print("=" * 70)


if __name__ == "__main__":
    run_pipeline()
