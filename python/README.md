# VieNeu-TTS Vietnamese Voice Bot

## Cài đặt VieNeu-TTS

### Tự động (trong Electron)
Mở Voice Training > Nhấn "Cài đặt tự động"

### Thủ công
```bash
cd python

# Clone VieNeu-TTS
git clone https://github.com/pnnbao/VieNeu-TTS

# Cài đặt (VieNeu-TTS sử dụng .venv riêng)
cd VieNeu-TTS && pip install -e . && cd ..
```

> 💡 **Model tự động tải:** VieNeu-TTS tự động tải model GGUF từ HuggingFace khi khởi động lần đầu. Không cần clone model riêng.

## Sử dụng TTS Server

### Kiểm tra cài đặt
```bash
python setup_env.py check
```

### Chạy TTS Server (FastAPI)
```bash
python vieneu_tts_server.py
# Server chạy tại http://127.0.0.1:8179
```

### API Endpoints
| Method | Endpoint | Mô tả |
|--------|----------|--------|
| GET | `/health` | Health check + model status |
| POST | `/generate` | Tạo audio (JSON hoặc WAV binary) |
| POST | `/generate-stream` | SSE streaming audio chunks |

## Cách hoạt động

```
┌─────────────────────────────────────────────────┐
│  Electron App (React)                           │
│  VoiceChat.jsx → Trò chuyện realtime           │
│  VoiceCreate.jsx → Quản lý giọng đọc          │
└─────────────────┬───────────────────────────────┘
                  │ IPC invoke
                  ▼
┌─────────────────────────────────────────────────┐
│  Electron Main (main.js)                        │
│  ├── nodejs-whisper (whisper.cpp) → STT  [Node] │
│  ├── node-llama-cpp (Qwen3)      → LLM  [Node] │
│  └── tts-server.js → HTTP client        [Node] │
└─────────────────┬───────────────────────────────┘
                  │ HTTP POST /generate
                  ▼
┌─────────────────────────────────────────────────┐
│  VieNeu-TTS Server (vieneu_tts_server.py)       │
│    FastAPI + uvicorn                            │
│    ├── GGUF backbone (CPU) — llama.cpp          │
│    ├── Codec (CUDA) — neuphonic/distill-neucodec│
│    └── Output: WAV binary / SSE streaming       │
└─────────────────────────────────────────────────┘
```

## Cấu trúc thư mục

```
python/
├── vieneu_tts_server.py           # TTS server (FastAPI)
├── setup_env.py                   # Auto setup script
├── requirements.txt               # Python dependencies
├── venv/                          # Virtual environment (core deps)
├── VieNeu-TTS/                    # VieNeu-TTS repo (git clone)
│   ├── .venv/                     # VieNeu-TTS own venv
│   ├── src/vieneu/                # VieNeu core library
│   └── finetune/                  # LoRA fine-tuning
│       ├── dataset/raw_audio/     # Reference audio files
│       └── output/                # LoRA adapters + merged models
├── ref_audio/                     # Giọng mẫu (upload từ UI)
│   └── ref_170681234.wav
└── outputs/                       # Audio đã tạo
    └── generated_170681234.wav
```

## Yêu cầu hệ thống
- Python 3.11+
- NVIDIA GPU với CUDA (RTX 30/40/50 series)
- VRAM 8 GB+ (12 GB khuyến nghị)
- Dung lượng: ~3 GB cho model GGUF

## Model info
- **Engine**: VieNeu-TTS 0.3B
- **Backbone**: GGUF quantized (q4) — chạy trên CPU
- **Codec**: neuphonic/distill-neucodec — chạy trên CUDA
- **Nguồn**: [pnnbao-ump/VieNeu-TTS-0.3B-q4-gguf](https://huggingface.co/pnnbao-ump/VieNeu-TTS-0.3B-q4-gguf)
- **Khả năng**: Zero-shot voice cloning, LoRA fine-tuning
