from .standard import VieNeuTTS
from .fast import FastVieNeuTTS
from .remote import RemoteVieNeuTTS

def Vieneu(mode="standard", **kwargs):
    """
    Factory function for VieNeu-TTS.

    Args:
        mode: 'standard' (CPU/GPU-GGUF), 'fast' (GPU-LMDeploy), 'remote' (API)
        **kwargs: Arguments for chosen class

    Returns:
        VieNeuTTS | RemoteVieNeuTTS instance
    """
    match mode:
        case "remote" | "api":
            return RemoteVieNeuTTS(**kwargs)
        case "fast" | "gpu":
            return FastVieNeuTTS(**kwargs)
        case _:
            return VieNeuTTS(**kwargs)
