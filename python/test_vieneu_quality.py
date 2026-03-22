#!/usr/bin/env python3
"""Test audio quality: compare soundfile WAV vs manual WAV encoding (server uses manual)."""
import sys, os, time, struct, io
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "VieNeu-TTS", "src"))
os.environ["PYTHONUTF8"] = "1"
from pathlib import Path
import numpy as np
import soundfile as sf

VIENEU_DIR = Path(__file__).parent / "VieNeu-TTS"
BACKBONE_PATH = str(VIENEU_DIR / "finetune" / "output" / "merged_model")
CODEC_REPO = "neuphonic/distill-neucodec"
OUTPUT_DIR = Path(__file__).parent / "outputs"
OUTPUT_DIR.mkdir(exist_ok=True)
SAMPLE_RATE = 24000

TEST_TEXT = "Xin chào, tôi là trợ lý AI ngân hàng. Tôi có thể giúp gì cho bạn?"

def encode_wav_bytes_server_style(audio_data, sample_rate):
    """Same as server's encode_wav_bytes — PCM 16-bit mono."""
    if audio_data.dtype == np.float32 or audio_data.dtype == np.float64:
        audio_int16 = np.clip(audio_data * 32767, -32768, 32767).astype(np.int16)
    else:
        audio_int16 = audio_data.astype(np.int16)
    buf = io.BytesIO()
    num_samples = len(audio_int16)
    data_size = num_samples * 2
    buf.write(b"RIFF")
    buf.write(struct.pack("<I", 36 + data_size))
    buf.write(b"WAVE")
    buf.write(b"fmt ")
    buf.write(struct.pack("<I", 16))
    buf.write(struct.pack("<H", 1))
    buf.write(struct.pack("<H", 1))
    buf.write(struct.pack("<I", sample_rate))
    buf.write(struct.pack("<I", sample_rate * 2))
    buf.write(struct.pack("<H", 2))
    buf.write(struct.pack("<H", 16))
    buf.write(b"data")
    buf.write(struct.pack("<I", data_size))
    buf.write(audio_int16.tobytes())
    return buf.getvalue()

print("=" * 60)
print("  VieNeu-TTS Audio Quality Comparison")
print("=" * 60)

print("\nLoading model...")
from vieneu import Vieneu
tts = Vieneu(mode="standard", backbone_repo=BACKBONE_PATH, backbone_device="cpu", codec_repo=CODEC_REPO, codec_device="cpu")
voices = tts.list_preset_voices()
print(f"Voices: {voices}")

# Generate audio
print(f"\nGenerating: '{TEST_TEXT}'")
t0 = time.time()
audio = tts.infer(text=TEST_TEXT)
gen_time = time.time() - t0

print(f"Generated in {gen_time:.2f}s")
print(f"Audio: shape={audio.shape}, dtype={audio.dtype}")
print(f"Range: min={audio.min():.6f}, max={audio.max():.6f}, mean={audio.mean():.6f}")
print(f"Non-zero samples: {np.count_nonzero(audio)}/{len(audio)} ({100*np.count_nonzero(audio)/len(audio):.1f}%)")

# Save with soundfile (high quality reference)
out_sf = str(OUTPUT_DIR / "test_soundfile.wav")
sf.write(out_sf, audio, SAMPLE_RATE)
print(f"\n1) Soundfile WAV: {out_sf} ({os.path.getsize(out_sf):,} bytes)")

# Save with server-style encoding (what Electron app receives)
wav_bytes = encode_wav_bytes_server_style(audio, SAMPLE_RATE)
out_server = str(OUTPUT_DIR / "test_server_style.wav")
with open(out_server, "wb") as f:
    f.write(wav_bytes)
print(f"2) Server-style WAV: {out_server} ({len(wav_bytes):,} bytes)")

# Verify server-style WAV is valid
try:
    audio_back, sr = sf.read(out_server)
    print(f"   Readback: shape={audio_back.shape}, sr={sr}, range=[{audio_back.min():.6f}, {audio_back.max():.6f}]")
    diff = np.abs(audio.astype(np.float64) - audio_back.astype(np.float64))
    print(f"   Max diff vs original: {diff.max():.8f} (should be < 0.001 for PCM16)")
except Exception as e:
    print(f"   ERROR reading back: {e}")

print(f"\n{'='*60}")
print(f"  Files to compare in: {OUTPUT_DIR}")
print(f"  Listen to both and compare quality!")
print(f"{'='*60}")
