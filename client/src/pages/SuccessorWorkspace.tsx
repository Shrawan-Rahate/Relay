import { ArrowRight } from 'lucide-react';
import { Button } from '../components/ui';
import HandoverDocument from '../components/HandoverDocument';
import type { DemoSource } from '../data/demo';
import type { DemoHandoverVersion } from '../data/handovers';

export default function SuccessorWorkspace({ versions, selectedVersion, onSelect, acknowledgedVersions, onAcknowledge, onHandover, onSource, canPrepareHandover = true }: {
  canPrepareHandover?: boolean;
  versions: DemoHandoverVersion[]; selectedVersion: number | null; onSelect: (version: number) => void;
  acknowledgedVersions: number[]; onAcknowledge: (version: number) => void;
  onHandover: () => void; onSource: (source: DemoSource) => void;
}) {
  const selected = versions.find(version => version.version === selectedVersion) ?? versions.at(-1);
  const acknowledged = selected ? acknowledgedVersions.includes(selected.version) : false;
  return <div className="feature-page handover-page"><div className="page-heading"><h1>Successor Workspace</h1><p>Incoming view · Read the selected version before carrying it forward.</p></div><p className="feature-demo-note">DEMO · No server-published handover or receipt is loaded. You can read a frozen local publication preview and preview acknowledging that specific version. Nothing persists after reload.</p>
    {selected ? <><div className="handover-controls"><label className="filter-label">Selected handover preview<select value={selected.version} onChange={event => onSelect(Number(event.target.value))}>{[...versions].reverse().map(version => <option key={version.version} value={version.version}>DEMO v{version.version} · not published</option>)}</select></label><Button variant="primary" disabled={acknowledged} onClick={() => onAcknowledge(selected.version)}>{acknowledged ? `Acknowledgment previewed · v${selected.version}` : `Preview acknowledgment · v${selected.version}`}<ArrowRight size={18} /></Button></div>
    <div className="document-state"><h2>DEMO v{selected.version} · Frozen publication preview</h2><p>Publication status: not published. This document contains no reviewer-only reasons or answer history.</p></div>
    <div className="acknowledgment-status" role="status"><h3>Receipt status · v{selected.version}</h3><p>No server receipt exists in this demo.</p><p>{acknowledged ? `Local acknowledgment preview for DEMO v${selected.version} only. No receipt was created or sent.` : `DEMO v${selected.version} has no acknowledgment preview in this session.`}</p>{acknowledged && <span className="field-help">This version’s local preview is complete. Selecting another version keeps its acknowledgment separate.</span>}</div>
    <HandoverDocument content={selected.content} incoming onSource={onSource} /></> : <div className="successor-empty"><h2>No handover version to read yet</h2><p>No real published versions or receipts are supplied. A reviewer must prepare a handover before an incoming member can read it.</p><Button variant="primary" onClick={onHandover}>{canPrepareHandover ? 'Open handover preview' : 'Browse project overview'}<ArrowRight size={18} /></Button></div>}
  </div>;
}
