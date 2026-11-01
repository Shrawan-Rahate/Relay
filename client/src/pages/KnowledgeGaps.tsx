import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowLeft, ArrowUp, ArrowUpRight, FileSearch, Search } from 'lucide-react';
import { Button, SourceIcon } from '../components/ui';
import { categoryLabels, gaps, sources, type DemoSource } from '../data/demo';

export default function KnowledgeGaps({ initialId, onSource }: { initialId?: string; onSource: (source: DemoSource) => void }) {
  const [status, setStatus] = useState('OPEN');
  const [category, setCategory] = useState('ALL');
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState(initialId ?? gaps[0].id);
  const [mobileDetail, setMobileDetail] = useState(false);
  const questionButtons = useRef(new Map<string, HTMLButtonElement>());
  const listScrollPosition = useRef(0);
  const returningToList = useRef(false);
  const evidenceRef = useRef<HTMLDetailsElement>(null);
  const detailRef = useRef<HTMLElement>(null);
  const filtered = useMemo(() => gaps.filter(gap => (status === 'ALL' || gap.status === status) && (category === 'ALL' || gap.category === category) && `${gap.title} ${gap.question} ${gap.shortId}`.toLowerCase().includes(query.toLowerCase())), [status, category, query]);
  const selected = filtered.find(gap => gap.id === selectedId) ?? filtered[0];
  const index = filtered.findIndex(gap => gap.id === selected?.id);
  useEffect(() => {
    if (!window.matchMedia('(width < 768px)').matches) return;
    if (mobileDetail) {
      detailRef.current?.focus({ preventScroll: true });
      detailRef.current?.scrollIntoView({ block: 'start' });
    } else if (returningToList.current) {
      returningToList.current = false;
      questionButtons.current.get(selectedId)?.focus({ preventScroll: true });
      window.scrollTo({ top: listScrollPosition.current, behavior: 'instant' });
    }
  }, [mobileDetail, selectedId]);
  const selectQuestion = (id: string) => {
    setSelectedId(id);
    if (window.matchMedia('(width < 768px)').matches) {
      listScrollPosition.current = window.scrollY;
      setMobileDetail(true);
    }
  };
  const backToQuestions = () => {
    returningToList.current = true;
    setMobileDetail(false);
  };
  return <div className={`gaps-page page-enter ${mobileDetail ? 'mobile-detail-open' : ''}`}>
    <div className="page-heading"><h1>Knowledge gaps</h1><p>Select a question. Read the evidence. Identify what needs clarification.</p></div>
    <div className="gaps-toolbar"><label className="list-search"><Search size={20} /><input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search questions" aria-label="Search knowledge gaps" /></label><label className="filter-label">Status<select value={status} onChange={e => setStatus(e.target.value)}><option value="OPEN">Open</option><option value="RESOLVED">Resolved</option><option value="ALL">All statuses</option></select></label><label className="filter-label">Category<select value={category} onChange={e => setCategory(e.target.value)}><option value="ALL">All categories</option>{Object.entries(categoryLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label></div>
    <div className="gap-workspace"><section className="gap-list-pane" aria-label="Knowledge gap list"><h2 className="list-caption">{filtered.length} demo {filtered.length === 1 ? 'question' : 'questions'}</h2><div className="gap-list">{filtered.map(gap => <button key={gap.id} ref={button => { if (button) questionButtons.current.set(gap.id, button); else questionButtons.current.delete(gap.id); }} className={`gap-list-item ${gap.id === selected?.id ? 'selected' : ''}`} aria-pressed={gap.id === selected?.id} onClick={() => selectQuestion(gap.id)}><span className="question-category">{categoryLabels[gap.category]}</span><span className="list-question">{gap.question}</span></button>)}{filtered.length === 0 && <div className="empty-state"><Search size={24} /><h2>No matching questions</h2><p>Try another phrase or clear your filters.</p><Button onClick={() => { setQuery(''); setCategory('ALL'); setStatus('ALL'); }}>Clear filters</Button></div>}</div></section>
    <section ref={detailRef} tabIndex={-1} className="evidence-pane" aria-label="Selected question" aria-live="polite"><Button variant="ghost" className="back-to-questions" onClick={backToQuestions}><ArrowLeft size={20} />Back to questions</Button>{selected ? <div key={selected.id}>
      <div className="evidence-topbar"><div className="question-context"><span>{categoryLabels[selected.category]}</span><span className="mobile-question-status">Status: {selected.status === 'OPEN' ? 'Open' : selected.status === 'RESOLVED' ? 'Resolved' : 'Dismissed'}</span></div><div className="panel-pagination"><span>{index + 1} of {filtered.length}</span><Button variant="ghost" className="icon-button" aria-label="Previous question" disabled={index <= 0} onClick={() => setSelectedId(filtered[index - 1].id)}><ArrowUp size={18} /></Button><Button variant="ghost" className="icon-button" aria-label="Next question" disabled={index >= filtered.length - 1} onClick={() => setSelectedId(filtered[index + 1].id)}><ArrowDown size={18} /></Button></div></div>
      <div className="evidence-content"><h2 className="detail-question">{selected.question}</h2><p className="detail-summary">{selected.summary}</p>
        <div className="next-action"><h3>Next: check the source evidence</h3><p>{selected.category === 'MISSING_OWNER' ? 'Look for a documented owner. If none is named, ask the outgoing team to clarify.' : selected.category === 'POTENTIAL_CONFLICT' ? 'Compare the policies and ask the outgoing team which source is current.' : selected.category === 'UNRESOLVED_DEPENDENCY' ? 'Check the dependency and identify the next action that needs confirmation.' : 'Compare the release notes and identify which stage needs clarification.'}</p><Button variant="primary" onClick={() => { if (evidenceRef.current) { evidenceRef.current.open = true; evidenceRef.current.querySelector('summary')?.focus(); evidenceRef.current.scrollIntoView({ block: 'nearest' }); } }}>Inspect evidence<ArrowDown size={18} /></Button></div>
        <details className="evidence-disclosure" ref={evidenceRef}><summary>Source evidence <span>{selected.evidence.length} {selected.evidence.length === 1 ? 'reference' : 'references'}</span></summary><div className="evidence-quotes">{selected.evidence.map(evidence => { const source = sources.find(s => s.id === evidence.sourceId)!; return <article className="evidence-card" key={source.id}><div className="evidence-card-heading"><SourceIcon type={source.type} /><h3>{source.filename}</h3></div><blockquote>{evidence.quote}</blockquote><button className="inline-link" onClick={() => onSource(source)}>Open full source<ArrowUpRight size={18} /></button></article>; })}</div></details>
        <p className="demo-notice">DEMO fixtures · These are sample questions and excerpts, not verified project facts. Clarifications and reviews will be available after API integration.</p>
      </div></div> : <div className="empty-state"><FileSearch size={28} /><h2>No question selected</h2><p>Adjust the filters to find a demo question.</p></div>}</section></div>
  </div>;
}
