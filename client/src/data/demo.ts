import type { Project, KnowledgeGap, GapCategory, SourceType } from '../../../shared/api-types';

export const project = {
  id: 'demo-project', name: 'Customer platform',
  description: 'A clear path forward for the team taking over our customer platform.', role: 'REVIEWER',
  createdAt: '2026-10-20T09:00:00Z', updatedAt: '2026-10-30T14:30:00Z',
} satisfies Project;

export const categoryLabels: Record<GapCategory, string> = {
  MISSING_OWNER: 'Missing owner', UNCLEAR_STATUS: 'Unclear status',
  UNRESOLVED_DEPENDENCY: 'Dependency', POTENTIAL_CONFLICT: 'Potential conflict',
};
export interface DemoSource { id: string; filename: string; type: SourceType; description: string; content: string; imported: string }
export const sources: DemoSource[] = [
  { id: 'architecture', filename: 'architecture.md', type: 'MARKDOWN', description: 'System architecture & decisions', imported: 'Oct 28', content: '# Customer platform architecture\n\nThe customer platform uses a shared identity service.\n\n## Webhook delivery\nFailed webhook deliveries are retried three times with exponential backoff.\nOwnership of the retry queue will be confirmed during the platform transition.\n\n## Billing\nThe billing migration depends on the identity service moving to v2.\nThe identity v2 rollout date is still to be agreed with the infrastructure team.' },
  { id: 'handoff', filename: 'transition-notes.md', type: 'MARKDOWN', description: 'Outgoing team’s transition notes', imported: 'Oct 29', content: '# Platform transition\n\n## Webhook delivery\nThe integrations team has been monitoring webhook delivery failures.\nA permanent owner for retry alerts has not been assigned.\n\n## Account export\nAccount export is ready for internal testing. External release is paused pending a privacy review.\n\n## Session expiry\nSessions should expire after 24 hours of inactivity.' },
  { id: 'tasks', filename: 'release-checklist.csv', type: 'CSV', description: 'Release tasks & current blockers', imported: 'Oct 30', content: 'title,status,owner\nAccount export,In progress,Unassigned\nConfirm privacy review,Waiting,Unassigned\nBilling migration,Blocked,Unassigned\nSupport runbook,Complete,Unassigned' },
  { id: 'readme', filename: 'README.md', type: 'GITHUB', description: 'Repository setup & operating notes', imported: 'Oct 30', content: '# Customer platform\n\n## Authentication\nSession tokens expire after 12 hours of inactivity.\n\n## Support\nThe support runbook is maintained by the customer operations team.\nFor incidents, follow the escalation steps in the support runbook.' },
];

interface DemoEvidence { sourceId: string; quote: string; context: string }
export type DemoGap = KnowledgeGap & { shortId: string; title: string; summary: string; evidence: DemoEvidence[] };
const gap = (id: number, category: GapCategory, title: string, question: string, summary: string, evidence: DemoEvidence[]): DemoGap => ({
  id: `demo-gap-${id}`, projectId: project.id, shortId: `GAP-${String(id).padStart(3, '0')}`, category, title, question, summary, evidence,
  status: 'OPEN', fingerprint: `demo-${id}`, provenance: { fixture: true }, claimIds: [`demo-claim-${id}`], claimLinks: [],
  createdAt: '2026-10-30T14:00:00Z', updatedAt: '2026-10-30T14:00:00Z',
});
export const gaps: DemoGap[] = [
  gap(1, 'MISSING_OWNER', 'Webhook retry ownership', 'Who will own webhook retries after the transition?', 'The architecture notes describe retry behavior, but neither source names a permanent owner for the queue or its alerts.', [
    { sourceId: 'architecture', quote: 'Ownership of the retry queue will be confirmed during the platform transition.', context: 'Webhook delivery' },
    { sourceId: 'handoff', quote: 'A permanent owner for retry alerts has not been assigned.', context: 'Webhook delivery' },
  ]),
  gap(2, 'POTENTIAL_CONFLICT', 'Session expiry policy', 'Should sessions expire after 12 or 24 hours of inactivity?', 'The repository and transition notes describe different session expiry policies. Confirm the intended behavior before the handover.', [
    { sourceId: 'readme', quote: 'Session tokens expire after 12 hours of inactivity.', context: 'Authentication' },
    { sourceId: 'handoff', quote: 'Sessions should expire after 24 hours of inactivity.', context: 'Session expiry' },
  ]),
  gap(3, 'UNRESOLVED_DEPENDENCY', 'Billing migration dependency', 'When will identity v2 be ready for the billing migration?', 'The billing migration depends on an identity rollout whose date has not been agreed.', [
    { sourceId: 'architecture', quote: 'The identity v2 rollout date is still to be agreed with the infrastructure team.', context: 'Billing' },
    { sourceId: 'tasks', quote: 'Billing migration,Blocked,Unassigned', context: 'Release checklist' },
  ]),
  gap(4, 'UNCLEAR_STATUS', 'Account export readiness', 'Is account export ready to release or still awaiting privacy review?', 'Internal testing and external release appear to be at different stages. The checklist does not make that distinction.', [
    { sourceId: 'handoff', quote: 'Account export is ready for internal testing. External release is paused pending a privacy review.', context: 'Account export' },
    { sourceId: 'tasks', quote: 'Account export,In progress,Unassigned', context: 'Release checklist' },
  ]),
  gap(5, 'MISSING_OWNER', 'Support runbook ownership', 'Who maintains the support runbook?', 'The incoming team needed an explicit owner for operational documentation.', [
    { sourceId: 'readme', quote: 'The support runbook is maintained by the customer operations team.', context: 'Support' },
  ]),
];
