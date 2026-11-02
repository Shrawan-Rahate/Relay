import { useState } from 'react';
import type { ClaimEvidence, ListedClaim, SourceDocument } from '../../../shared/api-types';
import { fetchEvidenceDocument, claimTypes } from '../lib/workflow-api';
import { Badge, Button } from './ui';
import { Provenance, useWorkflowTicket, WorkflowError, type WorkflowContext } from './LiveWorkflow';

export function ClaimGroups({ claims, context }: { claims: ListedClaim[]; context: WorkflowContext }) {
  return <>{claimTypes.map(type => {
    const group = claims.filter(claim => claim.type === type);
    return group.length ? <section className="claim-group" key={type}><h3>{type}</h3>{group.map(claim => <article className="claim-item" key={claim.id}>
      <Badge>{claim.status}</Badge><p className="preserve-text">{claim.text}</p>
      <p>Provider: {claim.run.provider} · Model: {claim.run.model} · Version: {claim.run.modelVersion ?? 'Not supplied'}</p><Provenance value={claim.run.provenance} />
      {claim.evidence.length === 0 ? <p>No evidence was returned for this claim.</p> : claim.evidence.map(e => <Evidence key={e.id} evidence={e} context={context} />)}
    </article>)}</section> : null;
  })}</>;
}
function Evidence({ evidence, context }: { evidence: ClaimEvidence; context: WorkflowContext }) {
  const [document, setDocument] = useState<SourceDocument | null>(null), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const ticket = useWorkflowTicket();
  const read = async () => {
    const current = ticket(); setBusy(true); setError(''); setDocument(null);
    try { const value = await fetchEvidenceDocument(context.api, context.project.id, evidence); if (current()) setDocument(value); }
    catch (error) { if (current()) context.fail(error, setError); }
    finally { if (current()) setBusy(false); }
  };
  return <div className="live-evidence"><h4>{evidence.filename}</h4><p>Document: {evidence.documentId} · UTF-16 offsets {evidence.startOffset}–{evidence.endOffset}</p>
    <blockquote>{evidence.quote}</blockquote><Button disabled={busy} onClick={() => void read()}>Read source document</Button>
    {busy && <p role="status">Loading evidence document…</p>}<WorkflowError message={error} retry={() => void read()} />
    {document && <details open><summary>Current document content</summary><pre>{document.content}</pre>{document.content.slice(evidence.startOffset, evidence.endOffset) !== evidence.quote && <p>The current document differs at the recorded offsets. The quote above is the stored extraction evidence.</p>}</details>}
  </div>;
}
