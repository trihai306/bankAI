import path from "path";
import fs from "fs";
import os from "os";

/**
 * Reusable Voice Conversation Engine
 * Pipeline: Audio → Whisper STT → Llama LLM → F5-TTS → Audio Response
 *
 * Designed for reuse across VoiceChat (mic) and future PhoneCall (SIP) features.
 */
// Sentence delimiters — when LLM output hits one of these, flush to TTS
const SENTENCE_DELIMITERS = /[.!?;。！？\n]/;

export class VoiceConversationEngine {
  constructor({ nodewhisper, workerPrompt, workerPromptStream, initQwenModel, runPython, ttsServer, dbAPI }) {
    this.nodewhisper = nodewhisper;
    this.workerPrompt = workerPrompt;
    this.workerPromptStream = workerPromptStream;
    this.initQwenModel = initQwenModel;
    this.runPython = runPython;
    this.ttsServer = ttsServer;
    this.dbAPI = dbAPI;

    this.isActive = false;
    this.voiceConfig = null; // { refAudio, refText, voiceId }
    this.baseSystemPrompt =
      "Bạn là trợ lý AI ngân hàng thông minh. Trả lời ngắn gọn, rõ ràng bằng tiếng Việt. Chỉ trả lời nội dung, không giải thích thêm.";
    this.systemPrompt = this.baseSystemPrompt;
    this.conversationHistory = [];
  }

  start(config = {}) {
    this.isActive = true;
    this.conversationHistory = [];

    if (config.voiceId) {
      const voice = this.dbAPI.getVoice(config.voiceId);
      if (voice) {
        this.voiceConfig = {
          refAudio: voice.audio_path,
          refText: voice.transcript || "",
          voiceId: voice.id,
          voiceName: voice.name,
        };
      }
    }

    if (config.systemPrompt) {
      this.baseSystemPrompt = config.systemPrompt;
    }

    // Load training data and build system prompt
    this.loadTrainingData();

    console.log("[VoiceEngine] Session started", {
      voice: this.voiceConfig?.voiceName || "none",
      trainingDataLoaded: this.systemPrompt !== this.baseSystemPrompt,
    });

    return { success: true, voice: this.voiceConfig };
  }

  loadTrainingData() {
    try {
      const entries = this.dbAPI.getActiveTrainingData();
      if (entries && entries.length > 0) {
        const trainingBlock = entries
          .map((e) => `### ${e.title}\n${e.content}`)
          .join("\n\n");
        this.systemPrompt = `[KIẾN THỨC THAM KHẢO]\n${trainingBlock}\n[/KIẾN THỨC THAM KHẢO]\n\n${this.baseSystemPrompt}`;
        console.log(`[VoiceEngine] Loaded ${entries.length} training data entries into system prompt`);
      } else {
        this.systemPrompt = this.baseSystemPrompt;
        console.log("[VoiceEngine] No active training data");
      }
    } catch (err) {
      console.warn("[VoiceEngine] Failed to load training data:", err.message);
      this.systemPrompt = this.baseSystemPrompt;
    }
  }

  stop() {
    this.isActive = false;
    const history = [...this.conversationHistory];
    this.conversationHistory = [];
    console.log("[VoiceEngine] Session stopped");
    return { success: true, history };
  }

  getStatus() {
    return {
      isActive: this.isActive,
      voice: this.voiceConfig,
      historyLength: this.conversationHistory.length,
    };
  }

  async processAudioChunk(audioData, filename) {
    if (!this.isActive) {
      return { success: false, error: "Voice engine not active" };
    }

    const pipelineStart = performance.now();
    const timings = {};

    const tmpDir = path.join(os.tmpdir(), "bankai-voice");
    if (!fs.existsSync(tmpDir)) {
      fs.mkdirSync(tmpDir, { recursive: true });
    }

    const wavFilename = filename || `chunk_${Date.now()}.wav`;
    const wavPath = path.join(tmpDir, wavFilename);

    try {
      // Step 1: Save audio buffer to temp WAV file
      let stepStart = performance.now();
      console.log("[VoiceEngine] Step 1: Saving audio chunk...");
      const buffer = Buffer.from(audioData);
      fs.writeFileSync(wavPath, buffer);
      timings.save = performance.now() - stepStart;
      console.log(`[VoiceEngine] ⏱ Step 1 (Save): ${timings.save.toFixed(0)}ms`);

      // Step 2: Whisper STT (via persistent whisper-server)
      stepStart = performance.now();
      console.log("[VoiceEngine] Step 2: Whisper STT...");
      const transcript = await this.nodewhisper(wavPath, {
        whisperOptions: {
          language: "vi",
        },
      });

      // whisper-server returns clean text directly (no timestamps)
      const userText = (typeof transcript === "string" ? transcript : "")
        .replace(
          /\[\d{2}:\d{2}:\d{2}\.\d{3}\s*-->\s*\d{2}:\d{2}:\d{2}\.\d{3}\]\s*/g,
          "",
        )
        .trim();
      timings.stt = performance.now() - stepStart;
      console.log(`[VoiceEngine] ⏱ Step 2 (STT): ${(timings.stt / 1000).toFixed(2)}s`);
      console.log("[VoiceEngine] Transcript:", userText);

      if (!userText || userText.length < 2) {
        return { success: false, error: "No speech detected", step: "stt" };
      }

      // Step 3: Llama LLM response
      stepStart = performance.now();
      console.log("[VoiceEngine] Step 3: Llama LLM...");
      await this.initQwenModel();

      const contextMessages = this.conversationHistory
        .slice(-6)
        .map((m) => `${m.role === "user" ? "Người dùng" : "AI"}: ${m.content}`)
        .join("\n");

      const fullPrompt = contextMessages
        ? `${this.systemPrompt}\n\nLịch sử hội thoại:\n${contextMessages}\n\nNgười dùng: ${userText}\n\nAI:`
        : `${this.systemPrompt}\n\nNgười dùng: ${userText}\n\nAI:`;

      const responseText = await this.workerPrompt(fullPrompt, 0.5, 0.9);
      timings.llm = performance.now() - stepStart;
      console.log(`[VoiceEngine] ⏱ Step 3 (LLM): ${(timings.llm / 1000).toFixed(2)}s`);
      console.log("[VoiceEngine] LLM Response:", responseText);

      // Save to history
      this.conversationHistory.push(
        { role: "user", content: userText },
        { role: "assistant", content: responseText },
      );

      // Step 4: F5-TTS via persistent server (model stays in GPU memory)
      let audioBuffer = null;
      if (this.voiceConfig?.refAudio) {
        stepStart = performance.now();
        console.log("[VoiceEngine] Step 4: F5-TTS (persistent server)...");
        try {
          const ttsResult = await this.ttsServer.generateWav({
            refAudio: this.voiceConfig.refAudio,
            refText: this.voiceConfig.refText || "",
            genText: responseText,
            speed: 1.0,
          });
          timings.tts = performance.now() - stepStart;

          if (ttsResult.success) {
            audioBuffer = ttsResult.audioBuffer;
            const serverTimings = ttsResult.timings || {};
            console.log(`[VoiceEngine] ⏱ Step 4 (TTS): ${(timings.tts / 1000).toFixed(2)}s (server: preprocess=${serverTimings.preprocess}s, generate=${serverTimings.generate}s)`);
            console.log(`[VoiceEngine] TTS audio: ${audioBuffer.length} bytes`);
          } else {
            console.warn(`[VoiceEngine] ⏱ Step 4 (TTS) FAILED after ${(timings.tts / 1000).toFixed(2)}s:`, ttsResult.error);
          }
        } catch (ttsErr) {
          timings.tts = performance.now() - stepStart;
          console.warn(`[VoiceEngine] ⏱ Step 4 (TTS) ERROR after ${(timings.tts / 1000).toFixed(2)}s:`, ttsErr.message);
        }
      }

      // Pipeline summary
      const totalTime = performance.now() - pipelineStart;
      timings.total = totalTime;
      console.log("");
      console.log("╔══════════════════════════════════════════╗");
      console.log("║     🎤 Voice Pipeline Performance        ║");
      console.log("╠══════════════════════════════════════════╣");
      console.log(`║  Step 1 (Save)  : ${String(timings.save.toFixed(0)).padStart(6)}ms             ║`);
      console.log(`║  Step 2 (STT)   : ${String((timings.stt / 1000).toFixed(2)).padStart(6)}s              ║`);
      console.log(`║  Step 3 (LLM)   : ${String((timings.llm / 1000).toFixed(2)).padStart(6)}s              ║`);
      console.log(`║  Step 4 (TTS)   : ${String(((timings.tts || 0) / 1000).toFixed(2)).padStart(6)}s              ║`);
      console.log("╠══════════════════════════════════════════╣");
      console.log(`║  ⚡ Total       : ${String((totalTime / 1000).toFixed(2)).padStart(6)}s              ║`);
      console.log("╚══════════════════════════════════════════╝");
      console.log("");

      // Cleanup temp file
      try {
        fs.unlinkSync(wavPath);
      } catch { }

      return {
        success: true,
        transcript: userText,
        responseText,
        audioBuffer,
        timings,
      };
    } catch (error) {
      console.error("[VoiceEngine] Pipeline error:", error);
      // Cleanup temp file on error
      try {
        fs.unlinkSync(wavPath);
      } catch { }
      return { success: false, error: error.message };
    }
  }

  /**
   * Streaming pipeline: STT → LLM stream → sentence accumulator → TTS parallel → audio queue
   * @param {Uint8Array|number[]} audioData - raw WAV data
   * @param {string} filename
   * @param {function} onEvent - callback for streaming events:
   *   { type: 'stt-done',  transcript }
   *   { type: 'llm-chunk', text, fullText }  — each sentence-level chunk
   *   { type: 'tts-audio', audioBuffer, chunkIndex }
   *   { type: 'done',      timings, responseText }
   */
  /**
   * Text-only pipeline: skip STT, go directly to LLM → TTS
   * Used when user types text instead of speaking
   * @param {string} userText - the text typed by user
   * @param {function} onEvent - same callback interface as processAudioChunkStream
   */
  async processTextStream(userText, onEvent) {
    if (!this.isActive) {
      return { success: false, error: "Voice engine not active" };
    }

    const trimmedText = (userText || "").trim();
    if (!trimmedText || trimmedText.length < 2) {
      return { success: false, error: "Empty text" };
    }

    console.log("");
    console.log("╔══════════════════════════════════════════════════╗");
    console.log("║  ⌨️  TEXT INPUT PIPELINE ACTIVATED                ║");
    console.log("╚══════════════════════════════════════════════════╝");
    console.log(`[VoiceEngine:Text] Input: "${trimmedText}"`);

    const pipelineStart = performance.now();
    const timings = {};

    try {
      // Notify frontend: "STT done" (text input, no actual STT)
      onEvent?.({ type: "stt-done", transcript: trimmedText });

      // LLM streaming (reuse same logic as processAudioChunkStream)
      const stepStart = performance.now();
      console.log("[VoiceEngine:Text] Step: Llama LLM (streaming)...");
      await this.initQwenModel();

      const contextMessages = this.conversationHistory
        .slice(-6)
        .map((m) => `${m.role === "user" ? "Người dùng" : "AI"}: ${m.content}`)
        .join("\n");

      const fullPrompt = contextMessages
        ? `${this.systemPrompt}\n\nLịch sử hội thoại:\n${contextMessages}\n\nNgười dùng: ${trimmedText}\n\nAI:`
        : `${this.systemPrompt}\n\nNgười dùng: ${trimmedText}\n\nAI:`;

      let sentenceBuffer = "";
      let fullResponseText = "";
      let chunkIndex = 0;
      const audioBuffers = [];
      const ttsPromises = [];
      const chunkTimings = [];  // { idx, flushT, ttsReadyT, text }

      const MAX_TTS_CONCURRENT = 3;
      let activeTts = 0;
      const ttsPending = [];

      const startTtsTask = (idx, text) => {
        const run = async () => {
          activeTts++;
          try {
            const ttsResult = await this.ttsServer.generateWav({
              refAudio: this.voiceConfig.refAudio,
              refText: this.voiceConfig.refText || "",
              genText: text,
              speed: 1.0,
            });

            if (ttsResult.success) {
              audioBuffers[idx] = ttsResult.audioBuffer;
              const ttsReadyT = ((performance.now() - pipelineStart) / 1000).toFixed(2);
              if (chunkTimings[idx]) chunkTimings[idx].ttsReadyT = ttsReadyT;
              console.log(`[VoiceEngine:Text] 🔊 TTS chunk ${idx} ready (t=${ttsReadyT}s, ${ttsResult.audioBuffer.length} bytes)`);
              onEvent?.({ type: "tts-audio", audioBuffer: ttsResult.audioBuffer, chunkIndex: idx });
            } else {
              console.warn(`[VoiceEngine:Text] TTS chunk ${idx} failed:`, ttsResult.error);
              audioBuffers[idx] = null;
              onEvent?.({ type: "tts-chunk-failed", chunkIndex: idx });
            }
          } catch (err) {
            console.warn(`[VoiceEngine:Text] TTS chunk ${idx} error:`, err.message);
            audioBuffers[idx] = null;
            onEvent?.({ type: "tts-chunk-failed", chunkIndex: idx });
          }
          activeTts--;
          if (ttsPending.length > 0) {
            const next = ttsPending.shift();
            next();
          }
        };

        const promise = new Promise((resolve) => {
          const wrappedRun = async () => {
            await run();
            resolve();
          };
          if (activeTts < MAX_TTS_CONCURRENT) {
            wrappedRun();
          } else {
            ttsPending.push(wrappedRun);
          }
        });
        ttsPromises.push(promise);
      };

      const flushSentence = (sentence) => {
        const trimmed = sentence.trim();
        if (!trimmed || trimmed.length < 2) return;

        const idx = chunkIndex++;
        const flushT = ((performance.now() - pipelineStart) / 1000).toFixed(2);
        chunkTimings[idx] = { idx, flushT, ttsReadyT: '-', text: trimmed.substring(0, 40) };
        console.log(`[VoiceEngine:Text] 📝 Chunk ${idx}: "${trimmed}" → TTS fired (t=${flushT}s)`);
        onEvent?.({ type: "llm-chunk", text: trimmed, fullText: fullResponseText });

        if (this.voiceConfig?.refAudio) {
          startTtsTask(idx, trimmed);
        }
      };

      const responseText = await this.workerPromptStream(
        fullPrompt,
        (token) => {
          fullResponseText += token;
          sentenceBuffer += token;

          const match = sentenceBuffer.match(SENTENCE_DELIMITERS);
          if (match) {
            const delimiterIdx = sentenceBuffer.indexOf(match[0]);
            const sentence = sentenceBuffer.substring(0, delimiterIdx + 1);
            sentenceBuffer = sentenceBuffer.substring(delimiterIdx + 1);
            flushSentence(sentence);
          }
        },
        0.5,
        0.9,
      );

      if (sentenceBuffer.trim().length >= 2) {
        flushSentence(sentenceBuffer);
      }
      sentenceBuffer = "";

      timings.llm = performance.now() - stepStart;
      console.log(`[VoiceEngine:Text] ⏱ LLM: ${(timings.llm / 1000).toFixed(2)}s (${chunkIndex} chunks)`);

      this.conversationHistory.push(
        { role: "user", content: trimmedText },
        { role: "assistant", content: responseText },
      );

      const ttsStart = performance.now();
      await Promise.allSettled(ttsPromises);
      timings.tts = performance.now() - ttsStart;
      console.log(`[VoiceEngine:Text] ⏱ TTS total: ${(timings.tts / 1000).toFixed(2)}s`);

      const totalTime = performance.now() - pipelineStart;
      timings.total = totalTime;
      console.log("");
      console.log("╔══════════════════════════════════════════════════════════════════════════════╗");
      console.log("║   ⌨️  Text Input Pipeline Performance                                       ║");
      console.log("╠══════════════════════════════════════════════════════════════════════════════╣");
      console.log(`║  LLM            : ${String((timings.llm / 1000).toFixed(2)).padStart(6)}s  (${chunkIndex} chunks)                                     ║`);
      console.log(`║  TTS wait       : ${String((timings.tts / 1000).toFixed(2)).padStart(6)}s  (parallel×2)                                       ║`);
      console.log(`║  ⚡ Total       : ${String((totalTime / 1000).toFixed(2)).padStart(6)}s                                                ║`);
      console.log("╠══════════════════════════════════════════════════════════════════════════════╣");
      console.log("║  Chunk │ LLM Flush │ TTS Ready │ Text                                       ║");
      console.log("║────────┼───────────┼───────────┼────────────────────────────────────────────║");
      for (const ct of chunkTimings) {
        if (!ct) continue;
        const idxStr = String(ct.idx).padStart(5);
        const flushStr = (ct.flushT + 's').padStart(8);
        const ttsStr = (ct.ttsReadyT === '-' ? '   -   ' : (ct.ttsReadyT + 's').padStart(8));
        const textStr = ct.text.padEnd(40).substring(0, 40);
        console.log(`║  ${idxStr} │ ${flushStr}  │ ${ttsStr}  │ ${textStr} ║`);
      }
      console.log("╚══════════════════════════════════════════════════════════════════════════════╝");
      console.log("");

      onEvent?.({ type: "done", timings, responseText, chunkCount: chunkIndex });

      return {
        success: true,
        transcript: trimmedText,
        responseText,
        audioBuffers: audioBuffers.filter(Boolean),
        chunkCount: chunkIndex,
        timings,
      };
    } catch (error) {
      console.error("[VoiceEngine:Text] Pipeline error:", error);
      return { success: false, error: error.message };
    }
  }

  async processAudioChunkStream(audioData, filename, onEvent) {
    if (!this.isActive) {
      return { success: false, error: "Voice engine not active" };
    }

    console.log("");
    console.log("╔══════════════════════════════════════════════════╗");
    console.log("║  🚀 STREAMING PIPELINE ACTIVATED                 ║");
    console.log("╚══════════════════════════════════════════════════╝");
    console.log("");

    const pipelineStart = performance.now();
    const timings = {};

    const tmpDir = path.join(os.tmpdir(), "bankai-voice");
    if (!fs.existsSync(tmpDir)) {
      fs.mkdirSync(tmpDir, { recursive: true });
    }

    const wavFilename = filename || `chunk_${Date.now()}.wav`;
    const wavPath = path.join(tmpDir, wavFilename);

    try {
      // Step 1: Save audio buffer to temp WAV file
      let stepStart = performance.now();
      const buffer = Buffer.from(audioData);
      fs.writeFileSync(wavPath, buffer);
      timings.save = performance.now() - stepStart;

      // Step 2: Whisper STT
      stepStart = performance.now();
      console.log("[VoiceEngine:Stream] Step 2: Whisper STT...");
      const transcript = await this.nodewhisper(wavPath, {
        whisperOptions: { language: "vi" },
      });

      const userText = (typeof transcript === "string" ? transcript : "")
        .replace(
          /\[\d{2}:\d{2}:\d{2}\.\d{3}\s*-->\s*\d{2}:\d{2}:\d{2}\.\d{3}\]\s*/g,
          "",
        )
        .trim();
      timings.stt = performance.now() - stepStart;
      console.log(`[VoiceEngine:Stream] ⏱ STT: ${(timings.stt / 1000).toFixed(2)}s — "${userText}"`);

      if (!userText || userText.length < 2) {
        return { success: false, error: "No speech detected", step: "stt" };
      }

      // Notify frontend: STT done
      onEvent?.({ type: "stt-done", transcript: userText });

      // Step 3: Llama LLM streaming
      stepStart = performance.now();
      console.log("[VoiceEngine:Stream] Step 3: Llama LLM (streaming)...");
      await this.initQwenModel();

      const contextMessages = this.conversationHistory
        .slice(-6)
        .map((m) => `${m.role === "user" ? "Người dùng" : "AI"}: ${m.content}`)
        .join("\n");

      const fullPrompt = contextMessages
        ? `${this.systemPrompt}\n\nLịch sử hội thoại:\n${contextMessages}\n\nNgười dùng: ${userText}\n\nAI:`
        : `${this.systemPrompt}\n\nNgười dùng: ${userText}\n\nAI:`;

      // Sentence accumulator + parallel TTS with concurrency limit
      let sentenceBuffer = "";
      let fullResponseText = "";
      let chunkIndex = 0;
      const audioBuffers = [];  // ordered results (Buffer objects)
      const ttsPromises = [];   // all TTS promises for final await
      const chunkTimings = [];  // { idx, flushT, ttsReadyT, text }

      // Concurrency-limited parallel TTS pool (F5-TTS can't handle too many connections)
      const MAX_TTS_CONCURRENT = 3;
      let activeTts = 0;
      const ttsPending = [];    // overflow queue when at max concurrency

      const startTtsTask = (idx, text) => {
        const run = async () => {
          activeTts++;
          try {
            const ttsResult = await this.ttsServer.generateWav({
              refAudio: this.voiceConfig.refAudio,
              refText: this.voiceConfig.refText || "",
              genText: text,
              speed: 1.0,
            });

            if (ttsResult.success) {
              audioBuffers[idx] = ttsResult.audioBuffer;
              const ttsReadyT = ((performance.now() - pipelineStart) / 1000).toFixed(2);
              if (chunkTimings[idx]) chunkTimings[idx].ttsReadyT = ttsReadyT;
              console.log(`[VoiceEngine:Stream] 🔊 TTS chunk ${idx} ready (t=${ttsReadyT}s, ${ttsResult.audioBuffer.length} bytes)`);
              onEvent?.({ type: "tts-audio", audioBuffer: ttsResult.audioBuffer, chunkIndex: idx });
            } else {
              console.warn(`[VoiceEngine:Stream] TTS chunk ${idx} failed:`, ttsResult.error);
              audioBuffers[idx] = null;
              onEvent?.({ type: "tts-chunk-failed", chunkIndex: idx });
            }
          } catch (err) {
            console.warn(`[VoiceEngine:Stream] TTS chunk ${idx} error:`, err.message);
            audioBuffers[idx] = null;
            onEvent?.({ type: "tts-chunk-failed", chunkIndex: idx });
          }
          activeTts--;
          // Start next pending task if any
          if (ttsPending.length > 0) {
            const next = ttsPending.shift();
            next();
          }
        };

        const promise = new Promise((resolve) => {
          const wrappedRun = async () => {
            await run();
            resolve();
          };
          if (activeTts < MAX_TTS_CONCURRENT) {
            wrappedRun();
          } else {
            ttsPending.push(wrappedRun);
          }
        });
        ttsPromises.push(promise);
      };

      const flushSentence = (sentence) => {
        const trimmed = sentence.trim();
        if (!trimmed || trimmed.length < 2) return;

        const idx = chunkIndex++;
        const flushT = ((performance.now() - pipelineStart) / 1000).toFixed(2);
        chunkTimings[idx] = { idx, flushT, ttsReadyT: '-', text: trimmed.substring(0, 40) };
        console.log(`[VoiceEngine:Stream] 📝 Chunk ${idx}: "${trimmed}" → TTS fired (t=${flushT}s)`);

        // Notify frontend: LLM sentence chunk
        onEvent?.({ type: "llm-chunk", text: trimmed, fullText: fullResponseText });

        // Fire TTS (parallel, concurrency-limited)
        if (this.voiceConfig?.refAudio) {
          startTtsTask(idx, trimmed);
        }
      };

      // Stream tokens from LLM
      const responseText = await this.workerPromptStream(
        fullPrompt,
        (token) => {
          fullResponseText += token;
          sentenceBuffer += token;

          // Check for sentence delimiter
          const match = sentenceBuffer.match(SENTENCE_DELIMITERS);
          if (match) {
            const delimiterIdx = sentenceBuffer.indexOf(match[0]);
            const sentence = sentenceBuffer.substring(0, delimiterIdx + 1);
            sentenceBuffer = sentenceBuffer.substring(delimiterIdx + 1);
            flushSentence(sentence);
          }
        },
        0.5,
        0.9,
      );

      // Flush remaining buffer
      if (sentenceBuffer.trim().length >= 2) {
        flushSentence(sentenceBuffer);
      }
      sentenceBuffer = "";

      timings.llm = performance.now() - stepStart;
      console.log(`[VoiceEngine:Stream] ⏱ LLM: ${(timings.llm / 1000).toFixed(2)}s (${chunkIndex} chunks)`);

      // Save to history
      this.conversationHistory.push(
        { role: "user", content: userText },
        { role: "assistant", content: responseText },
      );

      // Wait for all TTS tasks to complete
      const ttsStart = performance.now();
      await Promise.allSettled(ttsPromises);
      timings.tts = performance.now() - ttsStart;
      console.log(`[VoiceEngine:Stream] ⏱ TTS total: ${(timings.tts / 1000).toFixed(2)}s`);

      // Pipeline summary
      const totalTime = performance.now() - pipelineStart;
      timings.total = totalTime;
      console.log("");
      console.log("╔══════════════════════════════════════════════════════════════════════════════╗");
      console.log("║   🎤 Voice Stream Pipeline Performance                                       ║");
      console.log("╠══════════════════════════════════════════════════════════════════════════════╣");
      console.log(`║  Save           : ${String(timings.save.toFixed(0)).padStart(6)}ms                                              ║`);
      console.log(`║  STT            : ${String((timings.stt / 1000).toFixed(2)).padStart(6)}s                                               ║`);
      console.log(`║  LLM            : ${String((timings.llm / 1000).toFixed(2)).padStart(6)}s  (${chunkIndex} chunks)                                     ║`);
      console.log(`║  TTS wait       : ${String((timings.tts / 1000).toFixed(2)).padStart(6)}s  (parallel×2)                                       ║`);
      console.log(`║  ⚡ Total       : ${String((totalTime / 1000).toFixed(2)).padStart(6)}s                                                ║`);
      console.log("╠══════════════════════════════════════════════════════════════════════════════╣");
      console.log("║  Chunk │ LLM Flush │ TTS Ready │ Text                                       ║");
      console.log("║────────┼───────────┼───────────┼────────────────────────────────────────────║");
      for (const ct of chunkTimings) {
        if (!ct) continue;
        const idxStr = String(ct.idx).padStart(5);
        const flushStr = (ct.flushT + 's').padStart(8);
        const ttsStr = (ct.ttsReadyT === '-' ? '   -   ' : (ct.ttsReadyT + 's').padStart(8));
        const textStr = ct.text.padEnd(40).substring(0, 40);
        console.log(`║  ${idxStr} │ ${flushStr}  │ ${ttsStr}  │ ${textStr} ║`);
      }
      console.log("╚══════════════════════════════════════════════════════════════════════════════╝");
      console.log("");

      // Notify frontend: done
      onEvent?.({ type: "done", timings, responseText, chunkCount: chunkIndex });

      // Cleanup temp file
      try {
        fs.unlinkSync(wavPath);
      } catch { }

      return {
        success: true,
        transcript: userText,
        responseText,
        audioBuffers: audioBuffers.filter(Boolean),
        chunkCount: chunkIndex,
        timings,
      };
    } catch (error) {
      console.error("[VoiceEngine:Stream] Pipeline error:", error);
      try {
        fs.unlinkSync(wavPath);
      } catch { }
      return { success: false, error: error.message };
    }
  }
}
