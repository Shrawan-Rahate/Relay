import { useRef, useState, type FormEvent } from 'react';
import { ArrowRight, FileUp, Github, Search } from 'lucide-react';
import { Button, SourceIcon } from '../components/ui';
import { sources, type DemoSource } from '../data/demo';
import { importExamples, repositoryRequest, uploadIssue } from '../data/intelligence';

export default function SourceManager({ onSource, onAnalyze, readOnly = false }: { readOnly?: boolean; onSource: (source: DemoSource) => void; onAnalyze: () => void }) {
  const [repository, setRepository] = useState('');
  const [repoPreview, setRepoPreview] = useState<string | null>(null);
  const [repoError, setRepoError] = useState('');
  const [fileMessage, setFileMessage] = useState('');
  const [fileError, setFileError] = useState('');
  const [query, setQuery] = useState('');
  const [type, setType] = useState('ALL');
  const fileInput = useRef<HTMLInputElement>(null);
  const selectFile = (files: FileList | null) => {
    setFileMessage(''); setFileError('');
    if (!files?.length) return;
    if (files.length !== 1) { setFileError('Choose one file at a time.'); return; }
    const issue = uploadIssue(files[0]);
    if (issue) { setFileError(issue); return; }
    setFileMessage(`${files[0].name} selected locally. No content has been read or uploaded. Explore a fixed DEMO example below.`);
  };
  const previewRepository = (event: FormEvent) => {
    event.preventDefault();
    const request = repositoryRequest(repository);
    setRepoError(request ? '' : 'Enter owner/repo, without a URL, spaces, or access token.');
    setRepoPreview(request?.repository ?? null);
  };
  const filtered = sources.filter(source => (type === 'ALL' || source.type === type) && `${source.filename} ${source.description}`.toLowerCase().includes(query.toLowerCase()));
  return <div className="sources-page feature-page">
    <div className="page-heading"><h1>Source Manager</h1><p>Bring project context together before you analyze it.</p></div>
    <p className="feature-demo-note">DEMO · Source lists and previews are fixed examples. Nothing is imported or sent to a server.</p>
    {!readOnly && <div className="import-layout">
      <section aria-labelledby="repository-heading"><h2 id="repository-heading"><Github size={22} />GitHub repository</h2><p>Public repositories use the format owner/repo.</p><form onSubmit={previewRepository} noValidate><label className="field-label" htmlFor="repository">Repository</label><input id="repository" className="text-input" placeholder="owner/repo" value={repository} maxLength={140} aria-invalid={!!repoError} aria-describedby="repo-help repo-error" onChange={event => { setRepository(event.target.value); setRepoError(''); setRepoPreview(null); }} autoCapitalize="none" autoCorrect="off" spellCheck={false} /><p id="repo-help" className="field-help">This checks format locally. Repository availability and import require API integration.</p><Button type="submit">Preview import<ArrowRight size={18} /></Button><p id="repo-error" className="field-error" role="alert">{repoError}</p></form>{repoPreview && <div className="local-preview" role="status"><h3>Request preview only</h3><code>{repoPreview}</code><p>Format checked locally. No repository was contacted or imported.</p><button className="inline-link" onClick={() => onSource(sources[3])}>View unrelated DEMO repository source<ArrowRight size={18} /></button></div>}</section>
      <section aria-labelledby="upload-heading"><h2 id="upload-heading"><FileUp size={22} />Upload a document</h2><p>Markdown, TXT, or CSV · One file, up to 256 KiB.</p><div className="upload-area" onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); selectFile(event.dataTransfer.files); }}><FileUp size={28} /><p>Drop a file to check its type and size</p><Button onClick={() => fileInput.current?.click()}>Choose file</Button><input ref={fileInput} type="file" className="sr-only" tabIndex={-1} accept=".md,.markdown,.txt,.csv" aria-label="Choose a document for local format checks" onChange={event => { selectFile(event.target.files); event.target.value = ''; }} /><p className="field-help">Demo only. File contents are never read or uploaded.</p></div><p className="field-error" role="alert">{fileError}</p><p className="field-help" role="status">{fileMessage}</p><div className="sample-links"><span>Preview fixed DEMO files</span>{importExamples.map(example => <button className="inline-link" key={example.id} onClick={() => onSource(example)}>{example.label}<ArrowRight size={16} /></button>)}</div></section>
    </div>}
    <section className="source-library" aria-labelledby="source-list-heading"><div className="feature-section-heading"><h2 id="source-list-heading">Demo source library</h2>{!readOnly && <Button variant="primary" onClick={onAnalyze}>Go to AI Intelligence<ArrowRight size={18} /></Button>}</div><div className="gaps-toolbar"><label className="list-search"><Search size={20} /><input aria-label="Search demo sources" placeholder="Search sources" value={query} onChange={event => setQuery(event.target.value)} /></label><label className="filter-label">File type<select value={type} onChange={event => setType(event.target.value)}><option value="ALL">All types</option><option value="MARKDOWN">Markdown</option><option value="TXT">TXT</option><option value="CSV">CSV</option><option value="GITHUB">GitHub</option></select></label></div><div className="managed-source-list">{filtered.map(source => <button className="managed-source-row" key={source.id} onClick={() => onSource(source)}><SourceIcon type={source.type} /><span><strong>{source.filename}</strong><span>{source.description}</span></span><span className="source-kind">{source.type === 'MARKDOWN' ? 'Markdown' : source.type === 'GITHUB' ? 'GitHub' : source.type}</span><ArrowRight size={20} /><span className="sr-only">Open source details and linked evidence</span></button>)}</div>{filtered.length === 0 && <div className="empty-state"><h3>No matching demo sources</h3><p>Try another file type or search phrase.</p><Button onClick={() => { setQuery(''); setType('ALL'); }}>Clear filters</Button></div>}</section>
  </div>;
}
