import { createBrowserRouter } from 'react-router';
import { RequireAuth } from '../components/require-auth';
import { AppShell } from '../pages/app';
import { KimiConfigPage } from '../pages/settings/KimiConfigPage';

export const router = createBrowserRouter([
  { path: '/', element: <AppShell /> },
  {
    path: '/session/:id/*',
    element: <RequireAuth />,
    children: [{ path: '*', element: <AppShell /> }],
  },
  {
    path: '/settings',
    element: (
      <RequireAuth>
        <KimiConfigPage />
      </RequireAuth>
    ),
  },
]);
