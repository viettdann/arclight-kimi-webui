import path from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import Icons from 'unplugin-icons/vite';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode, command }) => {
  // PORT (from the shared root .env) is only needed for the dev-server proxy.
  // loadEnv also captures that .env's NODE_ENV=development into the build env —
  // harmless while serving, but on `vite build` it would resolve the whole
  // bundle to development (shipping a dev React build). Read it only when
  // serving so a production build stays production.
  const serverPort =
    command === 'serve'
      ? Number(loadEnv(mode, path.resolve(__dirname, '..'), '').PORT ?? process.env.PORT ?? 3000)
      : 3000;

  return {
    plugins: [react(), tailwindcss(), Icons({ compiler: 'jsx', jsx: 'react' })],
    resolve: {
      alias: [
        { find: '@', replacement: path.resolve(__dirname, 'src') },
        { find: '@shared', replacement: path.resolve(__dirname, '../shared') },
        { find: /^shared\/(.*)$/, replacement: `${path.resolve(__dirname, '../shared')}/$1` },
        { find: /^shared$/, replacement: path.resolve(__dirname, '../shared/index.ts') },
      ],
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
