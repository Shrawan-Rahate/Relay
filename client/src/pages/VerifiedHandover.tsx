import { useState } from 'react';
import { ArrowRight } from 'lucide-react';
import { Button } from '../components/ui';
import HandoverDocument from '../components/HandoverDocument';
import type { DemoSource } from '../data/demo';
import type { DemoHandoverVersion, HandoverPreviewContent } from '../data/handovers';

export default function VerifiedHandover({ content, versions, onPublishPreview, onSource, onReview, onSuccessor, canOpenSuccessor = true }: {
  canOpenSuccessor?: boolean;
  content: HandoverPreviewContent; versions: DemoHandoverVersion[];
  onPublishPreview: () => number; onSource: (source: DemoSource) => void;
  onReview: () => void; onSuccessor: (version: number) => void;
}) {
  const [selection, setSelection] = useState('current');
  const selected = versions.find(version => String(version.version) === selection);
  const documentContent = selected?.content ?? content;
  const publish = () => { setSelection(String(onPublishPreview())); };
  return <div className="feature-page handover-page"><div className="page-heading"><h1>Verified Handover</h1><p>Reviewer view · Keep reviewed context and uncertainty clearly separated.</p></div><p className="feature-demo-note">DEMO · No published handovers exist here. Review and publication previews are local only, disappear on reload, and do not create real approvals or published versions.</p>
    <div className="handover-controls"><label className="filter-label">Document view<select value={selection} onChange={event => setSelection(event.target.value)}><option value="current">Current review preview · not published</option>{[...versions].reverse().map(version => <option key={version.version} value={String(version.version)}>DEMO v{version.version} · publication preview</option>)}</select></label>{selected ? <Button variant="primary" onClick={() => canOpenSuccessor ? onSuccessor(selected.version) : setSelection('current')}>{canOpenSuccessor ? 'Open successor preview' : 'Prepare another preview'}<ArrowRight size={18} /></Button> : <Button variant="primary" onClick={publish}>Preview publication<ArrowRight size={18} /></Button>}</div>
    <div className="document-state" role="status"><h2>{selected ? `DEMO v${selected.version} · Publication preview` : 'Current review preview'}</h2><p>{selected ? 'Not published. This frozen local snapshot will not change when later review previews change.' : 'Not published. This preview updates from local APPROVE and EDIT decisions in Reviewer Queue.'}</p></div>
    {!selected && content.knowledge.length === 0 && <div className="handover-empty-guide"><p>There are no eligible review previews yet. You can inspect pending answers, or preview a handover containing only UNKNOWN questions.</p><button className="inline-link" onClick={onReview}>Open Reviewer Queue<ArrowRight size={18} /></button></div>}
    <HandoverDocument content={documentContent} onSource={onSource} />
    <section className="handover-history" aria-labelledby="version-history-heading"><h2 id="version-history-heading">Version history</h2><p className="field-help">Real published version history is unavailable until API integration. Entries below are session-only publication previews.</p>{versions.length === 0 ? <p className="document-empty">No publication previews created in this session.</p> : <ol>{[...versions].reverse().map(version => <li key={version.version}><button className="version-history-button" aria-current={selected?.version === version.version ? 'true' : undefined} onClick={() => setSelection(String(version.version))}><span>DEMO v{version.version}<span className="field-help">Publication preview · Not published</span></span><ArrowRight size={18} /></button></li>)}</ol>}</section>
  </div>;
}
