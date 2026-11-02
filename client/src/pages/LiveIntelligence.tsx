import { useEffect, useRef, useState } from 'react';
import type { ExtractionRunDetail, ListedClaim, Source, SourceDocument, SourceSummary } from '../../../shared/api-types';
import { Button } from '../components/ui';
import { LiveWorkflowBoundary, Provenance, useWorkflowTicket, WorkflowError, type WorkflowContext, type WorkflowProps } from '../components/LiveWorkflow';
import { ClaimGroups } from '../components/LiveClaimEvidence';
import { getSource, listSources } from '../lib/source-api';
import { extractClaims, fetchClaims } from '../lib/workflow-api';

export default function LiveIntelligence(props: WorkflowProps) {
  return <LiveWorkflowBoundary {...props}>{context => <IntelligenceWorkspace context={context} />}</LiveWorkflowBoundary>;
}
function IntelligenceWorkspace({ context }: { context: WorkflowContext }) {
  const [selected, setSelected] = useState<Record<string, SourceDocument>>({});
  const [pickerVersion, setPickerVersion] = useState(0), [claimsVersion, setClaimsVersion] = useState(0);
  const [run, setRun] = useState<ExtractionRunDetail | null>(null), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const submitting = useRef(false), ticket = useWorkflowTicket();
  const canExtract = context.project.role === 'REVIEWER' || context.project.role === 'OUTGOING';
  const documents = Object.values(selected);
  const bytes = documents.reduce((sum, doc) => sum + new TextEncoder().encode(doc.content).length, 0);
  const valid = documents.length > 0 && documents.length <= 20 && bytes <= 100_000;
  const extract = async () => {
    if (!canExtract || !valid || submitting.current) return;
    const current = ticket(); submitting.current = true; setBusy(true); setError(''); setRun(null);
    try { const value = await extractClaims(context.api, context.project.id, documents.map(doc => doc.id)); if (current()) setRun(value); }
    catch (error) { if (current()) context.fail(error, setError); }
    finally { submitting.current = false; if (current()) setBusy(false); }
  };
  return <div className="feature-page live-workflow"><div className="page-heading"><h1>AI Intelligence</h1><p>{context.project.name} · LIVE</p></div>
    <p>AI claims are UNVERIFIED. Extraction does not approve facts or replace human review.</p>
    {canExtract ? <section aria-labelledby="document-selection"><h2 id="document-selection">Choose source documents</h2>
      <DocumentPicker key={pickerVersion} context={context} selected={selected} disabled={busy} onSelect={(doc, checked) => setSelected(previous => { const next = { ...previous }; if (checked) next[doc.id] = doc; else delete next[doc.id]; return next; })} />
      <div className="workflow-actions"><Button disabled={busy} onClick={() => { setSelected({}); setPickerVersion(value => value + 1); }}>Refresh source documents</Button><Button variant="primary" disabled={!valid || busy} onClick={() => void extract()}>Extract claims</Button></div>
      <p className="field-help">{documents.length} documents selected · {bytes} UTF-8 bytes. Maximum 20 documents and 100,000 bytes. Extraction can take up to 30 seconds.</p>
      {!valid && documents.length > 0 && <p role="alert">Select no more than 20 documents totaling at most 100,000 UTF-8 bytes.</p>}
    </section> : <p>Read-only access. Only reviewers and outgoing members can extract claims.</p>}
    {busy && <p role="status">Extracting claims… Waiting for the backend result.</p>}<WorkflowError message={error} />
    <div className="workflow-actions"><Button disabled={busy} onClick={() => { setRun(null); setClaimsVersion(value => value + 1); }}>Refresh project claims</Button></div>
    {run ? <section aria-labelledby="extraction-result"><h2 id="extraction-result">Latest extraction result</h2><p role="status">{run.claims.length ? 'Extraction succeeded.' : 'Extraction succeeded with no claims.'}</p>
      <p>Run: {run.id} · Provider: {run.provider} · Model: {run.model} · Version: {run.modelVersion ?? 'Not supplied'}</p><Provenance value={run.provenance} />
      <ClaimGroups context={context} claims={run.claims.map(claim => ({ ...claim, run: { provider: run.provider, model: run.model, modelVersion: run.modelVersion, provenance: run.provenance } }))} />
    </section> : <ClaimsBrowser key={claimsVersion} context={context} />}
  </div>;
}
function DocumentPicker({ context, selected, disabled, onSelect }: { context: WorkflowContext; selected: Record<string, SourceDocument>; disabled: boolean; onSelect: (doc: SourceDocument, checked: boolean) => void }) {
  const [sources, setSources] = useState<SourceSummary[]>([]), [error, setError] = useState(''), [loading, setLoading] = useState(true);
  const ticket = useWorkflowTicket();
  const load = async () => {
    const current = ticket(); setLoading(true); setError(''); setSources([]);
    try { const values = await listSources(context.api, context.project.id); if (current()) setSources(values); }
    catch (error) { if (current()) context.fail(error, setError); }
    finally { if (current()) setLoading(false); }
  };
  useEffect(() => { void load(); }, []);
  return <>{loading ? <p role="status">Loading project sources…</p> : error ? <WorkflowError message={error} retry={() => void load()} /> : !sources.length ? <p>No sources are available. Import source material in Source Manager.</p> : sources.map(source => <SourceDocuments key={source.id} source={source} context={context} selected={selected} disabled={disabled} onSelect={onSelect} />)}</>;
}
function SourceDocuments({ source, context, selected, disabled, onSelect }: { source: SourceSummary; context: WorkflowContext; selected: Record<string, SourceDocument>; disabled: boolean; onSelect: (doc: SourceDocument, checked: boolean) => void }) {
  const [detail, setDetail] = useState<Source | null>(null), [error, setError] = useState(''), [loading, setLoading] = useState(false);
  const ticket = useWorkflowTicket();
  const load = async () => {
    const current = ticket(); setLoading(true); setError('');
    try { const value = await getSource(context.api, context.project.id, source.id); if (current()) setDetail(value); }
    catch (error) { if (current()) context.fail(error, setError); }
    finally { if (current()) setLoading(false); }
  };
  return <section><h3>{source.filename}</h3><p>{source._count.documents} documents</p>
    {!detail && <Button disabled={disabled || loading} onClick={() => void load()}>Load documents from {source.filename}</Button>}
    {loading && <p role="status">Loading documents…</p>}<WorkflowError message={error} />
    {detail && <fieldset disabled={disabled}><legend>{source.filename} documents</legend>{detail.documents.length === 0 && <p>No documents returned for this source.</p>}{detail.documents.map(doc => <div key={doc.id}>
      <label className="document-choice"><input type="checkbox" checked={!!selected[doc.id]} onChange={event => onSelect(doc, event.target.checked)} /><span>{source.filename} · Document {doc.position}</span></label>
      <details><summary>Read document {doc.position}</summary><pre>{doc.content}</pre><Provenance value={doc.metadata} /></details>
    </div>)}</fieldset>}
  </section>;
}
function ClaimsBrowser({ context }: { context: WorkflowContext }) {
  const [history, setHistory] = useState<(string | undefined)[]>([undefined]);
  const cursor = history[history.length - 1];
  return <section><h2>Stored project claims</h2><p>Page {history.length}. These are stored claims, not the result of a pending extraction.</p>
    <ClaimsPage key={cursor ?? 'first'} context={context} cursor={cursor} previous={history.length > 1 ? () => setHistory(items => items.slice(0, -1)) : undefined} next={value => setHistory(items => [...items, value])} />
  </section>;
}
function ClaimsPage({ context, cursor, previous, next }: { context: WorkflowContext; cursor?: string; previous?: () => void; next: (cursor: string) => void }) {
  const [claims, setClaims] = useState<ListedClaim[]>([]), [nextCursor, setNextCursor] = useState<string | null>(null), [loading, setLoading] = useState(true), [error, setError] = useState('');
  const ticket = useWorkflowTicket();
  const load = async () => {
    const current = ticket(); setLoading(true); setError(''); setClaims([]); setNextCursor(null);
    try { const result = await fetchClaims(context.api, context.project.id, cursor); if (current()) { setClaims(result.claims); setNextCursor(result.nextCursor); } }
    catch (error) { if (current()) context.fail(error, setError); }
    finally { if (current()) setLoading(false); }
  };
  useEffect(() => { void load(); }, []);
  return <>{loading ? <p role="status">Loading claims…</p> : error ? <WorkflowError message={error} retry={() => void load()} /> : <>{claims.length ? <ClaimGroups claims={claims} context={context} /> : <p>No claims on this page.</p>}</>}
    <div className="workflow-actions"><Button disabled={!previous || loading} onClick={previous}>Previous claims page</Button><Button disabled={!nextCursor || loading} onClick={() => nextCursor && next(nextCursor)}>Next claims page</Button></div>
  </>;
}
