import { Octokit } from "@octokit/rest";
import { z } from "zod";
import type { Prisma } from "./generated/prisma/client.js";
import { IngestionError, sha256 } from "./ingestion.js";

export type GitHubOptions = { githubFetch?: typeof fetch };
const PER_PAGE = 20;
const MAX_PAGES = 2;
const MAX_RESPONSE = 1024 * 1024;
const unavailable = () => new IngestionError(502, "GITHUB_UNAVAILABLE", "GitHub could not complete the import");
const tooLarge = () => new IngestionError(413, "GITHUB_IMPORT_TOO_LARGE", "GitHub import exceeds size limits");
const repositoryInput = z.object({
  repository: z.string().regex(/^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,37}[a-zA-Z0-9])?\/[a-zA-Z0-9_.-]{1,100}$/)
    .refine(value => ![".", ".."].includes(value.split("/")[1]!)),
}).strict();
const githubUrl = z.string().refine(value => {
  try { const u = new URL(value); return u.origin === "https://github.com" && !u.username && !u.password; } catch { return false; }
});
const author = z.object({ login: z.string() }).loose().nullable().optional();
const repositoryShape = z.object({ id: z.number(), full_name: z.string(), private: z.boolean(), html_url: githubUrl, size: z.number().nonnegative(), visibility: z.string().optional() }).loose();
const readmeShape = z.object({ name: z.string(), path: z.string(), sha: z.string(), html_url: githubUrl, content: z.string(), encoding: z.literal("base64"), size: z.number().nonnegative() }).loose();
const itemShape = z.object({
  id: z.number(), number: z.number(), title: z.string(), body: z.string().nullable().optional(),
  html_url: githubUrl, user: author, state: z.string(),
  created_at: z.string(), updated_at: z.string(), closed_at: z.string().nullable().optional(),
  merged_at: z.string().nullable().optional(), pull_request: z.unknown().optional(),
}).loose();
const identity = z.object({ name: z.string().nullable().optional(), email: z.string().nullable().optional(), date: z.string().nullable().optional() }).loose().nullable().optional();
const commitShape = z.object({
  sha: z.string(), html_url: githubUrl, author, committer: author,
  commit: z.object({ message: z.string(), author: identity, committer: identity }).loose(),
}).loose();
type Item = z.infer<typeof itemShape>;
type Commit = z.infer<typeof commitShape>;
type Document = { position: number; content: string; sha256: string; metadata: Prisma.InputJsonObject };

function json(value: unknown): Prisma.InputJsonObject {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonObject;
}

function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) => item && typeof item === "object" && !Array.isArray(item)
    ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);
}

function statusOf(error: unknown): number | undefined {
  return error && typeof error === "object" && "status" in error && typeof error.status === "number" ? error.status : undefined;
}

function safeError(error: unknown): IngestionError {
  if (error instanceof IngestionError) return error;
  if (error && typeof error === "object" && "cause" in error && error.cause instanceof IngestionError) return error.cause;
  const status = statusOf(error);
  const response = (error as { response?: { headers?: Record<string, string>; data?: { message?: unknown } } } | null)?.response;
  const headers = response?.headers;
  const rateMessage = typeof response?.data?.message === "string" && /rate limit|abuse detection/i.test(response.data.message);
  if (status === 429 || (status === 403 && (headers?.["x-ratelimit-remaining"] === "0" || headers?.["retry-after"] || rateMessage))) {
    return new IngestionError(429, "GITHUB_RATE_LIMITED", "GitHub rate limit reached. Try again later.");
  }
  if (status === 404) return new IngestionError(404, "GITHUB_NOT_FOUND", "Public GitHub repository not found");
  if (status === 403) return new IngestionError(403, "GITHUB_FORBIDDEN", "GitHub denied access to the repository");
  return unavailable();
}

function boundedFetch(options: GitHubOptions): typeof fetch {
  const fetchImpl = options.githubFetch ?? globalThis.fetch;
  const overall = AbortSignal.timeout(20_000);
  let totalBytes = 0;
  return async (input, init) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input : input.url);
    if (url.origin !== "https://api.github.com" || url.username || url.password) throw unavailable();
    const signal = AbortSignal.any([overall, AbortSignal.timeout(5000), ...(init?.signal ? [init.signal] : [])]);
    signal.throwIfAborted();
    const response = await fetchImpl(url.toString(), { ...init, redirect: "manual", signal });
    if (response.status >= 300 && response.status < 400) {
      await response.body?.cancel();
      throw unavailable();
    }
    if (Number(response.headers.get("content-length")) > MAX_RESPONSE) {
      await response.body?.cancel();
      throw tooLarge();
    }
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    const reader = response.body?.getReader();
    if (reader) {
      try {
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) break;
          signal.throwIfAborted();
          bytes += chunk.value.byteLength;
          totalBytes += chunk.value.byteLength;
          if (bytes > MAX_RESPONSE || totalBytes > 4 * MAX_RESPONSE) { await reader.cancel(); throw tooLarge(); }
          chunks.push(chunk.value);
        }
      } finally { reader.releaseLock(); }
    }
    return new Response(response.status === 204 || response.status === 205 ? null : Buffer.concat(chunks), {
      status: response.status, statusText: response.statusText, headers: response.headers,
    });
  };
}

export function parseGitHubInput(body: unknown) {
  const parsed = repositoryInput.safeParse(body);
  if (!parsed.success) throw new IngestionError(400, "INVALID_INPUT", "Repository must be owner/repo");
  return parsed.data.repository;
}

export async function prepareGitHubImport(repositoryName: string, options: GitHubOptions = {}) {
  const [owner, repo] = repositoryName.split("/") as [string, string];
  const octokit = new Octokit({
    auth: process.env.GITHUB_TOKEN || undefined,
    baseUrl: "https://api.github.com",
    request: { fetch: boundedFetch(options) },
    log: { debug() {}, info() {}, warn() {}, error() {} },
  });
  const pagination: Record<string, Prisma.InputJsonValue> = {};
  const documents: Document[] = [];
  const add = (content: string, metadata: Prisma.InputJsonObject) => {
    if (Buffer.byteLength(content, "utf8") > (metadata.kind === "readme" ? 128 * 1024 : 64 * 1024)
        || content.includes("\u0000") || Buffer.from(content).toString("utf8") !== content) throw tooLarge();
    documents.push({ position: documents.length + 1, content, sha256: sha256(content), metadata });
  };
  try {
    const repositoryResponse = await octokit.repos.get({ owner, repo });
    const parsedRepository = repositoryShape.safeParse(repositoryResponse.data);
    if (!parsedRepository.success) throw unavailable();
    const repository = parsedRepository.data;
    if (repository.private || (repository.visibility && repository.visibility !== "public")) {
      throw new IngestionError(403, "PUBLIC_REPOSITORY_REQUIRED", "Only public GitHub repositories may be imported");
    }
    let readme: z.infer<typeof readmeShape> | null = null;
    try {
      const result = await octokit.repos.getReadme({ owner, repo });
      const parsed = readmeShape.safeParse(result.data);
      if (!parsed.success) throw unavailable();
      readme = parsed.data;
      if (readme.size > 128 * 1024) throw tooLarge();
      const encoded = readme.content.replace(/\s/g, "");
      const bytes = Buffer.from(encoded, "base64");
      if (bytes.toString("base64") !== encoded || bytes.length !== readme.size || !Buffer.from(bytes.toString("utf8")).equals(bytes)) throw unavailable();
      add(bytes.toString("utf8"), { kind: "readme", githubUrl: readme.html_url, path: readme.path, blobSha: readme.sha, author: null, createdAt: null, updatedAt: null, status: null });
    } catch (error) { if (statusOf(error) !== 404) throw error; }

    async function items(kind: "issues" | "pulls" | "commits") {
      const collected: unknown[] = [];
      let pages = 0;
      let limitReached = false;
      let empty = false;
      for (let page = 1; page <= MAX_PAGES; page++) {
        let data: unknown;
        try {
          if (kind === "issues") data = (await octokit.issues.listForRepo({ owner, repo, state: "all", sort: "updated", direction: "desc", per_page: PER_PAGE, page })).data;
          else if (kind === "pulls") data = (await octokit.pulls.list({ owner, repo, state: "all", sort: "updated", direction: "desc", per_page: PER_PAGE, page })).data;
          else data = (await octokit.repos.listCommits({ owner, repo, per_page: PER_PAGE, page })).data;
        } catch (error) {
          if (kind === "commits" && statusOf(error) === 409 && repository.size === 0) { empty = true; break; }
          throw error;
        }
        if (!Array.isArray(data) || data.length > PER_PAGE) throw unavailable();
        collected.push(...data);
        pages++;
        if (data.length < PER_PAGE) break;
        limitReached = page === MAX_PAGES;
      }
      pagination[kind === "pulls" ? "pullRequests" : kind] = { perPage: PER_PAGE, maxPages: MAX_PAGES, pagesFetched: pages, limitReached, empty };
      return collected;
    }
    const issuesParsed = z.array(itemShape).safeParse(await items("issues"));
    const pullsParsed = z.array(itemShape).safeParse(await items("pulls"));
    const commitsParsed = z.array(commitShape).safeParse(await items("commits"));
    if (!issuesParsed.success || !pullsParsed.success || !commitsParsed.success) throw unavailable();
    const issues = [...new Map(issuesParsed.data.filter(item => !item.pull_request).map(item => [item.id, item])).values()];
    const pullRequests = [...new Map(pullsParsed.data.map(item => [item.id, item])).values()];
    const commits = [...new Map(commitsParsed.data.map(item => [item.sha, item])).values()];
    const addItem = (item: Item, kind: "issue" | "pull_request") => add(item.body ?? "", json({
      kind, githubUrl: item.html_url, number: item.number, title: item.title, author: item.user?.login ?? null,
      createdAt: item.created_at, updatedAt: item.updated_at, closedAt: item.closed_at ?? null,
      status: item.state, ...(kind === "pull_request" ? { mergedAt: item.merged_at ?? null } : {}),
    }));
    issues.forEach(item => addItem(item, "issue"));
    pullRequests.forEach(item => addItem(item, "pull_request"));
    commits.forEach((item: Commit) => add(item.commit.message, json({
      kind: "commit", githubUrl: item.html_url, sha: item.sha, author: item.author?.login ?? null,
      commitAuthor: item.commit.author ?? null, commitCommitter: item.commit.committer ?? null,
      createdAt: item.commit.author?.date ?? null, updatedAt: item.commit.committer?.date ?? null, status: null,
    })));
    const originalContent = canonical({ repository, readme, issues, pullRequests, commits });
    const byteSize = Buffer.byteLength(originalContent, "utf8");
    if (byteSize > MAX_RESPONSE) throw tooLarge();
    // A token can retain access after a public repository becomes private.
    // Verify visibility and identity again after collecting the snapshot.
    const finalRepository = repositoryShape.safeParse((await octokit.repos.get({ owner, repo })).data);
    if (!finalRepository.success) throw unavailable();
    if (finalRepository.data.private || (finalRepository.data.visibility && finalRepository.data.visibility !== "public")) {
      throw new IngestionError(403, "PUBLIC_REPOSITORY_REQUIRED", "Only public GitHub repositories may be imported");
    }
    if (finalRepository.data.id !== repository.id || finalRepository.data.full_name.toLowerCase() !== repository.full_name.toLowerCase()) throw unavailable();
    return {
      type: "GITHUB" as const, filename: `${owner}_${repo}.github.json`, originalContent, sha256: sha256(originalContent), byteSize,
      metadata: { repository: repository.full_name, githubUrl: repository.html_url },
      provenance: { method: "github_rest", apiOrigin: "https://api.github.com", fetchedAt: new Date().toISOString(), pagination, formatVersion: 1 },
      documents,
    };
  } catch (error) { throw safeError(error); }
}
