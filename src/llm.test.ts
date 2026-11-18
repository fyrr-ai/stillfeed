import { afterEach, expect, test } from 'bun:test';
import { codexArgs, complete, describe, json, model, provider, searchesWeb, Unavailable } from './llm';

const keys = ['STILLFEED_LLM', 'STILLFEED_LLM_MODEL', 'STILLFEED_LLM_FAST_MODEL', 'ANTHROPIC_API_KEY', 'OPENAI_API_KEY'] as const;
const saved = Object.fromEntries(keys.map(k => [k, process.env[k]]));
const set = (values: Partial<Record<(typeof keys)[number], string>>) => { for (const k of keys) delete process.env[k]; Object.assign(process.env, values); };
afterEach(() => { for (const k of keys) if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; });

test('the provider follows STILLFEED_LLM, else whichever API key is set', () => {
  set({}); expect(provider()).toBeNull(); expect(describe()).toBeNull();
  set({ OPENAI_API_KEY: 'x' }); expect(provider()).toBe('openai');
  set({ OPENAI_API_KEY: 'x', ANTHROPIC_API_KEY: 'y' }); expect(provider()).toBe('anthropic');
  set({ ANTHROPIC_API_KEY: 'y', STILLFEED_LLM: 'none' }); expect(provider()).toBeNull();
  set({ STILLFEED_LLM: 'codex' }); expect(describe()).toEqual({ provider: 'codex', model: 'gpt-6-luna' });
  set({ STILLFEED_LLM: 'gemini' }); expect(() => provider()).toThrow(Unavailable);
});

test('models: defaults per provider, the fast role falls back to the main model', () => {
  set({ ANTHROPIC_API_KEY: 'y' }); expect(model()).toBe('claude-opus-5-5'); expect(model('fast')).toBe('claude-opus-5-5');
  set({ ANTHROPIC_API_KEY: 'y', STILLFEED_LLM_MODEL: 'claude-sonnet-5-5' }); expect(model('fast')).toBe('claude-sonnet-5-5');
  set({ ANTHROPIC_API_KEY: 'y', STILLFEED_LLM_MODEL: 'claude-sonnet-5-5', STILLFEED_LLM_FAST_MODEL: 'claude-haiku-5-5' }); expect(model('fast')).toBe('claude-haiku-5-5');
  set({ OPENAI_API_KEY: 'x' }); expect(() => model()).toThrow('Set STILLFEED_LLM_MODEL');
});

test('no provider means Unavailable, never a request', async () => {
  set({}); expect(complete('hi')).rejects.toBeInstanceOf(Unavailable);
});

test('json finds the object inside prose or a code fence', () => {
  expect(json('Sure!\n```json\n{"keep":[1,2]}\n```')).toEqual({ keep: [1, 2] });
  expect(() => json('no')).toThrow();
});

test('only Discuss can search the web, and only through providers that support it', () => {
  set({ STILLFEED_LLM: 'codex' }); expect(searchesWeb()).toBe(true);
  set({ ANTHROPIC_API_KEY: 'y' }); expect(searchesWeb()).toBe(true);
  set({ OPENAI_API_KEY: 'x' }); expect(searchesWeb()).toBe(false);
  set({}); expect(searchesWeb()).toBe(false);
});

test('codex runs without shell, MCP servers or connected apps; web adds only the search app', () => {
  const plain = codexArgs('m', false, 'a'), web = codexArgs('m', true, 'a');
  for (const args of [plain, web]) {
    for (const feature of ['shell_tool', 'unified_exec', 'goals', 'image_generation']) expect(args.join(' ')).toContain(`--disable ${feature}`);
    expect(args.join(' ')).toContain('mcp_servers={}');
    expect(args.join(' ')).toContain('-s read-only');
  }
  expect(plain.join(' ')).toContain('--disable apps');
  expect(plain.join(' ')).not.toContain('search_service');
  expect(web.join(' ')).toContain('apps._default.enabled=false');
  expect(web.join(' ')).toContain('apps.connector_openai_search_service.enabled=true');
  expect(web.join(' ')).not.toContain('--disable apps');
});
