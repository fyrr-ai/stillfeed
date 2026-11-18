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
 * Only Discuss may search the web (`web: true`); every other call runs without tools.
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

/** Whether the configured provider can search the web for Discuss. OpenAI-compatible servers have no common search tool. */
export function searchesWeb(): boolean {
  try { const name = provider(); return name === 'anthropic' || name === 'codex'; } catch { return false; }
}

/** Runs one prompt and returns the model's text. Throws Unavailable when no provider is configured. */
export async function complete(prompt: string, role: Role = 'default', signal?: AbortSignal, options: { web?: boolean } = {}): Promise<string> {
  const name = provider();
  if (!name) throw new Unavailable('No AI provider configured (set ANTHROPIC_API_KEY, OPENAI_API_KEY or STILLFEED_LLM)');
  const chosen = model(role, name);
  signal?.throwIfAborted();
  const web = options.web === true && searchesWeb();
  const text = await { anthropic, openai, codex }[name](prompt, chosen, signal, web);
  console.error(`llm provider=${name} model=${chosen} role=${role}${web ? ' web=on' : ''}`);
  return text;
}

/** Anthropic-hosted search and fetch; their results arrive as content blocks, so there is no client tool loop. */
const WEB_TOOLS: Anthropic.ToolUnion[] = [
  { type: 'web_search_20260209', name: 'web_search', max_uses: 5 },
  { type: 'web_fetch_20260209', name: 'web_fetch', max_uses: 5 },
];

async function anthropic(prompt: string, chosen: string, signal?: AbortSignal, web = false) {
  const client = new Anthropic();
  const messages: Anthropic.MessageParam[] = [{ role: 'user', content: prompt }];
  const fallback = FALLBACK_FAMILIES.some(family => chosen.startsWith(family));
  // A server tool loop can pause; resending the paused turn resumes it. Bounded so a stuck search cannot loop.
  for (let turn = 0; ; turn++) {
    const request = { model: chosen, max_tokens: 16000, messages, ...(web ? { tools: WEB_TOOLS } : {}) };
    // On a policy decline the API reruns the request on a fallback model it picks per refusal category.
    const response: { stop_reason: string | null; content: Anthropic.ContentBlock[] } = fallback
      ? await client.beta.messages.stream({ ...request, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' } as Anthropic.Beta.MessageCreateParamsStreaming, {signal}).finalMessage() as unknown as Anthropic.Message
      : await client.messages.stream(request, {signal}).finalMessage();
    if (response.stop_reason === 'refusal') throw new Error('The model declined this request');
    if (response.stop_reason !== 'pause_turn' || turn >= 4) return response.content.map(block => block.type === 'text' ? block.text : '').join('');
    messages.splice(1, messages.length - 1, { role: 'assistant', content: response.content });
  }
}

async function openai(prompt: string, chosen: string, signal?: AbortSignal) {
  const response = await new OpenAI().chat.completions.create({ model: chosen, messages: [{ role: 'user', content: prompt }] }, {signal});
  return response.choices[0]?.message.content ?? '';
}

// Codex runs with no shell, MCP servers, goals or image generation, in a read-only sandbox, so text from articles
// cannot reach local files. Connected ChatGPT apps (mail, calendar, GitHub...) stay off; Discuss enables only the
// search app, which is how Codex reaches the web here (its native web_search setting offers no tool to the model).
// At low effort the model announces a search and then ends without calling it, so web answers use medium.
export function codexArgs(chosen: string, web: boolean, answer: string) {
  return ['codex', 'exec', '-m', chosen, '-c', `model_reasoning_effort=${web ? 'medium' : 'low'}`,
    '-c', 'mcp_servers={}', '--disable', 'shell_tool', '--disable', 'unified_exec', '--disable', 'goals', '--disable', 'image_generation', '-s', 'read-only',
    ...(web ? ['-c', 'apps._default.enabled=false', '-c', 'apps.connector_openai_search_service.enabled=true'] : ['--disable', 'apps']),
    '--skip-git-repo-check', '--ephemeral', '-o', answer, '-'];
}

async function codex(prompt: string, chosen: string, signal?: AbortSignal, web = false) {
  if (!Bun.which('codex')) throw new Unavailable('STILLFEED_LLM=codex needs the codex CLI on PATH');
  const dir = mkdtempSync(join(tmpdir(), 'stillfeed-codex-'));
  try {
    const answer = join(dir, 'answer.txt');
    const child = Bun.spawn(codexArgs(chosen, web, answer),
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
