import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { ProjectMember, ProjectRole } from '../../../shared/api-types';
import { Button } from '../components/ui';
import { useWorkflowTicket, type WorkflowProps } from '../components/LiveWorkflow';
import { memberErrors, roleLabels, type FieldErrors } from '../data/project-ui';
import { ApiError } from '../lib/api';
import { addMember, fetchMembers, memberError, removeMember } from '../lib/member-api';
import './live-members.css';

type Props = WorkflowProps & { currentUserId?: string };
export default function LiveProjectDetail(props: Props) {
  return <ProjectDetail key={`${props.project.id}:${props.project.role}`} {...props} />;
}
function ProjectDetail({ project, api, refreshAccess, currentUserId }: Props) {
  const [members, setMembers] = useState<ProjectMember[]>([]), [loading, setLoading] = useState(project.role === 'REVIEWER');
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(''), [denied, setDenied] = useState(false), [success, setSuccess] = useState('');
  const [email, setEmail] = useState(''), [role, setRole] = useState<ProjectRole>('OUTGOING'), [errors, setErrors] = useState<FieldErrors>({});
  const [pending, setPending] = useState(false), [removing, setRemoving] = useState<ProjectMember | null>(null);
  const loadVersion = useRef(0);
  const busy = useRef(false), ticket = useWorkflowTicket();
  const fail = (error: unknown) => {
    setError(memberError(error));
    if (error instanceof ApiError && [401, 403, 404].includes(error.status) && error.code !== 'USER_NOT_FOUND') {
      setDenied(true); setMembers([]); setRemoving(null);
    }
  };
  const load = async () => {
    const alive = ticket(), version = ++loadVersion.current;
    const current = () => alive() && version === loadVersion.current;
    setLoading(true); setLoaded(false); setMembers([]);
    try { const result = await fetchMembers(api, project); if (current()) { setMembers(result); setLoaded(true); setDenied(false); } }
    catch (error) { if (current()) fail(error); }
    finally { if (current()) setLoading(false); }
  };
  useEffect(() => {
    if (project.role === 'REVIEWER') { setError(''); void load(); }
    return () => { ++loadVersion.current; };
  }, [project, api]);
  const mutate = async (operation: () => Promise<unknown>, message: string, selfRemoval = false) => {
    if (busy.current || denied || loading || !loaded || project.role !== 'REVIEWER') return;
    busy.current = true; setPending(true); setError(''); setSuccess('');
    const current = ticket();
    try {
      await operation();
      if (!current()) return;
      setRemoving(null); setSuccess(message); setEmail('');
      if (selfRemoval) { setDenied(true); setMembers([]); refreshAccess(); }
      else await load();
    } catch (error) { if (current()) fail(error); }
    finally { busy.current = false; if (current()) setPending(false); }
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const input = { email: email.trim().toLowerCase(), role }, issues = memberErrors(input); setErrors(issues);
    if (Object.keys(issues).length) return;
    void mutate(() => addMember(api, project, input), 'Member added.');
  };
  const reviewers = members.filter(member => member.role === 'REVIEWER').length;
  return <div className="feature-page project-detail-page live-workflow live-members"><div className="page-heading"><h1>{project.name}</h1><p>Project & members · LIVE</p></div>
    <section><h2>Project information</h2><p className="project-description preserve-text">{project.description || 'No project description provided.'}</p>
      <dl className="project-facts"><div><dt>Your project role</dt><dd>{roleLabels[project.role]}</dd></div><div><dt>Project ID</dt><dd>{project.id}</dd></div><div><dt>Created</dt><dd>{project.createdAt || 'Not provided'}</dd></div><div><dt>Updated</dt><dd>{project.updatedAt || 'Not provided'}</dd></div></dl>
    </section><section className="workflow-section"><h2>Project members</h2>
      {project.role !== 'REVIEWER' ? <p>Only reviewers can view the member list and manage memberships. Your project role is {roleLabels[project.role]}.</p> : <>
        {error && <p role="alert" className="field-error">{error}</p>}{success && <p role="status">{success}</p>}
        {denied ? <Button onClick={refreshAccess}>Refresh project access</Button> : <>
          <Button disabled={pending || loading} onClick={() => { setError(''); setSuccess(''); setRemoving(null); void load(); }}>Refresh members</Button>
          {loading ? <p role="status">Loading members…</p> : !loaded ? null : members.length === 0 ? <p>No members returned for this project.</p> : <ul className="member-list">{members.map(member => {
            const lastReviewer = member.role === 'REVIEWER' && reviewers <= 1;
            return <li key={member.id}><div className="member-identity"><strong>{member.user.name || 'Name not provided'}</strong><p>{member.user.email}</p><p>{roleLabels[member.role]}{member.userId === currentUserId ? ' · You' : ''}</p><details><summary>Membership details</summary><dl><dt>Membership ID</dt><dd>{member.id}</dd><dt>Joined</dt><dd>{member.createdAt}</dd><dt>Updated</dt><dd>{member.updatedAt}</dd></dl></details>
              {lastReviewer && <p className="field-help">The final reviewer cannot be removed.</p>}</div><Button disabled={pending || lastReviewer} aria-label={`Remove ${member.user.email}`} onClick={() => setRemoving(member)}>Remove</Button></li>;
          })}</ul>}
          {removing && <section aria-label="Confirm member removal"><h3>Remove {removing.user.email}?</h3><p>This removes their access to this project.{removing.userId === currentUserId ? ' You will lose access to this project.' : ''}</p><Button disabled={pending} onClick={() => void mutate(() => removeMember(api, project, removing.id), 'Member removed.', removing.userId === currentUserId)}>Confirm removal</Button><Button disabled={pending} onClick={() => setRemoving(null)}>Cancel removal</Button></section>}
          <section className="member-form-card" aria-labelledby="member-form-title"><header><h3 id="member-form-title">Add a registered member</h3><p>Use an existing Relay user's email. They must have signed in to Relay. This does not create an account or send an invitation.</p></header>
          <form onSubmit={submit} noValidate><fieldset className="member-form-grid" disabled={pending || loading || !loaded}><legend className="sr-only">Add project member</legend>
            <div className="member-form-field"><label className="field-label" htmlFor="live-member-email">Registered email</label><input className="text-input" id="live-member-email" type="email" maxLength={254} autoComplete="off" autoCapitalize="none" value={email} onChange={event => { setEmail(event.target.value); setErrors({}); }} aria-invalid={!!errors.email} aria-describedby="live-member-email-error" />
            <p id="live-member-email-error" className="field-error">{errors.email}</p></div><div className="member-form-field"><label className="field-label" htmlFor="live-member-role">Assigned role</label><select className="text-input" id="live-member-role" value={role} onChange={event => setRole(event.target.value as ProjectRole)}>{Object.entries(roleLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div>
            <div className="member-form-actions">{Object.keys(errors).length > 0 && <p role="alert" className="field-error">Check the registered email and assigned role.</p>}<Button variant="primary" type="submit">Add member</Button></div>
          </fieldset></form>{pending && <p role="status">Updating membership…</p>}</section>
        </>}
      </>}
    </section></div>;
}
