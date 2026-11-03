import { useEffect, useRef, useState } from 'react';
import type { GapCategory, GapQuery, GapStatus, KnowledgeGap } from '../../../shared/api-types';
import { Button } from '../components/ui';
import { LiveWorkflowBoundary, Provenance, useWorkflowTicket, WorkflowError, type WorkflowContext, type WorkflowProps } from '../components/LiveWorkflow';
import FrozenEvidence from '../components/LiveGapEvidence';
import { fetchGap, fetchGaps, gapCategories, scanGaps } from '../lib/workflow-api';

export default function LiveKnowledgeGaps(props: WorkflowProps) {
  return <LiveWorkflowBoundary {...props}>{context => <GapsWorkspace context={context} />}</LiveWorkflowBoundary>;
}
function GapsWorkspace({ context }: { context: WorkflowContext }) {
  const [status, setStatus] = useState<GapStatus | ''>('OPEN'), [category, setCategory] = useState<GapCategory | ''>('');
  const [version, setVersion] = useState(0), [scanning, setScanning] = useState(false), [message, setMessage] = useState(''), [error, setError] = useState('');
  const submitting = useRef(false), ticket = useWorkflowTicket();
  const canScan = context.project.role === 'REVIEWER' || context.project.role === 'OUTGOING';
  const scan = async () => {
    if (!canScan || submitting.current) return;
    const current = ticket(); submitting.current = true; setScanning(true); setMessage(''); setError('');
    try { const result = await scanGaps(context.api, context.project.id); if (current()) { setMessage(`Scan completed: ${result.createdCount} created, ${result.existingCount} existing, ${result.scannedClaimCount} claims scanned.`); setVersion(value => value + 1); } }
    catch (error) { if (current()) context.fail(error, setError); }
    finally { submitting.current = false; if (current()) setScanning(false); }
  };
  return <div className="feature-page live-workflow"><div className="page-heading"><h1>Knowledge gaps</h1><p>{context.project.name} · LIVE</p></div>
    <p>Findings express uncertainty. A resolved gap does not make its linked AI claims human-approved.</p>
    <div className="workflow-actions">{canScan ? <Button variant="primary" disabled={scanning} onClick={() => void scan()}>Scan knowledge gaps</Button> : <p>Read-only access. Only reviewers and outgoing members can scan.</p>}<Button disabled={scanning} onClick={() => setVersion(value => value + 1)}>Refresh gaps</Button></div>
    {scanning && <p role="status">Scanning knowledge gaps… Waiting for the backend result.</p>}{message && <p role="status">{message}</p>}<WorkflowError message={error} />
    <div className="gaps-toolbar"><label className="filter-label">Status<select value={status} onChange={event => setStatus(event.target.value as GapStatus | '')}><option value="">All statuses</option><option value="OPEN">Open</option><option value="RESOLVED">Resolved</option><option value="DISMISSED">Dismissed</option></select></label>
      <label className="filter-label">Category<select value={category} onChange={event => setCategory(event.target.value as GapCategory | '')}><option value="">All categories</option>{gapCategories.map(value => <option key={value} value={value}>{value.replaceAll('_', ' ')}</option>)}</select></label></div>
    <GapsBrowser key={`${status}:${category}:${version}`} context={context} filters={{ status: status || undefined, category: category || undefined }} />
  </div>;
}
function GapsBrowser({ context, filters }: { context: WorkflowContext; filters: GapQuery }) {
  const [history, setHistory] = useState<(string | undefined)[]>([undefined]);
  const cursor = history[history.length - 1];
  return <section><h2>Project gaps</h2><p>Page {history.length}. No project-wide total is supplied by the backend.</p><GapsPage key={cursor ?? 'first'} context={context} filters={{ ...filters, cursor }} previous={history.length > 1 ? () => setHistory(items => items.slice(0, -1)) : undefined} next={value => setHistory(items => [...items, value])} /></section>;
}
function GapsPage({ context, filters, previous, next }: { context: WorkflowContext; filters: GapQuery; previous?: () => void; next: (cursor: string) => void }) {
  const [gaps, setGaps] = useState<KnowledgeGap[]>([]), [nextCursor, setNextCursor] = useState<string | null>(null), [loading, setLoading] = useState(true), [error, setError] = useState(''), [selected, setSelected] = useState('');
  const ticket = useWorkflowTicket();
  const load = async () => {
    const current = ticket(); setLoading(true); setError(''); setGaps([]); setNextCursor(null); setSelected('');
    try { const value = await fetchGaps(context.api, context.project.id, filters); if (current()) { setGaps(value.gaps); setNextCursor(value.nextCursor); } }
    catch (error) { if (current()) context.fail(error, setError); }
    finally { if (current()) setLoading(false); }
  };
  useEffect(() => { void load(); }, []);
  return <>{loading ? <p role="status">Loading gaps…</p> : error ? <WorkflowError message={error} retry={() => void load()} /> : gaps.length === 0 ? <p>No gaps on this page.</p> : <div>{gaps.map(gap => <Button className="gap-list-item" key={gap.id} aria-pressed={selected === gap.id} onClick={() => setSelected(gap.id)}><span>{gap.category.replaceAll('_', ' ')} · {gap.status}</span><span className="list-question">{gap.question}</span></Button>)}</div>}
    <div className="workflow-actions"><Button disabled={!previous || loading} onClick={previous}>Previous gaps page</Button><Button disabled={!nextCursor || loading} onClick={() => nextCursor && next(nextCursor)}>Next gaps page</Button></div>
    {selected && <GapDetail key={selected} context={context} gapId={selected} close={() => setSelected('')} />}
  </>;
}
function GapDetail({ context, gapId, close }: { context: WorkflowContext; gapId: string; close: () => void }) {
  const [gap, setGap] = useState<KnowledgeGap | null>(null), [error, setError] = useState(''), [loading, setLoading] = useState(true);
  const ticket = useWorkflowTicket(), heading = useRef<HTMLHeadingElement>(null);
  const load = async () => {
    const current = ticket(); setLoading(true); setGap(null); setError('');
    try { const value = await fetchGap(context.api, context.project.id, gapId); if (current()) setGap(value); }
    catch (error) { if (current()) context.fail(error, setError); }
    finally { if (current()) setLoading(false); }
  };
  useEffect(() => { void load(); }, []);
  useEffect(() => { if (gap) heading.current?.focus(); }, [gap]);
  return <section className="workflow-detail" aria-label="Gap details"><Button onClick={close}>Close gap details</Button>
    {loading && <p role="status">Loading gap details…</p>}<WorkflowError message={error} retry={() => void load()} />
    {gap && <><h2 ref={heading} tabIndex={-1}>{gap.question}</h2><p>{gap.category.replaceAll('_', ' ')} · {gap.status}</p><Provenance value={gap.provenance} />
      <h3>Linked claim evidence</h3><p>These quotes and provenance were recorded when the claims were linked to this gap. They are not human approval.</p>
      {gap.claimLinks.length === 0 && <p>No linked evidence was returned.</p>}
      {gap.claimLinks.map(link => <FrozenEvidence key={link.claimId} claimId={link.claimId} value={link.provenance} />)}
    </>}
  </section>;
}
