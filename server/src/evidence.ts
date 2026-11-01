import type { Prisma, SourceType } from "./generated/prisma/client.js";

// Only navigation fields are serialized; source/document metadata stays private to its API.
export const evidenceDocument = { select: {
  id: true, projectId: true, sourceId: true, metadata: true,
  source: { select: { id: true, projectId: true, filename: true, type: true } },
} } satisfies Prisma.SourceDocumentDefaultArgs;
type EvidenceDocument = Prisma.SourceDocumentGetPayload<typeof evidenceDocument>;

function originalGitHubUrl(type: SourceType, metadata: Prisma.JsonValue): string | null {
  if (type !== "GITHUB" || !metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;
  const value = metadata.githubUrl;
  if (typeof value !== "string" || /[\u0000-\u0020\u007f]/.test(value)) return null;
  try {
    const url = new URL(value);
    return url.origin === "https://github.com" && !url.username && !url.password ? value : null;
  } catch { return null; }
}

export function evidenceReference(document: EvidenceDocument, projectId: string) {
  if (document.projectId !== projectId || document.source.projectId !== projectId) throw new Error("Invalid evidence project");
  const sourceUrl = `/api/projects/${projectId}/sources/${document.sourceId}`;
  return { sourceId: document.sourceId, filename: document.source.filename, sourceType: document.source.type,
    sourceUrl, documentUrl: `${sourceUrl}/documents/${document.id}`,
    githubUrl: originalGitHubUrl(document.source.type, document.metadata) };
}

export function withEvidenceReferences<T extends { evidence: ({ document: EvidenceDocument } & Record<string, unknown>)[] }>(claim: T, projectId: string) {
  return { ...claim, evidence: claim.evidence.map(({ document, ...evidence }) => ({ ...evidence, ...evidenceReference(document, projectId) })) };
}
