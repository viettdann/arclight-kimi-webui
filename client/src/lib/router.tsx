import { createBrowserRouter, Navigate } from 'react-router';
import { ErrorView } from '../components/error-view';
import { GitCredentialsPanel } from '../components/preferences/git-credentials-panel';
import { RequireAdmin } from '../components/require-admin';
import { RequireAuth } from '../components/require-auth';
import { AccessControlPanel } from '../components/settings/access-control-panel';
import { DefaultsPanel } from '../components/settings/defaults-panel';
import { ModelsPanel } from '../components/settings/models-panel';
import { OverviewPanel } from '../components/settings/overview-panel';
import { ProviderPanel } from '../components/settings/provider-panel';
import { SettingsSection } from '../components/settings/settings-section';
import { Shell } from '../pages/app';
import { ChatView } from '../pages/chat-view';
import { PreferencesView } from '../pages/preferences';
import { SettingsView } from '../pages/settings';

export const router = createBrowserRouter([
  {
    path: '/',
    element: <Shell />,
    // Catches thrown errors and Responses (403/500/…) from any descendant, plus
    // React Router's synthetic 404 for URLs that match no route below.
    errorElement: <ErrorView />,
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
              {
                path: 'claude',
                element: <SettingsSection />,
                children: [
                  { index: true, element: <Navigate to="provider" replace /> },
                  { path: 'provider', element: <ProviderPanel /> },
                  { path: 'models', element: <ModelsPanel /> },
                  { path: 'defaults', element: <DefaultsPanel /> },
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
