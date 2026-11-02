import { lazy, Suspense, useState } from 'react';
import { AuthProvider } from './auth/context';
import { getLiveAuth } from './auth/runtime';
import { Button } from './components/ui';
import ThemeToggle from './components/ThemeToggle';
import LiveApp from './LiveApp';

const DemoApp = lazy(() => import('./DemoApp'));

export default function App() {
  const [mode, setMode] = useState<'live' | 'demo'>(() => import.meta.env.VITE_RELAY_MODE === 'demo' ? 'demo' : 'live');
  if (mode === 'demo') return <Suspense fallback={<p role="status">Loading DEMO previews…</p>}><DemoApp /><Button className="mode-return" onClick={() => setMode('live')}>Leave DEMO · Sign in to Relay</Button></Suspense>;
  try {
    if (import.meta.env.VITE_RELAY_MODE && !['demo', 'live'].includes(import.meta.env.VITE_RELAY_MODE)) throw new Error('VITE_RELAY_MODE must be live or demo.');
    const controller = getLiveAuth();
    return <AuthProvider controller={controller}><LiveApp onDemo={() => setMode('demo')} /></AuthProvider>;
  } catch (error) {
    return <div className="feature-page auth-page"><ThemeToggle /><div className="page-heading"><h1>Connect Relay authentication</h1></div><p className="field-error" role="alert">{error instanceof Error ? error.message : 'Authentication configuration is unavailable.'}</p><p>Set the public client configuration and restart the Vite server. Live login is unavailable until configuration is valid.</p><Button onClick={() => window.location.reload()}>Retry configuration</Button><Button onClick={() => setMode('demo')}>Explore explicit DEMO mode</Button></div>;
  }
}
