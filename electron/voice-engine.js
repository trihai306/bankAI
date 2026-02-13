import path from "path";
import fs from "fs";
import os from "os";

/**
 * Reusable Voice Conversation Engine
 * Pipeline: Audio → Whisper STT → Llama LLM → F5-TTS → Audio Response
 *
 * Designed for reuse across VoiceChat (mic) and future PhoneCall (SIP) features.
 */
export class VoiceConversationEngine {
  constructor({ nodewhisper, workerPrompt, initQwenModel, runPython, ttsServer, dbAPI }) {
    this.nodewhisper = nodewhisper;
    this.workerPrompt = workerPrompt;
    this.initQwenModel = initQwenModel;
    this.runPython = runPython;
    this.ttsServer = ttsServer;
    this.dbAPI = dbAPI;

    this.isActive = false;
    this.voiceConfig = null; // { refAudio, refText, voiceId }
    this.systemPrompt =
      "Bạn là trợ lý AI ngân hàng thông minh. Trả lời ngắn gọn, rõ ràng bằng tiếng Việt. Chỉ trả lời nội dung, không giải thích thêm.";
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
      this.systemPrompt = config.systemPrompt;
    }

    console.log("[VoiceEngine] Session started", {
      voice: this.voiceConfig?.voiceName || "none",
    });

    return { success: true, voice: this.voiceConfig };
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
      let audioPath = null;
      if (this.voiceConfig?.refAudio) {
        stepStart = performance.now();
        console.log("[VoiceEngine] Step 4: F5-TTS (persistent server)...");
        try {
          const ttsResult = await this.ttsServer.generate({
            refAudio: this.voiceConfig.refAudio,
            refText: this.voiceConfig.refText || "",
            genText: responseText,
            speed: 1.0,
          });
          timings.tts = performance.now() - stepStart;

          if (ttsResult.success) {
            audioPath = ttsResult.output;
            const serverTimings = ttsResult.timings || {};
            console.log(`[VoiceEngine] ⏱ Step 4 (TTS): ${(timings.tts / 1000).toFixed(2)}s (server: preprocess=${serverTimings.preprocess}s, generate=${serverTimings.generate}s)`);
            console.log("[VoiceEngine] TTS audio:", audioPath);
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
        audioPath,
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
}
