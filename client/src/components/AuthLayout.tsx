import type { ReactNode } from 'react';
import ThemeToggle from './ThemeToggle';

export default function AuthLayout({ children }: { children: ReactNode }) {
  return <div className="relay-auth-layout"><a className="relay-auth-skip" href="#auth-main" onClick={event => { event.preventDefault(); document.getElementById('auth-main')?.focus(); }}>Skip to sign-in content</a>
    <header className="relay-auth-header"><a className="relay-auth-brand" href="#login" aria-label="Relay home"><svg width="27" height="29" viewBox="0 0 28 30" fill="none" aria-hidden="true"><path d="M3 23V7h9a6 6 0 0 1 0 12H8" stroke="currentColor" strokeWidth="3.2" /><path d="m14 17 10 9M19 4h6v6" stroke="currentColor" strokeWidth="3.2" /></svg><span>relay<span className="brand-dot">.</span></span></a><ThemeToggle /></header>
    <main id="auth-main" className="relay-auth-stage" tabIndex={-1}>{children}</main><div className="relay-auth-baseline" aria-hidden="true">KNOWLEDGE, CARRIED FORWARD.</div>
  </div>;
}
