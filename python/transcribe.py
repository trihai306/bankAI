#!/usr/bin/env python3
"""
Audio Transcription Script using OpenAI Whisper
Converts audio (WAV, WebM, MP3) to text in Vietnamese
"""

import sys
import json
import os
import warnings
warnings.filterwarnings("ignore")

def transcribe_audio(audio_path, model_name="base"):
    """
    Transcribe audio file to text using Whisper
    
    Args:
        audio_path: Path to audio file
        model_name: Whisper model size (tiny, base, small, medium, large)
    
    Returns:
        dict: {"success": bool, "text": str, "error": str}
    """
    try:
        import whisper
        
        # Validate file exists
        if not os.path.exists(audio_path):
            return {
                "success": False,
                "error": f"File not found: {audio_path}"
            }
        
        # Load model (cached after first run)
        print(f"Loading Whisper model: {model_name}...", file=sys.stderr)
        model = whisper.load_model(model_name)
        
        # Transcribe with Vietnamese language hint
        print(f"Transcribing: {audio_path}...", file=sys.stderr)
        result = model.transcribe(
            audio_path,
            language="vi",  # Vietnamese language hint
            fp16=False,  # Use FP32 for better CPU compatibility
            verbose=False
        )
        
        text = result["text"].strip()
        
        return {
            "success": True,
            "text": text,
            "language": result.get("language", "vi")
        }
        
    except ImportError as e:
        return {
            "success": False,
            "error": f"Whisper not installed: {str(e)}"
        }
    except Exception as e:
        return {
            "success": False,
            "error": f"Transcription failed: {str(e)}"
        }

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(json.dumps({
            "success": False,
            "error": "Usage: python transcribe.py <audio_file> [model_name]"
        }))
        sys.exit(1)
    
    audio_path = sys.argv[1]
    model_name = sys.argv[2] if len(sys.argv) > 2 else "base"
    
    result = transcribe_audio(audio_path, model_name)
    print(json.dumps(result, ensure_ascii=False))
