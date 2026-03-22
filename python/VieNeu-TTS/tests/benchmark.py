import time
import numpy as np
from vieneu_utils.normalize_text import VietnameseTTSNormalizer
from vieneu_utils.phonemize_text import phonemize_with_dict
from vieneu_utils.core_utils import split_text_into_chunks

def benchmark_normalization(n_iterations=100):
    normalizer = VietnameseTTSNormalizer()
    text = "Ngày 21/02/2025 lúc 14h30, giá vàng đạt 100$ tại TPHCM. Phiên bản 1.0.4, tốc độ 60km/h."

    start = time.time()
    for _ in range(n_iterations):
        _ = normalizer.normalize(text)
    end = time.time()

    avg_time = (end - start) / n_iterations
    print(f"Average Normalization Time: {avg_time*1000:.4f} ms")

def benchmark_phonemization(n_iterations=10):
    text = "Xin chào Việt Nam, đây là một ví dụ về chuyển đổi văn bản thành âm thanh."

    start = time.time()
    for _ in range(n_iterations):
        _ = phonemize_with_dict(text)
    end = time.time()

    avg_time = (end - start) / n_iterations
    print(f"Average Phonemization Time: {avg_time*1000:.4f} ms")

def benchmark_text_splitting(n_iterations=100):
    text = "Câu ngắn. " * 50

    start = time.time()
    for _ in range(n_iterations):
        _ = split_text_into_chunks(text, max_chars=100)
    end = time.time()

    avg_time = (end - start) / n_iterations
    print(f"Average Text Splitting Time: {avg_time*1000:.4f} ms")

if __name__ == "__main__":
    print("=== VieNeu-TTS Benchmarks ===")
    benchmark_normalization()
    benchmark_phonemization()
    benchmark_text_splitting()
