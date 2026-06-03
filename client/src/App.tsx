import { useEffect } from 'react';
import { RouterProvider } from 'react-router';
import './lib/auth-subscriber';
import './lib/ws-subscriber';
import { useAuthStore } from './lib/auth-store';
import { router } from './lib/router';

export default function App() {
  useEffect(() => {
    void useAuthStore.getState().bootstrap();
  }, []);

  return <RouterProvider router={router} />;
}
