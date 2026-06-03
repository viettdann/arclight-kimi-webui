import { useAuthStore } from '@/lib/auth-store';
import { ProviderPanel } from './provider-panel';
import { PersonalProvidersPanel } from '../preferences/personal-providers-panel';

/**
 * Unified providers section. Admin sees built-in + personal;
 * regular users see only personal providers.
 */
export function ProvidersSection() {
  const user = useAuthStore((s) => s.user);
  const isAdmin = user?.role === 'admin';

  return (
    <div className="space-y-8">
      {isAdmin && <ProviderPanel />}
      <PersonalProvidersPanel />
    </div>
  );
}
