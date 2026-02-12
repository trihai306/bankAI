# Product Development Requirements (PDR) - AI Voice Bot

## Project Vision
Automate banking customer service calls in Vietnamese using local, private AI models. Provide a high-quality, voice-clonable interface for bank representatives to handle repetitive queries efficiently.

## Target Users
- Banking customer service departments
- Independent financial advisors
- Automated call center operators in Vietnam

## Core Features

### 1. Voice Cloning & TTS
- **Vietnamese Support**: High-fidelity TTS specifically for Vietnamese language.
- **Reference-based Cloning**: Ability to clone voices from short (5-10s) reference audio clips.
- **Hybrid System**: Local F5-TTS for custom voices, Edge TTS for standard fallback.

### 2. Speech-to-Text (STT)
- **Local Transcription**: OpenAI Whisper running locally for privacy.
- **Forced Vietnamese**: Language-specific optimization to ensure accuracy.

### 3. Intelligent Text Processing (LLM)
- **Task Automation**: Correcting transcripts, extracting intent, and generating answers.
- **Model**: Qwen:4b via Ollama for local processing.

### 4. Call Management
- **Dashboard**: Real-time stats, resource usage, and recent call history.
- **History**: Full logs with transcripts and audio playback.
- **Dialer**: (In Progress) Interface for initiating and managing calls.

### 5. Training & Data
- **Dataset Management**: Handling Vietnamese banking Q&A datasets.
- **Voice Training**: Workflow for creating and managing cloned voice models.

## Technical Requirements
- **Local Processing**: Prioritize local execution for STT/TTS/LLM to ensure data privacy.
- **Low Latency**: Optimize IPC and subprocess communication for real-time interaction.
- **Resource Monitoring**: Track CPU/RAM/GPU usage as local models are resource-intensive.

## Constraints & Assumptions
- Requires a relatively modern GPU/CPU for local AI inference.
- F5-TTS model download is large (~5GB).
- Local Ollama instance must be running.
- Vietnamese-only focus for NLP/TTS/STT.
