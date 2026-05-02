import { describe, expect, it } from 'bun:test';
import { DEFAULT_KIMI_CONFIG } from '../../../src/services/kimi-config/defaults';
import { escapeToml, renderToml } from '../../../src/services/kimi-config/serialize';

describe('escapeToml', () => {
  it('escapes backslash', () => {
    expect(escapeToml('a\\b')).toBe('a\\\\b');
  });

  it('escapes double quote', () => {
    expect(escapeToml('a"b')).toBe('a\\"b');
  });

  it('escapes both', () => {
    expect(escapeToml('a\\"b')).toBe('a\\\\\\"b');
  });
});

describe('renderToml', () => {
  it('renders full config without redaction', () => {
    const toml = renderToml(DEFAULT_KIMI_CONFIG, { redactSecrets: false });
    expect(toml).toContain('model = "kimi-code/kimi-for-coding"');
    expect(toml).toContain('thinking = false');
    expect(toml).toContain('[providers.kimi]');
    expect(toml).toContain('base_url = "https://api.kimi.com/coding/v1"');
    expect(toml).toContain('api_key = ""');
    expect(toml).toContain('[loop_control]');
    expect(toml).toContain('max_steps_per_turn = 100');
    expect(toml).toContain('[background]');
    expect(toml).toContain('[notifications]');
    expect(toml).toContain('[mcp.client]');
    expect(toml).toContain('tool_call_timeout_ms = 60000');
    expect(toml.endsWith('\n')).toBe(true);
  });

  it('redacts api_key for kimi provider when redactSecrets=true', () => {
    const row = {
      ...DEFAULT_KIMI_CONFIG,
      provider: { ...DEFAULT_KIMI_CONFIG.provider, apiKey: 'sk-secret' },
    };
    const toml = renderToml(row, { redactSecrets: true });
    expect(toml).toContain('api_key = ""');
    expect(toml).not.toContain('sk-secret');
  });

  it('does not redact api_key for anthropic provider', () => {
    const row = {
      ...DEFAULT_KIMI_CONFIG,
      provider: { ...DEFAULT_KIMI_CONFIG.provider, type: 'anthropic' as const, apiKey: 'sk-ant' },
    };
    const toml = renderToml(row, { redactSecrets: true });
    expect(toml).toContain('api_key = "sk-ant"');
  });

  it('writes services api_key verbatim (never redacted)', () => {
    const row = {
      ...DEFAULT_KIMI_CONFIG,
      services: {
        search: { baseUrl: 'https://search.example', apiKey: 'search-key' },
        fetch: null,
      },
    };
    const toml = renderToml(row, { redactSecrets: true });
    expect(toml).toContain('api_key = "search-key"');
  });

  it('includes display_name when defined', () => {
    const toml = renderToml(DEFAULT_KIMI_CONFIG);
    expect(toml).toContain('display_name = "Kimi-k2.6"');
  });

  it('appends extra_toml_override verbatim', () => {
    const row = {
      ...DEFAULT_KIMI_CONFIG,
      extraTomlOverride: '# custom\nfoo = "bar"',
    };
    const toml = renderToml(row);
    expect(toml).toContain('# custom\nfoo = "bar"');
  });

  it('escapes api_key with quotes and backslashes', () => {
    const row = {
      ...DEFAULT_KIMI_CONFIG,
      provider: { ...DEFAULT_KIMI_CONFIG.provider, apiKey: 'sk-"weird\\key"' },
    };
    const toml = renderToml(row, { redactSecrets: false });
    expect(toml).toContain('api_key = "sk-\\"weird\\\\key\\""');
  });

  it('omits services section when both are null', () => {
    const toml = renderToml(DEFAULT_KIMI_CONFIG);
    expect(toml).not.toContain('[services.moonshot_search]');
    expect(toml).not.toContain('[services.moonshot_fetch]');
  });

  it('omits hooks section when empty', () => {
    const toml = renderToml(DEFAULT_KIMI_CONFIG);
    expect(toml).not.toContain('[[hooks]]');
  });

  it('writes hooks when present', () => {
    const row = {
      ...DEFAULT_KIMI_CONFIG,
      hooks: [{ event: 'PreToolUse', command: 'echo hello', matcher: 'read', timeout: 5000 }],
    };
    const toml = renderToml(row);
    expect(toml).toContain('[[hooks]]');
    expect(toml).toContain('event = "PreToolUse"');
    expect(toml).toContain('command = "echo hello"');
    expect(toml).toContain('matcher = "read"');
    expect(toml).toContain('timeout = 5000');
  });
});
