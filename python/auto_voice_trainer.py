#!/usr/bin/env python3
"""
Auto Voice Trainer - Tự động tạo dataset + finetune từ 1 file audio dài.

User chỉ cần: đọc script 4-5 phút → system tự làm hết.

Flow:
1. Nhận audio dài (4-5 phút) + script text
2. Cắt audio thành đoạn 3-15s theo khoảng lặng
3. Dùng Whisper transcribe từng đoạn → match với script
4. Tạo metadata.csv
5. Prepare arrow dataset
6. Finetune F5-TTS

Usage:
    python auto_voice_trainer.py process <audio_file> [--script <script_file>]
    python auto_voice_trainer.py train [--epochs 50]
"""

import os
import sys
import json
import time
import shutil
import logging
from pathlib import Path

logging.basicConfig(level=logging.INFO, format='[%(levelname)s] %(message)s')
logger = logging.getLogger("auto_trainer")

SCRIPT_DIR = Path(__file__).parent.absolute()
DATASET_DIR = SCRIPT_DIR / "voice_dataset"
WAVS_DIR = DATASET_DIR / "wavs"
F5_TTS_DIR = SCRIPT_DIR / "F5-TTS-Vietnamese"
CKPT_FILE = SCRIPT_DIR / "F5-TTS-Vietnamese-ViVoice" / "model_last.pt"
VOCAB_FILE = SCRIPT_DIR / "F5-TTS-Vietnamese-ViVoice" / "vocab.txt"

# Default script cho user đọc (40 câu banking, ~4-5 phút)
DEFAULT_SCRIPT = """Xin chào, tôi là trợ lý ngân hàng AI, tôi có thể giúp gì cho bạn?
Để mở tài khoản ngân hàng, bạn cần chuẩn bị căn cước công dân và số điện thoại chính chủ.
Lãi suất tiết kiệm kỳ hạn mười hai tháng hiện tại dao động từ năm đến sáu phần trăm mỗi năm.
Phí chuyển khoản liên ngân hàng qua Internet Banking là một nghìn sáu trăm năm mươi đồng mỗi giao dịch.
Thẻ tín dụng có hạn mức chi tiêu từ hai mươi đến năm trăm triệu đồng tùy theo thu nhập của bạn.
Khi bị mất thẻ ATM, bạn cần gọi ngay hotline ngân hàng để khóa thẻ, sau đó đến chi nhánh làm lại.
Vay tín chấp không cần tài sản đảm bảo, lãi suất từ mười đến hai mươi phần trăm mỗi năm.
Dịch vụ Mobile Banking hoàn toàn miễn phí khi đăng ký và sử dụng.
Bảo hiểm tiền gửi tại Việt Nam tối đa một trăm hai mươi lăm triệu đồng cho mỗi người tại mỗi ngân hàng.
Chuyển tiền nhanh hai mươi bốn trên bảy qua Napas chỉ mất khoảng mười giây.
Để tăng hạn mức thẻ tín dụng, bạn cần sử dụng thẻ thường xuyên và thanh toán đúng hạn ít nhất sáu tháng.
Mã OTP là mã xác thực một lần, không bao giờ chia sẻ cho bất kỳ ai kể cả nhân viên ngân hàng.
Gửi tiết kiệm online thường có lãi suất cao hơn gửi tại quầy từ không phẩy một đến không phẩy ba phần trăm.
Vay mua nhà được hỗ trợ tối đa bảy mươi đến tám mươi phần trăm giá trị căn nhà, thời hạn lên đến hai mươi lăm năm.
Tài khoản bị khóa sau năm lần nhập sai mật khẩu, bạn cần gọi hotline để mở khóa.
Thanh toán QR Code rất an toàn vì mã hóa thông tin giao dịch và cần xác nhận trước khi chuyển tiền.
Nợ xấu được ghi nhận tại Trung tâm Thông tin tín dụng trong năm năm và ảnh hưởng nghiêm trọng đến việc vay vốn.
Rút tiền tại ATM cùng ngân hàng hoàn toàn miễn phí, khác ngân hàng mất từ một nghìn đến ba nghìn đồng.
Thẻ chip bảo mật cao hơn thẻ từ, hầu hết ngân hàng đã chuyển đổi hoàn toàn sang thẻ chip.
Trả góp không phần trăm qua thẻ tín dụng nghĩa là cửa hàng hỗ trợ phí trả góp thay cho bạn.
Xác minh danh tính điện tử eKYC cho phép mở tài khoản hoàn toàn online chỉ trong năm đến mười phút.
Phí duy trì tài khoản từ mười nghìn đến ba mươi nghìn đồng mỗi tháng, một số ngân hàng miễn phí hoàn toàn.
Khi giao dịch online bị lỗi và tiền bị trừ, bạn nên liên hệ hotline trong vòng hai mươi bốn giờ.
Lãi suất vay mua xe ô tô dao động từ bảy đến mười phần trăm mỗi năm, thời hạn từ năm đến bảy năm.
SMS Banking có phí từ tám nghìn đến mười một nghìn đồng mỗi tháng, khuyên dùng thông báo qua app miễn phí.
Ngân hàng số là ngân hàng hoạt động hoàn toàn trên nền tảng số, không có chi nhánh vật lý.
Điểm tín dụng CIC tốt sẽ giúp bạn vay dễ hơn và được lãi suất thấp hơn.
Chuyển tiền quốc tế qua SWIFT mất từ hai đến năm ngày làm việc, phí từ mười đến năm mươi đô la.
Khi phát hiện giao dịch bất thường, ngân hàng sẽ tạm khóa tài khoản để bảo vệ bạn.
Sổ tiết kiệm kỳ hạn sáu tháng nếu rút trước hạn sẽ chỉ nhận lãi suất không kỳ hạn rất thấp.
Cảm ơn bạn đã liên hệ, chúc bạn một ngày tốt lành."""


def split_audio(audio_path, output_dir, min_dur=2.0, max_dur=15.0):
    """Cắt audio dài thành đoạn ngắn theo khoảng lặng."""
    from pydub import AudioSegment
    from pydub.silence import split_on_silence

    logger.info(f"Loading audio: {audio_path}")
    audio = AudioSegment.from_file(str(audio_path))
    audio = audio.set_frame_rate(24000).set_channels(1).set_sample_width(2)

    total_dur = len(audio) / 1000
    logger.info(f"Total duration: {total_dur:.1f}s")

    # Split on silence
    chunks = split_on_silence(
        audio,
        min_silence_len=600,
        silence_thresh=audio.dBFS - 14,
        keep_silence=250,
    )
    logger.info(f"Split into {len(chunks)} raw chunks")

    # Merge small chunks
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

    # Filter and export
    result = []
    for i, chunk in enumerate(merged):
        dur = len(chunk) / 1000
        if dur < 0.5:
            continue
        # If too long, just keep (whisper handles up to 30s)
        if dur > 30:
            # Further split
            half = len(chunk) // 2
            merged.insert(i + 1, chunk[half:])
            chunk = chunk[:half]

        out_path = output_dir / f"segment_{i:04d}.wav"
        chunk.export(str(out_path), format="wav")
        result.append({"path": out_path, "duration": len(chunk) / 1000})
        logger.info(f"  Segment {i}: {len(chunk)/1000:.1f}s → {out_path.name}")

    return result


def transcribe_segments(segments):
    """Whisper transcribe từng segment."""
    logger.info(f"\nTranscribing {len(segments)} segments with Whisper...")

    import whisper
    model = whisper.load_model("medium")

    for seg in segments:
        try:
            result = model.transcribe(
                str(seg["path"]),
                language="vi",
                fp16=False,
                verbose=False,
            )
            seg["transcript"] = result["text"].strip()
            logger.info(f"  {seg['path'].name}: \"{seg['transcript'][:60]}...\"")
        except Exception as e:
            seg["transcript"] = ""
            logger.warning(f"  {seg['path'].name}: transcribe failed: {e}")

    return segments


def match_with_script(segments, script_text):
    """Match transcribed segments với script text (nếu có)."""
    if not script_text:
        return segments

    script_lines = [l.strip() for l in script_text.strip().split("\n") if l.strip()]
    logger.info(f"\nMatching {len(segments)} segments with {len(script_lines)} script lines...")

    # Simple: nếu số segment ~ số script lines, map 1-1
    # Nếu khác nhiều, dùng transcript từ Whisper
    if abs(len(segments) - len(script_lines)) <= len(script_lines) * 0.3:
        # Close enough, match by order
        for i, seg in enumerate(segments):
            if i < len(script_lines):
                seg["transcript"] = script_lines[i]
                logger.info(f"  Matched {seg['path'].name} → \"{script_lines[i][:50]}...\"")
    else:
        logger.info("  Segment count differs too much from script, using Whisper transcripts")

    return segments


def build_metadata(segments, output_dir):
    """Tạo metadata.csv."""
    metadata_path = output_dir / "metadata.csv"
    valid = 0

    with open(metadata_path, "w", encoding="utf-8") as f:
        for seg in segments:
            if not seg.get("transcript"):
                continue
            rel_path = f"wavs/{seg['path'].name}"
            f.write(f"{rel_path}|{seg['transcript']}\n")
            valid += 1

    logger.info(f"\nMetadata: {valid} valid samples → {metadata_path}")
    return valid


def process_audio(audio_path, script_text=None):
    """Full pipeline: audio → split → transcribe → dataset."""
    start = time.time()
    logger.info("=" * 60)
    logger.info("  AUTO VOICE TRAINER - Processing Audio")
    logger.info("=" * 60)

    audio_path = Path(audio_path)
    if not audio_path.exists():
        logger.error(f"Audio file not found: {audio_path}")
        return False

    # Clean and create dirs
    if WAVS_DIR.exists():
        shutil.rmtree(WAVS_DIR)
    DATASET_DIR.mkdir(exist_ok=True)
    WAVS_DIR.mkdir(exist_ok=True)

    # Step 1: Split audio
    segments = split_audio(audio_path, WAVS_DIR)
    if not segments:
        logger.error("No segments extracted!")
        return False

    # Step 2: Transcribe
    segments = transcribe_segments(segments)

    # Step 3: Match with script (if provided)
    if script_text:
        segments = match_with_script(segments, script_text)

    # Step 4: Build metadata
    valid = build_metadata(segments, DATASET_DIR)
    if valid == 0:
        logger.error("No valid samples!")
        return False

    # Step 5: Copy ref audio to ref_audio dir for F5-TTS
    ref_dir = SCRIPT_DIR / "ref_audio"
    ref_dir.mkdir(exist_ok=True)
    # Use first segment as default ref
    if segments:
        best = max(segments, key=lambda s: s["duration"] if 3 <= s["duration"] <= 10 else 0)
        ref_dest = ref_dir / "trained_voice.wav"
        shutil.copy2(str(best["path"]), str(ref_dest))
        # Save transcript
        transcripts = {}
        transcript_file = ref_dir / "_transcripts.json"
        if transcript_file.exists():
            transcripts = json.loads(transcript_file.read_text(encoding="utf-8"))
        transcripts["trained_voice.wav"] = best.get("transcript", "")
        transcript_file.write_text(json.dumps(transcripts, ensure_ascii=False, indent=2), encoding="utf-8")
        logger.info(f"\nBest ref audio: {ref_dest} ({best['duration']:.1f}s)")

    elapsed = time.time() - start
    logger.info(f"\nDataset ready in {elapsed:.1f}s!")
    logger.info(f"  Segments: {len(segments)}")
    logger.info(f"  Valid samples: {valid}")
    logger.info(f"  Dataset: {DATASET_DIR}")

    return True


def get_script():
    """Return default training script."""
    return DEFAULT_SCRIPT


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        print("\nDefault script (30 sentences, ~4-5 min reading):")
        print(DEFAULT_SCRIPT[:500] + "...")
        return

    cmd = sys.argv[1]

    if cmd == "script":
        # Print script for user to read
        print(DEFAULT_SCRIPT)

    elif cmd == "process":
        if len(sys.argv) < 3:
            print("Usage: python auto_voice_trainer.py process <audio.wav> [--script script.txt]")
            return
        audio_path = sys.argv[2]
        script_text = DEFAULT_SCRIPT

        # Check for custom script
        if "--script" in sys.argv:
            idx = sys.argv.index("--script")
            if idx + 1 < len(sys.argv):
                script_file = Path(sys.argv[idx + 1])
                if script_file.exists():
                    script_text = script_file.read_text(encoding="utf-8")

        process_audio(audio_path, script_text)

    elif cmd == "train":
        epochs = int(sys.argv[2]) if len(sys.argv) > 2 else 50
        # Import and use build_voice_dataset train
        from build_voice_dataset import train_model
        train_model(epochs=epochs)

    elif cmd == "all":
        if len(sys.argv) < 3:
            print("Usage: python auto_voice_trainer.py all <audio.wav>")
            return
        if process_audio(sys.argv[2], DEFAULT_SCRIPT):
            from build_voice_dataset import train_model
            train_model(epochs=50)

    else:
        print(f"Unknown: {cmd}")
        print(__doc__)


if __name__ == "__main__":
    main()
