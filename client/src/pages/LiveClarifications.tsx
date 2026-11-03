import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { Answer, KnowledgeGap, SourceDocument } from '../../../shared/api-types';
import { ApiError } from '../lib/api';
import { fetchGap, fetchGaps } from '../lib/workflow-api';
import { answerValidation, clarificationError, fetchAnswers, submitAnswer } from '../lib/clarification-api';
import { Badge, Button } from '../components/ui';
import { LiveWorkflowBoundary, useWorkflowTicket, WorkflowError, type WorkflowContext, type WorkflowProps } from '../components/LiveWorkflow';
import FrozenEvidence from '../components/LiveGapEvidence';
import AnswerEvidenceEditor, { type EvidenceDraft } from '../components/AnswerEvidenceEditor';

export default function LiveClarifications(props: WorkflowProps) {
  if (!['OUTGOING', 'REVIEWER'].includes(props.project.role)) return <div className="feature-page"><h1>Access restricted</h1><p>Your project role cannot read private clarification answers.</p></div>;
  return <LiveWorkflowBoundary {...props}>{context => <ClarificationWorkspace context={context} />}</LiveWorkflowBoundary>;
}
function ClarificationWorkspace({ context }: { context: WorkflowContext }) {
  const [history, setHistory] = useState<(string | undefined)[]>([undefined]), [revision, setRevision] = useState(0), [pending, setPending] = useState(false);
  const cursor = history[history.length - 1];
  return <div className="feature-page live-workflow"><div className="page-heading"><h1>Clarifications</h1><p>{context.project.name} · LIVE · {context.project.role === 'OUTGOING' ? 'Outgoing answers' : 'Reviewer history'}</p></div>
    <p>Open project questions. Assignment information is not provided by the backend. Answers are append-only and do not resolve gaps or approve claims.</p>
    <div className="workflow-actions"><Button disabled={pending} onClick={() => { setHistory([undefined]); setRevision(value => value + 1); }}>Refresh open questions</Button></div><p>Open questions · Page {history.length}</p>
    <OpenQuestions key={`${cursor ?? 'first'}:${revision}`} context={context} cursor={cursor} pending={pending} setPending={setPending} previous={history.length > 1 ? () => setHistory(items => items.slice(0, -1)) : undefined} next={value => setHistory(items => [...items, value])} />
  </div>;
}
function OpenQuestions({ context, cursor, pending, setPending, previous, next }: { context: WorkflowContext; cursor?: string; pending: boolean; setPending: (pending: boolean) => void; previous?: () => void; next: (cursor: string) => void }) {
  const [gaps, setGaps] = useState<KnowledgeGap[]>([]), [nextCursor, setNextCursor] = useState<string | null>(null), [selected, setSelected] = useState(''), [loading, setLoading] = useState(true), [error, setError] = useState('');
  const ticket = useWorkflowTicket();
  const load = async () => {
    const current = ticket(); setLoading(true); setError(''); setGaps([]); setNextCursor(null); setSelected('');
    try { const result = await fetchGaps(context.api, context.project.id, { status: 'OPEN', cursor }); if (current()) { setGaps(result.gaps.filter(gap => gap.status === 'OPEN')); setNextCursor(result.nextCursor); } }
    catch (error) { if (current()) context.fail(error, setError); }
    finally { if (current()) setLoading(false); }
  };
  useEffect(() => { void load(); }, []);
  return <>{loading ? <p role="status">Loading open questions…</p> : error ? <WorkflowError message={error} retry={() => void load()} /> : gaps.length === 0 ? <p>No open gaps on this page.</p> : gaps.map(gap => <Button className="gap-list-item" key={gap.id} disabled={pending} aria-pressed={selected === gap.id} onClick={() => setSelected(gap.id)}><span>{gap.category.replaceAll('_', ' ')}</span><span className="list-question">{gap.question}</span></Button>)}
    <div className="workflow-actions"><Button disabled={pending || loading || !previous} onClick={previous}>Previous questions page</Button><Button disabled={pending || loading || !nextCursor} onClick={() => nextCursor && next(nextCursor)}>Next questions page</Button></div>
    {selected && <Question key={selected} context={context} gapId={selected} setPending={setPending} />}
  </>;
}
function Question({ context, gapId, setPending }: { context: WorkflowContext; gapId: string; setPending: (pending: boolean) => void }) {
  const [gap, setGap] = useState<KnowledgeGap | null>(null), [loading, setLoading] = useState(true), [error, setError] = useState(''), [historyVersion, setHistoryVersion] = useState(0);
  const ticket = useWorkflowTicket(), heading = useRef<HTMLHeadingElement>(null);
  const load = async () => {
    const current = ticket(); setLoading(true); setError('');
    try { const value = await fetchGap(context.api, context.project.id, gapId); if (current()) { setGap(value); setHistoryVersion(value => value + 1); return true; } }
    catch (error) { if (current()) context.fail(error, setError); }
    finally { if (current()) setLoading(false); }
    return false;
  };
  useEffect(() => { void load(); }, []);
  useEffect(() => { if (gap) heading.current?.focus(); }, [gap]);
  return <section className="workflow-detail" aria-label="Selected clarification question">
    {loading && <p role="status">Loading question…</p>}<WorkflowError message={error} retry={() => void load()} />
    {gap && <><h2 ref={heading} tabIndex={-1}>{gap.question}</h2><p>{gap.category.replaceAll('_', ' ')} · {gap.status}</p><details><summary>Linked claim evidence</summary>{gap.claimLinks.length ? gap.claimLinks.map(link => <FrozenEvidence key={link.claimId} claimId={link.claimId} value={link.provenance} />) : <p>No linked evidence returned.</p>}</details>
      {context.project.role === 'OUTGOING' ? <AnswerForm context={context} gap={gap} disabled={loading || !!error} setPending={setPending} onSaved={() => setHistoryVersion(value => value + 1)} refresh={load} /> : <p>Reviewer read-only history. Only outgoing members can submit clarification answers.</p>}
      <AnswerHistory key={historyVersion} context={context} gapId={gapId} />
    </>}
  </section>;
}
function AnswerForm({ context, gap, disabled, setPending, onSaved, refresh }: { context: WorkflowContext; gap: KnowledgeGap; disabled: boolean; setPending: (pending: boolean) => void; onSaved: () => void; refresh: () => Promise<boolean> }) {
  const [text, setText] = useState(''), [rows, setRows] = useState<EvidenceDraft[]>([]), [error, setError] = useState(''), [busy, setBusy] = useState(false), [success, setSuccess] = useState<Answer | null>(null), [conflict, setConflict] = useState(false);
  const counter = useRef(0), submitting = useRef(false), ticket = useWorkflowTicket();
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (context.project.role !== 'OUTGOING' || gap.status !== 'OPEN' || disabled || conflict || submitting.current) return;
    setError(''); setSuccess(null);
    const request = { answerText: text, evidence: rows.map(row => ({ documentId: row.document?.id ?? '', quote: row.quote })) };
    const documents = rows.map(row => row.document).filter((doc): doc is SourceDocument => !!doc);
    const issue = answerValidation(request, documents, context.project.id);
    if (issue) { setError(issue); return; }
    const current = ticket(); submitting.current = true; setBusy(true); setPending(true);
    try {
      const value = await submitAnswer(context.api, context.project, gap.id, request, documents);
      if (current()) { setSuccess(value); setText(''); setRows([]); onSaved(); }
    } catch (error) {
      if (current()) {
        if (error instanceof ApiError && error.status === 409) setConflict(true);
        context.fail(error, () => setError(clarificationError(error)));
      }
    } finally { submitting.current = false; if (current()) { setBusy(false); setPending(false); } }
  };
  const refreshConflict = async () => { const current = ticket(); if (await refresh() && current()) { setConflict(false); setError(''); } };
  return <section><h3>Clarification answer</h3>{gap.status !== 'OPEN' && <p>This question is no longer open. Answer history remains available.</p>}
    <form onSubmit={event => void submit(event)} noValidate><fieldset disabled={disabled || busy || gap.status !== 'OPEN'}><legend className="sr-only">Write an append-only clarification</legend>
      <label className="field-label" htmlFor="live-answer">Your answer</label><textarea className="text-input" id="live-answer" rows={5} maxLength={10000} value={text} onChange={event => { setText(event.target.value); setSuccess(null); }} aria-describedby="live-answer-help live-answer-error" />
      <p id="live-answer-help" className="field-help">Nonblank answer, up to 10,000 characters. Optional evidence must quote a project document exactly. Submitted answers cannot be edited here.</p>
      {rows.length > 0 && <AnswerEvidenceEditor context={context} rows={rows} disabled={busy} update={(key, patch) => setRows(items => items.map(row => row.key === key ? { ...row, ...patch } : row))} remove={key => setRows(items => items.filter(row => row.key !== key))} />}
      <div className="workflow-actions"><Button type="button" disabled={rows.length >= 10} onClick={() => setRows(items => [...items, { key: ++counter.current, document: null, quote: '' }])}>Add evidence</Button><Button type="submit" variant="primary" disabled={conflict}>Submit clarification</Button></div>
    </fieldset></form>
    {busy && <p role="status">Submitting clarification…</p>}{error && <p className="field-error" id="live-answer-error" role="alert">{error}</p>}
    {conflict && <Button disabled={disabled || busy} onClick={() => void refreshConflict()}>Refresh question and answer history</Button>}
    {success && <p role="status">Clarification submitted · Answer {success.id} · {success.effectiveReviewStatus}. This did not resolve the gap or approve a claim.</p>}
  </section>;
}
function AnswerHistory({ context, gapId }: { context: WorkflowContext; gapId: string }) {
  const [cursors, setCursors] = useState<(string | undefined)[]>([undefined]), [version, setVersion] = useState(0);
  const cursor = cursors[cursors.length - 1];
  return <section><h3>Answer history</h3><p>Page {cursors.length} · Oldest first. Review status is the backend effective status; no private decision reasons are loaded.</p>
    <Button onClick={() => { setCursors([undefined]); setVersion(value => value + 1); }}>Refresh answer history</Button>
    <AnswerPage key={`${cursor ?? 'first'}:${version}`} context={context} gapId={gapId} cursor={cursor} previous={cursors.length > 1 ? () => setCursors(items => items.slice(0, -1)) : undefined} next={value => setCursors(items => [...items, value])} />
  </section>;
}
function AnswerPage({ context, gapId, cursor, previous, next }: { context: WorkflowContext; gapId: string; cursor?: string; previous?: () => void; next: (cursor: string) => void }) {
  const [answers, setAnswers] = useState<Answer[]>([]), [nextCursor, setNextCursor] = useState<string | null>(null), [loading, setLoading] = useState(true), [error, setError] = useState('');
  const ticket = useWorkflowTicket();
  const load = async () => {
    const current = ticket(); setLoading(true); setError(''); setAnswers([]); setNextCursor(null);
    try { const result = await fetchAnswers(context.api, context.project, gapId, cursor); if (current()) { setAnswers(result.answers); setNextCursor(result.nextCursor); } }
    catch (error) { if (current()) context.fail(error, setError); }
    finally { if (current()) setLoading(false); }
  };
  useEffect(() => { void load(); }, []);
  return <>{loading ? <p role="status">Loading answer history…</p> : error ? <WorkflowError message={error} retry={() => void load()} /> : answers.length === 0 ? <p>No answers on this page.</p> : answers.map(answer => <article className="live-evidence" key={answer.id}>
    <h4>Answer {answer.id}</h4><p>Author: {answer.author.name ?? answer.author.id} · Submitted: {answer.createdAt}</p><Badge>{answer.effectiveReviewStatus}</Badge>
    <h5>Original answer</h5><p className="preserve-text">{answer.answerText}</p>{answer.effectiveText !== null && <><h5>Effective reviewed text</h5><p className="preserve-text">{answer.effectiveText}</p></>}
    <details><summary>Answer evidence</summary>{answer.evidence.length === 0 ? <p>No evidence attached.</p> : answer.evidence.map(item => <div key={item.id}><p>Document: {item.documentId}</p><blockquote>{item.quote}</blockquote><p>Recorded document SHA-256: {item.documentSha256}</p></div>)}</details>
  </article>)}<div className="workflow-actions"><Button disabled={!previous || loading} onClick={previous}>Previous answers page</Button><Button disabled={!nextCursor || loading} onClick={() => nextCursor && next(nextCursor)}>Next answers page</Button></div></>;
}
