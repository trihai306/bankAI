import pytest
from vieneu_utils.phonemize_text import phonemize_with_dict

def test_phonemize_vietnamese():
    text = "Xin chào Việt Nam"
    # We don't check exact phonemes because they depend on espeak version,
    # but we check if it returns a non-empty string and doesn't crash.
    phonemes = phonemize_with_dict(text)
    assert isinstance(phonemes, str)
    assert len(phonemes) > 0

def test_phonemize_english_tag():
    text = "Học <en>machine learning</en> rất hay"
    phonemes = phonemize_with_dict(text)
    assert isinstance(phonemes, str)
    assert len(phonemes) > 0
    # Should contain phonemes for 'machine learning'
    # usually espeak uses symbols like məˈʃiːn
    assert any(c in phonemes for c in "əˈʃ")

def test_phonemize_with_custom_dict():
    custom_dict = {"robot": "ro-bot-phi-diệu"}
    text = "Tôi là robot"
    phonemes = phonemize_with_dict(text, phoneme_dict=custom_dict)
    assert "ro-bot-phi-diệu" in phonemes
