#!/usr/bin/env python3
"""One entry point for every model call Radar makes: the Anthropic API, an OpenAI-compatible API, or the codex CLI.

Configuration (environment or RADAR_HOME/.env):
  RADAR_LLM             anthropic | openai | codex | none. Unset: anthropic if ANTHROPIC_API_KEY is set,
                        else openai if OPENAI_API_KEY is set, else none (AI features stay off).
  RADAR_LLM_MODEL       model for summaries, Hot and suggestions.
  RADAR_LLM_FAST_MODEL  model for the relevance triage (defaults to RADAR_LLM_MODEL).
  ANTHROPIC_API_KEY     for anthropic.
  OPENAI_API_KEY, OPENAI_BASE_URL   for openai and anything OpenAI-compatible (OpenRouter, Ollama, vLLM, LM Studio).
  RADAR_LANGUAGE        language of summaries and reasons, e.g. "English" (default), "Czech", "German".

Prompts are short and every caller parses JSON out of the answer, so a provider only has to return text.
"""
import os
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

DEFAULT_MODELS = {
    # Users who want lower cost can set RADAR_LLM_MODEL=claude-haiku-5-5.
    "anthropic": ("claude-opus-5-5", "claude-opus-5-5"),
    "codex": ("gpt-6-luna", "gpt-6.1-sol"),
}
# Models that accept the server-side refusal fallback (Claude Haiku has none).
FALLBACK_FAMILIES = ("claude-fable", "claude-mythos", "claude-opus-5", "claude-sonnet-5-5")


class Unavailable(RuntimeError):
    """No AI provider is configured; callers keep working without the AI feature."""


def language():
    return os.environ.get("RADAR_LANGUAGE", "").strip() or "English"


def provider():
    chosen = os.environ.get("RADAR_LLM", "").strip().lower()
    if chosen in ("none", "off", "false", "0"):
        return None
    if chosen:
        if chosen not in ("anthropic", "openai", "codex"):
            raise Unavailable(f"Unknown RADAR_LLM={chosen!r}; use anthropic, openai, codex or none")
        return chosen
    if os.environ.get("ANTHROPIC_API_KEY"):
        return "anthropic"
    if os.environ.get("OPENAI_API_KEY"):
        return "openai"
    return None


def model(role="default", name=None):
    name = name or provider()
    configured = os.environ.get("RADAR_LLM_FAST_MODEL" if role == "fast" else "RADAR_LLM_MODEL", "").strip()
    if role == "fast" and not configured:
        configured = os.environ.get("RADAR_LLM_MODEL", "").strip()
    if configured:
        return configured
    defaults = DEFAULT_MODELS.get(name)
    if not defaults:
        raise Unavailable(f"Set RADAR_LLM_MODEL for the {name} provider")
    return defaults[1] if role == "fast" else defaults[0]


def complete(prompt, role="default"):
    """Run one prompt and return the model's text. Raises Unavailable when no provider is configured."""
    name = provider()
    if not name:
        raise Unavailable("No AI provider configured (set ANTHROPIC_API_KEY, OPENAI_API_KEY or RADAR_LLM)")
    chosen = model(role, name)
    text = {"anthropic": _anthropic, "openai": _openai, "codex": _codex}[name](prompt, chosen)
    print(f"llm provider={name} model={chosen} role={role}", file=sys.stderr, flush=True)
    return text


def _anthropic(prompt, chosen):
    import anthropic

    client = anthropic.Anthropic()
    messages = [{"role": "user", "content": prompt}]
    if chosen.startswith(FALLBACK_FAMILIES):
        # On a policy decline the API reruns the request on a fallback model it picks per refusal category.
        response = client.beta.messages.create(
            model=chosen, max_tokens=16000, messages=messages,
            betas=["server-side-fallback-2026-07-01"], fallbacks="default",
        )
    else:
        response = client.messages.create(model=chosen, max_tokens=16000, messages=messages)
    if response.stop_reason == "refusal":
        raise RuntimeError("The model declined this request")
    return "".join(block.text for block in response.content if block.type == "text")


def _openai(prompt, chosen):
    from openai import OpenAI

    client = OpenAI()  # reads OPENAI_API_KEY and OPENAI_BASE_URL
    response = client.chat.completions.create(model=chosen, messages=[{"role": "user", "content": prompt}])
    return response.choices[0].message.content or ""


def _codex(prompt, chosen):
    if not shutil.which("codex"):
        raise Unavailable("RADAR_LLM=codex needs the codex CLI on PATH")
    with tempfile.TemporaryDirectory() as tmp:
        answer = Path(tmp) / "answer.txt"
        result = subprocess.run(
            ["codex", "exec", "-m", chosen, "-c", "model_reasoning_effort=low", "-s", "read-only",
             "--skip-git-repo-check", "--ephemeral", "-o", str(answer), "-"],
            input=prompt, capture_output=True, text=True, timeout=300, check=False, cwd=tmp,
        )
        if result.returncode != 0:
            raise RuntimeError(f"codex exited {result.returncode}")
        tokens = re.search(r"tokens used\s*([\d,]+)", result.stderr)
        print(f"codex model={chosen} tokens={tokens.group(1) if tokens else '?'}", file=sys.stderr, flush=True)
        return answer.read_text(encoding="utf-8") if answer.exists() else ""
