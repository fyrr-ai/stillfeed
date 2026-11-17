import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * One entry point for every model call Stillfeed makes: the Anthropic API, an OpenAI-compatible API, or the codex CLI.
 *
 *   STILLFEED_LLM             anthropic | openai | codex | none. Unset: anthropic if ANTHROPIC_API_KEY is set,
 *                         else openai if OPENAI_API_KEY is set, else none (AI features stay off).
 *   STILLFEED_LLM_MODEL       model for summaries, Hot and suggestions.
 *   STILLFEED_LLM_FAST_MODEL  model for the relevance triage (defaults to STILLFEED_LLM_MODEL).
 *   OPENAI_BASE_URL       any OpenAI-compatible server (OpenRouter, Ollama, vLLM, LM Studio).
 *
 * Prompts are short and every caller parses JSON out of the answer, so a provider only has to return text.
 */
export type Provider = 'anthropic' | 'openai' | 'codex';
export type Role = 'default' | 'fast';

/** No AI provider is configured; callers keep working without the AI feature. */
export class Unavailable extends Error {}

const DEFAULT_MODELS: Partial<Record<Provider, [string, string]>> = {
  // Lower cost: STILLFEED_LLM_FAST_MODEL=claude-haiku-5-5 for the triage.
  anthropic: ['claude-opus-5-5', 'claude-opus-5-5'],
  codex: ['gpt-6-luna', 'gpt-6.1-sol'],
};
/** Models that accept the server-side refusal fallback (Claude Haiku has none). */
const FALLBACK_FAMILIES = ['claude-fable', 'claude-mythos', 'claude-opus-5', 'claude-sonnet-5-5'];

export const language = () => process.env.STILLFEED_LANGUAGE?.trim() || 'English';

export function provider(): Provider | null {
  const chosen = (process.env.STILLFEED_LLM ?? '').trim().toLowerCase();
  if (['none', 'off', 'false', '0'].includes(chosen)) return null;
  if (chosen) {
    if (chosen === 'anthropic' || chosen === 'openai' || chosen === 'codex') return chosen;
    throw new Unavailable(`Unknown STILLFEED_LLM=${chosen}; use anthropic, openai, codex or none`);
  }
  if (process.env.ANTHROPIC_API_KEY) return 'anthropic';
  if (process.env.OPENAI_API_KEY) return 'openai';
  return null;
}

export function model(role: Role = 'default', name = provider()): string {
  const main = process.env.STILLFEED_LLM_MODEL?.trim();
  const configured = role === 'fast' ? process.env.STILLFEED_LLM_FAST_MODEL?.trim() || main : main;
  if (configured) return configured;
  const defaults = name ? DEFAULT_MODELS[name] : undefined;
  if (!defaults) throw new Unavailable(`Set STILLFEED_LLM_MODEL for the ${name} provider`);
  return role === 'fast' ? defaults[1] : defaults[0];
}

/** What the UI shows: which provider and model write the summaries, or null when AI is off. */
export function describe(): { provider: Provider; model: string } | null {
  try { const name = provider(); return name ? { provider: name, model: model('default', name) } : null; } catch { return null; }
}

/** Runs one prompt and returns the model's text. Throws Unavailable when no provider is configured. */
export async function complete(prompt: string, role: Role = 'default', signal?: AbortSignal): Promise<string> {
  const name = provider();
  if (!name) throw new Unavailable('No AI provider configured (set ANTHROPIC_API_KEY, OPENAI_API_KEY or STILLFEED_LLM)');
  const chosen = model(role, name);
  signal?.throwIfAborted();
  const text = await { anthropic, openai, codex }[name](prompt, chosen, signal);
  console.error(`llm provider=${name} model=${chosen} role=${role}`);
  return text;
}

async function anthropic(prompt: string, chosen: string, signal?: AbortSignal) {
  const client = new Anthropic();
  const request = { model: chosen, max_tokens: 16000, messages: [{ role: 'user' as const, content: prompt }] };
  // On a policy decline the API reruns the request on a fallback model it picks per refusal category.
  const response: { stop_reason: string | null; content: { type: string; text?: string }[] } = FALLBACK_FAMILIES.some(family => chosen.startsWith(family))
    ? await client.beta.messages.stream({ ...request, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' }, {signal}).finalMessage()
    : await client.messages.stream(request, {signal}).finalMessage();
  if (response.stop_reason === 'refusal') throw new Error('The model declined this request');
  return response.content.map(block => block.type === 'text' ? block.text ?? '' : '').join('');
}

async function openai(prompt: string, chosen: string, signal?: AbortSignal) {
  const response = await new OpenAI().chat.completions.create({ model: chosen, messages: [{ role: 'user', content: prompt }] }, {signal});
  return response.choices[0]?.message.content ?? '';
}

async function codex(prompt: string, chosen: string, signal?: AbortSignal) {
  if (!Bun.which('codex')) throw new Unavailable('STILLFEED_LLM=codex needs the codex CLI on PATH');
  const dir = mkdtempSync(join(tmpdir(), 'stillfeed-codex-'));
  try {
    const answer = join(dir, 'answer.txt');
    const child = Bun.spawn(['codex', 'exec', '-m', chosen, '-c', 'model_reasoning_effort=low', '-s', 'read-only', '--skip-git-repo-check', '--ephemeral', '-o', answer, '-'],
      { cwd: dir, stdin: new Blob([prompt]), stdout: 'ignore', stderr: 'pipe', timeout: 300000 });
    const abort = () => child.kill();
    signal?.addEventListener('abort', abort, {once: true});
    let stderr: string, code: number;
    try { [stderr, code] = await Promise.all([new Response(child.stderr).text(), child.exited]); }
    finally { signal?.removeEventListener('abort', abort); }
    signal?.throwIfAborted();
    if (code !== 0) throw new Error(`codex exited ${code}`);
    console.error(`codex model=${chosen} tokens=${/tokens used\s*([\d,]+)/.exec(stderr)?.[1] ?? '?'}`);
    const file = Bun.file(answer);
    return await file.exists() ? await file.text() : '';
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

/** The JSON object in a model answer (models sometimes wrap it in prose or a code fence). */
export function json(raw: string): unknown {
  const start = raw.indexOf('{'), end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('The model answer has no JSON object');
  return JSON.parse(raw.slice(start, end + 1));
}
