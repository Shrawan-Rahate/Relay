import { ArrowUpRight } from 'lucide-react';
import { SourceIcon } from './ui';
import { sources, type DemoSource } from '../data/demo';
import type { DemoAnswerEvidence } from '../data/clarifications';

export default function WorkflowEvidence({ evidence, onSource, label = 'Read linked evidence' }: { evidence: DemoAnswerEvidence[]; onSource: (source: DemoSource) => void; label?: string }) {
  return <details className="workflow-evidence"><summary>{label} ({evidence.length})</summary>{evidence.length === 0 ? <p>No evidence attached to this demo answer.</p> : evidence.map((item, index) => { const source = sources.find(source => source.id === item.sourceId)!; return <article className="workflow-quote" key={`${item.sourceId}-${index}`}><div className="evidence-card-heading"><SourceIcon type={source.type} /><h3>{source.filename}</h3></div><blockquote>{item.quote}</blockquote><button className="inline-link" onClick={() => onSource(source)}>Open full source<ArrowUpRight size={18} /></button></article>; })}</details>;
}
