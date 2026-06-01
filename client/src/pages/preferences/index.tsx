import { FileText, GitBranch, Server } from 'lucide-react';
import {
  type SettingsNavItem,
  SettingsLayout,
} from '../../components/settings/settings-layout';

const NAV_ITEMS: SettingsNavItem[] = [
  {
    to: 'providers',
    label: 'Personal providers',
    description: 'Your model providers (OAuth or API)',
    icon: <Server />,
  },
  {
    to: 'git-credentials',
    label: 'Git credentials',
    description: 'Tokens for cloning repos',
    icon: <GitBranch />,
  },
  {
    to: 'instructions',
    label: 'Global instructions',
    description: 'Personal memory for every project',
    icon: <FileText />,
  },
];

export function PreferencesView() {
  return <SettingsLayout title="Preferences" navItems={NAV_ITEMS} />;
}
