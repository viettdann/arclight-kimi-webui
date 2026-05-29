import { createBrowserRouter, Navigate } from 'react-router';
import { GitCredentialsPanel } from '../components/preferences/git-credentials-panel';
import { RequireAdmin } from '../components/require-admin';
import { RequireAuth } from '../components/require-auth';
import { AccessControlPanel } from '../components/settings/access-control-panel';
import { KimiAgentPanel } from '../components/settings/kimi-agent-panel';
import { KimiBackgroundPanel } from '../components/settings/kimi-background-panel';
import { KimiDefaultsPanel } from '../components/settings/kimi-defaults-panel';
import { KimiHooksPanel } from '../components/settings/kimi-hooks-panel';
import { KimiRawTomlPanel } from '../components/settings/kimi-raw-toml-panel';
import { KimiSection } from '../components/settings/kimi-section';
import { KimiServicesPanel } from '../components/settings/kimi-services-panel';
import { OverviewPanel } from '../components/settings/overview-panel';
import { ProviderPanel } from '../components/settings/provider-panel';
import { Shell } from '../pages/app';
import { ChatView } from '../pages/chat-view';
import { PreferencesView } from '../pages/preferences';
import { SettingsView } from '../pages/settings';

export const router = createBrowserRouter([
  {
    path: '/',
    element: <Shell />,
    children: [
      { index: true, element: <ChatView /> },
      {
        path: 'session/:id/*',
        element: <RequireAuth />,
        children: [{ index: true, element: <ChatView /> }],
      },
      {
        path: 'settings',
        element: <RequireAdmin />,
        children: [
          {
            element: <SettingsView />,
            children: [
              { index: true, element: <Navigate to="overview" replace /> },
              { path: 'overview', element: <OverviewPanel /> },
              { path: 'provider', element: <ProviderPanel /> },
              {
                path: 'kimi',
                element: <KimiSection />,
                children: [
                  { index: true, element: <Navigate to="defaults" replace /> },
                  { path: 'defaults', element: <KimiDefaultsPanel /> },
                  { path: 'services', element: <KimiServicesPanel /> },
                  { path: 'agent', element: <KimiAgentPanel /> },
                  { path: 'background', element: <KimiBackgroundPanel /> },
                  { path: 'hooks', element: <KimiHooksPanel /> },
                  { path: 'raw-toml', element: <KimiRawTomlPanel /> },
                ],
              },
              { path: 'access', element: <AccessControlPanel /> },
            ],
          },
        ],
      },
      {
        path: 'preferences',
        element: <RequireAuth />,
        children: [
          {
            element: <PreferencesView />,
            children: [
              { index: true, element: <Navigate to="git-credentials" replace /> },
              { path: 'git-credentials', element: <GitCredentialsPanel /> },
            ],
          },
        ],
      },
    ],
  },
]);
