import { useRef, useState, type FormEvent } from 'react';
import type { AnswerRequest } from '../../../shared/api-types';
import { ArrowRight, Search } from 'lucide-react';
import { Button } from '../components/ui';
import WorkflowEvidence from '../components/WorkflowEvidence';
import { gaps, sources, type DemoSource } from '../data/demo';
import { answerIssue, effectiveAnswer, type DemoAnswer } from '../data/clarifications';

type Draft = { text: string; sourceId: string; quote: string };
export default function Clarifications({ answers, onAdd, onSource, onQueue }: { answers: DemoAnswer[]; onAdd: (answer: DemoAnswer) => void; onSource: (source: DemoSource) => void; onQueue: () => void }) {
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState(gaps[0].id);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [error, setError] = useState('');
  const [preview, setPreview] = useState(false);
  const errorRef = useRef<HTMLParagraphElement>(null);
  const filtered = gaps.filter(gap => gap.status === 'OPEN' && gap.question.toLowerCase().includes(query.toLowerCase()));
  const selected = filtered.find(gap => gap.id === selectedId) ?? filtered[0];
  const draft = drafts[selected?.id ?? ''] ?? { text: '', sourceId: sources[0].id, quote: '' };
  const updateDraft = (patch: Partial<Draft>) => { if (selected) setDrafts(current => ({ ...current, [selected.id]: { ...draft, ...patch } })); setError(''); setPreview(false); };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!selected) return;
    const request: AnswerRequest = { answerText: draft.text, evidence: draft.quote ? [{ documentId: `demo-document-${draft.sourceId}`, quote: draft.quote }] : [] };
    const issue = answerIssue(request);
    if (issue) { setError(issue); requestAnimationFrame(() => errorRef.current?.focus()); return; }
    onAdd({ id: `demo-local-${crypto.randomUUID()}`, gapId: selected.id, answerText: request.answerText, status: 'PENDING_REVIEW', origin: 'local', evidence: draft.quote ? [{ sourceId: draft.sourceId, quote: draft.quote }] : [], decisions: [] });
    setDrafts(current => ({ ...current, [selected.id]: { text: '', sourceId: sources[0].id, quote: '' } }));
    setError(''); setPreview(true);
  };
  const history = answers.filter(answer => answer.gapId === selected?.id);
  return <div className="feature-page workflow-page"><div className="page-heading"><h1>Clarifications</h1><p>Outgoing view · Add context to an open question.</p></div><p className="feature-demo-note">DEMO · Preview answers locally. Nothing is submitted or persisted; reloading clears local changes. Assignment data is not available, so this view shows open project gaps.</p>
    <div className="gaps-toolbar"><label className="list-search"><Search size={20} /><input value={query} aria-label="Search open questions" placeholder="Search open questions" onChange={event => { setQuery(event.target.value); setError(''); setPreview(false); }} /></label><label className="filter-label workflow-question-select">Open project question<select value={selected?.id ?? ''} onChange={event => { setSelectedId(event.target.value); setError(''); setPreview(false); }}>{!selected && <option value="">No matching questions</option>}{filtered.map(gap => <option key={gap.id} value={gap.id}>{gap.title}</option>)}</select></label></div>
    {selected ? <><section className="workflow-question"><h2>{selected.question}</h2><p>{selected.summary}</p><WorkflowEvidence evidence={selected.evidence} onSource={onSource} /></section>
    <section className="workflow-section"><h2>Clarification answer</h2><form onSubmit={submit} noValidate><label className="field-label" htmlFor="clarification-answer">Your answer</label><textarea id="clarification-answer" className="text-input" rows={5} maxLength={10000} value={draft.text} onChange={event => updateDraft({ text: event.target.value })} aria-describedby="answer-help answer-error" aria-invalid={!!error} required /><p id="answer-help" className="field-help">Explain what is known and what remains uncertain. {draft.text.length.toLocaleString()} / 10,000 characters.</p>
    <details className="workflow-evidence"><summary>Attach evidence (optional)</summary><label className="field-label" htmlFor="answer-source">Demo source</label><select id="answer-source" className="text-input" value={draft.sourceId} onChange={event => updateDraft({ sourceId: event.target.value, quote: '' })}>{sources.map(source => <option key={source.id} value={source.id}>{source.filename}</option>)}</select><button type="button" className="inline-link" onClick={() => onSource(sources.find(source => source.id === draft.sourceId)!)}>Read selected source<ArrowRight size={18} /></button><label className="field-label" htmlFor="answer-quote">Exact quote</label><textarea id="answer-quote" className="text-input" rows={3} maxLength={4000} value={draft.quote} onChange={event => updateDraft({ quote: event.target.value })} aria-describedby="quote-help" /><p id="quote-help" className="field-help">Paste an exact excerpt from this demo source, up to 4,000 characters. Leave blank to attach no evidence.</p>{draft.quote && <Button type="button" variant="ghost" onClick={() => updateDraft({ quote: '' })}>Remove quote</Button>}</details>
    <p id="answer-error" ref={errorRef} tabIndex={-1} className="field-error" role="alert">{error}</p><Button type="submit" variant="primary">Preview clarification<ArrowRight size={18} /></Button><p className="field-help">Adds a non-persistent answer preview to the demo history and queue. Does not resolve the gap.</p></form>
    {preview && <div className="local-preview" role="status"><h3>Local answer preview only</h3><p>No answer was submitted. The demo effective status is PENDING_REVIEW.</p><button className="inline-link" onClick={onQueue}>Inspect in Reviewer Queue<ArrowRight size={18} /></button></div>}</section>
    <section className="workflow-section"><h2>Answer history</h2><p className="field-help">Fixed fixtures and local previews, in order. Reviewer-only decision reasons are excluded from this outgoing view.</p>{history.length === 0 ? <p className="workflow-empty">No demo answers for this question yet.</p> : history.map((answer, index) => { const effective = effectiveAnswer(answer); return <article className="answer-history-item" key={answer.id}><h3>{answer.origin === 'fixture' ? 'DEMO fixture' : 'Local answer preview'} · Answer {index + 1}</h3><p className="field-help">DEMO effective status: {effective.status}</p><p className="preserve-text">{answer.answerText}</p>{effective.text !== null && <div className="effective-preview"><h3>Effective text · local preview only</h3><p className="preserve-text">{effective.text}</p></div>}<WorkflowEvidence evidence={answer.evidence} onSource={onSource} label="Answer evidence" /></article>; })}</section></> : <div className="empty-state"><h2>No matching open questions</h2><p>Try another search phrase.</p><Button onClick={() => setQuery('')}>Clear search</Button></div>}
  </div>;
}
