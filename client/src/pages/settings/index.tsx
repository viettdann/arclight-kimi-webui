import { Gauge, Server, Settings2, Users } from 'lucide-react';
import { useLocation } from 'react-router';
import {
  type SettingsNavItem,
  SettingsLayout,
} from '../../components/settings/settings-layout';

interface SettingsNav extends SettingsNavItem {
  /** Hide the config header (for routes that save automatically or don't edit). */
  hideEditChrome?: boolean;
}

const NAV_ITEMS: SettingsNav[] = [
  {
    to: 'overview',
    label: 'Overview',
    description: 'System info & status',
    icon: <Gauge />,
    hideEditChrome: true,
  },
  {
    to: 'providers',
    label: 'Built-in providers',
    description: 'API providers shared across users',
    icon: <Server />,
  },
  {
    to: 'session-defaults',
    label: 'Session defaults',
    description: 'Approval & thinking for new sessions',
    icon: <Settings2 />,
    // Saves automatically — the "press Save" config header would lie.
    hideEditChrome: true,
  },
  {
    to: 'access',
    label: 'Members & access',
    description: 'Identity & allowlist',
    icon: <Users />,
    hideEditChrome: true,
  },
];

export function SettingsView() {
  const { pathname } = useLocation();
  const activeNav = NAV_ITEMS.find((item) => pathname.startsWith(`/settings/${item.to}`));
  const showEditChrome = activeNav?.hideEditChrome !== true;

  // Config header (only on routes with a manual per-section Save). Each panel
  // owns its own Save/Discard — there is no page-wide save.
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
