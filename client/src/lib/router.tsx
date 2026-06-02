import { createBrowserRouter, Navigate } from 'react-router';
import { ErrorView } from '../components/error-view';
import { GitCredentialsPanel } from '../components/preferences/git-credentials-panel';
import { InstructionsPanel } from '../components/preferences/instructions-panel';
import { PersonalProvidersPanel } from '../components/preferences/personal-providers-panel';
import { ProjectDiscoverySection } from '../components/settings/project-discovery-section';
import { RequireAdmin } from '../components/require-admin';
import { RequireAuth } from '../components/require-auth';
import { AccessControlPanel } from '../components/settings/access-control-panel';
import { DefaultsPanel } from '../components/settings/defaults-panel';
import { OverviewPanel } from '../components/settings/overview-panel';
import { ProviderPanel } from '../components/settings/provider-panel';
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
    // Catches thrown errors and Responses (403/500/…) from any descendant, plus
    // React Router's synthetic 404 for URLs that match no route below.
    errorElement: <ErrorView />,
    children: [
      {
        // Chat Shell: fixed project rail + shared header. Settings/Preferences
        // deliberately live OUTSIDE this so they render as full-page chrome
        // (one sidebar + a back-to-chat topbar) — never doubled up with the rail.
        element: <Shell />,
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
        ],
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
              { path: 'providers', element: <ProviderPanel /> },
              { path: 'session-defaults', element: <DefaultsPanel /> },
              { path: 'access', element: <AccessControlPanel /> },
              { path: 'project-discovery', element: <ProjectDiscoverySection /> },
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
              { index: true, element: <Navigate to="providers" replace /> },
              { path: 'providers', element: <PersonalProvidersPanel /> },
              { path: 'git-credentials', element: <GitCredentialsPanel /> },
              { path: 'instructions', element: <InstructionsPanel /> },
            ],
          },
        ],
      },
    ],
  },
]);
