import { FileText, Server, Shield, SlidersHorizontal } from 'lucide-react';
import { SettingsDialog, type SettingsNavItem } from '../../components/settings/settings-dialog';
import { useAuthStore } from '../../lib/auth-store';

export function SettingsView() {
  const user = useAuthStore((s) => s.user);
  const isAdmin = user?.role === 'admin';

  const navItems: SettingsNavItem[] = [
    {
      to: 'general',
      label: 'General',
      description: 'Instructions & git credentials',
      icon: <FileText />,
    },
    {
      to: 'providers',
      label: 'Providers',
      description: 'Model providers',
      icon: <Server />,
    },
    {
      to: 'workspace',
      label: 'Workspace',
      description: 'Session defaults & preferences',
      icon: <SlidersHorizontal />,
    },
    ...(isAdmin
      ? [
          {
            to: 'system',
            label: 'System',
            description: 'Access control & project discovery',
            icon: <Shield />,
          } satisfies SettingsNavItem,
        ]
      : []),
  ];

  return <SettingsDialog title="Settings" navItems={navItems} />;
}
