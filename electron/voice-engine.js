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
  constructor({ nodewhisper, workerPrompt, initQwenModel, runPython, dbAPI }) {
    this.nodewhisper = nodewhisper;
    this.workerPrompt = workerPrompt;
    this.initQwenModel = initQwenModel;
    this.runPython = runPython;
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

    const tmpDir = path.join(os.tmpdir(), "bankai-voice");
    if (!fs.existsSync(tmpDir)) {
      fs.mkdirSync(tmpDir, { recursive: true });
    }

    const wavFilename = filename || `chunk_${Date.now()}.wav`;
    const wavPath = path.join(tmpDir, wavFilename);

    try {
      // Step 1: Save audio buffer to temp WAV file
      console.log("[VoiceEngine] Step 1: Saving audio chunk...");
      const buffer = Buffer.from(audioData);
      fs.writeFileSync(wavPath, buffer);

      // Step 2: Whisper STT (via persistent whisper-server)
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

      console.log("[VoiceEngine] Transcript:", userText);

      if (!userText || userText.length < 2) {
        return { success: false, error: "No speech detected", step: "stt" };
      }

      // Step 3: Llama LLM response
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
      console.log("[VoiceEngine] LLM Response:", responseText);

      // Save to history
      this.conversationHistory.push(
        { role: "user", content: userText },
        { role: "assistant", content: responseText },
      );

      // Step 4: F5-TTS (only if voice is configured)
      let audioPath = null;
      if (this.voiceConfig?.refAudio) {
        console.log("[VoiceEngine] Step 4: F5-TTS...");
        try {
          const ttsResult = await this.runPython([
            "generate",
            "--ref-audio",
            this.voiceConfig.refAudio,
            "--ref-text",
            this.voiceConfig.refText || "",
            "--gen-text",
            responseText,
            "--speed",
            "1.0",
          ]);

          if (ttsResult.success) {
            audioPath = ttsResult.output;
            console.log("[VoiceEngine] TTS audio:", audioPath);
          } else {
            console.warn("[VoiceEngine] TTS failed:", ttsResult.error);
          }
        } catch (ttsErr) {
          console.warn("[VoiceEngine] TTS error:", ttsErr.message);
        }
      }

      // Cleanup temp file
      try {
        fs.unlinkSync(wavPath);
      } catch { }

      return {
        success: true,
        transcript: userText,
        responseText,
        audioPath,
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
