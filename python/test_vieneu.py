#!/usr/bin/env python3
"""Quick test: load merged model and generate audio."""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "VieNeu-TTS", "src"))
os.environ["PYTHONUTF8"] = "1"
from pathlib import Path

VIENEU_DIR = Path(__file__).parent / "VieNeu-TTS"
BACKBONE_PATH = str(VIENEU_DIR / "finetune" / "output" / "merged_model")
CODEC_REPO = "neuphonic/distill-neucodec"

print(f"[TEST] Backbone path: {BACKBONE_PATH}")
print(f"[TEST] Path exists: {os.path.isdir(BACKBONE_PATH)}")
print(f"[TEST] voices.json exists: {os.path.isfile(os.path.join(BACKBONE_PATH, 'voices.json'))}")
print(f"[TEST] Files: {os.listdir(BACKBONE_PATH)}")

print("\n[TEST] Importing Vieneu...")
from vieneu import Vieneu

print("[TEST] Creating TTS instance (merged model)...")
tts = Vieneu(
    mode="standard",
    backbone_repo=BACKBONE_PATH,
    backbone_device="cpu",
    codec_repo=CODEC_REPO,
    codec_device="cpu",
)
print("[TEST] Model loaded!")

# Check voices
voices = tts.list_preset_voices()
print(f"[TEST] Preset voices: {voices}")

if voices:
    if isinstance(voices[0], tuple):
        _, vid = voices[0]
    else:
        vid = voices[0]
    voice_data = tts.get_preset_voice(vid)
    print(f"[TEST] Default voice codes type: {type(voice_data.get('codes'))}")
    print(f"[TEST] Default voice text: {voice_data.get('text', '')[:50]}")

# Generate test
print("\n[TEST] Generating 'Xin chao' with default voice...")
try:
    audio = tts.infer(text="Xin chào")
    print(f"[TEST] SUCCESS! Audio shape: {audio.shape}, dtype: {audio.dtype}")
except Exception as e:
    print(f"[TEST] FAILED: {e}")
    import traceback
    traceback.print_exc()
