import { expect, it, vi } from 'vitest';
import { RelayApi } from '../src/lib/api';
import { addMember, fetchMembers, removeMember, memberError } from '../src/lib/member-api';
import { ids, json, project, root } from './workflow-fixtures';
export const member = { id: ids.doc, projectId: project.id, userId: ids.source, role: 'OUTGOING' as const, user: { id: ids.source, name: 'Ada', email: 'ada@example.test' }, createdAt: '2026-11-03T10:00:00Z', updatedAt: '2026-11-03T10:00:00Z' };
it('uses project scoped cookie requests, normalized email, exact bodies and 204 deletion', async () => {
  const fetcher = vi.fn<typeof fetch>(async (_, init) => init?.method === 'DELETE' ? new Response(null, { status: 204 }) : init?.method === 'POST' ? json({ member }, 201) : json({ members: [member] }));
  const api = new RelayApi('', fetcher);
  expect(await fetchMembers(api, project)).toEqual([member]);
  await addMember(api, project, { email: ' Ada@Example.test ', role: 'OUTGOING' });
  await removeMember(api, project, member.id);
  expect(fetcher.mock.calls.map(([p]) => p)).toEqual([`${root}/members`, `${root}/members`, `${root}/members/${member.id}`]);
  expect(fetcher.mock.calls[1][1]?.body).toBe(JSON.stringify({ email: 'ada@example.test', role: 'OUTGOING' }));
  for (const [, init] of fetcher.mock.calls) { expect(init?.credentials).toBe('include'); expect(new Headers(init?.headers).has('Authorization')).toBe(false); }
});
it.each(['OUTGOING', 'INCOMING'] as const)('blocks member operations for %s', async role => {
  const fetcher = vi.fn(), api = new RelayApi('', fetcher), p = { ...project, role };
  await expect(fetchMembers(api, p)).rejects.toMatchObject({ status: 403 });
  await expect(addMember(api, p, { email: member.user.email, role: 'REVIEWER' })).rejects.toMatchObject({ status: 403 });
  await expect(removeMember(api, p, member.id)).rejects.toMatchObject({ status: 403 });
  expect(fetcher).not.toHaveBeenCalled();
});
it('rejects cross-project or malformed membership data and invalid input', async () => {
  for (const bad of [{ ...member, projectId: ids.next }, { ...member, role: 'ADMIN' }, { ...member, user: { ...member.user, id: ids.next } }]) {
    await expect(fetchMembers(new RelayApi('', async () => json({ members: [bad] })), project)).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  }
  const fetcher = vi.fn(), api = new RelayApi('', fetcher);
  await expect(addMember(api, project, { email: 'bad', role: 'INCOMING' })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  await expect(removeMember(api, project, '../bad')).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  expect(fetcher).not.toHaveBeenCalled();
});
it.each([[401, 'UNAUTHENTICATED', /sign in/i], [403, 'FORBIDDEN', /reviewer/i], [404, 'USER_NOT_FOUND', /registered/i], [404, 'NOT_FOUND', /access/i], [409, 'MEMBERSHIP_EXISTS', /already/i], [409, 'LAST_REVIEWER', /final reviewer/i], [409, 'CONFLICT', /refresh/i]] as const)('handles %s %s without displaying provider details', async (status, code, message) => {
  const api = new RelayApi('', async () => json({ error: { code, message: 'sensitive provider details' } }, status)), unauthorized = vi.fn(); api.onUnauthorized(unauthorized);
  try { await fetchMembers(api, project); throw Error('expected rejection'); } catch (error) { expect(memberError(error)).toMatch(message); expect(memberError(error)).not.toContain('sensitive'); }
  expect(unauthorized).toHaveBeenCalledTimes(status === 401 ? 1 : 0);
});
