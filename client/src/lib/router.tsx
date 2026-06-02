import { createBrowserRouter, Navigate } from 'react-router';
import { ErrorView } from '../components/error-view';
import { ProjectDiscoverySection } from '../components/settings/project-discovery-section';
import { RequireAuth } from '../components/require-auth';
import { AccessControlPanel } from '../components/settings/access-control-panel';
import { GeneralSection } from '../components/settings/general-section';
import { OverviewPanel } from '../components/settings/overview-panel';
import { ProviderPanel } from '../components/settings/provider-panel';
import { ProvidersSection } from '../components/settings/providers-section';
import { SystemSection } from '../components/settings/system-section';
import { WorkspacePanel } from '../components/settings/workspace-panel';
import { Shell } from '../pages/app';
import { ChatView } from '../pages/chat-view';
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
        // Chat Shell: fixed project rail + shared header. Chat pages AND the
        // settings modal render under here, so the rail + header stay mounted and
        // blur through the settings backdrop instead of dropping to a blank page.
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
          {
            // Settings is a route-driven modal (SettingsView → SettingsDialog,
            // portaled). Nested here so opening it keeps the Shell behind the
            // backdrop; closing navigates back to `backgroundLocation`.
            path: 'settings',
            element: <RequireAuth />,
            children: [
              {
                element: <SettingsView />,
                children: [
                  { index: true, element: <Navigate to="providers" replace /> },
                  { path: 'providers', element: <ProvidersSection /> },
                  { path: 'workspace', element: <WorkspacePanel /> },
                  { path: 'general', element: <GeneralSection /> },
                  { path: 'system', element: <SystemSection /> },
                  // ── Redirect map for old URLs ──
                  { path: 'overview', element: <Navigate to="/settings/system" replace /> },
                  {
                    path: 'session-defaults',
                    element: <Navigate to="/settings/workspace" replace />,
                  },
                  { path: 'access', element: <Navigate to="/settings/system" replace /> },
                  {
                    path: 'project-discovery',
                    element: <Navigate to="/settings/system" replace />,
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  },
]);
