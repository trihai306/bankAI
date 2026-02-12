# Codebase Summary

## Overview
AI Voice Bot is an Electron-based application designed for automated banking call handling in Vietnamese. It integrates local AI models for Text-to-Speech (TTS), Speech-to-Text (STT), and Large Language Model (LLM) processing.

## Backend (Electron)

| File | Purpose | Key Functions/Components |
|------|---------|-------------------------|
| `electron/main.js` | Main entry point for Electron. Manages windows and IPC. | `spawnPython`, IPC handlers (`tts`, `qwen`, `voice`, `db`) |
| `electron/preload.js` | Secure bridge between Main and Renderer processes. | `contextBridge` exposing `window.electronAPI` |
| `electron/db.js` | SQLite database management using `better-sqlite3`. | `initDB`, `dbAPI` (Dashboard stats, Calls, Settings) |
| `electron/edge-tts.js` | Cloud fallback for TTS using Microsoft Edge API. | `generateSpeech`, `getVoices`, `cleanupOldFiles` |

## Frontend (React)

| File/Dir | Purpose | Key Functions/Components |
|----------|---------|-------------------------|
| `src/main.jsx` | React entry point. | Renders `<App />` into the DOM. |
| `src/App.jsx` | Router configuration. | Defines routes for Dashboard, History, Settings, etc. |
| `src/store/useStore.js` | Global state management via Zustand. | App settings, Electron API status, data fetching. |
| `src/components/Layout.jsx` | Main application shell. | Sidebar navigation, glassmorphism layout, global theme. |
| `src/components/WaveformVisualizer.jsx` | Audio visualization. | Real-time canvas-based waveform from audio streams. |
| `src/pages/Dashboard.jsx` | Overview of system status. | Call stats, resource usage monitoring (placeholder), recent activity. |
| `src/pages/VoiceTraining.jsx` | Voice cloning interface. | Recording reference audio, generating clones via F5-TTS. |
| `src/pages/CallCenter.jsx` | Active call management. | Dialer UI, live call status, interaction log. |
| `src/pages/Chat.jsx` | LLM playground. | Testing Qwen/Ollama responses with custom prompts. |
| `src/pages/History.jsx` | Call logs and transcripts. | Historical call data with playback and transcript view. |
| `src/pages/ModelManager.jsx` | AI model management. | Installing and updating AI models (partially implemented). |
| `src/pages/Settings.jsx` | Configuration page. | TTS, STT, and LLM selection and tuning. |
| `src/pages/TrainingData.jsx` | Dataset browser. | Viewing banking knowledge and Q&A datasets. |

## AI Backend (Python)

| File | Purpose | Logic |
|------|---------|-------|
| `python/f5_tts.py` | Vietnamese Voice Cloning. | Uses F5-TTS architecture for zero-shot voice cloning. |
| `python/transcribe.py` | Speech-to-Text. | Uses OpenAI Whisper (base model) for Vietnamese transcription. |

## Data Resources
- `training-data/`: Contains `.json`, `.csv`, and `.txt` files with banking domain knowledge in Vietnamese.
- `python/ref_audio/`: Storage for reference `.wav` files used in voice cloning.
- `python/outputs/`: Temporary storage for generated TTS audio files.
