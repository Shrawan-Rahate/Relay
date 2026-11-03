import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { QueuedAnswer, ReviewAction, ReviewDecision, ReviewedAnswer, ReviewRequest } from '../../../shared/api-types';
import { Badge, Button } from '../components/ui';
import { LiveWorkflowBoundary, useWorkflowTicket, WorkflowError, type WorkflowContext, type WorkflowProps } from '../components/LiveWorkflow';
import { fetchReviewHistory, fetchReviewQueue, resolveReviewEvidence, reviewError, reviewValidation, submitReview, type ReviewDocument } from '../lib/review-api';
import './live-reviews.css';

export default function LiveReviewerQueue(props: WorkflowProps) {
  if (props.project.role !== 'REVIEWER') return <div className="feature-page"><h1>Access restricted</h1><p>Only reviewers can access the review queue and private review history.</p></div>;
  return <LiveWorkflowBoundary {...props}>{context => <ReviewQueue context={context} />}</LiveWorkflowBoundary>;
}
function ReviewQueue({ context }: { context: WorkflowContext }) {
  const [answers, setAnswers] = useState<QueuedAnswer[]>([]), [selected, setSelected] = useState<QueuedAnswer | null>(null);
  const [cursors, setCursors] = useState<(string | undefined)[]>([undefined]), [nextCursor, setNextCursor] = useState<string | null>(null), [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(true), [error, setError] = useState(''), [pending, setPending] = useState(false);
  const cursor = cursors[cursors.length - 1], ticket = useWorkflowTicket();
  useEffect(() => {
    let active = true; const current = ticket(); setLoading(true); setError(''); setAnswers([]); setNextCursor(null);
    fetchReviewQueue(context.api, context.project, cursor).then(result => { if (active && current()) { setAnswers(result.answers); setNextCursor(result.nextCursor); } })
      .catch(error => { if (active && current()) context.fail(error, () => setError(reviewError(error))); })
      .finally(() => { if (active && current()) setLoading(false); });
    return () => { active = false; };
  }, [cursor, revision]);
  const refresh = () => { setCursors([undefined]); setRevision(value => value + 1); };
  return <div className="feature-page live-workflow live-reviews"><div className="page-heading"><h1>Human Reviewer Queue</h1><p>{context.project.name} · Reviewer · LIVE</p></div>
    <p>Review outgoing answers against their supporting evidence. Deferred answers remain available for later review. Gaps stay open unless you explicitly resolve them.</p>
    <div className="workflow-actions"><Button disabled={pending || loading} onClick={refresh}>Refresh queue</Button><span>Queue page {cursors.length}</span></div>
    {loading ? <p role="status">Loading reviewer queue…</p> : error ? <WorkflowError message={error} retry={refresh} /> : answers.length === 0 ? <p>No answers awaiting review on this page.</p> : <div className="review-queue-list">{answers.map(answer => <Button key={answer.id} className="review-queue-item" disabled={pending} aria-pressed={selected?.id === answer.id} aria-label={`Review answer ${answer.id}: ${answer.gap.question}`} onClick={() => setSelected(answer)}><span>{answer.gap.question}</span><span className="field-help">{answer.gap.category.replaceAll('_', ' ')} · {answer.effectiveReviewStatus}</span></Button>)}</div>}
    <div className="workflow-actions"><Button disabled={pending || loading || cursors.length === 1} onClick={() => setCursors(items => items.slice(0, -1))}>Previous queue page</Button><Button disabled={pending || loading || !nextCursor} onClick={() => nextCursor && setCursors(items => [...items, nextCursor])}>Next queue page</Button></div>
    {selected && <AnswerReview key={selected.id} answer={selected} context={context} setPending={setPending} onSaved={refresh} />}
  </div>;
}
function AnswerReview({ answer, context, setPending, onSaved }: { answer: QueuedAnswer; context: WorkflowContext; setPending: (pending: boolean) => void; onSaved: () => void }) {
  const [effective, setEffective] = useState<ReviewedAnswer>(answer), [reviews, setReviews] = useState<ReviewDecision[]>([]), [nextAfter, setNextAfter] = useState<number | null>(null);
  const [historyLoading, setHistoryLoading] = useState(true), [historyError, setHistoryError] = useState(''), [blocked, setBlocked] = useState(true);
  const [action, setAction] = useState<ReviewAction>('APPROVE'), [correctedText, setCorrectedText] = useState(''), [reason, setReason] = useState(''), [resolveGap, setResolveGap] = useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [success, setSuccess] = useState('');
  const submitting = useRef(false), historyVersion = useRef(0), ticket = useWorkflowTicket();
  const loadHistory = async (after = 0) => {
    const alive = ticket(), version = ++historyVersion.current, current = () => alive() && version === historyVersion.current;
    setHistoryLoading(true); setHistoryError(''); setBlocked(true);
    try {
      const result = await fetchReviewHistory(context.api, context.project, answer.gapId, answer.id, after);
      if (current()) { setEffective(result.answer); setReviews(items => after ? [...items, ...result.reviews] : result.reviews); setNextAfter(result.nextAfter); setBlocked(false); setError(''); }
    } catch (error) { if (current()) context.fail(error, () => setHistoryError(reviewError(error))); }
    finally { if (current()) setHistoryLoading(false); }
  };
  useEffect(() => { void loadHistory(); }, []);
  const final = !['PENDING_REVIEW', 'DEFERRED'].includes(effective.effectiveReviewStatus);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (submitting.current || blocked || final || historyLoading || context.project.role !== 'REVIEWER') return;
    const optionalReason = reason === '' ? {} : { reason };
    const input: ReviewRequest = action === 'APPROVE' ? { action, ...optionalReason, resolveGap } : action === 'EDIT' ? { action, correctedText, ...optionalReason, resolveGap } : { action, reason, resolveGap: false };
    const issue = reviewValidation(input); setError(issue ?? ''); setSuccess(''); if (issue) return;
    const current = ticket(); submitting.current = true; setBusy(true); setPending(true);
    try {
      const result = await submitReview(context.api, context.project, answer.gapId, answer.id, input);
      if (current()) {
        setEffective(result.answer); setSuccess(`Review saved: ${result.answer.effectiveReviewStatus}. ${result.decision.resolveGap ? 'Gap resolution confirmed.' : 'No gap resolution requested.'}${result.decision.action === 'DEFER' ? ' This is not a final decision.' : ''}`);
        setReason(''); setCorrectedText(''); setResolveGap(false); onSaved(); await loadHistory();
      }
    } catch (error) {
      if (current()) { setBlocked(true); setResolveGap(false); context.fail(error, () => setError(reviewError(error))); }
    } finally { submitting.current = false; if (current()) { setBusy(false); setPending(false); } }
  };
  return <section className="workflow-detail" aria-label="Selected answer review"><h2>{answer.gap.question}</h2><p>{answer.gap.category.replaceAll('_', ' ')} · Gap at queue load: {answer.gap.status}</p>
    <h3>Outgoing answer</h3><p className="preserve-text">{answer.answerText}</p><p>Author: {answer.author.name ?? answer.author.id} · Submitted: <time dateTime={answer.createdAt}>{answer.createdAt}</time></p>
    <p>Effective review status: <Badge>{effective.effectiveReviewStatus}</Badge></p>{effective.effectiveText !== null && <><h3>Effective reviewed text</h3><p className="preserve-text">{effective.effectiveText}</p></>}
    <ReviewEvidence context={context} answer={answer} />
    {success && <p role="status">{success}</p>}{error && <p className="field-error" role="alert">{error}</p>}
    {final ? <p>This answer has a final review decision. Review history remains available below.</p> : <form onSubmit={event => void submit(event)} noValidate className="review-form"><fieldset disabled={busy || historyLoading}><legend>Review decision</legend>
      <label className="field-label" htmlFor="review-action">Review action</label><select className="text-input" id="review-action" value={action} onChange={event => { setAction(event.target.value as ReviewAction); setResolveGap(false); setError(''); }}><option value="APPROVE">Approve</option><option value="EDIT">Edit</option><option value="REJECT">Reject</option><option value="DEFER">Defer</option></select>
      {action === 'EDIT' && <div><label className="field-label" htmlFor="review-corrected">Corrected answer</label><textarea id="review-corrected" className="text-input" rows={5} maxLength={10000} value={correctedText} onChange={event => setCorrectedText(event.target.value)} required /></div>}
      <div><label className="field-label" htmlFor="review-reason">Review reason</label><textarea id="review-reason" className="text-input" rows={3} maxLength={5000} value={reason} onChange={event => setReason(event.target.value)} required={action === 'REJECT' || action === 'DEFER'} aria-describedby="review-reason-help" /><p id="review-reason-help" className="field-help">{action === 'REJECT' || action === 'DEFER' ? 'Required' : 'Optional'} · Up to 5,000 characters. Visible only to reviewers.</p></div>
      {(action === 'APPROVE' || action === 'EDIT') && <label className="checkbox-field"><input type="checkbox" checked={resolveGap} disabled={answer.gap.status === 'DISMISSED'} onChange={event => setResolveGap(event.target.checked)} />Resolve this knowledge gap</label>}
      <p className="field-help">Approve, edit and reject are final for this answer. Defer allows later review. Reviewing does not publish a handover.</p><Button type="submit" variant="primary" disabled={blocked}>Submit review</Button>
    </fieldset></form>}{busy && <p role="status">Saving review…</p>}
    <section aria-label="Private review history"><h3>Review history</h3><Button disabled={busy || historyLoading} onClick={() => void loadHistory()}>Refresh review history</Button>
      {historyLoading && <p role="status">Loading review history…</p>}<WorkflowError message={historyError} retry={() => void loadHistory()} />
      {!historyLoading && !historyError && reviews.length === 0 && <p>No review decisions yet.</p>}
      {reviews.map(decision => <article className="live-evidence" key={decision.id}><h4>Decision {decision.sequence} · {decision.action}</h4><p>{decision.reviewer.name ?? decision.reviewerId}</p><time dateTime={decision.createdAt}>{decision.createdAt}</time>
        {decision.reason !== null && <><h5>Reason</h5><p className="preserve-text">{decision.reason}</p></>}{decision.correctedText !== null && <><h5>Corrected text</h5><p className="preserve-text">{decision.correctedText}</p></>}<p>{decision.resolveGap ? 'Gap resolution requested' : 'No gap resolution requested'}</p></article>)}
      {nextAfter !== null && <Button disabled={busy || historyLoading} onClick={() => void loadHistory(nextAfter)}>More review history</Button>}
    </section>
  </section>;
}
function ReviewEvidence({ context, answer }: { context: WorkflowContext; answer: QueuedAnswer }) {
  const [documents, setDocuments] = useState<ReviewDocument[]>([]), [selected, setSelected] = useState<ReviewDocument | null>(null), [loading, setLoading] = useState(true), [error, setError] = useState('');
  const ticket = useWorkflowTicket(), documentHeading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { if (selected) documentHeading.current?.focus(); }, [selected]);
  const load = async () => {
    const current = ticket(); setLoading(true); setError('');
    try { const documents = await resolveReviewEvidence(context.api, context.project, answer); if (current()) setDocuments(documents); }
    catch (error) { if (current()) context.fail(error, () => setError(reviewError(error))); }
    finally { if (current()) setLoading(false); }
  };
  useEffect(() => { void load(); }, []);
  return <section><h3>Supporting evidence</h3>{answer.evidence.length === 0 ? <p>No supporting evidence was attached.</p> : answer.evidence.map(evidence => {
    const resolved = documents.find(item => item.document.id === evidence.documentId), changed = resolved && (resolved.document.sha256 !== evidence.documentSha256 || resolved.document.content.slice(evidence.startOffset, evidence.endOffset) !== evidence.quote);
    return <article className="live-evidence" key={evidence.id}><blockquote>{evidence.quote}</blockquote><p>Document: {evidence.documentId}</p><p className="field-help">Recorded SHA-256: {evidence.documentSha256} · Offsets {evidence.startOffset}–{evidence.endOffset}</p>
      {resolved ? <><a className="review-document-link" href={`#review-document-${resolved.document.id}`} onClick={event => { event.preventDefault(); setSelected(resolved); }}>Read document {resolved.filename}</a>{changed && <p>The current document differs from the recorded evidence. The original quote above is unchanged.</p>}</> : !loading && !error && <p>This evidence document could not be located in the current project sources.</p>}
    </article>;
  })}{loading && answer.evidence.length > 0 && <p role="status">Resolving evidence documents…</p>}<WorkflowError message={error} retry={() => void load()} />
    {selected && <section id={`review-document-${selected.document.id}`} className="workflow-detail" aria-label="Supporting document"><h4 ref={documentHeading} tabIndex={-1}>{selected.filename}</h4><p>Document {selected.document.id} · Current source content</p><pre>{selected.document.content}</pre><Button onClick={() => setSelected(null)}>Close document</Button></section>}
  </section>;
}
