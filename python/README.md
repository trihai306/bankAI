# F5-TTS Vietnamese Voice Bot

## Cài đặt F5-TTS

### Tự động (trong Electron)
Mở Voice Training > Nhấn "Cài đặt tự động"

### Thủ công
```bash
cd python

# Clone F5-TTS Vietnamese
git clone https://github.com/nguyenthienhy/F5-TTS-Vietnamese

# Cài đặt
cd F5-TTS-Vietnamese && pip install -e .

# Tải model (~5GB)
cd ..
git lfs install
git clone https://huggingface.co/hynt/F5-TTS-Vietnamese-ViVoice
```

## Sử dụng CLI

### Kiểm tra cài đặt
```bash
python f5_tts.py check
```

### Tạo giọng nói
```bash
python f5_tts.py generate \
  --ref-audio ref_audio/sample.wav \
  --ref-text "Nội dung audio mẫu đang đọc" \
  --gen-text "Văn bản cần tạo giọng nói" \
  --speed 1.0
```

## Cách hoạt động

```
┌─────────────────────────────────────────────────┐
│  Electron App (React)                           │
│  VoiceTraining.jsx                              │
│    ├── Thu âm giọng mẫu (3-10s)                │
│    ├── Upload → python/ref_audio/              │
│    └── Gọi tts:generate                        │
└─────────────────┬───────────────────────────────┘
                  │ IPC invoke
                  ▼
┌─────────────────────────────────────────────────┐
│  Electron Main (main.js)                        │
│    └── spawn python3 f5_tts.py generate ...    │
└─────────────────┬───────────────────────────────┘
                  │ subprocess
                  ▼
┌─────────────────────────────────────────────────┐
│  Python CLI (f5_tts.py)                         │
│    └── f5-tts_infer-cli                        │
│         ├── Model: F5-TTS-Vietnamese-ViVoice   │
│         └── Output: outputs/generated_xxx.wav  │
└─────────────────────────────────────────────────┘
```

## Cấu trúc thư mục

```
python/
├── f5_tts.py                      # CLI script
├── F5-TTS-Vietnamese/             # F5-TTS repo (git clone)
├── F5-TTS-Vietnamese-ViVoice/     # Model (HuggingFace)
│   ├── model_last.pt              # Checkpoint (~1.5GB)
│   └── vocab.txt                  # Vocabulary
├── ref_audio/                     # Giọng mẫu (upload từ UI)
│   ├── ref_1706812345678.wav
│   └── sample.wav
└── outputs/                       # Audio đã tạo
    └── generated_1706812345.wav
```

## Yêu cầu hệ thống
- Python 3.12+
- RAM 8GB+
- GPU với CUDA (khuyến nghị, có thể chạy CPU nhưng chậm)
- Dung lượng: ~6GB cho model

## Model info
- **Nguồn**: [hynt/F5-TTS-Vietnamese-ViVoice](https://huggingface.co/hynt/F5-TTS-Vietnamese-ViVoice)
- **Dataset**: ~1000h dữ liệu tiếng Việt
- **Khả năng**: Zero-shot voice cloning từ 3-30s audio mẫu
