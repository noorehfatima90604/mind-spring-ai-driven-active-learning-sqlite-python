"""
Optional fine-tuned Flan-T5. LOCAL_T5_MODEL_PATH in .env → save_pretrained folder.
"""

from __future__ import annotations

import json
import logging
import os
import re
from typing import Any

logger = logging.getLogger(__name__)

_model = None
_tokenizer = None
_device: str | None = None
_hf_load_error: str | None = None


def _model_path_configured() -> str | None:
    p = (os.getenv("LOCAL_T5_MODEL_PATH") or "").strip()
    return p or None


def _ensure_loaded() -> bool:
    global _model, _tokenizer, _device, _hf_load_error
    if _hf_load_error is not None:
        return False
    if _model is not None and _tokenizer is not None:
        return True
    path = _model_path_configured()
    if not path:
        return False
    if not os.path.exists(path):
        logger.warning("LOCAL_T5_MODEL_PATH does not exist: %s", path)
        return False
    try:
        import torch
        from transformers import AutoModelForSeq2SeqLM, AutoTokenizer

        device = (os.getenv("LOCAL_T5_DEVICE") or "cpu").strip().lower()
        if device == "cuda" and not torch.cuda.is_available():
            device = "cpu"

        tok = AutoTokenizer.from_pretrained(path)
        mdl = AutoModelForSeq2SeqLM.from_pretrained(path)
        mdl.to(device)
        mdl.eval()
        _tokenizer = tok
        _model = mdl
        _device = device
        logger.info("Local T5 loaded from %s on %s", path, device)
        return True
    except Exception as e:
        _hf_load_error = str(e)
        logger.warning("Local T5 load failed: %s", e)
        return False


def _truncate(s: str, max_chars: int) -> str:
    if len(s) <= max_chars:
        return s
    return s[: max_chars - 20] + "\n...[truncated]..."


def _generate(prompt: str, max_new_tokens: int | None = None) -> str | None:
    if not _ensure_loaded():
        return None
    try:
        import torch

        max_in = int(os.getenv("LOCAL_T5_MAX_INPUT_LENGTH", "1024"))
        mnt = max_new_tokens or int(os.getenv("LOCAL_T5_MAX_NEW_TOKENS", "512"))
        max_chars = int(os.getenv("LOCAL_T5_MAX_INPUT_CHARS", "12000"))
        prompt = _truncate(prompt, max_chars)

        inputs = _tokenizer(
            prompt,
            return_tensors="pt",
            truncation=True,
            max_length=max_in,
        )
        assert _device is not None
        inputs = {k: v.to(_device) for k, v in inputs.items()}
        with torch.no_grad():
            out_ids = _model.generate(  # type: ignore[union-attr]
                **inputs,
                max_new_tokens=mnt,
                num_beams=int(os.getenv("LOCAL_T5_NUM_BEAMS", "4")),
                early_stopping=True,
            )
        text = _tokenizer.decode(out_ids[0], skip_special_tokens=True)  # type: ignore[union-attr]
        return text if text and text.strip() else None
    except Exception as e:
        logger.warning("Local T5 generate failed: %s", e)
        return None


def _format_template(template: str, mapping: dict[str, Any]) -> str:
    out = template
    for k, v in mapping.items():
        out = out.replace("{" + k + "}", str(v))
    return out


def _append_adaptive(base: str, adaptive_note: str) -> str:
    a = (adaptive_note or "").strip()
    if not a:
        return base
    return base + "\n\n[Adaptive profile]\n" + a


DEFAULT_MCQ_TEMPLATE = (
    "Generate exactly {count} MCQs for chapter '{chapter}'. "
    "Use this context:\n{context}\n"
    "Return ONLY a JSON list. Each object must have keys: "
    "'q', 'options' (list of 4 strings), 'answer' (single letter A-D), 'explanation'."
)

DEFAULT_SUMMARY_TEMPLATE = (
    "Summarize the chapter '{chapter}' for a student. Base your answer on:\n{context}\n"
    "Write clear paragraphs."
)

DEFAULT_CHAT_TEMPLATE = (
    "You are a tutor. Use the textbook context to answer.\n"
    "Context:\n{context}\n\nStudent question:\n{message}\n\nAnswer:"
)


def build_mcq_prompt(chapter: str, count: int, context: str, adaptive_note: str = "") -> str:
    tpl = os.getenv("LOCAL_T5_MCQ_TEMPLATE") or DEFAULT_MCQ_TEMPLATE
    base = _format_template(
        tpl,
        {"chapter": chapter or "", "count": int(count), "context": context or ""},
    )
    return _append_adaptive(base, adaptive_note)


def build_summary_prompt(chapter: str, context: str, adaptive_note: str = "") -> str:
    tpl = os.getenv("LOCAL_T5_SUMMARY_TEMPLATE") or DEFAULT_SUMMARY_TEMPLATE
    base = _format_template(tpl, {"chapter": chapter or "", "context": context or ""})
    return _append_adaptive(base, adaptive_note)


def build_chat_prompt(message: str, context: str, adaptive_note: str = "") -> str:
    tpl = os.getenv("LOCAL_T5_CHAT_TEMPLATE") or DEFAULT_CHAT_TEMPLATE
    base = _format_template(
        tpl, {"message": message or "", "context": context or ""}
    )
    return _append_adaptive(base, adaptive_note)


def mcq_output_usable(text: str) -> bool:
    if not text or "[" not in text:
        return False
    start = text.index("[")
    end = text.rindex("]") + 1
    if end <= start:
        return False
    try:
        data = json.loads(text[start:end])
    except json.JSONDecodeError:
        return False
    if not isinstance(data, list) or len(data) == 0:
        return False
    for item in data:
        if not isinstance(item, dict):
            return False
        qtext = item.get("q") or item.get("question")
        opts = item.get("options")
        ans = item.get("answer") or item.get("correct_answer")
        if not qtext or not isinstance(opts, list) or len(opts) < 2:
            return False
        if not ans or not isinstance(ans, str):
            return False
        letter = re.sub(r"[^A-Da-d]", "", str(ans))[:1].upper()
        if letter not in ("A", "B", "C", "D"):
            return False
    return True


def summary_output_usable(text: str) -> bool:
    return len((text or "").strip()) >= 40


def chat_output_usable(text: str) -> bool:
    return len((text or "").strip()) >= 15


def try_local_mcq(
    chapter: str, count: int, context: str, adaptive_note: str = ""
) -> str | None:
    if not _model_path_configured():
        return None
    prompt = build_mcq_prompt(chapter, count, context, adaptive_note)
    out = _generate(
        prompt,
        max_new_tokens=int(os.getenv("LOCAL_T5_MAX_NEW_TOKENS_MCQ", "1024")),
    )
    if out and mcq_output_usable(out):
        logger.info("MCQs served from local T5")
        return out
    if out:
        logger.info("Local T5 MCQ output rejected; using Gemini fallback")
    return None


def try_local_summary(
    chapter: str, context: str, adaptive_note: str = ""
) -> str | None:
    if not _model_path_configured():
        return None
    prompt = build_summary_prompt(chapter, context, adaptive_note)
    out = _generate(
        prompt,
        max_new_tokens=int(os.getenv("LOCAL_T5_MAX_NEW_TOKENS_SUMMARY", "768")),
    )
    if out and summary_output_usable(out):
        logger.info("Summary served from local T5")
        return out
    if out:
        logger.info("Local T5 summary rejected; using Gemini fallback")
    return None


def try_local_chat(
    message: str, context: str, adaptive_note: str = ""
) -> str | None:
    if not _model_path_configured():
        return None
    prompt = build_chat_prompt(message, context, adaptive_note)
    out = _generate(
        prompt,
        max_new_tokens=int(os.getenv("LOCAL_T5_MAX_NEW_TOKENS_CHAT", "512")),
    )
    if out and chat_output_usable(out):
        logger.info("Chat reply served from local T5")
        return out
    if out:
        logger.info("Local T5 chat rejected; using Gemini fallback")
    return None
