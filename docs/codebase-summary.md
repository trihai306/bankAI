# Codebase Summary

## Overview
AI Voice Bot is an Electron-based application designed for automated banking call handling in Vietnamese. It integrates local AI models for Text-to-Speech (TTS), Speech-to-Text (STT), and Large Language Model (LLM) processing.

## Backend (Electron)

| File | Purpose | Key Functions/Components |
|------|---------|-------------------------|
| `electron/main.js` | Main entry point for Electron. Manages windows and IPC. | IPC handlers (`tts`, `qwen`, `voice`, `db`, `voice-chat`) |
| `electron/preload.js` | Secure bridge between Main and Renderer processes. | `contextBridge` exposing `window.electronAPI` |
| `electron/db.js` | SQLite database management using `better-sqlite3`. | `initDB`, `dbAPI` (Dashboard stats, Calls, Settings, Voices) |
| `electron/tts-server.js` | VieNeu-TTS server manager (persistent Python FastAPI). | `TTSServerManager` (start, stop, generate, generateWav) |
| `electron/voice-engine.js` | Realtime voice conversation pipeline. | `VoiceConversationEngine` (STT → LLM → TTS) |
| `electron/whisper-server.js` | Persistent whisper.cpp STT server. | `WhisperServerManager` (transcribe) |

## Frontend (React)

| File/Dir | Purpose | Key Functions/Components |
|----------|---------|-------------------------|
| `src/main.jsx` | React entry point. | Renders `<App />` into the DOM. |
| `src/App.jsx` | Router configuration. | Defines routes for Dashboard, History, Settings, etc. |
| `src/store/useStore.js` | Global state management via Zustand. | App settings, Electron API status, data fetching. |
| `src/components/Layout.jsx` | Main application shell. | Sidebar navigation, glassmorphism layout, global theme. |
| `src/pages/Dashboard.jsx` | Overview of system status. | Call stats, resource usage monitoring, recent activity. |
| `src/pages/VoiceCreate.jsx` | Voice management interface. | Creating, editing, and testing voice profiles for VieNeu-TTS. |
| `src/pages/VoiceChat.jsx` | Realtime voice conversation. | STT → LLM → TTS streaming pipeline with audio playback. |
| `src/pages/HealthCheck.jsx` | System health monitoring. | Whisper, LLM, VieNeu-TTS status checks. |
| `src/pages/History.jsx` | Call logs and transcripts. | Historical call data with playback and transcript view. |
| `src/pages/ModelManager.jsx` | AI model management. | Model status for Qwen3, Whisper, VieNeu-TTS. |
| `src/pages/Settings.jsx` | Configuration page. | TTS, STT, and LLM selection and tuning. |
| `src/pages/TrainingData.jsx` | Dataset browser. | Viewing banking knowledge and Q&A datasets. |

## AI Backend (Python)

| File | Purpose | Logic |
|------|---------|-------|
| `python/vieneu_tts_server.py` | Vietnamese TTS Server. | VieNeu-TTS 0.3B GGUF backbone (CPU) + codec (CUDA), FastAPI + uvicorn on port 8179. |
| `python/setup_env.py` | Environment setup automation. | Cross-platform venv creation, dependency installation, VieNeu-TTS status checks. |

## Data Resources
- `training-data/`: Contains `.json`, `.csv`, and `.txt` files with banking domain knowledge in Vietnamese.
- `python/ref_audio/`: Storage for reference `.wav` files used in voice cloning.
- `python/outputs/`: Temporary storage for generated TTS audio files.
- `python/VieNeu-TTS/finetune/`: LoRA fine-tuning datasets, adapters, and merged models.
