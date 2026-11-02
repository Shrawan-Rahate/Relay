import type { Source, SourceSummary } from '../../../shared/api-types';
import { ApiError, type RelayApi } from './api';

const invalid = () => new ApiError(502, 'INVALID_RESPONSE', 'Relay returned invalid source data. Refresh sources to retry.');
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function base(projectId: string) {
  if (!uuid.test(projectId)) throw invalid();
  return `/api/projects/${encodeURIComponent(projectId)}/sources`;
}
function fields(source: SourceSummary | Source, projectId: string) {
  if (!source || !uuid.test(source.id) || source.projectId !== projectId || typeof source.filename !== 'string'
    || !['MARKDOWN', 'TXT', 'CSV', 'GITHUB'].includes(source.type) || !Number.isSafeInteger(source.byteSize) || source.byteSize < 0
    || typeof source.sha256 !== 'string' || source.provenance === undefined || source.metadata === undefined) throw invalid();
}
function sourceFrom(source: Source, projectId: string, sourceId?: string): Source {
  fields(source, projectId);
  if ((sourceId && source.id !== sourceId) || typeof source.originalContent !== 'string' || !Array.isArray(source.documents)
    || source.documents.some(doc => !doc || !uuid.test(doc.id) || doc.projectId !== projectId || doc.sourceId !== source.id
      || typeof doc.content !== 'string' || typeof doc.sha256 !== 'string' || !Number.isSafeInteger(doc.position) || doc.metadata === undefined)) throw invalid();
  return source;
}
export async function listSources(api: RelayApi, projectId: string) {
  const body = await api.request<{ sources: SourceSummary[] }>(base(projectId));
  if (!Array.isArray(body?.sources)) throw invalid();
  body.sources.forEach(source => {
    fields(source, projectId);
    if (!Number.isSafeInteger(source._count?.documents) || source._count.documents < 0) throw invalid();
  });
  return body.sources;
}
export async function getSource(api: RelayApi, projectId: string, sourceId: string) {
  if (!uuid.test(sourceId)) throw invalid();
  const body = await api.request<{ source: Source }>(`${base(projectId)}/${encodeURIComponent(sourceId)}`);
  return sourceFrom(body?.source, projectId, sourceId);
}
export async function importSource(api: RelayApi, projectId: string, input: File | string) {
  let body: FormData | string;
  if (typeof input === 'string') body = JSON.stringify({ repository: input });
  else { body = new FormData(); body.append('file', input); }
  const result = await api.request<{ source: Source }>(`${base(projectId)}${typeof input === 'string' ? '/github' : ''}`, { method: 'POST', body });
  return sourceFrom(result?.source, projectId);
}
export function fileIssue(file: File | null) {
  if (!file || !/\.(md|txt|csv)$/i.test(file.name)) return 'Choose one .md, .txt, or .csv file.';
  if (!file.size || file.size > 262144) return 'Choose a nonempty file no larger than 256 KiB.';
  if (file.name.length > 255 || /[/\\\u0000-\u001f\u007f]/.test(file.name)) return 'Use a filename of at most 255 characters without path separators or control characters.';
  return null;
}
export function repositoryIssue(value: string) {
  return /^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,37}[a-zA-Z0-9])?\/[a-zA-Z0-9_.-]{1,100}$/.test(value) && !value.endsWith('/.') && !value.endsWith('/..')
    ? null : 'Enter owner/repo, without a URL, spaces, or access token.';
}
export function isSourceAccessError(error: unknown) {
  return error instanceof ApiError && [401, 403, 404].includes(error.status)
    && !['GITHUB_NOT_FOUND', 'GITHUB_FORBIDDEN', 'PUBLIC_REPOSITORY_REQUIRED'].includes(error.code);
}
export function sourceError(error: unknown) {
  if (!(error instanceof ApiError)) return 'Source data could not be loaded. Please retry.';
  if (error.status === 404 && error.code === 'NOT_FOUND') return 'This source or project is unavailable, or your membership was removed. Refresh project access.';
  return `${error.message} (${error.code})`;
}
