import type { Claim, ClaimType, GitHubImportRequest } from '../../../shared/api-types';
import { sources } from './demo';

export const claimGroups: { type: ClaimType; label: string }[] = [
  { type: 'DECISION', label: 'Decision' }, { type: 'OWNER', label: 'Owner' },
  { type: 'DEPENDENCY', label: 'Dependency' }, { type: 'STATUS', label: 'Status' }, { type: 'RISK', label: 'Risk' },
];
export type DemoClaim = Pick<Claim, 'id' | 'type' | 'text' | 'status'> & { sourceId: string; quote: string };
export const demoClaims: DemoClaim[] = [
  { id: 'demo-decision', type: 'DECISION', text: 'Webhook retries use exponential backoff, with three retry attempts.', status: 'UNVERIFIED', sourceId: 'architecture', quote: 'Failed webhook deliveries are retried three times with exponential backoff.' },
  { id: 'demo-owner', type: 'OWNER', text: 'The source names customer operations as the support runbook owner.', status: 'UNVERIFIED', sourceId: 'readme', quote: 'The support runbook is maintained by the customer operations team.' },
  { id: 'demo-dependency', type: 'DEPENDENCY', text: 'The billing migration depends on identity v2.', status: 'UNVERIFIED', sourceId: 'architecture', quote: 'The billing migration depends on the identity service moving to v2.' },
  { id: 'demo-status', type: 'STATUS', text: 'The release checklist describes the billing migration as blocked.', status: 'UNVERIFIED', sourceId: 'tasks', quote: 'Billing migration,Blocked,Unassigned' },
  { id: 'demo-risk', type: 'RISK', text: 'External account export release may be delayed by the pending privacy review.', status: 'UNVERIFIED', sourceId: 'handoff', quote: 'Account export is ready for internal testing. External release is paused pending a privacy review.' },
];
export function repositoryRequest(value: string): GitHubImportRequest | null {
  const repository = value.trim();
  return /^[a-z\d](?:[a-z\d-]{0,37}[a-z\d])?\/(?!\.{1,2}$)[a-z\d._-]{1,100}$/i.test(repository) ? { repository } : null;
}
export function uploadIssue(file: Pick<File, 'name' | 'size'>): string | null {
  if (!/\.(md|markdown|txt|csv)$/i.test(file.name)) return 'Choose a Markdown, TXT, or CSV file.';
  if (file.name.length > 255 || /[\\/\u0000-\u001f\u007f]/.test(file.name)) return 'Use a filename of at most 255 characters without separators or control characters.';
  if (file.size === 0) return 'This file is empty. Choose a nonempty file.';
  if (file.size > 262144) return 'Choose a file no larger than 256 KiB.';
  return null;
}
export const importExamples = [
  { ...sources[0], label: 'Markdown' },
  { id: 'demo-txt', filename: 'operating-notes.txt', type: 'TXT' as const, description: 'DEMO plain-text source', content: 'DEMO operating notes\n\nConfirm queue ownership before the handover.\nEscalation steps still need a documented owner.', imported: '' , label: 'TXT' },
  { ...sources[2], label: 'CSV' },
];
