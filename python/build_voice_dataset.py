#!/usr/bin/env python3
"""
Build F5-TTS training dataset từ ref_audio + transcripts.
Tự động:
1. Đọc ref_audio/*.wav + _transcripts.json
2. Cắt audio dài thành đoạn 3-15s (theo khoảng lặng)
3. Tạo metadata.csv đúng format F5-TTS
4. Prepare dataset (arrow format)
5. Chạy finetune

Usage:
    python build_voice_dataset.py prepare   # Tạo dataset
    python build_voice_dataset.py train     # Finetune model
    python build_voice_dataset.py all       # Prepare + train
"""

import os
import sys
import json
import shutil
import logging
from pathlib import Path

logging.basicConfig(level=logging.INFO, format='%(message)s')
logger = logging.getLogger("build_dataset")

SCRIPT_DIR = Path(__file__).parent.absolute()
REF_AUDIO_DIR = SCRIPT_DIR / "ref_audio"
TRANSCRIPT_FILE = REF_AUDIO_DIR / "_transcripts.json"
DATASET_DIR = SCRIPT_DIR / "voice_dataset"
WAVS_DIR = DATASET_DIR / "wavs"
METADATA_FILE = DATASET_DIR / "metadata.csv"

F5_TTS_DIR = SCRIPT_DIR / "F5-TTS-Vietnamese"
CKPT_FILE = SCRIPT_DIR / "F5-TTS-Vietnamese-ViVoice" / "model_last.pt"
VOCAB_FILE = SCRIPT_DIR / "F5-TTS-Vietnamese-ViVoice" / "vocab.txt"


def load_transcripts():
    if TRANSCRIPT_FILE.exists():
        return json.loads(TRANSCRIPT_FILE.read_text(encoding="utf-8"))
    return {}


def split_audio_by_silence(audio_path, output_dir, min_dur=2.0, max_dur=15.0):
    """Cắt audio dài thành đoạn ngắn theo khoảng lặng."""
    try:
        from pydub import AudioSegment
        from pydub.silence import split_on_silence

        audio = AudioSegment.from_file(str(audio_path))
        # Resample to 24kHz mono
        audio = audio.set_frame_rate(24000).set_channels(1)

        total_dur = len(audio) / 1000  # seconds

        if total_dur <= max_dur:
            # Short enough, just copy
            out_path = output_dir / audio_path.name
            audio.export(str(out_path), format="wav")
            return [out_path]

        # Split on silence
        chunks = split_on_silence(
            audio,
            min_silence_len=500,  # 500ms silence
            silence_thresh=audio.dBFS - 16,
            keep_silence=200,
        )

        # Merge small chunks to reach min_dur
        merged = []
        current = AudioSegment.empty()
        for chunk in chunks:
            current += chunk
            if len(current) / 1000 >= min_dur:
                merged.append(current)
                current = AudioSegment.empty()
        if len(current) > 500:
            if merged:
                merged[-1] += current
            else:
                merged.append(current)

        # Export chunks
        result_paths = []
        stem = audio_path.stem
        for i, chunk in enumerate(merged):
            dur = len(chunk) / 1000
            if dur < 0.5 or dur > 30:
                continue
            out_path = output_dir / f"{stem}_chunk{i:03d}.wav"
            chunk.export(str(out_path), format="wav")
            result_paths.append(out_path)

        return result_paths

    except Exception as e:
        logger.error(f"Error splitting {audio_path}: {e}")
        # Fallback: just copy
        out_path = output_dir / audio_path.name
        shutil.copy2(str(audio_path), str(out_path))
        return [out_path]


def prepare_dataset():
    """Tạo dataset từ ref_audio + transcripts."""
    logger.info("=" * 50)
    logger.info("  Building Voice Dataset for F5-TTS")
    logger.info("=" * 50)

    transcripts = load_transcripts()
    if not transcripts:
        logger.error("Không có transcripts! Vào Voice Training → nhập transcript cho mỗi audio trước.")
        return False

    # Create dirs
    DATASET_DIR.mkdir(exist_ok=True)
    WAVS_DIR.mkdir(exist_ok=True)

    # Process each audio
    metadata = []
    for filename, transcript in transcripts.items():
        if not transcript.strip():
            continue

        audio_path = REF_AUDIO_DIR / filename
        if not audio_path.exists():
            logger.warning(f"  Skip {filename} - file not found")
            continue

        logger.info(f"  Processing: {filename}")
        logger.info(f"  Transcript: {transcript[:60]}...")

        # Split long audio
        chunks = split_audio_by_silence(audio_path, WAVS_DIR)

        if len(chunks) == 1:
            # Single file, use full transcript
            rel_path = f"wavs/{chunks[0].name}"
            metadata.append(f"{rel_path}|{transcript.strip()}")
        else:
            # Multiple chunks - split transcript by sentences
            sentences = [s.strip() for s in transcript.replace(".", ".\n").replace("!", "!\n").replace("?", "?\n").split("\n") if s.strip()]
            for i, chunk_path in enumerate(chunks):
                rel_path = f"wavs/{chunk_path.name}"
                # Assign transcript: round-robin if more chunks than sentences
                text = sentences[i % len(sentences)] if sentences else transcript
                metadata.append(f"{rel_path}|{text}")

    if not metadata:
        logger.error("Không có data hợp lệ để tạo dataset!")
        return False

    # Write metadata.csv
    with open(METADATA_FILE, "w", encoding="utf-8") as f:
        for line in metadata:
            f.write(line + "\n")

    logger.info(f"\nDataset created:")
    logger.info(f"  Dir: {DATASET_DIR}")
    logger.info(f"  Files: {len(metadata)} samples")
    logger.info(f"  Metadata: {METADATA_FILE}")

    # Prepare arrow format
    logger.info("\nPreparing arrow dataset...")
    try:
        venv_python = str(SCRIPT_DIR / "venv" / "bin" / "python")

        # Remove CWD from path to avoid f5_tts.py shadow
        env = os.environ.copy()
        script_dir_str = str(SCRIPT_DIR)
        py_path = env.get("PYTHONPATH", "")
        env["PYTHONPATH"] = str(F5_TTS_DIR / "src") + (":" + py_path if py_path else "")

        import subprocess
        processed_dir = DATASET_DIR / "processed"
        result = subprocess.run([
            venv_python,
            str(F5_TTS_DIR / "src" / "f5_tts" / "train" / "datasets" / "prepare_csv_wavs.py"),
            str(DATASET_DIR),
            str(processed_dir),
        ], capture_output=True, text=True, env=env)

        if result.returncode == 0:
            logger.info("Arrow dataset prepared successfully!")
        else:
            logger.warning(f"Arrow preparation warning: {result.stderr[-500:]}")
            logger.info("Dataset can still be used for basic finetune.")

    except Exception as e:
        logger.warning(f"Arrow prep skipped: {e}")

    return True


def train_model(epochs=50, lr=1e-5, batch_size=1600):
    """Finetune F5-TTS on custom dataset."""
    logger.info("=" * 50)
    logger.info("  Finetuning F5-TTS")
    logger.info("=" * 50)

    if not METADATA_FILE.exists():
        logger.error("Dataset chưa prepare! Chạy 'prepare' trước.")
        return False

    venv_python = str(SCRIPT_DIR / "venv" / "bin" / "python")
    finetune_script = str(F5_TTS_DIR / "src" / "f5_tts" / "train" / "finetune_cli.py")

    # Dataset name = folder name
    dataset_name = DATASET_DIR.name

    # Symlink dataset into F5-TTS data dir
    f5_data_dir = F5_TTS_DIR / "data" / dataset_name
    if not f5_data_dir.exists():
        processed = DATASET_DIR / "processed"
        if processed.exists():
            f5_data_dir.parent.mkdir(parents=True, exist_ok=True)
            os.symlink(str(processed), str(f5_data_dir))
        else:
            logger.error("Processed dataset not found. Run 'prepare' first.")
            return False

    env = os.environ.copy()
    env["PYTHONPATH"] = str(F5_TTS_DIR / "src")
    env["HF_HUB_OFFLINE"] = "1"

    import subprocess
    cmd = [
        venv_python, finetune_script,
        "--exp_name", "F5TTS_Base",
        "--dataset_name", dataset_name,
        "--batch_size_per_gpu", str(batch_size),
        "--batch_size_type", "frame",
        "--learning_rate", str(lr),
        "--epochs", str(epochs),
        "--num_warmup_updates", "100",
        "--save_per_updates", "500",
        "--last_per_updates", "500",
        "--finetune",
        "--pretrain", str(CKPT_FILE),
        "--tokenizer", "custom",
        "--tokenizer_path", str(VOCAB_FILE),
    ]

    logger.info(f"Command: {' '.join(cmd[-10:])}")
    logger.info(f"Epochs: {epochs}, LR: {lr}, Batch: {batch_size}")
    logger.info("Training started... (this may take 10-60 min on M1 Pro)")

    result = subprocess.run(cmd, env=env, cwd=str(F5_TTS_DIR))

    if result.returncode == 0:
        logger.info("Finetune completed!")
        # Find latest checkpoint
        ckpt_dir = F5_TTS_DIR / "ckpts" / dataset_name
        if ckpt_dir.exists():
            ckpts = sorted(ckpt_dir.glob("model_*.pt"), key=lambda p: p.stat().st_mtime, reverse=True)
            if ckpts:
                logger.info(f"Latest checkpoint: {ckpts[0]}")
                # Copy to easy location
                dest = SCRIPT_DIR / "finetuned_model.pt"
                shutil.copy2(str(ckpts[0]), str(dest))
                logger.info(f"Copied to: {dest}")
        return True
    else:
        logger.error("Finetune failed!")
        return False


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        return

    cmd = sys.argv[1]
    if cmd == "prepare":
        prepare_dataset()
    elif cmd == "train":
        epochs = int(sys.argv[2]) if len(sys.argv) > 2 else 50
        train_model(epochs=epochs)
    elif cmd == "all":
        if prepare_dataset():
            train_model()
    else:
        print(f"Unknown command: {cmd}")
        print(__doc__)


if __name__ == "__main__":
    main()
