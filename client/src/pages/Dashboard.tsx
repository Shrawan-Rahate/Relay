import { ArrowRight } from 'lucide-react';
import { Button, SectionTitle, SourceIcon } from '../components/ui';
import { gaps, sources, project, type DemoSource } from '../data/demo';

export default function Dashboard({ onGaps, onSource }: { onGaps: () => void; onSource: (source: DemoSource) => void }) {
  const openGaps = gaps.filter(gap => gap.status === 'OPEN');
  return <div className="dashboard page-enter">
    <div className="page-heading"><h1>{project.name}</h1><p>Prepare the next team to take over with confidence.</p></div>
    <section className="handover-banner" aria-labelledby="handover-title"><div><h2 id="handover-title">Start with the unanswered questions</h2><p>Explore {openGaps.length} demo questions and the source material behind them.</p></div><Button variant="primary" onClick={onGaps}>Review open questions<ArrowRight size={20} /></Button></section>
    <div className="overview-strip" aria-label="Demo fixture counts"><div><strong>{sources.length}</strong><span>Demo sources</span></div><div><strong>{openGaps.length}</strong><span>Open demo questions</span></div><div><strong>{gaps.reduce((count, gap) => count + gap.evidence.length, 0)}</strong><span>Evidence references</span></div></div>
    <section className="journey-panel"><SectionTitle title="Your handover, step by step" /><p className="section-description">A guide to the workflow. No live processing or review has taken place.</p><ol className="journey">
      <li><span className="step">1</span><div><h3>Connect sources</h3><p>Bring together documents and repository context.</p><details className="source-disclosure"><summary>Browse demo sources</summary><div className="source-table">{sources.map(source => <button key={source.id} onClick={() => onSource(source)} className="source-row"><SourceIcon type={source.type} /><span>{source.filename}</span><ArrowRight size={16} /></button>)}</div></details></div></li>
      <li><span className="step">2</span><div><h3>Reconstruct context</h3><p>Extract claims and keep each one linked to its source. Claims remain unverified.</p></div></li>
      <li className="current"><span className="step">3</span><div><h3>Clarify & review</h3><p>Explore open questions, inspect evidence, and identify what needs clarification.</p><span className="step-note">Start here in this demo</span></div></li>
      <li><span className="step">4</span><div><h3>Hand it over</h3><p>Publish reviewed knowledge with unresolved questions clearly separated.</p></div></li>
    </ol></section>
  </div>;
}
