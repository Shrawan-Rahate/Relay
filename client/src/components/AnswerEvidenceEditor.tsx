import { useEffect, useRef, useState } from 'react';
import type { Source, SourceDocument, SourceSummary } from '../../../shared/api-types';
import { Button } from './ui';
import { useWorkflowTicket, WorkflowError, type WorkflowContext } from './LiveWorkflow';
import { getSource, listSources } from '../lib/source-api';
export type EvidenceDraft = { key: number; document: SourceDocument | null; quote: string };
export default function AnswerEvidenceEditor({ context, rows, disabled, update, remove }: { context: WorkflowContext; rows: EvidenceDraft[]; disabled: boolean; update: (key: number, patch: Partial<EvidenceDraft>) => void; remove: (key: number) => void }) {
  const [sources, setSources] = useState<SourceSummary[]>([]), [loading, setLoading] = useState(true), [error, setError] = useState('');
  const ticket = useWorkflowTicket();
  const load = async () => {
    const current = ticket(); setLoading(true); setError('');
    try { const result = await listSources(context.api, context.project.id); if (current()) setSources(result); }
    catch (error) { if (current()) context.fail(error, setError); }
    finally { if (current()) setLoading(false); }
  };
  useEffect(() => { void load(); }, []);
  return <fieldset disabled={disabled}><legend>Optional evidence</legend>{loading && <p role="status">Loading evidence sources…</p>}<WorkflowError message={error} retry={() => void load()} />
    {!loading && !error && sources.length === 0 && <p>No sources available. Remove evidence entries to submit without evidence.</p>}
    {rows.map((row, index) => <EvidenceRow key={row.key} row={row} index={index + 1} sources={sources} context={context} update={patch => update(row.key, patch)} remove={() => remove(row.key)} />)}
  </fieldset>;
}
function EvidenceRow({ row, index, sources, context, update, remove }: { row: EvidenceDraft; index: number; sources: SourceSummary[]; context: WorkflowContext; update: (patch: Partial<EvidenceDraft>) => void; remove: () => void }) {
  const [sourceId, setSourceId] = useState(''), [detail, setDetail] = useState<Source | null>(null), [loading, setLoading] = useState(false), [error, setError] = useState('');
  const ticket = useWorkflowTicket(), sequence = useRef(0);
  const load = async (id: string) => {
    const current = ticket(), request = ++sequence.current; setSourceId(id); setDetail(null); setError(''); update({ document: null });
    if (!id) { setLoading(false); return; }
    setLoading(true);
    try { const value = await getSource(context.api, context.project.id, id); if (current() && sequence.current === request) setDetail(value); }
    catch (error) { if (current() && sequence.current === request) context.fail(error, setError); }
    finally { if (current() && sequence.current === request) setLoading(false); }
  };
  return <div className="live-evidence"><label className="field-label" htmlFor={`evidence-source-${row.key}`}>Evidence source {index}</label><select id={`evidence-source-${row.key}`} className="text-input" value={sourceId} onChange={event => void load(event.target.value)}><option value="">Choose a source</option>{sources.map(source => <option key={source.id} value={source.id}>{source.filename}</option>)}</select>
    {loading && <p role="status">Loading evidence documents…</p>}<WorkflowError message={error} retry={() => void load(sourceId)} />
    {detail && <><label className="field-label" htmlFor={`evidence-document-${row.key}`}>Evidence document {index}</label><select id={`evidence-document-${row.key}`} className="text-input" value={row.document?.id ?? ''} onChange={event => update({ document: detail.documents.find(doc => doc.id === event.target.value) ?? null })}><option value="">Choose a document</option>{detail.documents.map(doc => <option key={doc.id} value={doc.id}>Document {doc.position} · {doc.id}</option>)}</select><Button type="button" onClick={() => void load(sourceId)}>Reload evidence document {index}</Button></>}
    {row.document && <details><summary>Read selected document {index}</summary><p>Document ID: {row.document.id}</p><pre>{row.document.content}</pre></details>}
    <label className="field-label" htmlFor={`evidence-quote-${row.key}`}>Exact quote {index}</label><textarea className="text-input" id={`evidence-quote-${row.key}`} rows={3} maxLength={4000} value={row.quote} onChange={event => update({ quote: event.target.value })} />
    <Button type="button" onClick={remove}>Remove evidence {index}</Button>
  </div>;
}
