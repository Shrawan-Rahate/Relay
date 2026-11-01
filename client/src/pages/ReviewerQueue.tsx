import { useRef, useState, type FormEvent } from 'react';
import type { ReviewAction, ReviewRequest } from '../../../shared/api-types';
import { ArrowRight, Search } from 'lucide-react';
import { Button } from '../components/ui';
import WorkflowEvidence from '../components/WorkflowEvidence';
import { gaps, type DemoSource } from '../data/demo';
import { effectiveAnswer, isReviewable, reviewIssue, type DemoAnswer } from '../data/clarifications';

const actions: { action: ReviewAction; description: string }[] = [
  { action: 'APPROVE', description: 'Keep the original answer.' },
  { action: 'EDIT', description: 'Use corrected text.' },
  { action: 'REJECT', description: 'Exclude this answer.' },
  { action: 'DEFER', description: 'Keep it in the review queue.' },
];
function DecisionEditor({ answer, onDecision }: { answer: DemoAnswer; onDecision: (id: string, request: ReviewRequest) => void }) {
  const [action, setAction] = useState<ReviewAction>('APPROVE');
  const [correctedText, setCorrectedText] = useState('');
  const [reason, setReason] = useState('');
  const [resolveGap, setResolveGap] = useState(false);
  const [error, setError] = useState('');
  const errorRef = useRef<HTMLParagraphElement>(null);
  const needsReason = action === 'REJECT' || action === 'DEFER';
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const request: ReviewRequest = action === 'EDIT' ? { action, correctedText, reason, resolveGap } : action === 'APPROVE' ? { action, reason, resolveGap } : { action, reason };
    const issue = reviewIssue(request);
    if (issue) { setError(issue); requestAnimationFrame(() => errorRef.current?.focus()); return; }
    onDecision(answer.id, request);
    setError(''); setReason(''); setResolveGap(false);
  };
  return <form className="decision-form" onSubmit={submit} noValidate><fieldset className="review-action-options"><legend>Choose a decision to preview</legend>{actions.map(option => <label key={option.action}><input type="radio" name="review-action" value={option.action} checked={action === option.action} onChange={() => { setAction(option.action); setResolveGap(false); setError(''); }} /><span><strong>{option.action}</strong><span>{option.description}</span></span></label>)}</fieldset>
    {action === 'EDIT' && <div className="review-field"><label className="field-label" htmlFor="corrected-text">Corrected text (required)</label><textarea id="corrected-text" className="text-input" rows={6} maxLength={10000} required value={correctedText} onChange={event => { setCorrectedText(event.target.value); setError(''); }} aria-describedby="correction-help review-error" /><p id="correction-help" className="field-help">The corrected text becomes effective only in this local decision preview. Maximum 10,000 characters.</p><Button type="button" variant="ghost" onClick={() => setCorrectedText(answer.answerText)}>Use original answer as starting text</Button></div>}
    <div className="review-field"><label className="field-label" htmlFor="review-reason">{needsReason ? 'Reason (required)' : 'Reason (optional)'}</label><textarea id="review-reason" className="text-input" rows={3} maxLength={5000} required={needsReason} value={reason} onChange={event => { setReason(event.target.value); setError(''); }} aria-describedby="reason-help review-error" /><p id="reason-help" className="field-help">Up to 5,000 characters. Decision reasons are shown only in the reviewer preview.</p></div>
    {!needsReason && <label className="resolve-preview"><input type="checkbox" checked={resolveGap} onChange={event => setResolveGap(event.target.checked)} /><span>Include “resolve gap” in this request preview<span className="field-help">Optional for APPROVE and EDIT. The demo gap itself stays unchanged.</span></span></label>}
    <p ref={errorRef} id="review-error" tabIndex={-1} className="field-error" role="alert">{error}</p><Button variant="primary" type="submit">Preview {action}<ArrowRight size={18} /></Button><p className="field-help">No real decision is submitted. This only updates the non-persistent demo effective status and history.</p>
  </form>;
}
export default function ReviewerQueue({ answers, onDecision, onSource }: { answers: DemoAnswer[]; onDecision: (id: string, request: ReviewRequest) => void; onSource: (source: DemoSource) => void }) {
  const [scope, setScope] = useState('pending');
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState(answers[0]?.id ?? '');
  const [lastPreview, setLastPreview] = useState<{ id: string; action: ReviewAction } | null>(null);
  const pending = answers.filter(isReviewable);
  const filtered = answers.filter(answer => (scope === 'all' || isReviewable(answer)) && `${answer.answerText} ${gaps.find(gap => gap.id === answer.gapId)?.question ?? ''}`.toLowerCase().includes(query.toLowerCase()));
  const selected = filtered.find(answer => answer.id === selectedId) ?? filtered[0];
  const gap = gaps.find(gap => gap.id === selected?.gapId);
  const previewDecision = (id: string, request: ReviewRequest) => { onDecision(id, request); setLastPreview({ id, action: request.action }); };
  return <div className="feature-page workflow-page"><div className="page-heading"><h1>Reviewer Queue</h1><p>Reviewer view · Check the answer against its evidence.</p></div><p className="feature-demo-note">DEMO · {pending.length} pending or deferred answer {pending.length === 1 ? 'example' : 'examples'}. All decisions are local, non-persistent previews. No real approvals, people, or submissions are represented.</p>
    <div className="gaps-toolbar"><label className="list-search"><Search size={20} /><input aria-label="Search review answers and questions" placeholder="Search answers or questions" value={query} onChange={event => setQuery(event.target.value)} /></label><label className="filter-label">Queue scope<select value={scope} onChange={event => setScope(event.target.value)}><option value="pending">Pending review ({pending.length})</option><option value="all">All demo answers ({answers.length})</option></select></label></div>
    {lastPreview && <div className="local-preview" role="status"><h3>{lastPreview.action} · local decision preview only</h3><p>No real review was submitted. APPROVE, EDIT, and REJECT previews leave the pending queue; DEFER previews remain reviewable.</p><button className="inline-link" onClick={() => { setScope('all'); setQuery(''); setSelectedId(lastPreview.id); setLastPreview(null); }}>View this answer’s local history<ArrowRight size={18} /></button></div>}
    {selected && gap ? <><label className="field-label queue-answer-select" htmlFor="queue-answer">Choose an answer ({filtered.length})</label><select className="text-input" id="queue-answer" value={selected.id} onChange={event => setSelectedId(event.target.value)}>{filtered.map((answer, index) => <option key={answer.id} value={answer.id}>{index + 1}. {gaps.find(gap => gap.id === answer.gapId)?.title} · {effectiveAnswer(answer).status}</option>)}</select>
    <section className="workflow-question"><h2>{gap.question}</h2><p>Demo gap status: {gap.status}</p><WorkflowEvidence evidence={gap.evidence} onSource={onSource} label="Gap evidence" /></section>
    <section className="workflow-section"><h2>Original answer</h2><p className="field-help">{selected.origin === 'fixture' ? 'DEMO fixture' : 'Local answer preview'} · No author identity is fabricated.</p><p className="answer-original preserve-text">{selected.answerText}</p><WorkflowEvidence evidence={selected.evidence} onSource={onSource} label="Answer evidence" /><div className="effective-preview"><h3>DEMO effective status: {effectiveAnswer(selected).status}</h3>{effectiveAnswer(selected).text !== null ? <p className="preserve-text">{effectiveAnswer(selected).text}</p> : <p>No effective confirmed text in this preview.</p>}<p className="field-help">The original answer status remains PENDING_REVIEW. Local decisions do not alter the answer’s original text.</p></div></section>
    <section className="workflow-section"><h2>Review decision</h2>{isReviewable(selected) ? <DecisionEditor key={selected.id} answer={selected} onDecision={previewDecision} /> : <p className="workflow-empty">This answer has a final local decision preview. Real review actions remain unavailable until API integration.</p>}</section>
    <section className="workflow-section"><h2>Decision history</h2><p className="field-help">Reviewer-only local previews, in sequence. No historical decisions are fabricated.</p>{selected.decisions.length === 0 ? <p className="workflow-empty">No decision previews for this demo answer.</p> : selected.decisions.map(decision => <article className="decision-history-item" key={decision.sequence}><h3>Preview {decision.sequence} · {decision.request.action}</h3>{decision.request.action === 'EDIT' && <><h4>Corrected text</h4><p className="preserve-text">{decision.request.correctedText}</p></>}{decision.request.reason && <><h4>Reviewer-only reason</h4><p className="preserve-text">{decision.request.reason}</p></>}{(decision.request.action === 'APPROVE' || decision.request.action === 'EDIT') && <p className="field-help">Resolve gap in request preview: {decision.request.resolveGap ? 'yes' : 'no'}. Demo gap unchanged.</p>}<p className="field-help">Local only · No review submitted or persisted.</p></article>)}</section></> : <div className="empty-state"><h2>{query ? 'No matching demo answers' : 'No pending demo answers'}</h2><p>{query ? 'Try another search phrase or scope.' : 'You can inspect local history or preview an outgoing clarification.'}</p><Button onClick={() => { setScope('all'); setQuery(''); }}>Show all demo answers</Button></div>}
  </div>;
}
