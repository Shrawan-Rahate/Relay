import type { JsonValue } from '../../../shared/api-types';
import { Badge } from './ui';
import { Provenance } from './LiveWorkflow';

function record(value: JsonValue | undefined): Record<string, JsonValue> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : null;
}
export default function FrozenEvidence({ claimId, value }: { claimId: string; value: JsonValue }) {
  const data = record(value);
  const evidence = Array.isArray(data?.evidence) ? data.evidence.map(record).filter((item): item is Record<string, JsonValue> => !!item && typeof item.quote === 'string' && typeof item.documentId === 'string') : [];
  return <article className="live-evidence"><h4>Claim {claimId}</h4>{data?.claimStatus === 'UNVERIFIED' && <Badge>UNVERIFIED</Badge>}
    {typeof data?.claimText === 'string' && <p className="preserve-text">{data.claimText}</p>}
    {evidence.length ? evidence.map((item, index) => <div key={index}><p>Document: {String(item.documentId)}</p><blockquote>{String(item.quote)}</blockquote><Provenance value={item} /></div>) : <p>Structured evidence quotes are unavailable for this link. Inspect the recorded provenance below.</p>}
    <Provenance value={value} />
  </article>;
}
