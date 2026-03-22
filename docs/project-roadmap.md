# Project Roadmap

## Phase 1: Core AI Integration (Completed)
- [x] Basic Electron + React + Vite setup.
- [x] SQLite database integration.
- [x] Python subprocess spawning infrastructure.
- [x] Whisper STT integration (nodejs-whisper / whisper.cpp native).
- [x] VieNeu-TTS Vietnamese voice synthesis (persistent FastAPI server).
- [x] Qwen3 LLM integration via node-llama-cpp (local GGUF).

## Phase 2: UI & UX Refinement (Completed)
- [x] Custom Tailwind theme (purple/violet).
- [x] Glassmorphism layout & animations.
- [x] Voice management workflow UI (VoiceCreate).
- [x] Dashboard with stats and resource usage.
- [x] History page with transcript playback.

## Phase 3: Robustness & Reliability (Current)
- [x] Persistent whisper-server (model loaded once, reused).
- [x] Persistent VieNeu-TTS server (FastAPI on port 8179).
- [x] Realtime voice conversation pipeline (VoiceChat).
- [x] LoRA fine-tuning support for custom voices.
- [ ] Real resource monitoring (CPU/GPU/RAM).
- [ ] Better model lifecycle management (downloads/updates).
- [ ] Automated testing for IPC and Python scripts.

## Phase 4: Production Features (Planned)
- [ ] Real SIP/VoIP integration for actual calls.
- [ ] Advanced call analytics.
- [ ] Multi-voice management system.
- [ ] Dataset editor for banking Q&A.
- [ ] Windows/macOS/Linux installers.

## Phase 5: Optimization (Planned)
- [ ] Model quantization for faster inference.
- [ ] Latency reduction in audio pipeline.
- [ ] Caching for repetitive LLM queries.
- [ ] Streaming TTS/STT support.
