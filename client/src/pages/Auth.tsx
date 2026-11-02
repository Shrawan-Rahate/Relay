import { useEffect, useRef, useState, type FormEvent, type MouseEvent } from 'react';
import { ArrowRight, Check, CircleAlert, Eye, EyeOff, LoaderCircle, Mail } from 'lucide-react';
import { Button } from '../components/ui';
import { authErrors, emailIssue, type FieldErrors } from '../data/project-ui';
import { useAuth } from '../auth/context';

export default function Auth({ register, onSwitch, onDemo }: { register: boolean; onSwitch: () => void; onDemo: () => void }) {
  const { state, controller } = useAuth();
  const [email, setEmail] = useState(state.pendingEmail ?? '');
  const [name, setName] = useState(''); const [password, setPassword] = useState(''); const [confirm, setConfirm] = useState('');
  const [showPassword, setShowPassword] = useState(false); const [showConfirm, setShowConfirm] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});
  const formRef = useRef<HTMLFormElement>(null); const headingRef = useRef<HTMLHeadingElement>(null);
  const errorRef = useRef<HTMLDivElement>(null);
  const logoutRetry = state.retry === 'logout'; const disabled = state.busy || logoutRetry;
  const verification = register && !!state.pendingEmail && (state.status === 'pending' || state.status === 'error');
  useEffect(() => { document.title = `Relay · ${verification ? 'Confirm your email' : register ? 'Sign up' : 'Login'}`; }, [register, verification]);
  useEffect(() => { headingRef.current?.focus(); }, [register, verification]);
  useEffect(() => { if (state.error) errorRef.current?.focus(); }, [state.error]);
  const submit = async (event: FormEvent) => {
    event.preventDefault(); if (disabled) return;
    const normalized = email.trim().toLowerCase();
    const fields = authErrors({ email: normalized, password, ...(register && name ? { name: name.trim() } : {}) }, register, confirm);
    setErrors(fields);
    if (Object.keys(fields).length) {
      const ids: Record<string, string> = { name: 'auth-name', email: 'auth-email', password: 'auth-password', confirmPassword: 'auth-confirm' };
      formRef.current?.querySelector<HTMLElement>(`#${ids[Object.keys(fields)[0]]}`)?.focus();
      return;
    }
    try {
      if (register) await controller.signup(normalized, password, name.trim() || undefined);
      else await controller.login(normalized, password);
    } finally { setPassword(''); setConfirm(''); setShowPassword(false); setShowConfirm(false); }
  };
  const resend = () => {
    if (disabled) return;
    const issue = emailIssue(email); setErrors(issue ? { email: issue } : {});
    if (issue) formRef.current?.querySelector<HTMLElement>('#auth-email')?.focus();
    else void controller.resend(email.trim().toLowerCase());
  };
  const switchPage = (event: MouseEvent<HTMLAnchorElement>) => { event.preventDefault(); if (!disabled) onSwitch(); };
  const VisibilityIcon = showPassword ? EyeOff : Eye; const ConfirmIcon = showConfirm ? EyeOff : Eye;
  return <div className="relay-auth-content">
    <section className="relay-auth-card" aria-labelledby="auth-heading" aria-busy={state.busy}>
      <div className="relay-auth-heading"><span className="relay-auth-eyebrow">{verification ? 'ONE MORE STEP' : 'YOUR PROJECT, CARRIED FORWARD'}</span>
        <h1 id="auth-heading" ref={headingRef} tabIndex={-1}>{verification ? 'Confirm your email' : register ? 'Create your account' : 'Welcome back'}</h1>
        <p>{verification ? 'A little confirmation. A clear path forward.' : register ? 'Bring your team’s context into one place.' : 'Sign in to your Relay workspace.'}</p>
      </div>
      {state.error && <div ref={errorRef} tabIndex={-1} className="relay-auth-message relay-auth-error" role="alert"><CircleAlert size={19} aria-hidden="true" /><div><strong>{logoutRetry ? 'Sign-out needs another try' : 'We couldn’t complete that'}</strong><p>{state.error}</p>
        {state.retry === 'restore' && <Button disabled={state.busy} onClick={() => void controller.restore()}>Retry session restoration</Button>}
        {state.retry === 'exchange' && <Button disabled={state.busy} onClick={() => void controller.resume()}>Retry Relay connection</Button>}
        {logoutRetry && <Button disabled={state.busy} onClick={() => void controller.logout()}>Retry sign-out</Button>}
      </div></div>}
      {state.notice && <div className="relay-auth-message" role="status"><Check size={19} aria-hidden="true" /><p>{state.notice}</p></div>}
      {state.status === 'pending' && !verification && <div className="relay-auth-message" role="status"><Mail size={19} aria-hidden="true" /><p>Confirm your email using the link in your inbox, then sign in here. Need another link? Request one below.</p></div>}
      {verification ? <div className="relay-auth-verification"><span className="relay-auth-mail-icon"><Mail size={28} strokeWidth={1.6} aria-hidden="true" /></span>
        <h2>Check your inbox</h2><p>Look for a confirmation link for</p><p className="relay-auth-email">{state.pendingEmail}</p>
        <p>Open it in the browser you used to sign up. Once your email is confirmed, sign in to connect to Relay.</p>
        <Button variant="primary" className="relay-auth-submit" disabled={disabled} onClick={resend}>{state.busy ? <><LoaderCircle size={18} className="relay-auth-spinner" aria-hidden="true" />Requesting email…</> : 'Resend confirmation email'}</Button>
        <p className="relay-auth-fine-print">No email yet? Check your spam folder, or wait a moment before requesting another link.</p>
      </div> : <form ref={formRef} onSubmit={submit} noValidate aria-label={register ? 'Create a Relay account' : 'Sign in to Relay'}>
        <fieldset disabled={disabled} className="auth-fields relay-auth-fields"><legend className="sr-only">{register ? 'Account details' : 'Sign-in details'}</legend>
          {register && <div><label className="field-label" htmlFor="auth-name">Name <span className="relay-auth-optional">(optional)</span></label><input id="auth-name" className="text-input" autoComplete="name" placeholder="Your name" maxLength={100} value={name} onChange={event => { setName(event.target.value); setErrors({}); }} aria-invalid={!!errors.name} aria-describedby={errors.name ? 'auth-name-error' : undefined} /><p id="auth-name-error" className="field-error">{errors.name}</p></div>}
          <div><label className="field-label" htmlFor="auth-email">Email</label><input id="auth-email" type="email" inputMode="email" className="text-input" autoComplete="email" autoCapitalize="none" autoCorrect="off" spellCheck={false} placeholder="you@company.com" maxLength={254} required value={email} onChange={event => { setEmail(event.target.value); setErrors({}); }} aria-invalid={!!errors.email} aria-describedby={errors.email ? 'auth-email-error' : undefined} /><p id="auth-email-error" className="field-error">{errors.email}</p></div>
          <div><label className="field-label" htmlFor="auth-password">Password</label><div className="relay-auth-password"><input id="auth-password" type={showPassword ? 'text' : 'password'} className="text-input" autoComplete={register ? 'new-password' : 'current-password'} placeholder={register ? 'Create a password' : 'Enter your password'} maxLength={128} required value={password} onChange={event => { setPassword(event.target.value); setErrors({}); }} aria-invalid={!!errors.password} aria-describedby={`auth-password-help${errors.password ? ' auth-password-error' : ''}`} /><button className="relay-auth-visibility" type="button" aria-label={showPassword ? 'Hide password' : 'Show password'} aria-controls="auth-password" aria-pressed={showPassword} onClick={() => setShowPassword(value => !value)}><VisibilityIcon size={19} aria-hidden="true" /></button></div>
            <p id="auth-password-help" className="field-help">{register ? 'Use 12–128 characters. Choose a unique password.' : 'Use the password for your Relay account.'}</p><p id="auth-password-error" className="field-error">{errors.password}</p></div>
          {register && <div><label className="field-label" htmlFor="auth-confirm">Confirm password</label><div className="relay-auth-password"><input id="auth-confirm" type={showConfirm ? 'text' : 'password'} className="text-input" autoComplete="new-password" placeholder="Enter your password again" maxLength={128} required value={confirm} onChange={event => { setConfirm(event.target.value); setErrors({}); }} aria-invalid={!!errors.confirmPassword} aria-describedby={errors.confirmPassword ? 'auth-confirm-error' : undefined} /><button className="relay-auth-visibility" type="button" aria-label={showConfirm ? 'Hide confirm password' : 'Show confirm password'} aria-controls="auth-confirm" aria-pressed={showConfirm} onClick={() => setShowConfirm(value => !value)}><ConfirmIcon size={19} aria-hidden="true" /></button></div><p id="auth-confirm-error" className="field-error">{errors.confirmPassword}</p></div>}
          <Button variant="primary" className="relay-auth-submit" type="submit">{state.busy ? <><LoaderCircle size={18} className="relay-auth-spinner" aria-hidden="true" />{state.status === 'signing-out' ? 'Signing out…' : 'Please wait…'}</> : <>{register ? 'Create account' : 'Sign in'}<ArrowRight size={18} aria-hidden="true" /></>}</Button>
        </fieldset>
        {Object.keys(errors).length > 0 && <p role="alert" className="field-error">Check the highlighted fields. Nothing was submitted.</p>}
        {state.busy && <p className="relay-auth-progress" role="status">{state.status === 'signing-out' ? 'Finishing sign-out…' : 'Securely contacting the authentication service…'}</p>}
        {register && <p className="relay-auth-fine-print">We’ll ask you to confirm your email before you access your workspace.</p>}
      </form>}
      <div className="relay-auth-switch"><span>{register ? verification ? 'Already confirmed?' : 'Already have an account?' : 'New to Relay?'}</span><a href={register ? '#login' : '#register'} onClick={switchPage} aria-disabled={disabled} tabIndex={disabled ? -1 : undefined}>{register ? 'Sign in' : 'Sign up'}<ArrowRight size={15} aria-hidden="true" /></a></div>
      {!register && <div className="relay-auth-resend"><span>Waiting for a verification email?</span><button type="button" onClick={resend} disabled={disabled}>Resend confirmation email</button></div>}
    </section>
    <footer className="relay-auth-footer"><span>Just looking around?</span><button type="button" disabled={disabled} onClick={onDemo}>Explore DEMO<ArrowRight size={14} aria-hidden="true" /></button><p>Sample data. Separate from your live workspace.</p></footer>
  </div>;
}
