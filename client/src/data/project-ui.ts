import type { AddMemberRequest, CreateProjectRequest, LoginRequest, Project, ProjectRole, RegisterRequest } from '../../../shared/api-types';
import { project } from './demo';

export type ProjectPreview = Pick<Project, 'id' | 'name' | 'description'> & { origin: 'fixture' | 'local' };
export const sampleProject: ProjectPreview = { id: project.id, name: project.name, description: project.description, origin: 'fixture' };
export type RoleView = ProjectRole | 'ALL_DEMO';
export const roleLabels: Record<ProjectRole, string> = { REVIEWER: 'Reviewer', OUTGOING: 'Outgoing', INCOMING: 'Incoming' };
export type ProjectPage = 'overview' | 'sources' | 'intelligence' | 'gaps' | 'clarifications' | 'reviews' | 'handover' | 'successor' | 'project-detail';
export const projectPages: { id: ProjectPage; label: string; roles: ProjectRole[] }[] = [
  { id: 'overview', label: 'Overview', roles: ['REVIEWER', 'OUTGOING', 'INCOMING'] },
  { id: 'sources', label: 'Source Manager', roles: ['REVIEWER', 'OUTGOING', 'INCOMING'] },
  { id: 'intelligence', label: 'AI Intelligence', roles: ['REVIEWER', 'OUTGOING'] },
  { id: 'gaps', label: 'Knowledge gaps', roles: ['REVIEWER', 'OUTGOING', 'INCOMING'] },
  { id: 'clarifications', label: 'Clarifications', roles: ['OUTGOING'] },
  { id: 'reviews', label: 'Reviewer Queue', roles: ['REVIEWER'] },
  { id: 'handover', label: 'Verified Handover', roles: ['REVIEWER'] },
  { id: 'successor', label: 'Successor Workspace', roles: ['INCOMING'] },
  { id: 'project-detail', label: 'Project & members', roles: ['REVIEWER', 'OUTGOING', 'INCOMING'] },
];
export function canViewPage(page: ProjectPage, role: RoleView): boolean { return role === 'ALL_DEMO' || !!projectPages.find(item => item.id === page)?.roles.includes(role); }
// LIVE reviewers may inspect answers; keep the separate DEMO workflow unchanged.
export function canViewLivePage(page: ProjectPage, role: ProjectRole): boolean { return page === 'handover' ? ['REVIEWER', 'OUTGOING', 'INCOMING'].includes(role) : page === 'clarifications' ? role === 'OUTGOING' || role === 'REVIEWER' : canViewPage(page, role); }
export const canManageMembers = (role: RoleView) => role === 'ALL_DEMO' || role === 'REVIEWER';
export type FieldErrors = Record<string, string>;
export function emailIssue(email: string): string | null {
  return email.trim().length <= 254 && !/[\u0000-\u001f\u007f]/.test(email.trim()) && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) ? null : 'Enter a valid email address of at most 254 characters.';
}
export function authErrors(request: LoginRequest | RegisterRequest, register: boolean, confirmPassword = ''): FieldErrors {
  const errors: FieldErrors = {};
  const email = emailIssue(request.email); if (email) errors.email = email;
  if (request.password.length < (register ? 12 : 1) || request.password.length > 128) errors.password = register ? 'Use a password of 12–128 characters.' : 'Enter a password of 1–128 characters.';
  if (register && 'name' in request && request.name !== undefined && (!request.name.trim() || request.name.trim().length > 100)) errors.name = 'Use a name of 1–100 characters, or leave it blank.';
  if (register && request.password !== confirmPassword) errors.confirmPassword = 'Passwords do not match.';
  return errors;
}
export function projectErrors(request: CreateProjectRequest): FieldErrors {
  const errors: FieldErrors = {};
  if (!request.name.trim() || request.name.trim().length > 200) errors.name = 'Enter a project name of 1–200 characters.';
  if ((request.description?.length ?? 0) > 5000) errors.description = 'Keep the description within 5,000 characters.';
  return errors;
}
export function memberErrors(request: AddMemberRequest): FieldErrors {
  const errors: FieldErrors = {};
  const email = emailIssue(request.email); if (email) errors.email = email;
  if (!['REVIEWER', 'OUTGOING', 'INCOMING'].includes(request.role)) errors.role = 'Choose Reviewer, Outgoing, or Incoming.';
  return errors;
}
