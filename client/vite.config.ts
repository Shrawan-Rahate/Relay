import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { assertPublishableKey } from './src/auth/config';
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', 'VITE_');
  // Fail before bundling a known private credential into public browser code.
  assertPublishableKey(env.VITE_SUPABASE_PUBLISHABLE_KEY ?? '');
  return { plugins: [react()], server: { proxy: { '/api': { target: 'http://localhost:4000' } } } };
});
