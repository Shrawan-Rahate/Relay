import type { AddMemberRequest, Project, ProjectMember } from '../../../shared/api-types';
import { memberErrors } from '../data/project-ui';
import { ApiError, type RelayApi } from './api';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const invalid = () => new ApiError(502, 'INVALID_RESPONSE', 'Membership data could not be verified. Refresh members.');
function path(project: Project) {
  if (project.role !== 'REVIEWER') throw new ApiError(403, 'FORBIDDEN', 'Only reviewers can manage members.');
  if (!uuid.test(project.id)) throw new ApiError(400, 'INVALID_INPUT', 'Invalid project ID.');
  return `/api/projects/${project.id}/members`;
}
function checked(member: ProjectMember, projectId: string): ProjectMember {
  if (!member || !uuid.test(member.id) || member.projectId !== projectId || !uuid.test(member.userId)
    || !['REVIEWER', 'OUTGOING', 'INCOMING'].includes(member.role) || typeof member.createdAt !== 'string' || typeof member.updatedAt !== 'string'
    || !member.user || member.user.id !== member.userId || typeof member.user.email !== 'string'
    || !(member.user.name === null || typeof member.user.name === 'string')) throw invalid();
  return { id: member.id, projectId, userId: member.userId, role: member.role, createdAt: member.createdAt, updatedAt: member.updatedAt,
    user: { id: member.user.id, name: member.user.name, email: member.user.email } };
}
export async function fetchMembers(api: RelayApi, project: Project) {
  const body = await api.request<{ members: ProjectMember[] }>(path(project));
  if (!Array.isArray(body?.members)) throw invalid();
  const members = body.members.map(member => checked(member, project.id));
  if (new Set(members.map(member => member.id)).size !== members.length || new Set(members.map(member => member.userId)).size !== members.length) throw invalid();
  return members;
}
export async function addMember(api: RelayApi, project: Project, input: AddMemberRequest) {
  const base = path(project), request = { email: input.email.trim().toLowerCase(), role: input.role };
  if (Object.keys(memberErrors(request)).length) throw new ApiError(400, 'INVALID_INPUT', 'Check the email and assigned role.');
  const body = await api.request<{ member: ProjectMember }>(base, { method: 'POST', body: JSON.stringify(request) });
  const member = checked(body?.member, project.id);
  if (member.user.email !== request.email || member.role !== request.role) throw invalid();
  return member;
}
export async function removeMember(api: RelayApi, project: Project, memberId: string) {
  const base = path(project);
  if (!uuid.test(memberId)) throw new ApiError(400, 'INVALID_INPUT', 'Invalid membership ID.');
  await api.request<void>(`${base}/${memberId}`, { method: 'DELETE' });
}
export function memberError(error: unknown): string {
  if (!(error instanceof ApiError)) return 'Members could not be updated. Refresh members before retrying.';
  if (error.status === 401) return 'Your session expired. Please sign in again.';
  if (error.status === 403) return 'Only reviewers can access membership management. Refresh project access.';
  if (error.code === 'USER_NOT_FOUND') return 'No registered Relay user has this email. They must sign in to Relay first; no account was created.';
  if (error.status === 404) return 'The project or membership is unavailable, or your access changed. Refresh project access.';
  if (error.code === 'MEMBERSHIP_EXISTS') return 'This user is already a project member. Existing roles cannot be edited here.';
  if (error.code === 'LAST_REVIEWER') return 'The final reviewer cannot be removed. Add another reviewer before removing this membership.';
  if (error.status === 409) return 'Membership changed. Refresh members before retrying.';
  if (error.code === 'INVALID_INPUT') return 'Check the registered email and assigned role.';
  if (error.code === 'INVALID_RESPONSE') return 'Relay returned invalid membership data. A change may have completed; refresh members before retrying.';
  return 'The request could not be confirmed. Check your connection and refresh members before retrying.';
}
