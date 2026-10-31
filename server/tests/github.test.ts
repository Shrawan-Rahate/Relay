import "dotenv/config";
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import request from "supertest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import type { Prisma, ProjectRole } from "../src/generated/prisma/client.js";

const target = new URL(process.env.DATABASE_URL ?? "");
if (!["postgresql:", "postgres:"].includes(target.protocol) || target.pathname !== "/relay_dev"
    || !["localhost", "127.0.0.1", "[::1]"].includes(target.hostname) || (target.port && target.port !== "5432")
    || [...target.searchParams.keys()].some(k => k !== "schema")
    || (target.searchParams.has("schema") && target.searchParams.get("schema") !== "public")) throw Error("GitHub tests require local relay_dev");

const at = "2026-10-20T12:00:00Z";
const readmeText = "# Actual README\r\nUse queues.\r\n";
const repository = { id: 42, full_name: "acme/relay", private: false, visibility: "public", html_url: "https://github.com/acme/relay", url: "https://api.github.com/repos/acme/relay", default_branch: "main", size: 100, updated_at: at, owner: { login: "acme" } };
const readme = { type: "file", name: "README.md", path: "README.md", sha: "a".repeat(40), html_url: "https://github.com/acme/relay/blob/main/README.md", content: Buffer.from(readmeText).toString("base64"), encoding: "base64", size: Buffer.byteLength(readmeText), download_url: "http://127.0.0.1/private" };
const issue = { id: 1, number: 7, title: "Actual issue", body: "Keep retries bounded.", html_url: "https://github.com/acme/relay/issues/7", user: { login: "ada" }, state: "open", created_at: at, updated_at: at, closed_at: null };
const pull = { id: 2, number: 8, title: "Actual pull request", body: "Original PR body", html_url: "https://github.com/acme/relay/pull/8", user: { login: "sam" }, state: "closed", created_at: at, updated_at: at, closed_at: at, merged_at: at };
const commit = { sha: "b".repeat(40), html_url: `https://github.com/acme/relay/commit/${"b".repeat(40)}`, author: { login: "sam" }, committer: { login: "sam" }, commit: { message: "Actual commit message\n\nDetails", author: { name: "Sam", email: "public@example.test", date: at }, committer: { name: "Sam", email: "public@example.test", date: at } } };
type Reply = { status?: number; data?: unknown; headers?: Record<string, string> };
type Override = (url: URL) => Reply | undefined | Promise<Reply | undefined>;

function githubMock(override?: Override) {
  const calls: URL[] = [];
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input : input.url);
    calls.push(url);
    assert.equal(url.origin, "https://api.github.com");
    assert.equal(init?.redirect, "manual");
    let reply = await override?.(url);
    if (!reply) {
      const data: Record<string, unknown> = {
        "/repos/acme/relay": repository, "/repos/acme/relay/readme": readme,
        "/repos/acme/relay/issues": [issue, { ...pull, pull_request: { url: "https://api.github.com/repos/acme/relay/pulls/8" } }],
        "/repos/acme/relay/pulls": [pull], "/repos/acme/relay/commits": [commit],
      };
      if (!(url.pathname in data)) throw Error("Unexpected GitHub request");
      reply = { data: data[url.pathname] };
    }
    return new Response(JSON.stringify(reply.data ?? { message: "GitHub provider diagnostic" }), {
      status: reply.status ?? 200, headers: { "content-type": "application/json", ...reply.headers },
    });
  };
  return { calls, fetch };
}

type App = ReturnType<typeof createApp>;
const ids = new Set<string>();
const projectIds = new Set<string>();
after(async () => {
  try {
    assert.equal(await prisma.user.count({ where: { id: { in: [...ids] } } }), 0);
    assert.equal(await prisma.project.count({ where: { id: { in: [...projectIds] } } }), 0);
    assert.equal(await prisma.source.count({ where: { projectId: { in: [...projectIds] } } }), 0);
    assert.equal(await prisma.sourceDocument.count({ where: { projectId: { in: [...projectIds] } } }), 0);
  } finally { await prisma.$disconnect(); }
});

async function scenario(run: (app: App, db: Prisma.TransactionClient, mock: ReturnType<typeof githubMock>) => Promise<void>, override?: Override) {
  const rollback = Error("rollback GitHub tests");
  const mock = githubMock(override);
  try {
    await prisma.$transaction(async db => {
      await run(createApp(db, { githubFetch: mock.fetch }), db, mock);
      throw rollback;
    }, { timeout: 30_000 });
  } catch (error) { if (error !== rollback) throw error; }
}

async function fixture(db: Prisma.TransactionClient, role: ProjectRole = "REVIEWER", projectId?: string) {
  const token = randomBytes(32).toString("base64url");
  const user = await db.user.create({ data: {
    email: `${randomUUID()}@relay.test`, passwordHash: "unused-session-only-fixture",
    sessions: { create: { tokenHash: createHash("sha256").update(token).digest("hex"), expiresAt: new Date(Date.now() + 3600000) } },
  } });
  ids.add(user.id);
  if (!projectId) {
    projectId = (await db.project.create({ data: { name: "GitHub test project" } })).id;
    projectIds.add(projectId);
  }
  const member = await db.projectMember.create({ data: { projectId, userId: user.id, role } });
  return { id: user.id, projectId, memberId: member.id, cookie: `relay_session=${token}` };
}
function ingest(app: App, user: { cookie: string; projectId: string }, body: object = { repository: "acme/relay" }) {
  return request(app).post(`/api/projects/${user.projectId}/sources/github`).set("Cookie", user.cookie).send(body);
}

test("public GitHub import stores original facts, text, URLs, authors, timestamps, hashes and provenance", async () => {
  await scenario(async (app, db, mock) => {
    const user = await fixture(db);
    const response = await ingest(app, user);
    assert.equal(response.status, 201);
    const source = response.body.source;
    assert.equal(source.type, "GITHUB");
    assert.equal(source.importedById, user.id);
    assert.equal(source.metadata.repository, "acme/relay");
    assert.equal(source.metadata.githubUrl, repository.html_url);
    assert.equal(source.sha256, createHash("sha256").update(source.originalContent).digest("hex"));
    const snapshot = JSON.parse(source.originalContent);
    assert.deepEqual(snapshot.repository, repository);
    assert.equal(snapshot.readme.content, readme.content);
    assert.deepEqual(snapshot.issues, [issue]);
    assert.deepEqual(snapshot.pullRequests, [pull]);
    assert.deepEqual(snapshot.commits, [commit]);
    assert.equal(source.documents.length, 4);
    const byKind = Object.fromEntries(source.documents.map((doc: { metadata: { kind: string } }) => [doc.metadata.kind, doc]));
    assert.equal(byKind.readme.content, readmeText);
    assert.equal(byKind.readme.metadata.author, null);
    assert.equal(byKind.issue.content, issue.body);
    assert.equal(byKind.issue.metadata.githubUrl, issue.html_url);
    assert.equal(byKind.issue.metadata.author, "ada");
    assert.equal(byKind.issue.metadata.createdAt, at);
    assert.equal(byKind.issue.metadata.status, "open");
    assert.equal(byKind.pull_request.content, pull.body);
    assert.equal(byKind.pull_request.metadata.mergedAt, at);
    assert.equal(byKind.commit.content, commit.commit.message);
    assert.equal(byKind.commit.metadata.commitAuthor.date, at);
    for (const doc of source.documents) {
      assert.equal(doc.sha256, createHash("sha256").update(doc.content).digest("hex"));
      assert.equal(doc.projectId, user.projectId);
    }
    assert.equal(source.provenance.method, "github_rest");
    assert.ok(source.provenance.fetchedAt);
    assert.equal(mock.calls.length, 6);
    assert.ok(mock.calls.every(url => url.origin === "https://api.github.com"));
    const detail = await request(app).get(`/api/projects/${user.projectId}/sources/${source.id}`).set("Cookie", user.cookie);
    assert.equal(detail.status, 200);
    assert.deepEqual(detail.body.source, source);
  });
});

test("GitHub importing requires auth and reviewer/outgoing roles before any network request", async () => {
  await scenario(async (app, db, mock) => {
    const reviewer = await fixture(db);
    const incoming = await fixture(db, "INCOMING", reviewer.projectId);
    const outsider = await fixture(db);
    const path = `/api/projects/${reviewer.projectId}/sources/github`;
    assert.equal((await request(app).post(path).send({ repository: "acme/relay" })).status, 401);
    assert.equal((await ingest(app, incoming)).status, 403);
    assert.equal((await ingest(app, { ...outsider, projectId: reviewer.projectId })).status, 404);
    assert.equal((await request(app).post(path).set("Cookie", reviewer.cookie).set("Origin", "https://attacker.test").send({ repository: "acme/relay" })).status, 403);
    assert.equal(mock.calls.length, 0);
    const outgoing = await fixture(db, "OUTGOING", reviewer.projectId);
    assert.equal((await ingest(app, outgoing)).status, 201);
  });
});

test("repository input rejects URLs, traversal, hostnames, malformed names and extra fields", async () => {
  await scenario(async (app, db, mock) => {
    const user = await fixture(db);
    for (const value of ["https://github.com/acme/relay", "http://127.0.0.1/a", "acme/../relay", "acme/%2e%2e", "acme/relay?x=1", "acme/relay#x", "acme\\relay", "acme/..", "acme/.", "acme/", "acme", "a".repeat(40) + "/relay"]) {
      assert.equal((await ingest(app, user, { repository: value })).status, 400);
    }
    assert.equal((await ingest(app, user, { repository: "acme/relay", token: "not-accepted" })).status, 400);
    assert.equal(mock.calls.length, 0);
  });
});

test("private repositories are rejected even when GitHub credentials can see them", async () => {
  await scenario(async (app, db, mock) => {
    const user = await fixture(db);
    const response = await ingest(app, user);
    assert.equal(response.status, 403);
    assert.equal(response.body.error.code, "PUBLIC_REPOSITORY_REQUIRED");
    assert.equal(mock.calls.length, 1);
    assert.equal(await db.source.count({ where: { projectId: user.projectId } }), 0);
  }, url => url.pathname === "/repos/acme/relay" ? { data: { ...repository, private: true, visibility: "private" } } : undefined);
});

const failures: [number, Record<string, string>, number, string][] = [
  [404, {}, 404, "GITHUB_NOT_FOUND"], [403, {}, 403, "GITHUB_FORBIDDEN"],
  [403, { "x-ratelimit-remaining": "0", "retry-after": "60" }, 429, "GITHUB_RATE_LIMITED"],
  [429, { "retry-after": "60" }, 429, "GITHUB_RATE_LIMITED"], [500, {}, 502, "GITHUB_UNAVAILABLE"],
];
for (const [status, headers, expected, code] of failures) {
  test(`GitHub ${status} failures return safe ${code} errors without partial imports`, async () => {
    await scenario(async (app, db) => {
      const user = await fixture(db);
      const response = await ingest(app, user);
      assert.equal(response.status, expected);
      assert.equal(response.body.error.code, code);
      assert.ok(!JSON.stringify(response.body).includes("provider diagnostic"));
      assert.equal(await db.source.count({ where: { projectId: user.projectId } }), 0);
    }, () => ({ status, headers, data: { message: "GitHub provider diagnostic" } }));
  });
}

test("late upstream failure leaves no source or documents", async () => {
  await scenario(async (app, db) => {
    const user = await fixture(db);
    assert.equal((await ingest(app, user)).status, 502);
    assert.equal(await db.source.count({ where: { projectId: user.projectId } }), 0);
    assert.equal(await db.sourceDocument.count({ where: { projectId: user.projectId } }), 0);
  }, url => url.pathname.endsWith("/commits") ? { status: 503 } : undefined);
});

test("empty repositories and missing README import real repository metadata without invented documents", async () => {
  await scenario(async (app, db) => {
    const user = await fixture(db);
    const response = await ingest(app, user);
    assert.equal(response.status, 201);
    assert.deepEqual(response.body.source.documents, []);
    const snapshot = JSON.parse(response.body.source.originalContent);
    assert.equal(snapshot.readme, null);
    assert.deepEqual(snapshot.commits, []);
  }, url => {
    if (url.pathname === "/repos/acme/relay") return { data: { ...repository, size: 0 } };
    if (url.pathname.endsWith("/readme")) return { status: 404 };
    if (url.pathname.endsWith("/commits")) return { status: 409 };
    return { data: [] };
  });
});

test("pagination is bounded and untrusted Link URLs are never followed", async () => {
  await scenario(async (app, db, mock) => {
    const user = await fixture(db);
    const response = await ingest(app, user);
    assert.equal(response.status, 201);
    assert.equal(response.body.source.documents.filter((doc: { metadata: { kind: string } }) => doc.metadata.kind === "issue").length, 40);
    const calls = mock.calls.filter(url => url.pathname.endsWith("/issues"));
    assert.deepEqual(calls.map(url => url.searchParams.get("page")), ["1", "2"]);
    assert.ok(calls.every(url => url.searchParams.get("per_page") === "20"));
    assert.equal(response.body.source.provenance.pagination.issues.limitReached, true);
  }, url => url.pathname.endsWith("/issues") ? {
    data: Array.from({ length: 20 }, (_, index) => ({ ...issue, id: (Number(url.searchParams.get("page")) - 1) * 20 + index + 1, number: (Number(url.searchParams.get("page")) - 1) * 20 + index + 1 })),
    headers: { link: '<http://127.0.0.1/private>; rel="next"' },
  } : undefined);
});

test("unchanged GitHub facts deduplicate independently of fetch time and are scoped per project", async () => {
  await scenario(async (app, db) => {
    const user = await fixture(db);
    const other = await fixture(db);
    assert.equal((await ingest(app, user)).status, 201);
    assert.equal((await ingest(app, user)).status, 409);
    assert.equal(await db.source.count({ where: { projectId: user.projectId } }), 1);
    assert.equal(await db.sourceDocument.count({ where: { projectId: user.projectId } }), 4);
    assert.equal((await ingest(app, other)).status, 201);
    const list = await request(app).get(`/api/projects/${other.projectId}/sources`).set("Cookie", user.cookie);
    assert.equal(list.status, 404);
  });
});

test("redirects cannot send GitHub requests or tokens to another host", async () => {
  await scenario(async (app, db, mock) => {
    const user = await fixture(db);
    assert.equal((await ingest(app, user)).status, 502);
    assert.equal(mock.calls.length, 1);
    assert.equal(await db.source.count({ where: { projectId: user.projectId } }), 0);
  }, () => ({ status: 302, headers: { location: "http://127.0.0.1/private" } }));
});

test("oversized README and oversized API responses are rejected without partial rows", async () => {
  await scenario(async (app, db) => {
    const user = await fixture(db);
    assert.equal((await ingest(app, user)).status, 413);
    assert.equal(await db.source.count({ where: { projectId: user.projectId } }), 0);
  }, url => url.pathname.endsWith("/readme") ? { data: { ...readme, size: 128 * 1024 + 1, content: Buffer.from("x".repeat(128 * 1024 + 1)).toString("base64") } } : undefined);
  await scenario(async (app, db) => {
    const user = await fixture(db);
    assert.equal((await ingest(app, user)).status, 413);
    assert.equal(await db.source.count({ where: { projectId: user.projectId } }), 0);
  }, () => ({ data: { ...repository, oversized: "x".repeat(1024 * 1024 + 1) } }));
});

test("membership revocation during GitHub fetch prevents persistence", async () => {
  await scenario(async (_app, db) => {
    const user = await fixture(db);
    const mock = githubMock(async url => {
      if (url.pathname.endsWith("/commits")) await db.projectMember.delete({ where: { id: user.memberId } });
      return undefined;
    });
    const app = createApp(db, { githubFetch: mock.fetch });
    assert.equal((await ingest(app, user)).status, 404);
    assert.ok(mock.calls.some(url => url.pathname.endsWith("/commits")));
    assert.equal(await db.projectMember.count({ where: { id: user.memberId } }), 0);
    assert.equal(await db.source.count({ where: { projectId: user.projectId } }), 0);
  });
});

test("secondary GitHub rate limits are recognized without rate-limit headers", async () => {
  await scenario(async (app, db) => {
    const user = await fixture(db);
    const response = await ingest(app, user);
    assert.equal(response.status, 429);
    assert.equal(response.body.error.code, "GITHUB_RATE_LIMITED");
    assert.equal(await db.source.count({ where: { projectId: user.projectId } }), 0);
  }, () => ({ status: 403, data: { message: "You have exceeded a secondary rate limit." } }));
});

test("valid literal Unicode replacement characters in README text are preserved", async () => {
  const text = "A literal replacement character: \uFFFD\n";
  await scenario(async (app, db) => {
    const user = await fixture(db);
    const response = await ingest(app, user);
    assert.equal(response.status, 201);
    assert.equal(response.body.source.documents[0].content, text);
  }, url => url.pathname.endsWith("/readme") ? { data: { ...readme, content: Buffer.from(text).toString("base64"), size: Buffer.byteLength(text) } } : undefined);
});

test("network timeouts and malformed upstream records do not persist partial data", async () => {
  await scenario(async (app, db) => {
    const user = await fixture(db);
    assert.equal((await ingest(app, user)).status, 502);
    assert.equal(await db.source.count({ where: { projectId: user.projectId } }), 0);
  }, () => { throw new DOMException("Private network diagnostic", "AbortError"); });
  await scenario(async (app, db) => {
    const user = await fixture(db);
    assert.equal((await ingest(app, user)).status, 502);
    assert.equal(await db.source.count({ where: { projectId: user.projectId } }), 0);
  }, url => url.pathname.endsWith("/issues") ? { data: [{ unexpected: "not a GitHub issue" }] } : undefined);
});

test("repository becoming private during collection cannot be persisted", async () => {
  let repositoryReads = 0;
  await scenario(async (app, db) => {
    const user = await fixture(db);
    assert.equal((await ingest(app, user)).status, 403);
    assert.equal(await db.source.count({ where: { projectId: user.projectId } }), 0);
  }, url => {
    if (url.pathname === "/repos/acme/relay" && ++repositoryReads > 1) return { data: { ...repository, private: true, visibility: "private" } };
    return undefined;
  });
});
