#!/usr/bin/env python3
"""
F5-TTS Vietnamese CLI
Sử dụng: python f5_tts.py --ref-audio ref.wav --ref-text "text" --gen-text "text to generate" --output out.wav

Cài đặt:
    git clone https://github.com/nguyenthienhy/F5-TTS-Vietnamese
    cd F5-TTS-Vietnamese && pip install -e .
    git lfs install
    git clone https://huggingface.co/hynt/F5-TTS-Vietnamese-ViVoice
"""

import os
import sys
import json
import time
import shutil
import argparse
import subprocess
import platform
from pathlib import Path

# Đường dẫn mặc định
SCRIPT_DIR = Path(__file__).parent.absolute()
MODEL_DIR = SCRIPT_DIR / "F5-TTS-Vietnamese-ViVoice"
OUTPUT_DIR = SCRIPT_DIR / "outputs"

VOCAB_FILE = MODEL_DIR / "vocab.txt"
CKPT_FILE = MODEL_DIR / "model_last.pt"

# Cross-platform venv paths
IS_WINDOWS = platform.system() == "Windows"
VENV_BIN = SCRIPT_DIR / "venv" / ("Scripts" if IS_WINDOWS else "bin")


def check_gpu():
    """Kiểm tra GPU/CUDA availability - F5-TTS chỉ hỗ trợ GPU"""
    try:
        import torch
        cuda_available = torch.cuda.is_available()
        gpu_name = torch.cuda.get_device_name(0) if cuda_available else None
        gpu_count = torch.cuda.device_count() if cuda_available else 0
        return {
            "cuda_available": cuda_available,
            "gpu_name": gpu_name,
            "gpu_count": gpu_count,
            "torch_version": torch.__version__,
            "cuda_version": torch.version.cuda if cuda_available else None,
        }
    except ImportError:
        return {
            "cuda_available": False,
            "gpu_name": None,
            "gpu_count": 0,
            "torch_version": None,
            "cuda_version": None,
            "error": "PyTorch not installed"
        }
    except Exception as e:
        return {
            "cuda_available": False,
            "gpu_name": None,
            "gpu_count": 0,
            "error": str(e)
        }


def check_installation():
    """Kiểm tra F5-TTS đã cài đặt chưa"""
    cli_name = "f5-tts_infer-cli.exe" if IS_WINDOWS else "f5-tts_infer-cli"
    venv_cli = VENV_BIN / cli_name
    cli_available = venv_cli.exists()
    gpu_info = check_gpu()
    
    return {
        "model_exists": CKPT_FILE.exists(),
        "vocab_exists": VOCAB_FILE.exists(),
        "cli_available": cli_available,
        "model_dir": str(MODEL_DIR),
        "gpu": gpu_info,
        "gpu_only": True,
        "ready": CKPT_FILE.exists() and VOCAB_FILE.exists() and cli_available and gpu_info["cuda_available"]
    }


def install_f5tts():
    """Cài đặt F5-TTS và tải model"""
    print(json.dumps({"status": "installing", "step": "clone_repo"}))
    
    f5_dir = SCRIPT_DIR / "F5-TTS-Vietnamese"
    if not f5_dir.exists():
        subprocess.run([
            "git", "clone", 
            "https://github.com/nguyenthienhy/F5-TTS-Vietnamese",
            str(f5_dir)
        ], check=True)
    
    print(json.dumps({"status": "installing", "step": "pip_install"}))
    subprocess.run([
        sys.executable, "-m", "pip", "install", "-e", str(f5_dir)
    ], check=True)
    
    print(json.dumps({"status": "installing", "step": "download_model"}))
    if not MODEL_DIR.exists():
        subprocess.run(["git", "lfs", "install"], check=True)
        subprocess.run([
            "git", "clone",
            "https://huggingface.co/hynt/F5-TTS-Vietnamese-ViVoice",
            str(MODEL_DIR)
        ], check=True)
    
    print(json.dumps({"status": "complete", "ready": True}))


def generate(ref_audio: str, ref_text: str, gen_text: str, output: str = None, speed: float = 1.0):
    """Tạo giọng nói với F5-TTS"""
    
    # Kiểm tra model
    status = check_installation()
    if not status["ready"]:
        if not status.get("gpu", {}).get("cuda_available", False):
            print(json.dumps({
                "error": "F5-TTS yêu cầu NVIDIA GPU với CUDA. Không phát hiện GPU khả dụng.",
                "gpu_required": True,
                "status": status
            }))
        else:
            print(json.dumps({"error": "F5-TTS chưa được cài đặt", "status": status}))
        sys.exit(1)
    
    # Tạo output path
    OUTPUT_DIR.mkdir(exist_ok=True)
    if output is None:
        output = str(OUTPUT_DIR / f"generated_{int(time.time() * 1000)}.wav")
    
    output_dir = Path(output).parent
    output_file = Path(output).name
    
    # Chạy f5-tts_infer-cli from venv (cross-platform)
    cli_name = "f5-tts_infer-cli.exe" if IS_WINDOWS else "f5-tts_infer-cli"
    venv_cli = VENV_BIN / cli_name
    cmd = [
        str(venv_cli),
        "--model", "F5TTS_Base",
        "--ref_audio", ref_audio,
        "--ref_text", ref_text,
        "--gen_text", gen_text,
        "--vocoder_name", "vocos",
        "--vocab_file", str(VOCAB_FILE),
        "--ckpt_file", str(CKPT_FILE),
        "--output_dir", str(output_dir),
    ]
    
    # Log command for debugging
    print(f"DEBUG: Running command: {' '.join(cmd)}", file=sys.stderr)
    
    # Force UTF-8 encoding and GPU mode for subprocess
    env = os.environ.copy()
    env["PYTHONUTF8"] = "1"
    env["PYTHONIOENCODING"] = "utf-8"
    # Ensure GPU is used (CUDA device 0)
    if "CUDA_VISIBLE_DEVICES" not in env or env["CUDA_VISIBLE_DEVICES"] == "":
        env["CUDA_VISIBLE_DEVICES"] = "0"
    
    result = subprocess.run(cmd, capture_output=True, text=True, env=env, encoding="utf-8", errors="replace")
    
    # Log subprocess output for debugging
    print(f"DEBUG: Return code: {result.returncode}", file=sys.stderr)
    print(f"DEBUG: stdout: {result.stdout}", file=sys.stderr)
    print(f"DEBUG: stderr: {result.stderr}", file=sys.stderr)
    
    if result.returncode != 0:
        print(json.dumps({
            "success": False,
            "error": result.stderr or result.stdout
        }))
        sys.exit(1)
    
    # Tìm file output mới nhất
    output_files = sorted(output_dir.glob("*.wav"), key=lambda f: f.stat().st_mtime, reverse=True)
    if output_files:
        latest = output_files[0]
        if str(latest) != output:
            shutil.move(str(latest), output)
    
    print(json.dumps({
        "success": True,
        "output": output,
        "ref_audio": ref_audio,
        "gen_text": gen_text[:50]
    }))


def main():
    parser = argparse.ArgumentParser(description="F5-TTS Vietnamese CLI")
    subparsers = parser.add_subparsers(dest="command", help="Commands")
    
    # Check command
    check_parser = subparsers.add_parser("check", help="Kiểm tra cài đặt")
    
    # Install command  
    install_parser = subparsers.add_parser("install", help="Cài đặt F5-TTS")
    
    # Generate command
    gen_parser = subparsers.add_parser("generate", help="Tạo giọng nói")
    gen_parser.add_argument("--ref-audio", required=True, help="File audio mẫu (3-30s)")
    gen_parser.add_argument("--ref-text", required=True, help="Transcript của audio mẫu")
    gen_parser.add_argument("--gen-text", required=True, help="Văn bản cần tạo giọng")
    gen_parser.add_argument("--output", help="File output (mặc định: outputs/generated_xxx.wav)")
    gen_parser.add_argument("--speed", type=float, default=1.0, help="Tốc độ đọc (1.0 = bình thường)")
    
    args = parser.parse_args()
    
    if args.command == "check":
        status = check_installation()
        print(json.dumps(status))
    
    elif args.command == "install":
        install_f5tts()
    
    elif args.command == "generate":
        generate(
            ref_audio=args.ref_audio,
            ref_text=args.ref_text,
            gen_text=args.gen_text,
            output=args.output,
            speed=args.speed
        )
    
    else:
        parser.print_help()


if __name__ == "__main__":
    main()
