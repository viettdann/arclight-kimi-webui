import { useState } from 'react';
import type {
  ProviderDTO,
  ProviderModelInput,
  ProviderModelsResponse,
  ProviderTestRequest,
  ProviderTestResponse,
  Visibility,
} from 'shared/types/providers';

/** A model discovered by probing the provider's `/v1/models` endpoint. */
export type AvailableModel = {
  id: string;
  displayName: string | null;
  contextWindow: number | null;
};

/**
 * Form/test/model state for an `api`-type provider editor.
 *
 * Centralizes the credential fields, test-connection action, and model
 * checklist edits shared by the Built-in provider panel. The state shape
 * mirrors the persisted provider (`models: ProviderModelInput[]`): selecting a
 * model adds it to the list, deselecting removes it.
 */
export interface ProviderFormState {
  namespace: string;
  baseUrl: string;
  /** Plaintext token draft, or null when editing and the user hasn't replaced it yet. */
  token: string | null;
  visibility: Visibility;
  /** Models selected for this provider. */
  models: ProviderModelInput[];
  /** Models discovered by the last Fetch Models probe (dropdown options). */
  availableModels: AvailableModel[];
  /** Whether a model-fetch probe is in flight. */
  fetchingModels: boolean;
  /** Error (or empty-result note) from the last model fetch, or null. */
  fetchModelsError: string | null;
  /** Whether the current form session has a successful test result. */
  tested: boolean;
  testResult: ProviderTestResponse | null;
  testing: boolean;
}

export function emptyForm(): ProviderFormState {
  return {
    namespace: '',
    baseUrl: '',
    token: null,
    visibility: 'private',
    models: [],
    availableModels: [],
    fetchingModels: false,
    fetchModelsError: null,
    tested: false,
    testResult: null,
    testing: false,
  };
}

/**
 * Whether staged credentials differ from the saved provider value.
 * - `token === null` means "keep the existing secret" → not a credential change.
 *   Any non-null token (including `''`) is a fresh entry and counts as dirty.
 * - `baseUrl` is dirty when it differs from the saved base URL (or from empty for
 *   a brand-new provider).
 *
 * Callers pass the already-prepared values they compare against, so each form can
 * decide whether to trim or scope the base URL by provider type.
 */
export function isCredentialDirty(args: {
  token: string | null;
  baseUrl: string;
  savedBaseUrl: string;
}): boolean {
  return args.token !== null || args.baseUrl !== args.savedBaseUrl;
}

/**
 * Whether credentials suffice to probe (Test / Fetch models). A freshly typed
 * token or, on edit, the reused saved secret counts. `fetchReady` needs base
 * URL + key; callers add their own model requirement on top for Test.
 */
export function probeReadiness(
  token: string | null,
  baseUrl: string,
  isEdit: boolean,
): { canProbe: boolean; hasBaseUrl: boolean; fetchReady: boolean } {
  const canProbe = (typeof token === 'string' && token.length > 0) || isEdit;
  const hasBaseUrl = baseUrl.trim().length > 0;
  return { canProbe, hasBaseUrl, fetchReady: hasBaseUrl && canProbe };
}

export function formFromProvider(p: ProviderDTO): ProviderFormState {
  return {
    namespace: p.namespace,
    baseUrl: p.baseUrl ?? '',
    token: null, // null = keep existing secret
    visibility: p.visibility ?? 'private',
    models: p.models.map((m) => ({
      modelId: m.modelId,
      displayName: m.displayName,
      contextWindow: m.contextWindow,
      isDefault: m.isDefault,
    })),
    availableModels: [],
    fetchingModels: false,
    fetchModelsError: null,
    tested: false,
    testResult: null,
    testing: false,
  };
}

export interface UseProviderFormOptions {
  /** Probe credentials against the appropriate scope's test endpoint. */
  testProvider: (body: ProviderTestRequest) => Promise<ProviderTestResponse>;
  /** Probe the appropriate scope's `/models` endpoint for the model catalog. */
  fetchModels: (body: ProviderTestRequest) => Promise<ProviderModelsResponse>;
}

export interface UseProviderForm {
  form: ProviderFormState;
  setForm: React.Dispatch<React.SetStateAction<ProviderFormState>>;
  patchForm: (patch: Partial<ProviderFormState>) => void;
  manualModelId: string;
  setManualModelId: (v: string) => void;
  /** Run the test endpoint; `providerId` backs an omitted token when editing. */
  handleTest: (providerId: string | null) => Promise<void>;
  /** Probe `/models`; `providerId` backs an omitted token when editing. */
  handleFetchModels: (providerId: string | null) => Promise<void>;
  toggleModelDefault: (modelId: string) => void;
  toggleModelSelected: (
    modelId: string,
    displayName: string | null,
    contextWindow: number | null,
  ) => void;
  addManualModel: () => void;
}

export function useProviderForm({
  testProvider,
  fetchModels,
}: UseProviderFormOptions): UseProviderForm {
  const [form, setForm] = useState<ProviderFormState>(emptyForm);
  // Manual model id input for when the fetch returns no models.
  const [manualModelId, setManualModelId] = useState('');

  function patchForm(patch: Partial<ProviderFormState>) {
    // Changing any credential field invalidates a previous test result.
    const credentialChanged = 'baseUrl' in patch || 'token' in patch;
    setForm((prev) => ({
      ...prev,
      ...patch,
      ...(credentialChanged ? { tested: false, testResult: null } : {}),
    }));
  }

  async function handleTest(providerId: string | null) {
    setForm((prev) => ({ ...prev, testing: true, testResult: null }));
    // Ping with the chosen default (else first) model. Sending it lets a
    // manually-entered model validate even when the provider has no listable
    // `/models` endpoint, so credential validation never depends on a fetch.
    const model = form.models.find((m) => m.isDefault)?.modelId ?? form.models[0]?.modelId ?? null;
    try {
      const res = await testProvider({
        type: 'api',
        baseUrl: form.baseUrl || null,
        token: form.token, // null = reuse saved secret
        model,
        providerId,
      });
      setForm((prev) => ({ ...prev, testing: false, testResult: res, tested: res.ok }));
    } catch (e) {
      setForm((prev) => ({
        ...prev,
        testing: false,
        testResult: { ok: false, error: e instanceof Error ? e.message : 'Test failed' },
        tested: false,
      }));
    }
  }

  async function handleFetchModels(providerId: string | null) {
    setForm((prev) => ({ ...prev, fetchingModels: true, fetchModelsError: null }));
    try {
      const { models } = await fetchModels({
        type: 'api',
        baseUrl: form.baseUrl || null,
        token: form.token, // null = reuse saved secret
        providerId,
      });
      setForm((prev) => ({
        ...prev,
        fetchingModels: false,
        availableModels: models,
        fetchModelsError:
          models.length === 0 ? 'No models returned — add one manually below.' : null,
      }));
    } catch (e) {
      setForm((prev) => ({
        ...prev,
        fetchingModels: false,
        fetchModelsError: e instanceof Error ? e.message : 'Failed to fetch models',
      }));
    }
  }

  function toggleModelDefault(modelId: string) {
    setForm((prev) => ({
      ...prev,
      models: prev.models.map((m) => ({ ...m, isDefault: m.modelId === modelId })),
    }));
  }

  function toggleModelSelected(
    modelId: string,
    displayName: string | null,
    contextWindow: number | null,
  ) {
    setForm((prev) => {
      const exists = prev.models.some((m) => m.modelId === modelId);
      if (exists) {
        const next = prev.models.filter((m) => m.modelId !== modelId);
        // Ensure at least one default.
        if (next.length > 0 && !next.some((m) => m.isDefault)) {
          const first = next[0];
          if (first) next[0] = { ...first, isDefault: true };
        }
        return { ...prev, models: next };
      }
      return {
        ...prev,
        models: [
          ...prev.models,
          { modelId, displayName, contextWindow, isDefault: prev.models.length === 0 },
        ],
      };
    });
  }

  function addManualModel() {
    const id = manualModelId.trim();
    if (!id) return;
    toggleModelSelected(id, null, null);
    setManualModelId('');
  }

  return {
    form,
    setForm,
    patchForm,
    manualModelId,
    setManualModelId,
    handleTest,
    handleFetchModels,
    toggleModelDefault,
    toggleModelSelected,
    addManualModel,
  };
}
