import { createContext, useContext, useEffect, useSyncExternalStore, type ReactNode } from 'react';
import { AuthController, cleanCallbackUrl, isAuthCallback } from './controller';

const AuthContext = createContext<AuthController | null>(null);
export function AuthProvider({ controller, children }: { controller: AuthController; children: ReactNode }) {
  useEffect(() => {
    const url = window.location.href;
    // Remove credentials/errors from the address bar before rendering or navigation.
    if (isAuthCallback(url)) window.history.replaceState(null, '', cleanCallbackUrl(url));
    void controller.start(url);
    const check = () => {
      if (controller.getSnapshot().status === 'authenticated' && !controller.getSnapshot().busy) void controller.restore();
    };
    const visible = () => { if (document.visibilityState === 'visible') check(); };
    window.addEventListener('focus', check);
    document.addEventListener('visibilitychange', visible);
    const interval = window.setInterval(check, 60_000);
    return () => {
      window.removeEventListener('focus', check); document.removeEventListener('visibilitychange', visible); window.clearInterval(interval);
    };
  }, [controller]);
  return <AuthContext.Provider value={controller}>{children}</AuthContext.Provider>;
}
export function useAuth() {
  const controller = useContext(AuthContext);
  if (!controller) throw new Error('Live auth requires AuthProvider');
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  return { state, controller, api: controller.api };
}
