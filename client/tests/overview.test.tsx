// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Project, ProjectRole } from '../../shared/api-types';
import LiveOverview from '../src/pages/LiveOverview';

afterEach(cleanup);
const project: Project = { id: '22222222-2222-4222-8222-222222222222', name: 'Backend project', description: 'Real description', role: 'REVIEWER', createdAt: '', updatedAt: '' };
const cases = [
  { role: 'REVIEWER', action: 'Review answers', page: 'reviews', sections: ['Pending review queue', 'Open knowledge gaps', 'Team members and their roles', 'Latest published handover'] },
  { role: 'OUTGOING', action: 'Answer questions', page: 'clarifications', sections: ['Connected sources', 'Unverified AI claims', 'Open clarification questions', 'Submitted answers and review status'] },
  { role: 'INCOMING', action: 'Read handover', page: 'successor', sections: ['Latest published handover', 'Confirmed knowledge and unknowns', 'Evidence-backed next actions', 'Acknowledgment status'] },
] as const;

it.each(cases)('shows only $role sections with honest unavailable states and correct action', async ({ role, action, page, sections }) => {
  const navigate = vi.fn();
  render(<LiveOverview project={{ ...project, role }} onNavigate={navigate} />);
  expect(screen.getByRole('heading', { name: 'Backend project' })).toBeTruthy();
  for (const title of sections) expect(screen.getByRole('heading', { name: title })).toBeTruthy();
  expect(screen.getAllByText('Unavailable')).toHaveLength(4);
  expect(screen.queryByRole('combobox')).toBeNull();
  expect(screen.queryByText(/Incident review|Demo sources|Acknowledged|Approved/)).toBeNull();
  await userEvent.click(screen.getByRole('button', { name: action }));
  expect(navigate).toHaveBeenCalledWith(page);
  if (role !== 'REVIEWER') expect(screen.queryByRole('heading', { name: 'Pending review queue' })).toBeNull();
});

it('replaces reviewer content immediately when the backend role changes', () => {
  const { rerender } = render(<LiveOverview project={project} onNavigate={() => {}} />);
  rerender(<LiveOverview project={{ ...project, role: 'INCOMING' as ProjectRole }} onNavigate={() => {}} />);
  expect(screen.queryByRole('heading', { name: 'Team members and their roles' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Review answers' })).toBeNull();
  expect(screen.getByRole('button', { name: 'Read handover' })).toBeTruthy();
});
