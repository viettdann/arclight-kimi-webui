import { useEffect, useState } from 'react';
import type { ProviderDTO, ProviderType } from 'shared/types/providers';
import { Button } from '@/components/ui/button';
import { SecHead } from '@/components/ui/sec-head';
import { deleteMyProvider, listMyProviders } from '../../api/providers';
import { showToast } from '../../components/toast-provider';
import { refreshComposerCatalog } from '../../lib/providers-store';
import { cn } from '../../lib/utils';
import { PersonalProviderDialog } from './personal-provider-dialog';

const TYPE_LABELS: Record<ProviderType, string> = {
  oauth: 'OAuth',
  api: 'API',
};

export function PersonalProvidersPanel() {
  const [providers, setProviders] = useState<ProviderDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<ProviderDTO | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await listMyProviders();
      setProviders(res.providers);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load providers');
    } finally {
      setLoading(false);
    }
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: one-shot on mount
  useEffect(() => {
    void load();
  }, []);

  function openAdd() {
    setEditing(null);
    setDialogOpen(true);
  }

  function openEdit(provider: ProviderDTO) {
    setEditing(provider);
    setDialogOpen(true);
  }

  function handleSaved() {
    void load();
    refreshComposerCatalog();
  }

  async function handleRemove(provider: ProviderDTO) {
    if (!window.confirm(`Remove provider "${provider.namespace}"?`)) return;
    try {
      await deleteMyProvider(provider.id);
      showToast({ message: 'Provider removed', type: 'info' });
      void load();
      refreshComposerCatalog();
    } catch (err) {
      showToast({
        message: err instanceof Error ? err.message : 'Failed to remove provider',
        type: 'error',
      });
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="h-7 w-7 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  const oauthProviders = providers.filter((p) => p.type === 'oauth');
  const apiProviders = providers.filter((p) => p.type === 'api');

  return (
    <div className="space-y-5">
      {error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-2.5 text-sm text-destructive">
          {error}
        </div>
      )}

      <SecHead
        title="Personal providers"
        description="Your own model providers (OAuth or API key). Visible only to you."
        actions={
          <Button type="button" variant="default" size="sm" onClick={openAdd}>
            Add provider
          </Button>
        }
      />

      {providers.length === 0 ? (
        <p className="text-xs italic text-muted-foreground border border-dashed border-border rounded-md py-6 text-center">
          No providers yet.
        </p>
      ) : (
        <div className="space-y-4">
          {oauthProviders.length > 0 && (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                OAuth
              </p>
              <ProviderList providers={oauthProviders} onEdit={openEdit} onRemove={handleRemove} />
            </div>
          )}
          {apiProviders.length > 0 && (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                API key
              </p>
              <ProviderList providers={apiProviders} onEdit={openEdit} onRemove={handleRemove} />
            </div>
          )}
        </div>
      )}

      <PersonalProviderDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        provider={editing}
        onSaved={handleSaved}
      />
    </div>
  );
}

interface ProviderListProps {
  providers: ProviderDTO[];
  onEdit: (provider: ProviderDTO) => void;
  onRemove: (provider: ProviderDTO) => void;
}

function ProviderList({ providers, onEdit, onRemove }: ProviderListProps) {
  return (
    <ul className="divide-y divide-border rounded-md border border-border overflow-hidden">
      {providers.map((provider) => (
        <li
          key={provider.id}
          className="flex items-center justify-between gap-3 px-3 py-2.5 hover:bg-muted/40 transition-colors"
        >
          <div className="flex min-w-0 flex-col gap-0.5">
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-sm font-medium truncate">{provider.namespace}</span>
              <span
                className={cn(
                  'shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider border',
                  'bg-muted border-border text-muted-foreground',
                )}
              >
                {TYPE_LABELS[provider.type]}
              </span>
              <span className="shrink-0 text-[10px] text-muted-foreground tabular-nums">
                {provider.models.length} model{provider.models.length !== 1 ? 's' : ''}
              </span>
            </div>
            <div className="text-xs text-muted-foreground min-w-0">
              <span className="font-mono">{provider.tokenMasked}</span>
            </div>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <time
              className="text-[11px] text-muted-foreground tabular-nums"
              dateTime={provider.createdAt}
              title={provider.createdAt}
            >
              {formatDate(provider.createdAt)}
            </time>
            <Button type="button" variant="ghost" size="xs" onClick={() => onEdit(provider)}>
              Edit
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="xs"
              onClick={() => onRemove(provider)}
              className="text-destructive hover:text-destructive"
            >
              Remove
            </Button>
          </div>
        </li>
      ))}
    </ul>
  );
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return iso;
  }
}
