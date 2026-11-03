import { useEffect, useRef, useState } from 'react';
import type { Handover, HandoverDetailResponse, HandoverSummary, PublishedEvidence, PublishedReview } from '../../../shared/api-types';
import { Badge, Button } from '../components/ui';
import { LiveWorkflowBoundary, useWorkflowTicket, WorkflowError, type WorkflowContext, type WorkflowProps } from '../components/LiveWorkflow';
import { acknowledgeHandover, fetchHandover, fetchHandovers, handoverError, publishHandover, readPublishedEvidence } from '../lib/handover-api';
import './live-handovers.css';

type Props = WorkflowProps & { currentUserId: string; successor?: boolean };
export default function LiveHandovers({ currentUserId, successor = false, ...props }: Props) {
  if (successor && props.project.role !== 'INCOMING') return <div className="feature-page"><h1>Access restricted</h1><p>The successor workspace is for incoming project members.</p></div>;
  return <LiveWorkflowBoundary key={currentUserId} {...props}>{context => <HandoverWorkspace context={context} currentUserId={currentUserId} successor={successor} />}</LiveWorkflowBoundary>;
}
function HandoverWorkspace({ context, currentUserId, successor }: { context: WorkflowContext; currentUserId: string; successor: boolean }) {
  const [versions, setVersions] = useState<HandoverSummary[]>([]), [selected, setSelected] = useState<HandoverSummary | null>(null);
  const [pages, setPages] = useState<(number | undefined)[]>([undefined]), [nextBefore, setNextBefore] = useState<number | null>(null), [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(true), [listError, setListError] = useState(''), [mutationError, setMutationError] = useState('');
  const [confirming, setConfirming] = useState(false), [pending, setPending] = useState(false), [blocked, setBlocked] = useState(false), [success, setSuccess] = useState('');
  const before = pages[pages.length - 1], submitting = useRef(false), ticket = useWorkflowTicket();
  useEffect(() => {
    let active = true; const current = ticket(); setLoading(true); setListError(''); setVersions([]); setNextBefore(null);
    fetchHandovers(context.api, context.project, before).then(result => {
      if (active && current()) { setVersions(result.handovers); setNextBefore(result.nextBeforeVersion); setBlocked(false); }
    }).catch(error => { if (active && current()) context.fail(error, () => setListError(handoverError(error))); })
      .finally(() => { if (active && current()) setLoading(false); });
    return () => { active = false; };
  }, [before, revision]);
  const refresh = () => { setPages([undefined]); setRevision(value => value + 1); };
  const publish = async () => {
    if (submitting.current || !confirming || blocked || loading || context.project.role !== 'REVIEWER') return;
    const current = ticket(); submitting.current = true; setPending(true); setMutationError(''); setSuccess('');
    try {
      const handover = await publishHandover(context.api, context.project);
      if (current()) { setSuccess(`Published version ${handover.version} successfully.`); setSelected(handover); setConfirming(false); refresh(); }
    } catch (error) { if (current()) { setBlocked(true); setConfirming(false); context.fail(error, () => setMutationError(handoverError(error))); } }
    finally { submitting.current = false; if (current()) setPending(false); }
  };
  return <div className="feature-page live-workflow live-handovers"><div className="page-heading"><h1>{successor ? 'Incoming Successor Workspace' : 'Verified Handover'}</h1><p>{context.project.name} · LIVE</p></div>
    <p>Read immutable published knowledge, its human review provenance, and what remains unknown. Unverified AI claims are not confirmed knowledge.</p>
    <div className="workflow-actions"><Button disabled={pending || loading} onClick={() => { setConfirming(false); refresh(); }}>Refresh versions</Button>{context.project.role === 'REVIEWER' && <Button variant="primary" disabled={pending || loading || blocked || !!listError} onClick={() => { setConfirming(true); setSuccess(''); setMutationError(''); }}>Publish new version</Button>}</div>
    {confirming && <section className="workflow-detail" aria-label="Confirm handover publication"><h2>Publish a new immutable version?</h2><p>The backend will build this snapshot from human-approved or edited answers, open UNKNOWN gaps, and explicit next actions. Previous versions will remain unchanged. Deferred and rejected answers are not confirmed knowledge.</p><div className="workflow-actions"><Button variant="primary" disabled={pending} onClick={() => void publish()}>Confirm publication</Button><Button disabled={pending} onClick={() => setConfirming(false)}>Cancel publication</Button></div></section>}
    {pending && <p role="status">Saving…</p>}{success && <p role="status">{success}</p>}<WorkflowError message={mutationError} />
    <section aria-label="Published handover versions"><h2>Published versions</h2><p>Page {pages.length} · Newest first</p>
      {loading ? <p role="status">Loading published versions…</p> : listError ? <WorkflowError message={listError} retry={refresh} /> : versions.length === 0 ? <p>No published handovers on this page.</p> : <ul className="handover-version-list">{versions.map(snapshot => <li key={snapshot.id}><div><strong>Version {snapshot.version}</strong><p><time dateTime={snapshot.publishedAt}>{snapshot.publishedAt}</time></p></div><Button disabled={pending} aria-pressed={selected?.id === snapshot.id} onClick={() => setSelected(snapshot)}>Read version {snapshot.version}</Button></li>)}</ul>}
      <div className="workflow-actions"><Button disabled={pending || loading || pages.length === 1} onClick={() => setPages(items => items.slice(0, -1))}>Newer versions</Button><Button disabled={pending || loading || !nextBefore} onClick={() => nextBefore && setPages(items => [...items, nextBefore])}>Older versions</Button></div>
    </section>
    {selected && <Snapshot key={selected.id} context={context} snapshot={selected} currentUserId={currentUserId} setPending={setPending} />}
  </div>;
}
function Snapshot({ context, snapshot, currentUserId, setPending }: { context: WorkflowContext; snapshot: HandoverSummary; currentUserId: string; setPending: (value: boolean) => void }) {
  const [data, setData] = useState<HandoverDetailResponse | null>(null), [loading, setLoading] = useState(true), [error, setError] = useState('');
  const [pages, setPages] = useState<(string | undefined)[]>([undefined]), [revision, setRevision] = useState(0);
  const [busy, setBusy] = useState(false), [blocked, setBlocked] = useState(false), [success, setSuccess] = useState('');
  const cursor = pages[pages.length - 1], submitting = useRef(false), ticket = useWorkflowTicket();
  useEffect(() => {
    let active = true; const current = ticket(); setLoading(true); setError(''); setData(null); setSuccess('');
    fetchHandover(context.api, context.project, snapshot, currentUserId, cursor).then(result => { if (active && current()) { setData(result); setBlocked(false); } })
      .catch(error => { if (active && current()) context.fail(error, () => setError(handoverError(error))); })
      .finally(() => { if (active && current()) setLoading(false); });
    return () => { active = false; };
  }, [cursor, revision]);
  const acknowledge = async () => {
    if (submitting.current || blocked || loading || !data || !('receipt' in data) || data.receipt || context.project.role !== 'INCOMING') return;
    const current = ticket(); submitting.current = true; setBusy(true); setPending(true); setError(''); setSuccess('');
    try {
      const receipt = await acknowledgeHandover(context.api, context.project, data.handover, currentUserId);
      if (current()) { setData({ handover: data.handover, receipt }); setSuccess('Acknowledgment confirmed.'); }
    } catch (error) { if (current()) { setBlocked(true); context.fail(error, () => setError(handoverError(error))); } }
    finally { submitting.current = false; if (current()) { setBusy(false); setPending(false); } }
  };
  const refresh = () => { setPages([undefined]); setRevision(value => value + 1); };
  return <section className="workflow-detail" aria-label="Selected published handover"><Button disabled={busy || loading} onClick={refresh}>Refresh snapshot and receipts</Button>
    {loading && <p role="status">Loading published snapshot…</p>}<WorkflowError message={error} retry={!data ? refresh : undefined} />
    {data && <><SnapshotContent handover={data.handover} context={context} />
      {context.project.role === 'REVIEWER' && 'receipts' in data ? <section className="handover-receipts"><h3>Incoming acknowledgment receipts</h3><p>Receipt page {pages.length}. User IDs are provided by the API; names and emails are not included.</p>
        {data.receipts.length === 0 ? <p>No acknowledgment receipts on this page.</p> : <ul>{data.receipts.map(receipt => <li key={receipt.id}><p>Member: {receipt.userId}</p><p>Version {receipt.snapshotVersion} · <time dateTime={receipt.createdAt}>{receipt.createdAt}</time></p><p>Receipt: {receipt.id}</p></li>)}</ul>}
        <div className="workflow-actions"><Button disabled={loading || pages.length === 1} onClick={() => setPages(items => items.slice(0, -1))}>Previous receipts</Button><Button disabled={loading || !data.nextReceiptCursor} onClick={() => data.nextReceiptCursor && setPages(items => [...items, data.nextReceiptCursor!])}>Next receipts</Button></div>
      </section> : 'receipt' in data && <section className="handover-receipts"><h3>Your acknowledgment</h3>
        {data.receipt ? <><p>Acknowledged version {data.receipt.snapshotVersion}</p><time dateTime={data.receipt.createdAt}>{data.receipt.createdAt}</time><p>Snapshot: {data.receipt.snapshotId}</p></> : <><p>You have not acknowledged this snapshot.</p>{context.project.role === 'INCOMING' ? <><p>Acknowledge this exact version and content SHA-256 after reading the confirmed knowledge and unknowns. Acknowledgment does not resolve gaps.</p><Button variant="primary" disabled={busy || blocked} onClick={() => void acknowledge()}>Acknowledge version {data.handover.version}</Button></> : <p>Only incoming members can acknowledge a handover.</p>}</>}
        {success && <p role="status">{success}</p>}{busy && <p role="status">Acknowledging this snapshot…</p>}
      </section>}
    </>}
  </section>;
}
function SnapshotContent({ handover, context }: { handover: Handover; context: WorkflowContext }) {
  const content = handover.content;
  return <><h2>Published version {handover.version}</h2><dl className="project-facts"><div><dt>Published</dt><dd><time dateTime={handover.publishedAt}>{handover.publishedAt}</time></dd></div><div><dt>Snapshot ID</dt><dd>{handover.id}</dd></div><div><dt>Published by</dt><dd>{handover.authorId}</dd></div><div><dt>Content SHA-256</dt><dd className="handover-hash">{handover.contentSha256}</dd></div></dl>
    <p>This published snapshot is immutable. Current source documents may have changed since its evidence was recorded.</p>
    <section className="handover-section"><h3>Confirmed knowledge</h3>{content.confirmedKnowledge.length === 0 ? <p>No confirmed knowledge in this snapshot.</p> : content.confirmedKnowledge.map(item => <article className="handover-knowledge" key={`${item.gapId}:${item.answerId}`}><Badge>CONFIRMED</Badge><p className="preserve-text">{item.text}</p><p>Gap: {item.gapId} · Answer: {item.answerId}</p><ReviewProvenance review={item.review} /><EvidenceList evidence={item.evidence} context={context} /></article>)}</section>
    <section className="handover-section"><h3>Unresolved gaps</h3>{content.unresolvedGaps.length === 0 ? <p>No unresolved gaps recorded in this snapshot.</p> : content.unresolvedGaps.map(gap => <article className="handover-unknown" key={gap.gapId}><Badge>UNKNOWN</Badge><h4>{gap.question}</h4><p>{gap.category.replaceAll('_', ' ')} · Gap {gap.gapId}</p></article>)}</section>
    <section className="handover-section"><h3>Explicit next actions</h3>{content.nextActions.length === 0 ? <p>No explicit next actions in this snapshot.</p> : <ol className="handover-actions">{content.nextActions.map((action, index) => <li key={`${action.answerId}:${index}`} value={action.order}><p className="preserve-text">{action.text}</p><p>Answer: {action.answerId} · Review decision: {action.reviewDecisionId}{action.lineNumber !== undefined ? ` · Line ${action.lineNumber}` : ''}</p>{action.review && <ReviewProvenance review={action.review} />}{action.evidence && <EvidenceList evidence={action.evidence} context={context} />}</li>)}</ol>}</section>
  </>;
}
function ReviewProvenance({ review }: { review: PublishedReview }) {
  return <details className="handover-provenance"><summary>Human review · {review.action}</summary><dl className="project-facts"><div><dt>Reviewer</dt><dd>{review.reviewerName ?? review.reviewerId}</dd></div><div><dt>Reviewer ID</dt><dd>{review.reviewerId}</dd></div><div><dt>Decision</dt><dd>{review.decisionId} · Sequence {review.sequence}</dd></div><div><dt>Reviewed</dt><dd>{review.reviewedAt}</dd></div></dl></details>;
}
function EvidenceList({ evidence, context }: { evidence: PublishedEvidence[]; context: WorkflowContext }) {
  return <section aria-label="Published supporting evidence"><h4>Supporting evidence</h4>{evidence.length === 0 ? <p>No evidence attached to this published item.</p> : evidence.map(item => <Evidence key={item.evidenceId} evidence={item} context={context} />)}</section>;
}
function Evidence({ evidence, context }: { evidence: PublishedEvidence; context: WorkflowContext }) {
  const [document, setDocument] = useState<Awaited<ReturnType<typeof readPublishedEvidence>>>(null), [loading, setLoading] = useState(false), [error, setError] = useState(''), [missing, setMissing] = useState(false);
  const ticket = useWorkflowTicket(), reading = useRef(false);
  const read = async () => {
    if (reading.current) return; reading.current = true; const current = ticket(); setLoading(true); setError(''); setMissing(false);
    try { const value = await readPublishedEvidence(context.api, context.project, evidence); if (current()) { setDocument(value); setMissing(!value); } }
    catch (error) { if (current()) context.fail(error, () => setError(handoverError(error))); }
    finally { reading.current = false; if (current()) setLoading(false); }
  };
  const changed = document && (document.document.sha256 !== evidence.documentSha256 || document.document.content.slice(evidence.startOffset, evidence.endOffset) !== evidence.quote);
  return <article className="live-evidence"><blockquote>{evidence.quote}</blockquote><p>{evidence.filename ?? 'Published source document'}{evidence.sourceType ? ` · ${evidence.sourceType}` : ''}</p><p>Document: {evidence.documentId}</p><p>Evidence: {evidence.evidenceId} · Offsets {evidence.startOffset}–{evidence.endOffset}</p><p className="handover-hash">Recorded SHA-256: {evidence.documentSha256}</p>
    <Button disabled={loading} onClick={() => void read()}>Read evidence document</Button>{loading && <p role="status">Loading evidence document…</p>}<WorkflowError message={error} />{missing && <p>The document could not be located in this project's current sources. The published quote remains unchanged.</p>}
    {document && <section className="handover-current-document"><h5>Current source document</h5><p>{document.filename}</p>{changed && <p>The current document differs from the published evidence. The frozen quote and hash above are unchanged.</p>}<pre>{document.document.content}</pre><Button onClick={() => setDocument(null)}>Close evidence document</Button></section>}
  </article>;
}
