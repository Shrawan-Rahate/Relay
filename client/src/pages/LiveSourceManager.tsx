import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { Project, Source, SourceSummary } from '../../../shared/api-types';
import { Button, SourceIcon } from '../components/ui';
import type { RelayApi } from '../lib/api';
import { fileIssue, getSource, importSource, isSourceAccessError, listSources, repositoryIssue, sourceError } from '../lib/source-api';
import './live-sources.css';

type Props = { project: Project; api: RelayApi; refreshAccess: () => void };
// Remount immediately on membership scope changes so old data cannot flash in a new project/role.
export default function LiveSourceManager(props: Props) {
  return <SourceWorkspace key={`${props.project.id}:${props.project.role}`} {...props} />;
}
function SourceWorkspace({ project, api, refreshAccess }: Props) {
  const [sources, setSources] = useState<SourceSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState('');
  const [detail, setDetail] = useState<Source | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');
  const [selectedId, setSelectedId] = useState('');
  const [accessError, setAccessError] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [repository, setRepository] = useState('');
  const [importError, setImportError] = useState('');
  const [importing, setImporting] = useState(false);
  const [success, setSuccess] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);
  const lifetime = useRef(0), blocked = useRef(false), listRequest = useRef(0), detailRequest = useRef(0), mutation = useRef(false);
  const canImport = project.role === 'REVIEWER' || project.role === 'OUTGOING';
  const alive = (epoch: number) => lifetime.current === epoch && !blocked.current;
  const fail = (error: unknown, display: (message: string) => void) => {
    if (isSourceAccessError(error)) {
      blocked.current = true; ++lifetime.current; setSources([]); setDetail(null); setSuccess(''); setAccessError(sourceError(error));
    } else display(sourceError(error));
  };
  const load = async () => {
    const epoch = lifetime.current, request = ++listRequest.current;
    setLoading(true); setListError(''); setSources([]);
    try { const items = await listSources(api, project.id); if (alive(epoch) && request === listRequest.current) setSources(items); }
    catch (error) { if (alive(epoch) && request === listRequest.current) fail(error, setListError); }
    finally { if (alive(epoch) && request === listRequest.current) setLoading(false); }
  };
  useEffect(() => {
    ++lifetime.current; void load();
    return () => { ++lifetime.current; };
    // The keyed workspace owns one immutable project/role scope. API changes restart its requests.
  }, [api]);
  useEffect(() => {
    // A new Project object comes from a successful backend membership revalidation.
    if (blocked.current) {
      blocked.current = false; setAccessError(''); setSelectedId(''); setDetailError('');
      setDetailLoading(false); setImportError(''); setImporting(false); void load();
    }
  }, [project]);
  const open = async (id: string) => {
    const epoch = lifetime.current, request = ++detailRequest.current;
    setSelectedId(id); setDetail(null); setDetailError(''); setDetailLoading(true);
    try { const source = await getSource(api, project.id, id); if (alive(epoch) && request === detailRequest.current) setDetail(source); }
    catch (error) { if (alive(epoch) && request === detailRequest.current) fail(error, setDetailError); }
    finally { if (alive(epoch) && request === detailRequest.current) setDetailLoading(false); }
  };
  const submit = async (event: FormEvent, kind: 'file' | 'repository') => {
    event.preventDefault();
    if (!canImport || blocked.current || mutation.current) return;
    setSuccess(''); setImportError('');
    const value = repository.trim();
    const issue = kind === 'file' ? fileIssue(file) : repositoryIssue(value);
    if (issue) { setImportError(issue); return; }
    const epoch = lifetime.current;
    mutation.current = true; setImporting(true);
    try {
      const source = await importSource(api, project.id, kind === 'file' ? file! : value);
      if (!alive(epoch)) return;
      setSuccess(`Imported ${source.filename}.`);
      if (kind === 'file') { setFile(null); if (fileInput.current) fileInput.current.value = ''; } else setRepository('');
      await load();
    } catch (error) { if (alive(epoch)) fail(error, setImportError); }
    finally { mutation.current = false; if (alive(epoch)) setImporting(false); }
  };
  return <div className="feature-page live-sources">
    <div className="page-heading"><h1>Source Manager</h1><p>{project.name} · LIVE sources</p></div>
    {accessError ? <section><p role="alert" className="field-error">{accessError}</p><Button onClick={refreshAccess}>Refresh project access</Button></section> : <>
      {canImport ? <div className="import-layout">
        <section aria-labelledby="live-repository-title"><h2 id="live-repository-title">Public GitHub repository</h2><form onSubmit={event => void submit(event, 'repository')}>
          <label className="field-label" htmlFor="live-repository">Repository</label><input id="live-repository" className="text-input" value={repository} onChange={event => setRepository(event.target.value)} placeholder="owner/repo" maxLength={140} disabled={importing} autoCapitalize="none" autoCorrect="off" spellCheck={false} aria-describedby="live-repository-help" />
          <p id="live-repository-help" className="field-help">Public repositories only. Enter owner/repo; no URL or access token. This imports a bounded snapshot, not a continuous sync.</p><Button type="submit" disabled={importing}>Import repository</Button>
        </form></section>
        <section aria-labelledby="live-upload-title"><h2 id="live-upload-title">Upload a document</h2><form onSubmit={event => void submit(event, 'file')}>
          <label className="field-label" htmlFor="live-document">Document file</label><input ref={fileInput} id="live-document" type="file" accept=".md,.txt,.csv" disabled={importing} onChange={event => { setFile(event.target.files?.[0] ?? null); setImportError(''); setSuccess(''); }} aria-describedby="live-file-help" />
          <p id="live-file-help" className="field-help">One UTF-8 .md, .txt, or .csv file, up to 256 KiB. CSV requires a title column and 1–1000 rows with nonblank titles.</p><Button type="submit" disabled={importing}>Upload file</Button>
        </form></section>
      </div> : <p className="field-help">Read-only access. Reviewers and outgoing members can import sources.</p>}
      {importing && <p role="status">Importing source…</p>}{importError && <p role="alert" className="field-error">{importError}</p>}{success && <p role="status">{success}</p>}
      <section className="source-library" aria-labelledby="live-source-list"><div className="feature-section-heading"><h2 id="live-source-list">Project sources</h2><Button onClick={() => void load()} disabled={loading || importing}>Refresh sources</Button></div>
        {loading ? <p role="status">Loading sources…</p> : listError ? <p role="alert" className="field-error">{listError}</p> : sources.length === 0 ? <div className="empty-state"><h3>No sources yet</h3><p>No sources were returned for this project.</p></div> : <ul className="live-source-list">{sources.map(source => <li key={source.id}><button className="managed-source-row" aria-pressed={selectedId === source.id} onClick={() => void open(source.id)}><SourceIcon type={source.type} /><span><strong>{source.filename}</strong><span>{source.type} · {source._count.documents} documents · {source.byteSize} bytes</span></span></button><details><summary>Source provenance</summary><pre>{JSON.stringify(source.provenance, null, 2)}</pre></details></li>)}</ul>}
      </section>
      {selectedId && <section className="live-source-detail" aria-label="Source details" aria-busy={detailLoading}>
        <Button onClick={() => { ++detailRequest.current; setSelectedId(''); setDetail(null); setDetailError(''); setDetailLoading(false); }}>Close source details</Button>
        {detailLoading && <p role="status">Loading source details…</p>}{detailError && <><p role="alert" className="field-error">{detailError}</p><Button onClick={() => void open(selectedId)}>Retry source details</Button></>}
        {detail && <><h2>{detail.filename}</h2><p>{detail.documents.length} documents · {detail.byteSize} bytes</p><h3>Provenance</h3><pre>{JSON.stringify(detail.provenance, null, 2)}</pre><details><summary>Source metadata and hash</summary><pre>{JSON.stringify(detail.metadata, null, 2)}</pre><p>SHA-256: {detail.sha256}</p></details>
          <h3>Original source content</h3><pre>{detail.originalContent}</pre><h3>Original documents</h3>{detail.documents.length === 0 && <p>No documents returned for this source.</p>}
          {detail.documents.map(doc => <article key={doc.id}><h4>Document {doc.position}</h4><pre>{doc.content}</pre><details><summary>Document metadata and hash</summary><pre>{JSON.stringify(doc.metadata, null, 2)}</pre><p>SHA-256: {doc.sha256}</p></details></article>)}
        </>}
      </section>}
    </>}
  </div>;
}
