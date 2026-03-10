# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

AI Voice Bot ("ai-voice-bot") - an Electron desktop app for automated banking call handling in Vietnamese. Combines a React frontend with local AI backends (VieNeu-TTS for voice synthesis, whisper.cpp for STT, Qwen3 via node-llama-cpp for text processing).

## Commands

```bash
# Development (starts Vite dev server + Electron)
npm run dev:electron

# Vite-only dev server (no Electron, browser mode - limited functionality)
npm run dev

# Production build
npm run build:electron

# Lint
npm run lint
```

## Architecture

### Process Model (Electron)

```
Renderer (React/Vite :5174)  <-->  Preload (contextBridge)  <-->  Main Process (Node.js)
                                                                    ├── SQLite (better-sqlite3)
                                                                    ├── whisper.cpp (nodejs-whisper) [STT]
                                                                    ├── node-llama-cpp (Qwen3 4B)   [LLM]
                                                                    └── tts-server.js → VieNeu-TTS  [TTS]
                                                                         └── HTTP to Python FastAPI :8179
```

- **Main process** (`electron/main.js`): Window management, all IPC handlers, whisper-server, node-llama-cpp worker, tts-server HTTP client. This is a large file containing all backend logic.
- **TTS Server** (`electron/tts-server.js`): Manages persistent Python VieNeu-TTS FastAPI server on port 8179. Spawns `python/vieneu_tts_server.py` using `python/VieNeu-TTS/.venv/python`.
- **Voice Engine** (`electron/voice-engine.js`): Orchestrates full pipeline: Audio → Whisper STT → Qwen3 LLM → VieNeu-TTS → Audio Response.
- **Preload** (`electron/preload.js`): Exposes `window.electronAPI` with namespaced methods (db, voice, call, model, tts, qwen). Uses CommonJS (`require`).
- **Renderer** (`src/`): React 19 + Vite. ESM throughout. Accesses backend exclusively through `window.electronAPI`.

### IPC Namespaces

All renderer-to-main communication goes through `window.electronAPI.<namespace>.<method>()`:
- `db` - SQLite CRUD (stats, calls, settings)
- `voices` - Voice CRUD (create, update, delete, list)
- `tts` - VieNeu-TTS voice generation (generate, upload ref audio, convert WebM->WAV, transcribe via Whisper)
- `qwen` - Qwen3 text processing via node-llama-cpp (correct/extract/answer tasks)
- `voice-chat` - Realtime voice conversation pipeline (STT → LLM → TTS streaming)

### Python Integration

TTS server runs as a persistent FastAPI process at `python/vieneu_tts_server.py`. Electron's `tts-server.js` spawns it using the VieNeu-TTS venv at `python/VieNeu-TTS/.venv/`. The server stays alive and accepts HTTP requests on port 8179.

Key Python files:
- `vieneu_tts_server.py` - VieNeu-TTS FastAPI server (GGUF backbone on CPU + codec on CUDA)
- `setup_env.py` - Cross-platform environment checker and setup automation

### Frontend Structure

- State: Zustand store (`src/store/useStore.js`) - handles Electron API detection and data fetching
- Routing: react-router-dom with `<Layout>` wrapper
- Styling: Tailwind CSS 3 with custom purple/violet theme, glow effects, and animations
- Path alias: `@` -> `src/`

### External Dependencies

- **node-llama-cpp** with Qwen3 4B GGUF model (auto-downloaded)
- **ffmpeg** required for WebM-to-WAV audio conversion
- **Python 3.11+** with VieNeu-TTS installed in `python/VieNeu-TTS/.venv/`
- **CUDA Toolkit 12.8+** for GPU inference (Whisper, LLM, TTS codec)

### Database

SQLite at `{userData}/voice-bot.db` with WAL mode. Tables: `settings`, `calls`, `models`, `voices`, `training_data`. Auto-initialized on app start.

## Key Patterns

- Electron main process uses ESM (`"type": "module"`), preload uses CommonJS
- Frontend gracefully degrades when `window.electronAPI` is unavailable (browser mode shows empty state)
- TTS runs as persistent FastAPI server (model loaded once, stays in memory) — NOT subprocess per call
- TTS output files auto-cleanup every 30 minutes (files older than 1 hour)
- File operations in IPC handlers validate paths against allowed directories before read/write/delete
