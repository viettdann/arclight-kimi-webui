import { createBrowserRouter, Navigate } from 'react-router';
import { ErrorView } from '../components/error-view';
import { GitCredentialsPanel } from '../components/preferences/git-credentials-panel';
import { PersonalProvidersPanel } from '../components/preferences/personal-providers-panel';
import { RequireAdmin } from '../components/require-admin';
import { RequireAuth } from '../components/require-auth';
import { AccessControlPanel } from '../components/settings/access-control-panel';
import { DefaultsPanel } from '../components/settings/defaults-panel';
import { OverviewPanel } from '../components/settings/overview-panel';
import { ProviderPanel } from '../components/settings/provider-panel';
import { SettingsSection } from '../components/settings/settings-section';
import { Shell } from '../pages/app';
import { ChatView } from '../pages/chat-view';
import { PreferencesView } from '../pages/preferences';
import { SettingsView } from '../pages/settings';

// Draft-session route + the query param carrying its target workspace. Shared so
// the route declaration, the navigate that opens a draft, and the composer that
// reads it can't drift to different spellings.
export const DRAFT_SESSION_PATH = '/session/new';
export const DRAFT_WORKDIR_PARAM = 'workDir';

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
        // Draft session: input only, no row yet. The first message fires
        // `start_session`; the resulting snapshot redirects to the real id.
        path: 'session/new',
        element: <RequireAuth />,
        children: [{ index: true, element: <ChatView /> }],
      },
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
              { path: 'providers', element: <PersonalProvidersPanel /> },
            ],
          },
        ],
      },
    ],
  },
]);
