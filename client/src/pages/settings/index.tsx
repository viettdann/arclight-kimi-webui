import { FileText, Server, Shield, SlidersHorizontal } from 'lucide-react';
import { useLocation } from 'react-router';
import { useAuthStore } from '../../lib/auth-store';
import { type SettingsNavItem, SettingsLayout } from '../../components/settings/settings-layout';

interface SettingsNav extends SettingsNavItem {
  hideEditChrome?: boolean;
}

export function SettingsView() {
  const { pathname } = useLocation();
  const user = useAuthStore((s) => s.user);
  const isAdmin = user?.role === 'admin';

  const NAV_ITEMS: SettingsNav[] = [
    {
      to: 'providers',
      label: 'Providers',
      description: 'Model providers',
      icon: <Server />,
      hideEditChrome: true,
    },
    {
      to: 'workspace',
      label: 'Workspace',
      description: 'Session defaults & preferences',
      icon: <SlidersHorizontal />,
      hideEditChrome: true,
    },
    {
      to: 'general',
      label: 'General',
      description: 'Instructions & git credentials',
      icon: <FileText />,
      hideEditChrome: true,
    },
    ...(isAdmin
      ? [
          {
            to: 'system',
            label: 'System',
            description: 'Access control & project discovery',
            icon: <Shield />,
            hideEditChrome: true,
          } satisfies SettingsNav,
        ]
      : []),
  ];

  const activeNav = NAV_ITEMS.find((item) => pathname.startsWith(`/settings/${item.to}`));
  const showEditChrome = activeNav?.hideEditChrome !== true;

  const contentHeader = showEditChrome ? (
    <header className="flex shrink-0 items-center justify-between gap-3 border-b border-border bg-background px-4 py-3 md:px-11">
      <div className="min-w-0">
        <h2 className="text-base font-semibold">Configuration</h2>
        <p className="text-xs text-muted-foreground">
          Changes are staged per section until you press its Save button.
        </p>
      </div>
    </header>
  ) : undefined;

  return <SettingsLayout title="Settings" navItems={NAV_ITEMS} contentHeader={contentHeader} />;
}
