# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

AI Voice Bot ("ai-voice-bot") - an Electron desktop app for automated banking call handling in Vietnamese. Combines a React frontend with local AI backends (F5-TTS for voice cloning, OpenAI Whisper for STT, Ollama/Qwen for text processing).

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
                                                                    ├── Python subprocess (F5-TTS, Whisper)
                                                                    └── Ollama HTTP API (:11434)
```

- **Main process** (`electron/main.js`): Window management, all IPC handlers, spawns Python subprocesses, calls Ollama API. This is a large file containing all backend logic.
- **Preload** (`electron/preload.js`): Exposes `window.electronAPI` with namespaced methods (db, voice, call, model, tts, qwen). Uses CommonJS (`require`).
- **Renderer** (`src/`): React 19 + Vite. ESM throughout. Accesses backend exclusively through `window.electronAPI`.

### IPC Namespaces

All renderer-to-main communication goes through `window.electronAPI.<namespace>.<method>()`:
- `db` - SQLite CRUD (stats, calls, settings)
- `voice` - Recording start/stop
- `call` - Initiate/hangup calls
- `model` - List/train models
- `tts` - F5-TTS voice cloning (generate, upload ref audio, convert WebM->WAV, transcribe via Whisper)
- `qwen` - Ollama text processing (correct/extract/answer tasks)

### Python Integration

Python scripts live in `python/` with their own venv at `python/venv/`. Main process spawns them via `child_process.spawn` using `python/venv/bin/python`. Scripts return JSON on stdout's last line.
- `f5_tts.py` - Vietnamese voice cloning TTS
- `transcribe.py` - Whisper-based audio transcription

### Frontend Structure

- State: Zustand store (`src/store/useStore.js`) - handles Electron API detection and data fetching
- Routing: react-router-dom with `<Layout>` wrapper
- Styling: Tailwind CSS 3 with custom purple/violet theme, glow effects, and animations
- Path alias: `@` -> `src/`

### External Dependencies

- **Ollama** must be running at `localhost:11434` with `qwen:4b` model pulled
- **ffmpeg** required for WebM-to-WAV audio conversion
- **Python venv** at `python/venv/` with F5-TTS and Whisper packages installed

### Database

SQLite at `{userData}/voice-bot.db` with WAL mode. Tables: `settings`, `calls`, `models`. Auto-initialized on app start.

## Key Patterns

- Electron main process uses ESM (`"type": "module"`), preload uses CommonJS
- Frontend gracefully degrades when `window.electronAPI` is unavailable (browser mode shows empty state)
- TTS output files auto-cleanup every 30 minutes (files older than 1 hour)
- File operations in IPC handlers validate paths against allowed directories before read/write/delete
