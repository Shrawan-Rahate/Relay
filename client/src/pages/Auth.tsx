import { useRef, useState, type FormEvent } from 'react';
import type { LoginRequest, RegisterRequest } from '../../../shared/api-types';
import { ArrowRight } from 'lucide-react';
import { Button } from '../components/ui';
import { authErrors, type FieldErrors } from '../data/project-ui';

export default function Auth({ register, onSwitch, onProjects }: { register: boolean; onSwitch: () => void; onProjects: () => void }) {
  const [email, setEmail] = useState(''); const [name, setName] = useState('');
  const [password, setPassword] = useState(''); const [confirm, setConfirm] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [previewed, setPreviewed] = useState(false);
  const [state, setState] = useState('ready');
  const formRef = useRef<HTMLFormElement>(null);
  const change = () => { setPreviewed(false); setErrors({}); };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const request: LoginRequest | RegisterRequest = register ? { email: email.trim().toLowerCase(), password, ...(name ? { name: name.trim() } : {}) } : { email: email.trim().toLowerCase(), password };
    const nextErrors = authErrors(request, register, confirm);
    setErrors(nextErrors); setPreviewed(false);
    if (Object.keys(nextErrors).length) { requestAnimationFrame(() => formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus()); return; }
    // Never retain credentials in a preview object, log, storage, or app-level identity.
    setPassword(''); setConfirm(''); setPreviewed(true);
  };
  return <div className="feature-page auth-page"><div className="page-heading"><h1>{register ? 'Register' : 'Login'}</h1><p>{register ? 'Create an account to carry project context forward.' : 'Access your project workspace.'}</p></div><p className="feature-demo-note">DEMO form · Use test inputs. Validation is local; no authentication request is sent, no account or session is created, and no tokens are stored.</p><label className="filter-label form-state-selector">DEMO form state<select value={state} onChange={event => { setState(event.target.value); setPreviewed(false); }}><option value="ready">Ready</option><option value="loading">Loading example</option><option value="error">Error example</option></select></label>{state === 'loading' && <p className="local-preview" role="status">DEMO loading example. No authentication is in progress. Select Ready to return to the form.</p>}{state === 'error' && <p className="field-error" role="alert">DEMO error example: authentication service unavailable. No request was made. Select Ready to retry local validation.</p>}
    <form ref={formRef} onSubmit={submit} noValidate><fieldset disabled={state !== 'ready'} className="auth-fields">{register && <div><label className="field-label" htmlFor="auth-name">Name (optional)</label><input id="auth-name" className="text-input" autoComplete="name" value={name} maxLength={100} onChange={event => { setName(event.target.value); change(); }} aria-invalid={!!errors.name} aria-describedby="auth-name-error" /><p id="auth-name-error" className="field-error">{errors.name}</p></div>}<div><label className="field-label" htmlFor="auth-email">Email</label><input id="auth-email" type="email" className="text-input" autoComplete="email" autoCapitalize="none" maxLength={254} value={email} required onChange={event => { setEmail(event.target.value); change(); }} aria-invalid={!!errors.email} aria-describedby="auth-email-error" /><p id="auth-email-error" className="field-error">{errors.email}</p></div><div><label className="field-label" htmlFor="auth-password">Password</label><input id="auth-password" type={showPassword ? 'text' : 'password'} className="text-input" autoComplete={register ? 'new-password' : 'current-password'} maxLength={128} value={password} required onChange={event => { setPassword(event.target.value); change(); }} aria-invalid={!!errors.password} aria-describedby="auth-password-help auth-password-error" /><p id="auth-password-help" className="field-help">{register ? '12–128 characters.' : '1–128 characters. Credentials are not checked in this demo.'}</p><p id="auth-password-error" className="field-error">{errors.password}</p></div>{register && <div><label className="field-label" htmlFor="auth-confirm">Confirm password</label><input id="auth-confirm" type={showPassword ? 'text' : 'password'} className="text-input" autoComplete="new-password" maxLength={128} value={confirm} required onChange={event => { setConfirm(event.target.value); change(); }} aria-invalid={!!errors.confirmPassword} aria-describedby="auth-confirm-error" /><p id="auth-confirm-error" className="field-error">{errors.confirmPassword}</p></div>}<label className="checkbox-field"><input type="checkbox" checked={showPassword} onChange={event => setShowPassword(event.target.checked)} />Show password</label><Button variant="primary" type="submit">Preview {register ? 'registration' : 'login'} validation<ArrowRight size={18} /></Button></fieldset></form>
    {Object.keys(errors).length > 0 && <p role="alert" className="field-error">Check the highlighted fields. Nothing was submitted.</p>}{previewed && <div className="local-preview" role="status"><h2>Validation preview only</h2><p>{register ? 'No account was created.' : 'You are not signed in.'} Password fields were cleared. No request was sent.</p></div>}<div className="auth-links"><button className="inline-link" onClick={onSwitch}>{register ? 'Preview Login instead' : 'Preview Register instead'}<ArrowRight size={18} /></button><button className="inline-link" onClick={onProjects}>Explore demo projects without signing in<ArrowRight size={18} /></button></div>
  </div>;
}
