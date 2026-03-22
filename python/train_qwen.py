#!/usr/bin/env python3
"""
Train Qwen cho AIBank - Tạo model Ollama custom với kiến thức ngân hàng.

Usage:
    python train_qwen.py build    # Tạo Ollama model với system prompt
    python train_qwen.py test     # Test model với câu hỏi mẫu
"""

import os
import sys
import json
import subprocess
import logging
from pathlib import Path

logging.basicConfig(level=logging.INFO, format='%(message)s')
logger = logging.getLogger("train_qwen")

SCRIPT_DIR = Path(__file__).parent.absolute()
PROJECT_DIR = SCRIPT_DIR.parent
TRAINING_DIR = PROJECT_DIR / "training-data"
MODELFILE_TEMPLATE = SCRIPT_DIR / "Modelfile.template"
MODELFILE_OUTPUT = SCRIPT_DIR / "Modelfile"

MODEL_NAME = "aibank-qwen"
BASE_MODEL = "qwen:4b"


def load_training_data():
    """Load tất cả training data từ JSONL files."""
    samples = []
    for f in TRAINING_DIR.glob("*.jsonl"):
        with open(f, "r", encoding="utf-8") as fh:
            for line in fh:
                line = line.strip()
                if not line:
                    continue
                try:
                    data = json.loads(line)
                    samples.append(data)
                except json.JSONDecodeError:
                    continue
    logger.info(f"Loaded {len(samples)} samples from {len(list(TRAINING_DIR.glob('*.jsonl')))} JSONL files")
    return samples


def load_all_qa(samples):
    """Load TẤT CẢ Q&A từ training data - nhúng hết vào model."""
    qa_pairs = []
    seen = set()

    for s in samples:
        q = a = ""
        # ChatML format
        if "messages" in s:
            msgs = s["messages"]
            user = next((m for m in msgs if m["role"] == "user"), None)
            asst = next((m for m in msgs if m["role"] == "assistant"), None)
            if user and asst:
                q, a = user["content"].strip(), asst["content"].strip()
        # Instruction format
        elif "input" in s and "output" in s:
            q, a = s["input"].strip(), s["output"].strip()
        elif "question" in s and "answer" in s:
            q, a = s["question"].strip(), s["answer"].strip()

        if q and a and q not in seen:
            seen.add(q)
            qa_pairs.append((q, a))

    return qa_pairs


def build_few_shot_examples(samples, max_examples=None):
    """Nhúng TẤT CẢ Q&A vào system prompt - model thuộc hết."""
    qa_pairs = load_all_qa(samples)

    if not qa_pairs:
        return ""

    # Also load txt knowledge
    knowledge_lines = []
    for f in TRAINING_DIR.glob("*.txt"):
        for line in f.read_text(encoding="utf-8").split("\n"):
            if line.strip():
                knowledge_lines.append(line.strip())

    # Also load JSON Q&A
    for f in TRAINING_DIR.glob("*.json"):
        try:
            data = json.loads(f.read_text(encoding="utf-8"))
            for obj in (data if isinstance(data, list) else [data]):
                q = obj.get("question", obj.get("input", "")).strip()
                a = obj.get("answer", obj.get("output", "")).strip()
                if q and a and q not in {p[0] for p in qa_pairs}:
                    qa_pairs.append((q, a))
        except Exception:
            pass

    parts = []

    if knowledge_lines:
        parts.append("### Kien thuc ngan hang chi tiet:\n" + "\n".join(f"- {l}" for l in knowledge_lines))

    if qa_pairs:
        parts.append("### Tat ca Q&A da training (" + str(len(qa_pairs)) + " cau):\n\n" +
                      "\n\n".join(f"H: {q}\nD: {a}" for q, a in qa_pairs))

    logger.info(f"  Knowledge: {len(knowledge_lines)} facts, {len(qa_pairs)} Q&A pairs")
    return "\n\n".join(parts)


def build_model():
    """Tạo Ollama model với system prompt + few-shot examples."""
    logger.info("=" * 50)
    logger.info("  AIBank Qwen Model Builder")
    logger.info("=" * 50)

    # Check ollama
    try:
        result = subprocess.run(["ollama", "list"], capture_output=True, text=True)
        if result.returncode != 0:
            logger.error("Ollama chưa cài đặt hoặc chưa chạy!")
            logger.error("Cài đặt: https://ollama.com/download")
            return False
    except FileNotFoundError:
        logger.error("Ollama chưa cài đặt! Cài tại: https://ollama.com/download")
        return False

    # Check base model
    logger.info(f"Kiểm tra base model: {BASE_MODEL}")
    result = subprocess.run(["ollama", "list"], capture_output=True, text=True)
    if BASE_MODEL.split(":")[0] not in result.stdout:
        logger.info(f"Đang tải {BASE_MODEL}...")
        subprocess.run(["ollama", "pull", BASE_MODEL], check=True)

    # Load training data
    samples = load_training_data()
    few_shot = build_few_shot_examples(samples)

    # Read template
    if not MODELFILE_TEMPLATE.exists():
        logger.error(f"Không tìm thấy {MODELFILE_TEMPLATE}")
        return False

    template = MODELFILE_TEMPLATE.read_text(encoding="utf-8")

    # Fill template
    modelfile_content = template.replace("{base_model}", BASE_MODEL)
    modelfile_content = modelfile_content.replace("{few_shot_examples}", few_shot)

    # Write Modelfile
    MODELFILE_OUTPUT.write_text(modelfile_content, encoding="utf-8")
    logger.info(f"Đã tạo Modelfile tại: {MODELFILE_OUTPUT}")
    logger.info(f"  - Base model: {BASE_MODEL}")
    logger.info(f"  - Training samples: {len(samples)}")
    logger.info(f"  - Few-shot examples: {len(few_shot.split(chr(10))) if few_shot else 0} dòng")

    # Create Ollama model
    logger.info(f"\nĐang tạo model '{MODEL_NAME}'...")
    result = subprocess.run(
        ["ollama", "create", MODEL_NAME, "-f", str(MODELFILE_OUTPUT)],
        capture_output=True, text=True
    )

    if result.returncode == 0:
        logger.info(f"Tạo model '{MODEL_NAME}' thành công!")
        logger.info(f"Sử dụng: ollama run {MODEL_NAME}")
        logger.info(result.stdout)
        return True
    else:
        logger.error(f"Lỗi tạo model: {result.stderr}")
        return False


def test_model():
    """Test model với câu hỏi mẫu."""
    questions = [
        "Phí chuyển khoản liên ngân hàng là bao nhiêu?",
        "Làm sao để mở tài khoản tiết kiệm online?",
        "Tôi bị mất thẻ ATM phải làm gì?",
    ]

    # Try custom model first, fallback to base
    model = MODEL_NAME
    result = subprocess.run(["ollama", "list"], capture_output=True, text=True)
    if MODEL_NAME not in result.stdout:
        logger.info(f"Model '{MODEL_NAME}' chưa tạo, dùng {BASE_MODEL}")
        model = BASE_MODEL

    logger.info(f"Testing model: {model}\n")

    for i, q in enumerate(questions, 1):
        logger.info(f"--- Câu {i}: {q}")
        try:
            import requests
            resp = requests.post("http://localhost:11434/api/generate", json={
                "model": model,
                "prompt": q,
                "stream": False,
                "options": {"temperature": 0.3}
            }, timeout=60)
            data = resp.json()
            logger.info(f"Trả lời: {data['response'][:300]}\n")
        except Exception as e:
            logger.error(f"Lỗi: {e}\n")


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        return

    cmd = sys.argv[1]
    if cmd == "build":
        success = build_model()
        sys.exit(0 if success else 1)
    elif cmd == "test":
        test_model()
    else:
        print(f"Unknown command: {cmd}")
        print(__doc__)
        sys.exit(1)


if __name__ == "__main__":
    main()
