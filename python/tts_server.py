#!/usr/bin/env python3
"""
F5-TTS Vietnamese HTTP Server - Optimized for Speed + Quality
CUDA: FP16 + torch.compile + TF32 + cfg_strength=1.0
MPS/CPU: float32 fallback
"""

import os
import sys
import time
import hashlib
import logging
import warnings
import threading

warnings.filterwarnings("ignore")

import numpy as np
import librosa
import soundfile as sf
import noisereduce as nr
from scipy.signal import butter, sosfilt

os.environ["HF_HUB_OFFLINE"] = "1"
os.environ["TRANSFORMERS_OFFLINE"] = "1"

from pathlib import Path
from contextlib import asynccontextmanager

SCRIPT_DIR = Path(__file__).parent.absolute()
F5_TTS_DIR = SCRIPT_DIR / "F5-TTS-Vietnamese"

script_dir_str = str(SCRIPT_DIR)
sys.path = [p for p in sys.path if p not in ('', '.', script_dir_str)]
sys.path.insert(0, str(F5_TTS_DIR / "src"))

MODEL_DIR = SCRIPT_DIR / "F5-TTS-Vietnamese-ViVoice"
OUTPUT_DIR = SCRIPT_DIR / "outputs"
REF_AUDIO_DIR = SCRIPT_DIR / "ref_audio"
VOCAB_FILE = MODEL_DIR / "vocab.txt"
CKPT_FILE = MODEL_DIR / "model_last.pt"

OUTPUT_DIR.mkdir(exist_ok=True)
REF_AUDIO_DIR.mkdir(exist_ok=True)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("tts_server")

# ── Global state ──
tts_model = None
whisper_model = None
_ref_cache = {}        # {hash: (ref_file, ref_text)}
_tensor_cache = {}     # {ref_file: (audio_tensor, sr)}
_generate_lock = threading.Lock()

# ── F5-TTS inference helpers (imported once after model load) ──
_f5 = {}  # Stores imported functions to avoid re-importing

# ── Pre-computed voice profiles ──
VOICE_PROFILES_DIR = SCRIPT_DIR / "voice_profiles"
VOICE_PROFILES_DIR.mkdir(exist_ok=True)
_voice_profiles = {}   # {name: {ref_file, ref_text, tensor, sr}}


def _hash_file(filepath):
    stat = os.stat(filepath)
    return hashlib.md5(f"{filepath}:{stat.st_mtime}:{stat.st_size}".encode()).hexdigest()


def load_tts_model():
    global tts_model
    if tts_model is not None:
        return tts_model

    logger.info("Loading F5-TTS model...")
    start = time.time()

    import torch
    import torchaudio
    from f5_tts.infer.utils_infer import (
        load_model, load_vocoder, preprocess_ref_audio_text,
        convert_char_to_pinyin, target_sample_rate, hop_length,
    )
    from f5_tts.model.backbones.dit import DiT
    from omegaconf import OmegaConf
    from importlib.resources import files as pkg_files

    # Store imported functions
    _f5["preprocess"] = preprocess_ref_audio_text
    _f5["convert_char_to_pinyin"] = convert_char_to_pinyin
    _f5["target_sample_rate"] = target_sample_rate
    _f5["hop_length"] = hop_length
    _f5["torchaudio"] = torchaudio
    _f5["torch"] = torch

    device = (
        "cuda" if torch.cuda.is_available()
        else "mps" if torch.backends.mps.is_available()
        else "cpu"
    )

    if device == "mps":
        os.environ["PYTORCH_ENABLE_MPS_FALLBACK"] = "1"
        torch.mps.set_per_process_memory_fraction(0.7)

    model_cfg = OmegaConf.load(str(pkg_files("f5_tts").joinpath("configs/F5TTS_Base.yaml")))
    mel_spec_type = model_cfg.model.mel_spec.mel_spec_type

    vocoder = load_vocoder(
        vocoder_name=mel_spec_type, is_local=False, local_path=None, device=device,
    )
    ema_model = load_model(
        DiT, model_cfg.model.arch,
        ckpt_path=str(CKPT_FILE), mel_spec_type=mel_spec_type,
        vocab_file=str(VOCAB_FILE), ode_method="euler", use_ema=True, device=device,
    )

    torch.set_grad_enabled(False)

    # ── CUDA optimizations ──
    if device == "cuda":
        ema_model = ema_model.half()
        torch.backends.cudnn.benchmark = True
        torch.backends.cuda.matmul.allow_tf32 = True
        torch.backends.cudnn.allow_tf32 = True
        if hasattr(torch, "compile"):
            try:
                ema_model = torch.compile(ema_model, mode="reduce-overhead")
                vocoder = torch.compile(vocoder, mode="reduce-overhead")
                logger.info("torch.compile enabled for model + vocoder")
            except Exception as e:
                logger.warning(f"torch.compile failed: {e}")

    if device == "mps":
        torch.mps.empty_cache()

    tts_model = {
        "ema_model": ema_model,
        "vocoder": vocoder,
        "device": device,
        "mel_spec_type": mel_spec_type,
    }

    logger.info(f"F5-TTS loaded in {time.time() - start:.1f}s on {device}")

    # Load pre-computed voice profiles
    _load_voice_profiles()

    _warm_up()
    return tts_model


def _warm_up():
    if tts_model is None:
        return

    # Warm up với voice profile nếu có, nếu không dùng ref audio
    if _voice_profiles:
        profile_name = next(iter(_voice_profiles))
        try:
            logger.info(f"Warming up with profile '{profile_name}'...")
            start = time.time()
            _generate_speech("", "", "xin chào", nfe_step=8, voice_profile=profile_name)
            logger.info(f"Warm-up done in {time.time() - start:.1f}s")
            return
        except Exception as e:
            logger.warning(f"Profile warm-up failed: {e}")

    ref_files = list(REF_AUDIO_DIR.glob("*.wav"))
    if not ref_files:
        return
    try:
        logger.info("Warming up...")
        start = time.time()
        _generate_speech(str(ref_files[0]), "xin chào", "xin chào", nfe_step=8)
        logger.info(f"Warm-up done in {time.time() - start:.1f}s")
    except Exception as e:
        logger.warning(f"Warm-up failed: {e}")


def _build_voice_profile(name, ref_audio_path, ref_text=""):
    """Tạo voice profile từ ref audio: pre-compute mọi thứ, lưu disk.

    Sau khi finetune, gọi hàm này 1 lần → mọi request sau dùng profile = skip toàn bộ preprocessing.
    Lưu: WAV (clip 3s, mono, 24kHz) + transcript + tensor (.pt)
    """
    import json
    torch = _f5["torch"]
    torchaudio = _f5["torchaudio"]
    target_sample_rate = _f5["target_sample_rate"]

    profile_dir = VOICE_PROFILES_DIR / name
    profile_dir.mkdir(exist_ok=True)

    # 1. Transcribe if needed
    actual_text = ref_text
    if not actual_text.strip() and whisper_model is not None:
        try:
            result = whisper_model.transcribe(ref_audio_path, language="vi", fp16=False, verbose=False)
            actual_text = result["text"].strip()
        except Exception:
            actual_text = "xin chào"

    # 2. Preprocess ref audio (F5-TTS pipeline)
    ref_file, ref_text_out = _f5["preprocess"](
        ref_audio_path, actual_text, device=tts_model["device"]
    )

    # 3. Load, resample, clip to 3s (finetuned model cần ít ref hơn)
    audio, sr = torchaudio.load(ref_file)
    if sr != target_sample_rate:
        audio = torchaudio.transforms.Resample(sr, target_sample_rate)(audio)
        sr = target_sample_rate
    if audio.shape[0] > 1:
        audio = torch.mean(audio, dim=0, keepdim=True)
    max_samples = int(3.0 * sr)  # 3s cho finetuned voice
    if audio.shape[-1] > max_samples:
        audio = audio[:, :max_samples]

    # 4. Normalize RMS
    rms = torch.sqrt(torch.mean(torch.square(audio)))
    if rms < 0.1:
        audio = audio * 0.1 / rms

    # 5. Save to disk
    wav_path = profile_dir / "ref.wav"
    tensor_path = profile_dir / "ref_tensor.pt"
    meta_path = profile_dir / "meta.json"

    sf.write(str(wav_path), audio.squeeze().numpy(), sr)
    torch.save({"audio": audio, "sr": sr}, str(tensor_path))
    meta = {
        "name": name,
        "ref_text": ref_text_out,
        "source_audio": str(ref_audio_path),
        "duration_s": round(audio.shape[-1] / sr, 2),
        "sample_rate": sr,
    }
    meta_path.write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")

    logger.info(f"Voice profile '{name}' saved: {meta['duration_s']}s, text='{ref_text_out[:50]}'")
    return meta


def _load_voice_profiles():
    """Load tất cả voice profiles từ disk vào memory khi server start."""
    import json
    torch = _f5["torch"]

    for profile_dir in VOICE_PROFILES_DIR.iterdir():
        if not profile_dir.is_dir():
            continue
        meta_path = profile_dir / "meta.json"
        tensor_path = profile_dir / "ref_tensor.pt"
        wav_path = profile_dir / "ref.wav"

        if not meta_path.exists() or not tensor_path.exists():
            continue

        try:
            meta = json.loads(meta_path.read_text(encoding="utf-8"))
            data = torch.load(str(tensor_path), map_location="cpu", weights_only=True)
            _voice_profiles[meta["name"]] = {
                "ref_file": str(wav_path),
                "ref_text": meta["ref_text"],
                "audio": data["audio"],
                "sr": data["sr"],
            }
            logger.info(f"Loaded voice profile: '{meta['name']}' ({meta['duration_s']}s)")
        except Exception as e:
            logger.warning(f"Failed to load profile {profile_dir.name}: {e}")


def _get_ref(ref_audio_path, ref_text_hint=""):
    """Get preprocessed ref audio (cached). Returns (ref_file, ref_text)."""
    file_hash = _hash_file(ref_audio_path)
    cache_key = f"{file_hash}:{ref_text_hint}"

    if cache_key in _ref_cache:
        return _ref_cache[cache_key]

    actual_ref_text = ref_text_hint
    if not actual_ref_text.strip() and whisper_model is not None:
        try:
            from pydub import AudioSegment
            audio_seg = AudioSegment.from_file(ref_audio_path)
            if len(audio_seg) > 15000:
                import tempfile
                with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
                    audio_seg[:15000].export(tmp.name, format="wav")
                    result = whisper_model.transcribe(tmp.name, language="vi", fp16=False, verbose=False)
                    os.unlink(tmp.name)
            else:
                result = whisper_model.transcribe(ref_audio_path, language="vi", fp16=False, verbose=False)
            actual_ref_text = result["text"].strip()
            logger.info(f"Whisper ref: '{actual_ref_text[:60]}'")
        except Exception:
            actual_ref_text = "xin chào"

    ref_file, ref_text = _f5["preprocess"](
        ref_audio_path, actual_ref_text, device=tts_model["device"]
    )
    _ref_cache[cache_key] = (ref_file, ref_text)

    # Keep cache <= 10 entries
    if len(_ref_cache) > 10:
        del _ref_cache[next(iter(_ref_cache))]

    return ref_file, ref_text


def _get_ref_tensor(ref_file, max_duration=5.0):
    """Load ref audio tensor (cached), clipped to max_duration for speed."""
    if ref_file in _tensor_cache:
        return _tensor_cache[ref_file]

    torchaudio = _f5["torchaudio"]
    audio, sr = torchaudio.load(ref_file)
    max_samples = int(max_duration * sr)
    if audio.shape[-1] > max_samples:
        audio = audio[:, :max_samples]
    _tensor_cache[ref_file] = (audio, sr)

    if len(_tensor_cache) > 10:
        del _tensor_cache[next(iter(_tensor_cache))]

    return audio, sr


import re


def _split_sentences(text):
    """Tách text thành câu hoàn chỉnh theo dấu câu tiếng Việt.

    Nguyên tắc:
    - CHỈ tách ở ranh giới câu tự nhiên (sau . ! ?)
    - Nếu câu quá dài (>250B), mới tách thêm ở dấu phẩy
    - KHÔNG BAO GIỜ tách giữa cụm từ/từ ghép
    - Câu quá ngắn (<30B) gộp vào câu trước
    """
    text = text.strip()
    if not text:
        return []

    # Bước 1: Tách theo dấu kết thúc câu (. ! ?)
    # Giữ dấu câu gắn với câu trước
    chunks = re.split(r'(?<=[.!?])\s+', text)

    # Bước 2: Chỉ tách thêm ở dấu phẩy nếu câu quá dài (>250 bytes)
    result = []
    for chunk in chunks:
        if len(chunk.encode("utf-8")) <= 250:
            result.append(chunk)
        else:
            # Tách theo dấu phẩy - giữ nguyên cụm từ
            sub_parts = re.split(r',\s+', chunk)
            current = ""
            for sp in sub_parts:
                candidate = (current + ", " + sp) if current else sp
                if current and len(candidate.encode("utf-8")) > 250:
                    result.append(current.strip())
                    current = sp
                else:
                    current = candidate
            if current:
                result.append(current.strip())

    # Bước 3: Gộp câu quá ngắn (<30 bytes) vào câu trước
    merged = []
    for s in result:
        s = s.strip()
        if not s:
            continue
        if merged and len(s.encode("utf-8")) < 30:
            merged[-1] += " " + s
        else:
            merged.append(s)

    if len(merged) > 1 and len(merged[-1].encode("utf-8")) < 30:
        merged[-2] += " " + merged[-1]
        merged.pop()

    return merged if merged else [text]


def _generate_one(audio_proc, ref_text_processed, gen_text, nfe, speed, cfg_strength, rms, target_rms):
    """Generate 1 câu ngắn → numpy waveform."""
    torch = _f5["torch"]
    hop_length = _f5["hop_length"]
    convert_char_to_pinyin = _f5["convert_char_to_pinyin"]

    text_list = [ref_text_processed + gen_text]
    final_text_list = convert_char_to_pinyin(text_list)

    ref_audio_len = audio_proc.shape[-1] // hop_length
    ref_text_len = max(len(ref_text_processed.encode("utf-8")), 1)
    gen_text_len = len(gen_text.encode("utf-8"))

    # Câu ngắn cần speed chậm hơn để không bị cắt
    local_speed = speed
    if gen_text_len < 10:
        local_speed = 0.3

    duration = ref_audio_len + int(ref_audio_len / ref_text_len * gen_text_len / local_speed)

    generated, _ = tts_model["ema_model"].sample(
        cond=audio_proc,
        text=final_text_list,
        duration=duration,
        steps=nfe,
        cfg_strength=cfg_strength,
        sway_sampling_coef=0,
    )

    generated = generated.to(torch.float32)
    generated = generated[:, ref_audio_len:, :]
    generated = generated.permute(0, 2, 1)

    if tts_model["mel_spec_type"] == "vocos":
        wav = tts_model["vocoder"].decode(generated)
    else:
        wav = tts_model["vocoder"](generated)

    if rms < target_rms:
        wav = wav * rms / target_rms

    return wav.squeeze().cpu().numpy()


def _concat_with_silence(waves, sr, silence_ms=150):
    """Nối nhiều waveform với khoảng lặng tự nhiên giữa các câu.

    silence_ms=150: khoảng nghỉ ~150ms giữa câu, giống nhịp nói tự nhiên.
    Cũng trim silence đầu/cuối mỗi câu để tránh khoảng trống thừa.
    """
    if len(waves) == 1:
        return waves[0]

    silence = np.zeros(int(silence_ms / 1000 * sr), dtype=np.float32)
    parts = []

    for i, wav in enumerate(waves):
        # Trim silence đầu/cuối mỗi câu
        # Tìm vị trí đầu tiên có amplitude > threshold
        threshold = 0.01
        indices = np.where(np.abs(wav) > threshold)[0]
        if len(indices) > 0:
            # Giữ 1ms padding trước/sau
            pad = int(0.001 * sr)
            start = max(0, indices[0] - pad)
            end = min(len(wav), indices[-1] + pad)
            wav = wav[start:end]

        parts.append(wav)
        if i < len(waves) - 1:
            parts.append(silence)

    return np.concatenate(parts)


def _generate_speech(ref_audio_path, ref_text, gen_text, nfe_step=16, speed=1.0,
                     cfg_strength=1.0, voice_profile=None):
    """Core TTS: tách câu dài → generate từng câu ngắn → nối silence.

    voice_profile: tên profile đã build sẵn → skip preprocessing, dùng tensor 3s đã cache.
    Không có profile: dùng ref_audio_path bình thường (5s).
    """
    torch = _f5["torch"]
    torchaudio = _f5["torchaudio"]
    target_sample_rate = _f5["target_sample_rate"]

    # 1. Lấy ref: ưu tiên voice profile > ref_audio_path
    if voice_profile and voice_profile in _voice_profiles:
        profile = _voice_profiles[voice_profile]
        ref_text_processed = profile["ref_text"]
        audio = profile["audio"]
        sr_ref = profile["sr"]
        logger.info(f"Using voice profile '{voice_profile}' (pre-computed, {audio.shape[-1]/sr_ref:.1f}s)")
    else:
        ref_file, ref_text_processed = _get_ref(ref_audio_path, ref_text)
        audio, sr_ref = _get_ref_tensor(ref_file)

    # 2. Split text into sentences
    sentences = _split_sentences(gen_text)
    logger.info(f"Split into {len(sentences)} sentences: {[s[:30] for s in sentences]}")

    # 3. Prepare ref audio tensor (once)
    device = tts_model["device"]
    nfe = max(4, min(32, nfe_step))

    with _generate_lock, torch.inference_mode():
        # Resample
        if sr_ref != target_sample_rate:
            audio_proc = torchaudio.transforms.Resample(sr_ref, target_sample_rate)(audio)
        else:
            audio_proc = audio

        if audio_proc.shape[0] > 1:
            audio_proc = torch.mean(audio_proc, dim=0, keepdim=True)

        target_rms = 0.1
        rms = torch.sqrt(torch.mean(torch.square(audio_proc)))
        if rms < target_rms:
            audio_proc = audio_proc * target_rms / rms

        audio_proc = audio_proc.to(device)

        # 5. Generate each sentence
        waves = []
        for i, sent in enumerate(sentences):
            t0 = time.time()
            wav = _generate_one(
                audio_proc, ref_text_processed, sent,
                nfe, speed, cfg_strength, rms, target_rms,
            )
            waves.append(wav)
            logger.info(f"  Sentence {i+1}/{len(sentences)}: {time.time()-t0:.2f}s \"{sent[:40]}\"")

        # Sync GPU
        if device == "cuda":
            torch.cuda.synchronize()
        elif device == "mps":
            torch.mps.synchronize()

    # 6. Crossfade concat
    final_wav = _concat_with_silence(waves, target_sample_rate, silence_ms=150)

    return final_wav, target_sample_rate


def load_whisper_model(model_name="medium"):
    global whisper_model
    if whisper_model is not None:
        return whisper_model
    logger.info(f"Loading Whisper '{model_name}'...")
    start = time.time()
    import whisper
    whisper_model = whisper.load_model(model_name)
    logger.info(f"Whisper loaded in {time.time() - start:.1f}s")
    return whisper_model


# ── FastAPI ──

@asynccontextmanager
async def lifespan(app):
    logger.info("=== TTS Server Starting ===")
    def _load_all():
        try:
            load_tts_model()
        except Exception as e:
            logger.error(f"F5-TTS load failed: {e}")
        try:
            load_whisper_model()
        except Exception as e:
            logger.warning(f"Whisper not available: {e}")
    threading.Thread(target=_load_all, daemon=True).start()
    yield
    logger.info("=== TTS Server Shutting Down ===")


from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

app = FastAPI(title="F5-TTS Server", lifespan=lifespan)


class GenerateRequest(BaseModel):
    ref_audio: str = ""           # Bỏ trống nếu dùng voice_profile
    ref_text: str = ""
    gen_text: str
    speed: float = 1.0
    nfe_step: int = 16            # 4=ultra-fast, 8=fast, 16=quality, 32=best
    cfg_strength: float = 1.0     # 1.0=fast+good, 2.0=best quality
    voice_profile: str = ""       # Tên profile đã build → skip preprocessing


class TranscribeRequest(BaseModel):
    audio_path: str


class FinetuneRequest(BaseModel):
    dataset_dir: str
    epochs: int = 50
    learning_rate: float = 1e-5
    batch_size: int = 3200


class BuildProfileRequest(BaseModel):
    name: str                     # Tên profile (vd: "banker", "female_01")
    ref_audio: str                # Path file audio gốc
    ref_text: str = ""            # Transcript (tự Whisper nếu trống)


@app.get("/health")
def health():
    return {
        "status": "ok",
        "tts_loaded": tts_model is not None,
        "whisper_loaded": whisper_model is not None,
    }


@app.get("/status")
def status():
    return {
        "ready": tts_model is not None,
        "loading": tts_model is None and CKPT_FILE.exists(),
        "engine": "F5-TTS Vietnamese (Optimized)",
        "model_exists": CKPT_FILE.exists(),
        "whisper_ready": whisper_model is not None,
        "voice_profiles": list(_voice_profiles.keys()),
    }


@app.post("/build-profile")
async def build_profile(req: BuildProfileRequest):
    """Build voice profile từ ref audio → pre-compute sẵn cho inference nhanh."""
    if tts_model is None:
        raise HTTPException(503, "F5-TTS model still loading...")
    if not req.name.strip():
        raise HTTPException(400, "name is required")
    if not os.path.exists(req.ref_audio):
        raise HTTPException(400, f"ref_audio not found: {req.ref_audio}")

    import asyncio
    loop = asyncio.get_event_loop()

    def _do():
        try:
            meta = _build_voice_profile(req.name, req.ref_audio, req.ref_text)
            # Reload into memory
            _load_voice_profiles()
            return {"success": True, **meta}
        except Exception as e:
            logger.error(f"Build profile error: {e}", exc_info=True)
            return {"success": False, "error": str(e)}

    return await loop.run_in_executor(None, _do)


@app.get("/profiles")
def list_profiles():
    """List all voice profiles."""
    profiles = []
    for name, p in _voice_profiles.items():
        profiles.append({
            "name": name,
            "ref_text": p["ref_text"][:60],
            "duration_s": round(p["audio"].shape[-1] / p["sr"], 2),
        })
    return {"profiles": profiles}


@app.post("/generate")
async def generate(req: GenerateRequest):
    """Generate TTS audio - optimized pipeline."""
    if tts_model is None:
        raise HTTPException(503, "F5-TTS model still loading...")
    if not req.gen_text.strip():
        raise HTTPException(400, "gen_text is required")
    # Cần ref_audio HOẶC voice_profile
    if not req.voice_profile and not req.ref_audio:
        raise HTTPException(400, "ref_audio or voice_profile is required")
    if req.ref_audio and not os.path.exists(req.ref_audio):
        raise HTTPException(400, f"ref_audio not found: {req.ref_audio}")

    import asyncio
    loop = asyncio.get_event_loop()

    def _do():
        start = time.time()
        try:
            wav, sr = _generate_speech(
                req.ref_audio, req.ref_text, req.gen_text,
                nfe_step=req.nfe_step, speed=req.speed,
                cfg_strength=req.cfg_strength,
                voice_profile=req.voice_profile or None,
            )
            output_path = str(OUTPUT_DIR / f"gen_{int(time.time() * 1000)}.wav")
            sf.write(output_path, wav, sr)
            elapsed = time.time() - start
            logger.info(f"Generated in {elapsed:.2f}s (nfe={req.nfe_step}, cfg={req.cfg_strength}): {output_path}")
            return {
                "success": True,
                "output": output_path,
                "gen_text": req.gen_text[:50],
                "elapsed": round(elapsed, 2),
            }
        except Exception as e:
            logger.error(f"Generate error: {e}", exc_info=True)
            return {"success": False, "error": str(e)}

    return await loop.run_in_executor(None, _do)


@app.post("/transcribe")
async def transcribe_audio(req: TranscribeRequest):
    """Transcribe audio using Whisper."""
    if whisper_model is None:
        raise HTTPException(503, "Whisper model still loading...")
    if not os.path.exists(req.audio_path):
        raise HTTPException(400, f"File not found: {req.audio_path}")

    import asyncio
    loop = asyncio.get_event_loop()

    def _do():
        start = time.time()
        try:
            audio_path = req.audio_path
            try:
                y_raw, sr = librosa.load(audio_path, sr=16000, mono=True)
                if len(y_raw) == 0:
                    return {"success": False, "error": "Audio file is empty"}

                y = y_raw.copy()

                # Bandpass filter
                y = sosfilt(butter(4, 120, btype='high', fs=sr, output='sos'), y)
                y = sosfilt(butter(4, 7500, btype='low', fs=sr, output='sos'), y)

                # Denoise
                y = nr.reduce_noise(y=y, sr=sr, stationary=True, prop_decrease=0.7, n_fft=1024)

                # Normalize
                peak = np.max(np.abs(y))
                if peak > 0:
                    y = y / peak * 0.95

                # Trim silence
                y, _ = librosa.effects.trim(y, top_db=30)

                # Nếu preprocessing làm audio quá ngắn/rỗng → fallback dùng raw
                if len(y) < sr * 0.3:
                    logger.warning("Preprocessed audio too short, using raw audio")
                    y = y_raw

                import tempfile
                with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
                    sf.write(tmp.name, y, sr)
                    audio_path = tmp.name

            except Exception as e:
                logger.warning(f"Audio preprocessing failed, using raw: {e}")

            result = whisper_model.transcribe(
                audio_path, language="vi", fp16=False, verbose=False,
                temperature=0.0, beam_size=3, best_of=1,
                condition_on_previous_text=False,
                no_speech_threshold=0.5, compression_ratio_threshold=2.0,
                logprob_threshold=-0.8,
            )

            if audio_path != req.audio_path:
                try:
                    os.unlink(audio_path)
                except Exception:
                    pass

            elapsed = time.time() - start
            text = result["text"].strip()
            logger.info(f"Transcribed in {elapsed:.2f}s: '{text[:80]}'")
            return {
                "success": True,
                "text": text,
                "language": result.get("language", "vi"),
                "elapsed": round(elapsed, 2),
            }
        except Exception as e:
            logger.error(f"Transcribe error: {e}")
            return {"success": False, "error": str(e)}

    return await loop.run_in_executor(None, _do)


@app.post("/finetune")
async def finetune(req: FinetuneRequest):
    """Finetune F5-TTS on custom voice data."""
    if not os.path.exists(req.dataset_dir):
        raise HTTPException(400, f"Dataset dir not found: {req.dataset_dir}")
    meta = os.path.join(req.dataset_dir, "metadata.csv")
    if not os.path.exists(meta):
        raise HTTPException(400, "metadata.csv not found in dataset dir")

    import asyncio, subprocess
    loop = asyncio.get_event_loop()

    def _do():
        try:
            venv_python = str(SCRIPT_DIR / "venv" / "bin" / "python")

            # Prepare dataset
            logger.info("Preparing dataset...")
            prep_script = str(F5_TTS_DIR / "src" / "f5_tts" / "train" / "datasets" / "prepare_csv_wavs.py")
            subprocess.run([
                venv_python, prep_script,
                req.dataset_dir, os.path.join(req.dataset_dir, "processed")
            ], check=True, capture_output=True)

            # Finetune
            logger.info("Starting finetuning...")
            finetune_script = str(F5_TTS_DIR / "src" / "f5_tts" / "train" / "finetune_cli.py")
            result = subprocess.run([
                venv_python, finetune_script,
                "--exp_name", "F5TTS_Base",
                "--dataset_name", os.path.basename(req.dataset_dir),
                "--batch_size_per_gpu", str(req.batch_size),
                "--learning_rate", str(req.learning_rate),
                "--epochs", str(req.epochs),
                "--finetune",
                "--pretrain", str(CKPT_FILE),
            ], capture_output=True, text=True, cwd=str(F5_TTS_DIR))

            return {
                "success": result.returncode == 0,
                "stdout": result.stdout[-2000:],
                "stderr": result.stderr[-2000:],
            }
        except Exception as e:
            return {"success": False, "error": str(e)}

    return await loop.run_in_executor(None, _do)


# ── Auto Training: ghi âm → tự động tạo profile ──

class AutoTrainRequest(BaseModel):
    audio_path: str               # File ghi âm của user (WAV/MP3, 1-10 phút)
    profile_name: str = ""        # Tên profile (auto-generate nếu trống)
    script_text: str = ""         # Script đã đọc (nếu có, chính xác hơn)
    epochs: int = 50              # Số epoch finetune
    skip_finetune: bool = False   # True = chỉ build profile từ ref audio, không finetune


# Training status tracker
_training_status = {}  # {profile_name: {status, step, progress, error}}


@app.post("/auto-train")
async def auto_train(req: AutoTrainRequest):
    """Tự động: ghi âm → split → transcribe → dataset → finetune → profile.

    Flow:
    1. Nhận audio ghi âm (1-10 phút)
    2. Split thành đoạn 2-15s theo khoảng lặng
    3. Whisper transcribe từng đoạn
    4. Match với script (nếu có)
    5. Tạo metadata.csv + dataset
    6. Finetune F5-TTS
    7. Auto build voice profile
    8. Profile sẵn sàng dùng ngay

    Nếu skip_finetune=True: chỉ chọn đoạn audio tốt nhất làm ref → build profile.
    Nhanh hơn nhưng chất lượng giọng kém hơn finetune.
    """
    if tts_model is None:
        raise HTTPException(503, "F5-TTS model still loading...")
    if whisper_model is None:
        raise HTTPException(503, "Whisper model still loading...")
    if not os.path.exists(req.audio_path):
        raise HTTPException(400, f"Audio not found: {req.audio_path}")

    # Auto-generate profile name
    profile_name = req.profile_name.strip()
    if not profile_name:
        profile_name = f"voice_{int(time.time())}"

    # Check not already training
    if profile_name in _training_status and _training_status[profile_name].get("status") == "training":
        raise HTTPException(409, f"Profile '{profile_name}' is already being trained")

    _training_status[profile_name] = {"status": "starting", "step": "init", "progress": 0}

    import asyncio
    loop = asyncio.get_event_loop()

    def _do_auto_train():
        import shutil
        import json
        from pydub import AudioSegment
        from pydub.silence import split_on_silence

        status = _training_status[profile_name]
        start_total = time.time()

        try:
            # ── Step 1: Load & validate audio ──
            status.update({"status": "training", "step": "loading_audio", "progress": 5})
            logger.info(f"[AUTO-TRAIN] Loading audio: {req.audio_path}")

            audio = AudioSegment.from_file(req.audio_path)
            audio = audio.set_frame_rate(24000).set_channels(1).set_sample_width(2)
            total_dur = len(audio) / 1000

            if total_dur < 5:
                status.update({"status": "error", "error": f"Audio quá ngắn ({total_dur:.1f}s), cần ít nhất 5s"})
                return status

            logger.info(f"[AUTO-TRAIN] Audio: {total_dur:.1f}s")

            # ── Step 2: Split audio ──
            status.update({"step": "splitting_audio", "progress": 10})
            logger.info("[AUTO-TRAIN] Splitting audio by silence...")

            dataset_dir = SCRIPT_DIR / "voice_dataset" / profile_name
            wavs_dir = dataset_dir / "wavs"
            if wavs_dir.exists():
                shutil.rmtree(wavs_dir)
            dataset_dir.mkdir(parents=True, exist_ok=True)
            wavs_dir.mkdir(exist_ok=True)

            chunks = split_on_silence(
                audio,
                min_silence_len=600,
                silence_thresh=audio.dBFS - 14,
                keep_silence=250,
            )

            # Merge small chunks (< 2s) into larger ones
            merged = []
            current = AudioSegment.empty()
            for chunk in chunks:
                current += chunk
                if len(current) / 1000 >= 2.0:
                    merged.append(current)
                    current = AudioSegment.empty()
            if len(current) > 500:
                if merged:
                    merged[-1] += current
                else:
                    merged.append(current)

            # Export segments
            segments = []
            for i, chunk in enumerate(merged):
                dur = len(chunk) / 1000
                if dur < 0.5:
                    continue
                if dur > 30:
                    half = len(chunk) // 2
                    merged.insert(i + 1, chunk[half:])
                    chunk = chunk[:half]

                out_path = wavs_dir / f"segment_{i:04d}.wav"
                chunk.export(str(out_path), format="wav")
                segments.append({"path": out_path, "duration": len(chunk) / 1000})

            logger.info(f"[AUTO-TRAIN] Split into {len(segments)} segments")

            if not segments:
                status.update({"status": "error", "error": "Không tách được đoạn nào từ audio"})
                return status

            # ── Step 3: Transcribe ──
            status.update({"step": "transcribing", "progress": 25})
            logger.info(f"[AUTO-TRAIN] Transcribing {len(segments)} segments...")

            for idx, seg in enumerate(segments):
                try:
                    result = whisper_model.transcribe(
                        str(seg["path"]), language="vi", fp16=False, verbose=False,
                        temperature=0.0, beam_size=3, best_of=1,
                        condition_on_previous_text=False,
                    )
                    seg["transcript"] = result["text"].strip()
                    logger.info(f"  [{idx+1}/{len(segments)}] \"{seg['transcript'][:50]}\"")
                except Exception as e:
                    seg["transcript"] = ""
                    logger.warning(f"  [{idx+1}] transcribe failed: {e}")

                status["progress"] = 25 + int(25 * (idx + 1) / len(segments))

            # ── Step 4: Match with script (if provided) ──
            if req.script_text.strip():
                script_lines = [l.strip() for l in req.script_text.strip().split("\n") if l.strip()]
                if abs(len(segments) - len(script_lines)) <= len(script_lines) * 0.3:
                    for i, seg in enumerate(segments):
                        if i < len(script_lines):
                            seg["transcript"] = script_lines[i]
                    logger.info(f"[AUTO-TRAIN] Matched {min(len(segments), len(script_lines))} segments with script")

            # ── Step 5: Build metadata.csv ──
            status.update({"step": "building_dataset", "progress": 55})

            metadata_path = dataset_dir / "metadata.csv"
            valid = 0
            with open(metadata_path, "w", encoding="utf-8") as f:
                for seg in segments:
                    if not seg.get("transcript"):
                        continue
                    rel_path = f"wavs/{seg['path'].name}"
                    f.write(f"{rel_path}|{seg['transcript']}\n")
                    valid += 1

            logger.info(f"[AUTO-TRAIN] Dataset: {valid} valid samples")

            if valid == 0:
                status.update({"status": "error", "error": "Không có sample hợp lệ sau transcribe"})
                return status

            # ── Step 6: Chọn ref audio tốt nhất ──
            # Ưu tiên đoạn 3-8s có transcript rõ
            best = None
            for seg in segments:
                if seg.get("transcript") and 3 <= seg["duration"] <= 8:
                    if best is None or seg["duration"] > best["duration"]:
                        best = seg
            if not best:
                best = max(segments, key=lambda s: s["duration"] if s.get("transcript") else 0)

            best_ref = str(best["path"])
            best_text = best.get("transcript", "")
            logger.info(f"[AUTO-TRAIN] Best ref: {best['path'].name} ({best['duration']:.1f}s) \"{best_text[:40]}\"")

            # ── Step 7: Finetune hoặc skip ──
            if req.skip_finetune:
                logger.info("[AUTO-TRAIN] Skipping finetune (quick mode)")
                status.update({"step": "building_profile", "progress": 80})
            else:
                status.update({"step": "finetuning", "progress": 60})
                logger.info(f"[AUTO-TRAIN] Starting finetune ({req.epochs} epochs)...")

                import subprocess
                venv_python = str(SCRIPT_DIR / "venv" / "bin" / "python")

                # Prepare arrow dataset
                prep_script = str(F5_TTS_DIR / "src" / "f5_tts" / "train" / "datasets" / "prepare_csv_wavs.py")
                processed_dir = str(dataset_dir / "processed")
                prep_result = subprocess.run(
                    [venv_python, prep_script, str(dataset_dir), processed_dir],
                    capture_output=True, text=True,
                )
                if prep_result.returncode != 0:
                    logger.warning(f"Dataset prep warning: {prep_result.stderr[:200]}")

                # Finetune
                finetune_script = str(F5_TTS_DIR / "src" / "f5_tts" / "train" / "finetune_cli.py")
                ft_result = subprocess.run([
                    venv_python, finetune_script,
                    "--exp_name", "F5TTS_Base",
                    "--dataset_name", profile_name,
                    "--batch_size_per_gpu", "3200",
                    "--learning_rate", "1e-5",
                    "--epochs", str(req.epochs),
                    "--finetune",
                    "--pretrain", str(CKPT_FILE),
                ], capture_output=True, text=True, cwd=str(F5_TTS_DIR))

                if ft_result.returncode != 0:
                    logger.warning(f"[AUTO-TRAIN] Finetune error: {ft_result.stderr[-500:]}")
                    # Không fail - vẫn build profile từ ref audio
                else:
                    logger.info("[AUTO-TRAIN] Finetune completed!")

                status.update({"step": "building_profile", "progress": 90})

            # ── Step 8: Build voice profile ──
            logger.info(f"[AUTO-TRAIN] Building profile '{profile_name}'...")
            _build_voice_profile(profile_name, best_ref, best_text)
            _load_voice_profiles()

            # ── Done ──
            elapsed = time.time() - start_total
            status.update({
                "status": "completed",
                "step": "done",
                "progress": 100,
                "profile_name": profile_name,
                "total_segments": len(segments),
                "valid_samples": valid,
                "elapsed_s": round(elapsed, 1),
                "ref_audio": best_ref,
                "ref_duration_s": round(best["duration"], 1),
            })

            logger.info(f"[AUTO-TRAIN] Done! Profile '{profile_name}' ready in {elapsed:.1f}s")
            return status

        except Exception as e:
            logger.error(f"[AUTO-TRAIN] Error: {e}", exc_info=True)
            status.update({"status": "error", "step": "failed", "error": str(e)})
            return status

    return await loop.run_in_executor(None, _do_auto_train)


@app.get("/auto-train/status/{profile_name}")
def get_training_status(profile_name: str):
    """Xem trạng thái training của 1 profile."""
    if profile_name not in _training_status:
        raise HTTPException(404, f"No training found for '{profile_name}'")
    return _training_status[profile_name]


@app.get("/auto-train/status")
def get_all_training_status():
    """Xem trạng thái tất cả training."""
    return _training_status


if __name__ == "__main__":
    import uvicorn
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 5111
    uvicorn.run(app, host="127.0.0.1", port=port, log_level="info")
