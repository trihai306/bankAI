#!/usr/bin/env python3
"""Regenerate voices.json using the CORRECT merged model + distill-neucodec.
This fixes codec mismatch that causes bad voice quality."""
import sys, os, json
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "VieNeu-TTS", "src"))
os.environ["PYTHONUTF8"] = "1"
from pathlib import Path

VIENEU_DIR = Path(__file__).parent / "VieNeu-TTS"
BACKBONE_PATH = str(VIENEU_DIR / "finetune" / "output" / "merged_model")
CODEC_REPO = "neuphonic/distill-neucodec"
VOICES_JSON_PATH = VIENEU_DIR / "finetune" / "output" / "merged_model" / "voices.json"
REF_AUDIO = str(VIENEU_DIR / "finetune" / "dataset" / "raw_audio" / "0001_voice.wav")

# Read transcript from metadata
import csv
metadata_path = VIENEU_DIR / "finetune" / "dataset" / "metadata_cleaned.csv"
ref_text = ""
with open(metadata_path, "r", encoding="utf-8") as f:
    reader = csv.reader(f, delimiter="|")
    for row in reader:
        if row[0] == "0001_voice.wav":
            ref_text = row[1].strip()
            break

print(f"Reference audio: {REF_AUDIO}")
print(f"Reference text: {ref_text}")
print(f"Output: {VOICES_JSON_PATH}")

print("\nLoading merged model with distill-neucodec (same as server)...")
from vieneu import Vieneu

tts = Vieneu(
    mode="standard",
    backbone_repo=BACKBONE_PATH,
    backbone_device="cpu",
    codec_repo=CODEC_REPO,
    codec_device="cpu",
)

print("Encoding reference audio with CORRECT codec...")
ref_codes = tts.encode_reference(REF_AUDIO)
codes_list = ref_codes.cpu().numpy().flatten().tolist()
print(f"Encoded: {len(codes_list)} codes")

voices_data = {
    "meta": {
        "spec": "vieneu.voice.presets",
        "spec_version": "1.0",
        "engine": "VieNeu-TTS",
        "codec": "distill-neucodec",
        "backbone": "merged_model (VieNeu-TTS-0.3B + LoRA)",
    },
    "default_voice": "lora_voice",
    "presets": {
        "lora_voice": {
            "codes": codes_list,
            "text": ref_text,
            "description": "Fine-tuned LoRA voice (distill-neucodec encoded)",
        }
    }
}

with open(VOICES_JSON_PATH, "w", encoding="utf-8") as f:
    json.dump(voices_data, f, ensure_ascii=False, indent=2)

print(f"\n✅ voices.json regenerated at {VOICES_JSON_PATH}")
print(f"   Codec: distill-neucodec (matches server)")
print(f"   Codes: {len(codes_list)} values")
print(f"   Default voice: lora_voice")
