import { Navigate } from 'react-router';
import { useAuthStore } from '@/lib/auth-store';
import { AccessControlPanel } from './access-control-panel';
import { OverviewPanel } from './overview-panel';
import { ProjectDiscoverySection } from './project-discovery-section';

/**
 * System section: access control + project discovery + overview (admin-only).
 * Non-admin users are redirected away.
 */
export function SystemSection() {
  const user = useAuthStore((s) => s.user);
  if (user?.role !== 'admin') return <Navigate to="/settings" replace />;

  return (
    <div className="space-y-8">
      <OverviewPanel />
      <AccessControlPanel />
      <ProjectDiscoverySection />
    </div>
  );
}
