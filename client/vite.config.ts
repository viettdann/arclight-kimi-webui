import path from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import Icons from 'unplugin-icons/vite';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  // Load .env from repo root so PORT (server) is available alongside VITE_*.
  const rootEnv = loadEnv(mode, path.resolve(__dirname, '..'), '');
  const serverPort = Number(rootEnv.PORT ?? process.env.PORT ?? 3000);

  return {
    plugins: [react(), tailwindcss(), Icons({ compiler: 'jsx', jsx: 'react' })],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, 'src'),
        '@shared': path.resolve(__dirname, '../shared'),
        shared: path.resolve(__dirname, '../shared/index.ts'),
      },
    },
    server: {
      port: 5173,
      strictPort: true,
      proxy: {
        '/api': {
          target: `http://localhost:${serverPort}`,
          changeOrigin: false,
        },
        '/ws': {
          target: `ws://localhost:${serverPort}`,
          ws: true,
          changeOrigin: false,
        },
      },
    },
  };
});
