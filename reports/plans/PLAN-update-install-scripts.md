# PLAN: Update Installation Scripts (F5-TTS → VieNeu-TTS)

## 📌 User Request (VERBATIM)
> cập nhật script cài đặt phần mềm

## 🎯 Acceptance Criteria
- [x] AC1: All F5-TTS references replaced with VieNeu-TTS in setup scripts
- [x] AC2: `setup_env.py` correctly references VieNeu-TTS paths and venv
- [x] AC3: `python/README.md` accurately describes VieNeu-TTS workflow
- [x] AC4: `docs/ai-setup-guide.md` reflects VieNeu-TTS architecture
- [x] AC5: `CLAUDE.md` accurately describes current architecture
- [x] AC6: Other docs (codebase-summary, system-architecture, project-roadmap) updated
- [x] AC7: Frontend pages (VoiceCreate, ModelManager) show VieNeu-TTS
- [x] AC8: `requirements.txt` comments updated

---

## Phase 1: Update `python/setup_env.py` (CRITICAL)

### Changes:
1. Replace `F5_TTS_DIR = SCRIPT_DIR / "F5-TTS-Vietnamese"` → `VIENEU_DIR = SCRIPT_DIR / "VieNeu-TTS"`
2. Update `VENV_DIR` — since TTS uses `python/VieNeu-TTS/.venv/`, setup_env.py should reference the correct venv
   - Keep `VENV_DIR = SCRIPT_DIR / "venv"` for basic Python deps
   - Add `VIENEU_VENV_DIR = VIENEU_DIR / ".venv"` for VieNeu-TTS specific checks
3. Replace `f5_tts_cloned` → `vieneu_cloned`
4. Replace `f5_tts_installed` → `vieneu_installed` (check for `vieneu` package instead of `f5-tts`)
5. Replace `cli_available` check — remove `f5-tts_infer-cli` check (no longer needed)
6. Replace `install_f5_tts()` → `install_vieneu_tts()` 
   - Install from VieNeu-TTS dir instead of F5-TTS-Vietnamese
7. Update `check_env()` output field names
8. Update `full_setup()` step messages
9. Update `find_system_python()` — keep 3.12+ requirement (VieNeu-TTS uses 3.11)
   - Actually change to 3.11+ since VieNeu places `.python-version` as 3.11
10. Add `vieneu_server_exists` check — verify `vieneu_tts_server.py` exists

### Checkpoint:
- [x] CP1: `python setup_env.py check` outputs valid JSON with updated field names

---

## Phase 2: Update `python/README.md`

### Changes:
1. Rewrite title: "VieNeu-TTS Vietnamese Voice Bot"
2. Update installation instructions:
   - Clone VieNeu-TTS instead of F5-TTS-Vietnamese
   - No need to separately clone model (loaded via HuggingFace at runtime)
3. Update CLI commands to reference `vieneu_tts_server.py`
4. Update architecture diagram — show VieNeu-TTS Server (FastAPI)
5. Update directory structure
6. Update requirements section

### Checkpoint:
- [x] CP2: README.md reflects VieNeu-TTS workflow accurately

---

## Phase 3: Update `python/requirements.txt`

### Changes:
1. Update comment: "VieNeu-TTS dependencies" instead of "F5-TTS dependencies"
2. Add `fastapi` and `uvicorn` as dependencies (needed by vieneu_tts_server.py)

### Checkpoint:
- [x] CP3: requirements.txt comments and deps are accurate

---

## Phase 4: Update `docs/ai-setup-guide.md`

### Changes:
1. Update architecture table: F5-TTS → VieNeu-TTS
2. Rewrite PHẦN 2 (Section 2):
   - Title: VieNeu-TTS instead of F5-TTS
   - Installation: Clone VieNeu-TTS, use its .venv
   - Remove model clone step (auto-downloaded at runtime)
   - Update check commands (`vieneu_tts_server.py` instead of `f5_tts.py`)
3. Update PHẦN 6 path mapping — remove f5-tts_infer-cli reference
4. Update directory structure section
5. Update Version Info table — VieNeu-TTS instead of F5-TTS

### Checkpoint:
- [x] CP4: AI setup guide accurately reflects VieNeu-TTS installation

---

## Phase 5: Update `CLAUDE.md`

### Changes:
1. Overview: Replace "F5-TTS for voice cloning" with "VieNeu-TTS for voice synthesis"
2. Architecture diagram: Remove "Python subprocess (F5-TTS, Whisper)" → add proper VieNeu-TTS server  
3. IPC namespaces: Update TTS description
4. Python Integration: Replace `f5_tts.py` with `vieneu_tts_server.py`
5. External Dependencies: Replace Ollama with node-llama-cpp, F5-TTS with VieNeu-TTS
6. Key Patterns: Update Python venv reference

### Checkpoint:
- [x] CP5: CLAUDE.md accurately describes current architecture

---

## Phase 6: Update other docs

### `docs/codebase-summary.md`:
1. AI Backend table: Replace f5_tts.py → vieneu_tts_server.py with correct description
2. Remove transcribe.py reference (Whisper is now Node.js native)

### `docs/system-architecture.md`:
1. Mermaid diagram: Python F5-TTS → VieNeu-TTS Server
2. Data Flow step 5: Update TTS description
3. Update IPC design section

### `docs/project-roadmap.md`:
1. Phase 1: Update F5-TTS reference to VieNeu-TTS

### Checkpoint:
- [x] CP6: All doc files consistent with VieNeu-TTS architecture

---

## Phase 7: Update Frontend references

### `src/pages/VoiceCreate.jsx`:
1. Line 587: "F5-TTS" → "VieNeu-TTS"

### `src/pages/ModelManager.jsx`:
1. Model entry: id, name, description → VieNeu-TTS info
2. Update size, params to match VieNeu-TTS 0.3B

### Checkpoint:
- [x] CP7: Frontend pages show VieNeu-TTS branding

---

## Risk Assessment

| Risk | Mitigation |
|------|-----------|
| Breaking `setup_env.py` IPC | Keep JSON output format compatible |
| Missing new deps | Add fastapi/uvicorn to requirements.txt |
| Venv path confusion | Clearly document both venvs |
