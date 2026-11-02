import { useSyncExternalStore } from 'react';
import { Moon, Sun } from 'lucide-react';
import { Button } from './ui';

declare global {
  interface Window {
    relayTheme: {
      getSnapshot: () => 'light' | 'dark';
      subscribe: (listener: () => void) => () => void;
      toggle: () => void;
    };
  }
}

export default function ThemeToggle() {
  const theme = useSyncExternalStore(window.relayTheme.subscribe, window.relayTheme.getSnapshot);
  const dark = theme === 'dark';
  return <Button variant="secondary" className="theme-toggle" type="button"
    aria-label="Light / Dark mode" aria-pressed={dark}
    title={`Switch to ${dark ? 'light' : 'dark'} mode`} onClick={window.relayTheme.toggle}>
    {dark ? <Moon size={18} aria-hidden="true" /> : <Sun size={18} aria-hidden="true" />}
    <span>{dark ? 'Dark' : 'Light'}</span>
  </Button>;
}
