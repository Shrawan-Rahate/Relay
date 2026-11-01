import { useRef, useState, type FormEvent } from 'react';
import type { AddMemberRequest, ProjectMember, ProjectRole } from '../../../shared/api-types';
import { ArrowRight } from 'lucide-react';
import { Button } from './ui';
import { canManageMembers, memberErrors, roleLabels, type FieldErrors, type RoleView } from '../data/project-ui';

export default function MembershipManager({ role, members = [], membersLoaded = false }: { role: RoleView; members?: ProjectMember[]; membersLoaded?: boolean }) {
  const [email, setEmail] = useState(''); const [memberRole, setMemberRole] = useState<ProjectRole>('OUTGOING');
  const [errors, setErrors] = useState<FieldErrors>({}); const [preview, setPreview] = useState<AddMemberRequest | null>(null);
  const [removePreview, setRemovePreview] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const manager = canManageMembers(role);
  const submit = (event: FormEvent) => {
    event.preventDefault(); if (!manager) return;
    const request: AddMemberRequest = { email: email.trim().toLowerCase(), role: memberRole };
    const nextErrors = memberErrors(request); setErrors(nextErrors); setPreview(null);
    if (Object.keys(nextErrors).length) { requestAnimationFrame(() => formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus()); return; }
    setPreview(request);
  };
  if (!manager) return <section className="workflow-section"><h2>Project members</h2><p className="workflow-empty">Membership lists and management are reviewer-only. No membership data is shown in this {roleLabels[role as ProjectRole].toLowerCase()} navigation preview.</p></section>;
  return <section className="workflow-section"><h2>Project members</h2><p className="field-help">Reviewer-only management preview. No users or memberships are fabricated.</p>{!membersLoaded ? <p className="workflow-empty">Membership data has not been loaded. No people are represented as members in this demo.</p> : members.length === 0 ? <p className="workflow-empty">No members returned for this project.</p> : <ul className="member-list">{members.map(member => { const lastReviewer = member.role === 'REVIEWER' && members.filter(item => item.role === 'REVIEWER').length <= 1; return <li key={member.id}><span>{member.user.name ?? member.user.email}<span className="field-help">{member.user.email} · {roleLabels[member.role]}</span></span><Button disabled={lastReviewer} onClick={() => setRemovePreview(member.id)}>Preview removal</Button>{lastReviewer && <p className="field-help">The last reviewer cannot be removed.</p>}</li>; })}</ul>}{removePreview && <p className="local-preview" role="status">Removal request preview only. No member was removed.</p>}
    <h3 className="membership-form-title">Add a registered member</h3><p>The email must already be registered. This demo cannot check registration or existing membership.</p><form ref={formRef} onSubmit={submit} noValidate><label className="field-label" htmlFor="member-email">Registered email</label><input id="member-email" type="email" className="text-input" maxLength={254} required autoComplete="off" autoCapitalize="none" value={email} onChange={event => { setEmail(event.target.value); setErrors({}); setPreview(null); }} aria-invalid={!!errors.email} aria-describedby="member-email-help member-email-error" /><p id="member-email-help" className="field-help">Use a test address. No registration lookup, invitation, or membership change occurs.</p><p id="member-email-error" className="field-error">{errors.email}</p><label className="field-label form-spaced-label" htmlFor="member-role">Project role</label><select id="member-role" className="text-input" value={memberRole} onChange={event => { setMemberRole(event.target.value as ProjectRole); setErrors({}); setPreview(null); }} aria-invalid={!!errors.role} aria-describedby="member-role-error">{Object.entries(roleLabels).map(([key, label]) => <option key={key} value={key}>{label} ({key})</option>)}</select><p id="member-role-error" className="field-error">{errors.role}</p><Button variant="primary" type="submit">Preview add-member request<ArrowRight size={18} /></Button>{Object.keys(errors).length > 0 && <p className="field-error" role="alert">Check the membership fields. No request was sent.</p>}</form>
    {preview && <div className="local-preview" role="status"><h3>Request preview · not a membership</h3><dl className="project-facts"><div><dt>Entered email</dt><dd>{preview.email}</dd></div><div><dt>Requested role</dt><dd>{preview.role}</dd></div></dl><p>Format checked locally. Registration, existing membership, permissions, and last-reviewer protection must be checked by the server. No member was added.</p></div>}
  </section>;
}
