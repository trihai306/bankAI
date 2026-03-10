#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Merge LoRA adapter into base model for FastVieNeuTTS (LMDeploy) compatibility.

FastVieNeuTTS (mode='fast') does NOT support runtime LoRA loading.
This script merges the LoRA weights into the base model and saves a
standalone merged model that LMDeploy can load directly.

Usage:
    cd c:/Users/Admin/Workspace/bankAI/python
    ../VieNeu-TTS/.venv/Scripts/python.exe merge_lora.py
"""

import sys
import time
from pathlib import Path

SCRIPT_DIR = Path(__file__).parent.absolute()
VIENEU_DIR = SCRIPT_DIR / "VieNeu-TTS"

# Add VieNeu-TTS to path
sys.path.insert(0, str(VIENEU_DIR / "src"))
sys.path.insert(0, str(VIENEU_DIR))

BASE_MODEL = "pnnbao-ump/VieNeu-TTS-0.3B"
LORA_PATH = str(VIENEU_DIR / "finetune" / "output" / "VieNeu-TTS-0.3B-LoRA")
MERGED_OUTPUT = str(VIENEU_DIR / "finetune" / "output" / "VieNeu-TTS-0.3B-Merged")


def main():
    import shutil
    import torch
    from transformers import AutoTokenizer, AutoModelForCausalLM
    from peft import PeftModel

    print("=" * 60)
    print("  🔀 Merge LoRA Adapter into Base Model")
    print("=" * 60)
    print(f"  Base model: {BASE_MODEL}")
    print(f"  LoRA path:  {LORA_PATH}")
    print(f"  Output:     {MERGED_OUTPUT}")
    print()

    # Step 1: Load base model
    print("⏳ Loading base model...", flush=True)
    t0 = time.time()
    tokenizer = AutoTokenizer.from_pretrained(BASE_MODEL)
    model = AutoModelForCausalLM.from_pretrained(BASE_MODEL)
    print(f"✅ Base model loaded in {time.time() - t0:.1f}s", flush=True)

    # Step 2: Load LoRA adapter
    print("⏳ Loading LoRA adapter...", flush=True)
    t0 = time.time()
    model = PeftModel.from_pretrained(model, LORA_PATH)
    print(f"✅ LoRA adapter loaded in {time.time() - t0:.1f}s", flush=True)

    # Step 3: Merge and unload
    print("⏳ Merging LoRA weights into base model...", flush=True)
    t0 = time.time()
    model = model.merge_and_unload()
    print(f"✅ Merge complete in {time.time() - t0:.1f}s", flush=True)

    # Step 4: Save merged model
    output_path = Path(MERGED_OUTPUT)
    output_path.mkdir(parents=True, exist_ok=True)

    print(f"⏳ Saving merged model to {MERGED_OUTPUT}...", flush=True)
    t0 = time.time()
    model.save_pretrained(MERGED_OUTPUT)
    tokenizer.save_pretrained(MERGED_OUTPUT)
    print(f"✅ Merged model saved in {time.time() - t0:.1f}s", flush=True)

    # Step 5: Copy voices.json from LoRA output if exists
    lora_voices = Path(LORA_PATH) / "voices.json"
    if lora_voices.exists():
        dest = output_path / "voices.json"
        shutil.copy2(str(lora_voices), str(dest))
        print(f"✅ Copied voices.json to merged model", flush=True)

    print()
    print("=" * 60)
    print("  ✅ MERGE COMPLETE")
    print(f"  Merged model: {MERGED_OUTPUT}")
    print("  You can now use mode='fast' with this merged model.")
    print("=" * 60)


if __name__ == "__main__":
    main()
