import { useEffect, useRef, useState } from 'react';
import { ArrowRight, ArrowUpRight, LoaderCircle, Search } from 'lucide-react';
import { Badge, Button, SourceIcon } from '../components/ui';
import { sources, type DemoSource } from '../data/demo';
import { claimGroups, demoClaims } from '../data/intelligence';

type PreviewState = 'idle' | 'loading' | 'claims' | 'empty' | 'error';
export default function Intelligence({ onSource, onSources }: { onSource: (source: DemoSource) => void; onSources: () => void }) {
  const [state, setState] = useState<PreviewState>('idle');
  const [selected, setSelected] = useState(() => sources.map(source => source.id));
  const [query, setQuery] = useState('');
  const [resultSources, setResultSources] = useState<string[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const setPreview = (next: PreviewState) => {
    if (timer.current) clearTimeout(timer.current);
    setResultSources([...selected]); setState(next);
  };
  const analyze = () => {
    setPreview('loading');
    timer.current = setTimeout(() => setState('claims'), 650);
  };
  const visibleClaims = demoClaims.filter(claim => resultSources.includes(claim.sourceId) && claim.text.toLowerCase().includes(query.toLowerCase()));
  return <div className="intelligence-page feature-page">
    <div className="page-heading"><h1>AI Intelligence</h1><p>Trace every claim back to its source before trusting it.</p></div>
    <p className="feature-demo-note">DEMO · Analyze Sources opens a fixed claim preview. No AI model runs, no extraction is saved, and no claims are verified.</p>
    <section className="analysis-setup" aria-labelledby="analysis-heading"><h2 id="analysis-heading">Choose source material</h2><p>Each demo source represents one sample document.</p><fieldset className="analysis-source-list" disabled={state === 'loading'}><legend className="sr-only">Select demo documents for the claim preview</legend>{sources.map(source => <label key={source.id}><input type="checkbox" checked={selected.includes(source.id)} onChange={event => { const checked = event.target.checked; setSelected(current => checked ? [...current, source.id] : current.filter(id => id !== source.id)); setState('idle'); }} /><SourceIcon type={source.type} /><span>{source.filename}</span></label>)}</fieldset><div className="analysis-actions"><Button variant="primary" disabled={selected.length === 0 || state === 'loading'} onClick={analyze}>{state === 'loading' ? <LoaderCircle size={20} className="loading-spinner" /> : null}{state === 'loading' ? 'Loading demo preview…' : 'Analyze Sources'}</Button><span className="field-help">{selected.length} demo {selected.length === 1 ? 'document' : 'documents'} selected</span></div>{selected.length === 0 && <p className="field-help" role="status">Select at least one document to preview claims.</p>}</section>
    <section className="analysis-results" aria-labelledby="claims-heading" aria-busy={state === 'loading'}><div className="feature-section-heading"><h2 id="claims-heading">Source claims</h2><label className="filter-label">DEMO state preview<select value={state} onChange={event => setPreview(event.target.value as PreviewState)}><option value="idle">Not analyzed</option><option value="loading">Loading example</option><option value="claims">Claim examples</option><option value="empty">Empty result example</option><option value="error">Error example</option></select></label></div>
      <div role="status" className="analysis-state-message">{state === 'idle' && <><h3>Start with your sources</h3><p>Select demo documents, then choose Analyze Sources to explore unverified claim examples.</p><button className="inline-link" onClick={onSources}>Browse source material<ArrowRight size={18} /></button></>}{state === 'loading' && <><h3>DEMO loading state</h3><p>Preparing the fixture preview. No analysis or background job is running.</p><Button onClick={() => setPreview('idle')}>Cancel preview</Button></>}{state === 'empty' && <><h3>DEMO: no claims returned</h3><p>An analysis can return no claims. Check the selected documents and try different source material.</p><Button onClick={onSources}>Browse sources</Button></>}{state === 'claims' && <p>DEMO claim examples · Provider and model: none. These fixtures were authored for the interface.</p>}</div>
      {state === 'error' && <div className="analysis-error" role="alert"><h3>DEMO error: analysis unavailable</h3><p>This is an error-state example, not a failed API request. No claims were generated or verified.</p><Button disabled={selected.length === 0} onClick={analyze}>Retry demo preview</Button></div>}
      {state === 'claims' && <><label className="list-search claim-search"><Search size={20} /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search claim examples" aria-label="Search demo claims" /></label>{claimGroups.map(group => { const claims = visibleClaims.filter(claim => claim.type === group.type); return <section className="claim-group" key={group.type} aria-labelledby={`group-${group.type}`}><h3 id={`group-${group.type}`}>{group.label}<span>{claims.length}</span></h3>{claims.length === 0 ? <p className="field-help">No matching {group.label.toLowerCase()} claim examples for this selection.</p> : claims.map(claim => { const source = sources.find(source => source.id === claim.sourceId)!; return <article className="claim-item" key={claim.id}><Badge>{claim.status}</Badge><p>{claim.text}</p><details className="claim-evidence"><summary>View source evidence</summary><div className="evidence-card-heading"><SourceIcon type={source.type} /><h3>{source.filename}</h3></div><blockquote>{claim.quote}</blockquote><button className="inline-link" onClick={() => onSource(source)}>Open full source<ArrowUpRight size={18} /></button></details></article>; })}</section>; })}</>}
    </section>
  </div>;
}
