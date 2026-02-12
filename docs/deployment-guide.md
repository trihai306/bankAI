# Deployment Guide

## Prerequisites for All Platforms
- **Node.js**: v18+
- **Python**: 3.10+ (must be in system PATH)
- **ffmpeg**: Must be installed and available in system PATH.
- **Ollama**: Must be installed and running on the target machine.

## Packaging for Distribution

The project uses `electron-builder` for packaging.

### 1. Build the Frontend
```bash
npm run build
```

### 2. Package the Application
```bash
# Generic build
npm run build:electron

# Platform specific (if configured)
# npm run build:win
# npm run build:mac
# npm run build:linux
```

## Post-Installation Requirements

Once the app is installed, the following manual steps are required for full functionality:

### Python Environment
The app expects a Python virtual environment at `{AppPath}/python/venv`.
In production, this needs to be bundled or created on first run.

1. Navigate to the `python` directory.
2. Create venv: `python -m venv venv`.
3. Install dependencies: `pip install -r requirements.txt`.

### AI Models
- **Ollama**: Run `ollama pull qwen:4b`.
- **F5-TTS**: The first run of voice cloning will trigger a download of the pretrained Vietnamese model (~5GB). Ensure a stable internet connection.
- **Whisper**: The first run of transcription will download the `base` Whisper model.

## Troubleshooting Production Builds
- **Audio Conversion**: If audio doesn't play or transcribe, check if `ffmpeg` is properly installed.
- **Python Paths**: Ensure the `python/venv/bin/python` (or `python/venv/Scripts/python.exe`) path is correct relative to the executable.
- **Database**: The SQLite file is stored in the user data directory. On Linux: `~/.config/ai-voice-bot/`. On Windows: `%APPDATA%/ai-voice-bot/`.
