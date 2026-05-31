import type { Context } from 'hono';
import {
  isProviderType,
  isVisibility,
  OAUTH_DEFAULT_MODEL,
  OAUTH_MODELS,
  type ProviderCreateRequest,
  type ProviderModelInput,
  type ProviderTestRequest,
  type ProviderType,
  type Visibility,
} from 'shared/types/providers';
import type { DB } from '../db';
import type { ProviderModelRow, ProviderRow } from '../db/schema';
import {
  createProvider,
  type ProviderScopeFilter,
  removeProvider,
  toDTO,
  updateProvider,
} from '../services/providers/store';
import { testProvider } from '../services/providers/test';
import { withTestLimit } from '../services/providers/test-limiter';
import { assertSafeBaseUrl } from '../services/providers/url-guard';

type Existing = { provider: ProviderRow; models: ProviderModelRow[] };

/**
 * Scope config for the shared provider pipeline. Built-in and Personal routers
 * pass different values; every behavioral fork lives behind one of these.
 *   - `ownerUserId`     NULL → Built-in (admin), string → that user's Personal.
 *   - `fetchExisting`   scoped row loader (getBuiltin / getOwned) for the id.
 *   - `allowOAuth`      Personal accepts `oauth`; Built-in is API-only.
 *   - `forceType`       Built-in pins `type='api'` regardless of body.
 *   - `allowVisibility` Built-in carries a `visibility` flag; Personal does not.
 */
export interface ProviderScopeConfig {
  ownerUserId: string | null;
  fetchExisting: (db: DB, id: string) => Promise<Existing | null>;
  allowOAuth?: boolean;
  forceType?: ProviderType;
  allowVisibility?: boolean;
}

/** WHERE-clause scope for store mutators, derived from the route scope. */
function mutationScope(cfg: ProviderScopeConfig): ProviderScopeFilter {
  return cfg.ownerUserId === null ? { builtin: true } : { ownerUserId: cfg.ownerUserId };
}

async function parseJsonBody(c: Context): Promise<Record<string, unknown> | null> {
  try {
    const body: unknown = await c.req.json();
    if (body == null || typeof body !== 'object') return null;
    return body as Record<string, unknown>;
  } catch {
    return null;
  }
}

// ─────────────────────────── POST / (create) ───────────────────────────

export async function handleCreate(
  c: Context,
  db: DB,
  cfg: ProviderScopeConfig,
): Promise<Response> {
  const b = await parseJsonBody(c);
  if (!b) return c.json({ error: 'invalid_body' }, 400);

  const req = b as unknown as ProviderCreateRequest;

  // Personal accepts oauth|api and validates the supplied type; Built-in pins api.
  const type: ProviderType = cfg.forceType ?? (req.type as ProviderType);
  if (!cfg.forceType && !isProviderType(req.type)) {
    return c.json({ error: 'invalid_type' }, 400);
  }

  if (typeof b.namespace !== 'string' || b.namespace.length === 0) {
    return c.json({ error: 'invalid_namespace' }, 400);
  }
  if (typeof b.token !== 'string' || b.token.length === 0) {
    return c.json({ error: 'invalid_token' }, 400);
  }

  const namespace = req.namespace;
  const token = req.token;
  const visibility: Visibility | null = cfg.allowVisibility
    ? isVisibility(req.visibility)
      ? req.visibility
      : 'private'
    : null;

  // oauth (Personal only): fixed model catalog, no base URL.
  if (cfg.allowOAuth && type === 'oauth') {
    const result = await testProvider({ type: 'oauth', token });
    if (!result.ok) return c.json({ error: 'test_failed', detail: result.error }, 400);

    const created = await createProvider(db, {
      ownerUserId: cfg.ownerUserId,
      type: 'oauth',
      visibility,
      namespace,
      baseUrl: null,
      token,
      models: OAUTH_MODELS.map((m) => ({
        modelId: m.id,
        displayName: m.displayName,
        contextWindow: m.contextWindow,
        isDefault: m.id === OAUTH_DEFAULT_MODEL,
      })),
    });
    return c.json(toDTO(created.provider, created.models), 201);
  }

  // api
  const models = Array.isArray(req.models) ? req.models : [];
  const pingModel = models.find((m) => m.isDefault)?.modelId ?? models[0]?.modelId ?? undefined;

  // Guard a caller-supplied base URL (empty string / null = no custom URL).
  let baseUrl: string | null = null;
  if (typeof req.baseUrl === 'string' && req.baseUrl.length > 0) {
    const guard = await assertSafeBaseUrl(req.baseUrl);
    if (!guard.ok) return c.json({ error: 'invalid_base_url' }, 400);
    baseUrl = guard.normalized;
  }

  const result = await testProvider({ type: 'api', baseUrl, token, model: pingModel });
  if (!result.ok) return c.json({ error: 'test_failed', detail: result.error }, 400);

  const created = await createProvider(db, {
    ownerUserId: cfg.ownerUserId,
    type: 'api',
    visibility,
    namespace,
    baseUrl,
    token,
    models,
  });
  return c.json(toDTO(created.provider, created.models), 201);
}

// ─────────────────────────── PATCH /:id ───────────────────────────

export async function handleUpdate(
  c: Context,
  db: DB,
  cfg: ProviderScopeConfig,
): Promise<Response> {
  const id = c.req.param('id') ?? '';
  const existing = await cfg.fetchExisting(db, id);
  if (!existing) return c.json({ error: 'not_found' }, 404);

  const b = await parseJsonBody(c);
  if (!b) return c.json({ error: 'invalid_body' }, 400);

  const providerType = existing.provider.type as ProviderType;
  // oauth providers (Personal) keep a fixed catalog: no base URL or model edits.
  const isApi = providerType !== 'oauth';

  const patch: {
    namespace?: string;
    baseUrl?: string | null;
    visibility?: Visibility;
    token?: string;
    models?: ProviderModelInput[];
  } = {};

  if (b.namespace !== undefined) patch.namespace = b.namespace as string;
  if (isApi) {
    if (b.baseUrl !== undefined) {
      // Guard a fresh caller-supplied base URL; empty/null clears the custom
      // URL and needs no validation. Persist the normalized origin.
      const raw = b.baseUrl as string | null;
      if (typeof raw === 'string' && raw.length > 0) {
        const guard = await assertSafeBaseUrl(raw);
        if (!guard.ok) return c.json({ error: 'invalid_base_url' }, 400);
        patch.baseUrl = guard.normalized;
      } else {
        patch.baseUrl = null;
      }
    }
    if (Array.isArray(b.models)) patch.models = b.models as ProviderModelInput[];
  }
  if (cfg.allowVisibility && b.visibility !== undefined && isVisibility(b.visibility)) {
    patch.visibility = b.visibility;
  }
  if (typeof b.token === 'string') patch.token = b.token;

  // Re-test only when credentials changed (token, or base URL on an api provider).
  if (b.token !== undefined || (isApi && b.baseUrl !== undefined)) {
    const token = typeof b.token === 'string' ? b.token : existing.provider.token;
    const baseUrl = isApi
      ? b.baseUrl !== undefined
        ? (patch.baseUrl ?? null)
        : existing.provider.baseUrl
      : null;
    const model = isApi
      ? ((Array.isArray(b.models) ? b.models : existing.models) as { modelId: string }[])[0]
          ?.modelId
      : undefined;

    const result = await testProvider({ type: providerType, baseUrl, token, model });
    if (!result.ok) return c.json({ error: 'test_failed', detail: result.error }, 400);
  }

  const updated = await updateProvider(db, id, patch, mutationScope(cfg));
  if (!updated) return c.json({ error: 'not_found' }, 404);
  return c.json(toDTO(updated.provider, updated.models));
}

// ─────────────────────────── DELETE /:id ───────────────────────────

export async function handleDelete(
  c: Context,
  db: DB,
  cfg: ProviderScopeConfig,
): Promise<Response> {
  const id = c.req.param('id') ?? '';
  const existing = await cfg.fetchExisting(db, id);
  if (!existing) return c.json({ error: 'not_found' }, 404);
  await removeProvider(db, id, mutationScope(cfg));
  return c.json({ ok: true });
}

// ─────────────────────────── POST /test ───────────────────────────

export async function handleTest(
  c: Context,
  db: DB,
  userId: string,
  cfg: ProviderScopeConfig,
): Promise<Response> {
  const b = await parseJsonBody(c);
  if (!b) return c.json({ ok: false, error: 'invalid_body' });

  const req = b as unknown as ProviderTestRequest;

  // Personal validates the supplied type; Built-in pins api.
  if (!cfg.forceType && !isProviderType(req.type)) {
    return c.json({ ok: false, error: 'invalid_type' });
  }
  const type: ProviderType = cfg.forceType ?? req.type;

  // Rate-limit per user: one in-flight test at a time + a short cooldown.
  const limited = await withTestLimit(userId, async () => {
    let token: string | null = typeof req.token === 'string' ? req.token : null;
    let baseUrl: string | null = req.baseUrl ?? null;

    // If token omitted/empty and providerId given, load the saved row.
    if ((!token || token.length === 0) && req.providerId) {
      const saved = await cfg.fetchExisting(db, req.providerId);
      if (saved) {
        token = saved.provider.token;
        // Force the saved base URL: a reused token must not be redirected to a
        // caller-supplied host. The saved URL was validated at save time.
        baseUrl = saved.provider.baseUrl;
      }
    } else if (type === 'api' && typeof baseUrl === 'string' && baseUrl.length > 0) {
      // Fresh caller-supplied base URL — guard and use the normalized origin.
      const guard = await assertSafeBaseUrl(baseUrl);
      if (!guard.ok) return { ok: false as const, error: 'invalid_base_url' };
      baseUrl = guard.normalized;
    }

    if (!token) {
      return { ok: false as const, error: 'missing_token' };
    }

    return testProvider({ type, baseUrl, token, model: req.model ?? undefined });
  });

  if (!limited.ok) return c.json({ ok: false, error: 'rate_limited' });
  return c.json(limited.value);
}
