import { createBrowserRouter } from 'react-router';
import { RequireAuth } from '../components/require-auth';
import { AppShell } from '../pages/app';
import { LoginPage } from '../pages/login';

// Single router instance. `auth-store.clearSession` calls `router.navigate`
// directly so logout works from anywhere — REST 401, WS 4401, manual button.
export const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  {
    path: '/*',
    element: <RequireAuth />,
    children: [{ path: '*', element: <AppShell /> }],
  },
]);
