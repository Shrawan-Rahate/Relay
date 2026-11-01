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
    || !["127.0.0.1", "localhost", "[::1]"].includes(target.hostname) || (target.port && target.port !== "5432")
    || [...target.searchParams.keys()].some(key => key !== "schema")
    || (target.searchParams.has("schema") && target.searchParams.get("schema") !== "public")) throw new Error("Source tests require local relay_dev");

type App = ReturnType<typeof createApp>;
type Body = { type: string; filename: string; content: string; metadata?: Record<string, unknown> };
const userIds = new Set<string>();
const projectIds = new Set<string>();
after(async () => {
  try {
    assert.equal(await prisma.user.count({ where: { id: { in: [...userIds] } } }), 0);
    assert.equal(await prisma.project.count({ where: { id: { in: [...projectIds] } } }), 0);
    assert.equal(await prisma.source.count({ where: { projectId: { in: [...projectIds] } } }), 0);
    assert.equal(await prisma.sourceDocument.count({ where: { projectId: { in: [...projectIds] } } }), 0);
  } finally { await prisma.$disconnect(); }
});

async function scenario(run: (app: App, db: Prisma.TransactionClient) => Promise<void>) {
  const rollback = new Error("rollback source test transaction");
  try {
    await prisma.$transaction(async db => { await run(createApp(db), db); throw rollback; }, { timeout: 30_000 });
  } catch (error) { if (error !== rollback) throw error; }
}

async function fixture(db: Prisma.TransactionClient, role: ProjectRole = "REVIEWER", projectId?: string) {
  const token = randomBytes(32).toString("base64url");
  const user = await db.user.create({ data: {
    email: `${randomUUID()}@relay.test`, passwordHash: "unused-session-only-fixture",
    sessions: { create: { tokenHash: createHash("sha256").update(token).digest("hex"), expiresAt: new Date(Date.now() + 3600_000) } },
  } });
  userIds.add(user.id);
  if (!projectId) {
    const project = await db.project.create({ data: { name: "Source test project" } });
    projectId = project.id;
    projectIds.add(projectId);
  }
  const member = await db.projectMember.create({ data: { projectId, userId: user.id, role } });
  return { id: user.id, projectId, memberId: member.id, cookie: `relay_session=${token}` };
}

const markdown: Body = { type: "MARKDOWN", filename: "notes.md", content: "# Relay\r\n\r\nOriginal **notes**.  \r\n" };
const csv: Body = { type: "CSV", filename: "tasks.csv", content: 'title,status,owner\r\n"Ship, Relay",open,Ada\r\n"Review\nnotes",done,Sam\r\n' };
function importSource(app: App, cookie: string, projectId: string, body: Body = markdown) {
  return request(app).post(`/api/projects/${projectId}/sources`).set("Cookie", cookie).send(body);
}

test("Markdown imports preserve original content, SHA-256, importer and caller metadata", async () => {
  await scenario(async (app, db) => {
    const user = await fixture(db);
    const response = await importSource(app, user.cookie, user.projectId, { ...markdown, metadata: { repository: "relay", revision: "abc123" } });
    assert.equal(response.status, 201);
    const source = response.body.source;
    assert.equal(source.originalContent, markdown.content);
    assert.equal(source.type, "MARKDOWN");
    assert.equal(source.filename, "notes.md");
    assert.equal(source.sha256, createHash("sha256").update(markdown.content).digest("hex"));
    assert.equal(source.byteSize, Buffer.byteLength(markdown.content));
    assert.equal(source.importedById, user.id);
    assert.deepEqual(source.metadata, { repository: "relay", revision: "abc123" });
    assert.equal(source.provenance.method, "manual_import");
    assert.equal(source.provenance.encoding, "utf-8");
    assert.equal(source.documents.length, 1);
    assert.equal(source.documents[0].content, markdown.content);
    assert.equal(source.documents[0].projectId, user.projectId);
    assert.equal(source.documents[0].sha256, source.sha256);
    assert.ok(source.createdAt && source.updatedAt && source.documents[0].createdAt);
    const stored = await db.source.findUniqueOrThrow({ where: { id: source.id } });
    assert.equal(stored.originalContent, markdown.content);
    assert.ok(!("decisions" in source) && !("aiResults" in source));
    const detail = await request(app).get(`/api/projects/${user.projectId}/sources/${source.id}`).set("Cookie", user.cookie);
    assert.equal(detail.status, 200);
    assert.deepEqual(detail.body.source, source);
    assert.equal(detail.headers["cache-control"], "no-store");
    const list = await request(app).get(`/api/projects/${user.projectId}/sources`).set("Cookie", user.cookie);
    assert.equal(list.status, 200);
    assert.equal(list.body.sources.length, 1);
    assert.equal(list.body.sources[0].id, source.id);
    assert.ok(!("originalContent" in list.body.sources[0]));
  });
});

test("CSV imports retain quoted multiline task rows and every original string cell", async () => {
  await scenario(async (app, db) => {
    const user = await fixture(db, "OUTGOING");
    const response = await importSource(app, user.cookie, user.projectId, csv);
    assert.equal(response.status, 201);
    const source = response.body.source;
    assert.equal(source.originalContent, csv.content);
    assert.equal(source.documents.length, 2);
    assert.deepEqual(source.documents.map((d: { position: number }) => d.position), [1, 2]);
    assert.equal(source.documents[0].content, '"Ship, Relay",open,Ada\r\n');
    assert.equal(source.documents[1].content, '"Review\nnotes",done,Sam\r\n');
    assert.deepEqual(source.documents[0].metadata.values, ["Ship, Relay", "open", "Ada"]);
    assert.deepEqual(source.documents[1].metadata.values, ["Review\nnotes", "done", "Sam"]);
    assert.deepEqual(source.documents[0].metadata.headers, ["title", "status", "owner"]);
    for (const document of source.documents) {
      assert.equal(document.sha256, createHash("sha256").update(document.content).digest("hex"));
      assert.equal(Buffer.from(csv.content).subarray(document.metadata.startByte, document.metadata.endByte).toString("utf8"), document.content);
    }
  });
});

test("UTF-8 BOM, Unicode, extra CSV columns and formula strings are preserved without inference", async () => {
  await scenario(async (app, db) => {
    const user = await fixture(db);
    const content = '\uFEFF Title ,custom,external_id\r\n"Décision 🧭",=1+1,0007\r\n';
    const response = await importSource(app, user.cookie, user.projectId, { ...csv, content });
    assert.equal(response.status, 201);
    assert.equal(response.body.source.originalContent, content);
    const doc = response.body.source.documents[0];
    assert.deepEqual(doc.metadata.headers, [" Title ", "custom", "external_id"]);
    assert.deepEqual(doc.metadata.values, ["Décision 🧭", "=1+1", "0007"]);
    assert.equal(doc.content, '"Décision 🧭",=1+1,0007\r\n');
  });
});

test("all members read sources, while only reviewer/outgoing can import", async () => {
  await scenario(async (app, db) => {
    const reviewer = await fixture(db);
    const outgoing = await fixture(db, "OUTGOING", reviewer.projectId);
    const incoming = await fixture(db, "INCOMING", reviewer.projectId);
    const response = await importSource(app, reviewer.cookie, reviewer.projectId);
    assert.equal(response.status, 201);
    assert.equal((await importSource(app, outgoing.cookie, reviewer.projectId, csv)).status, 201);
    assert.equal((await importSource(app, incoming.cookie, reviewer.projectId, { ...markdown, content: "Denied" })).status, 403);
    for (const user of [reviewer, outgoing, incoming]) {
      const list = await request(app).get(`/api/projects/${reviewer.projectId}/sources`).set("Cookie", user.cookie);
      assert.equal(list.status, 200);
      assert.equal(list.body.sources.length, 2);
      assert.equal((await request(app).get(`/api/projects/${reviewer.projectId}/sources/${response.body.source.id}`).set("Cookie", user.cookie)).status, 200);
    }
  });
});

test("imports require authentication and block cross-origin state changes", async () => {
  await scenario(async (app, db) => {
    const user = await fixture(db);
    const path = `/api/projects/${user.projectId}/sources`;
    assert.equal((await request(app).post(path).send(markdown)).status, 401);
    assert.equal((await request(app).get(path)).status, 401);
    assert.equal((await request(app).get(`${path}/${randomUUID()}`)).status, 401);
    assert.equal((await request(app).post(path).set("Cookie", user.cookie).set("Origin", "https://attacker.test").send(markdown)).status, 403);
    assert.equal(await db.source.count({ where: { projectId: user.projectId } }), 0);
    assert.equal((await request(app).post(path).set("Cookie", user.cookie).set("Origin", "http://localhost:5173").send(markdown)).status, 201);
  });
});

test("duplicate imports conflict across filenames and metadata, but remain allowed in another project", async () => {
  await scenario(async (app, db) => {
    const user = await fixture(db);
    const other = await fixture(db);
    assert.equal((await importSource(app, user.cookie, user.projectId)).status, 201);
    const duplicate = await importSource(app, user.cookie, user.projectId, { ...markdown, filename: "renamed.markdown", metadata: { different: true } });
    assert.equal(duplicate.status, 409);
    assert.equal(duplicate.body.error.code, "SOURCE_EXISTS");
    assert.equal(await db.source.count({ where: { projectId: user.projectId } }), 1);
    assert.equal(await db.sourceDocument.count({ where: { projectId: user.projectId } }), 1);
    assert.equal((await importSource(app, other.cookie, other.projectId)).status, 201);
    assert.equal((await importSource(app, user.cookie, user.projectId, { ...markdown, content: markdown.content + "\n" })).status, 201);
    const sharedContent = "title\nTask";
    assert.equal((await importSource(app, user.cookie, user.projectId, { ...csv, content: sharedContent })).status, 201);
    assert.equal((await importSource(app, user.cookie, user.projectId, { ...markdown, content: sharedContent })).status, 409);
  });
});

test("invalid Markdown, filenames, metadata, and import types are rejected without rows", async () => {
  await scenario(async (app, db) => {
    const user = await fixture(db);
    const invalid = [
      { ...markdown, content: " \r\n" }, { ...markdown, content: "bad\u0000text" }, { ...markdown, content: "\uD800" },
      { ...markdown, filename: "../notes.md" }, { ...markdown, filename: "C:\\notes.md" },
      { ...markdown, filename: "notes.exe" }, { ...markdown, filename: "notes\n.md" },
      { ...markdown, type: "GITHUB" }, { ...markdown, metadata: [] }, { ...markdown, content: 42 },
      { ...markdown, decisions: ["invented"] }, { ...markdown, metadata: { note: "x".repeat(9000) } },
    ];
    for (const body of invalid) {
      const response = await request(app).post(`/api/projects/${user.projectId}/sources`).set("Cookie", user.cookie).send(body);
      assert.equal(response.status, 400);
      assert.deepEqual(Object.keys(response.body), ["error"]);
    }
    assert.equal(await db.source.count({ where: { projectId: user.projectId } }), 0);
    assert.equal(await db.sourceDocument.count({ where: { projectId: user.projectId } }), 0);
  });
});

test("malformed CSV, missing titles, duplicate headers, empty tasks and inconsistent columns are rejected", async () => {
  await scenario(async (app, db) => {
    const user = await fixture(db);
    for (const content of [
      "title,status\n", "status,owner\nopen,Ada", "title,Title\nA,B", "title,\nA,B", 'title,status\n"unclosed,open',
      "title,status\nTask", "title,status\nTask,open,extra", "title,status\n   ,open", ",status\nTask,open",
    ]) {
      const response = await importSource(app, user.cookie, user.projectId, { ...csv, content });
      assert.equal(response.status, 400);
      assert.ok(!JSON.stringify(response.body).includes("CSV_"));
    }
    assert.equal(await db.source.count({ where: { projectId: user.projectId } }), 0);
  });
});

test("size limits count UTF-8 bytes and CSV task counts are bounded", async () => {
  await scenario(async (app, db) => {
    const user = await fixture(db);
    assert.equal((await importSource(app, user.cookie, user.projectId, { ...markdown, content: "x".repeat(256 * 1024) })).status, 201);
    assert.equal((await importSource(app, user.cookie, user.projectId, { ...markdown, content: "é".repeat(131073) })).status, 413);
    assert.equal((await importSource(app, user.cookie, user.projectId, { ...csv, content: "title\n" + "Task\n".repeat(1001) })).status, 400);
    assert.equal((await importSource(app, user.cookie, user.projectId, { ...csv, content: "title," + Array.from({ length: 50 }, (_, i) => `c${i}`).join(",") + "\n" + "value,".repeat(50) + "last" })).status, 400);
    const boundary = await importSource(app, user.cookie, user.projectId, { ...csv, content: "title\n" + "Task\n".repeat(1000) });
    assert.equal(boundary.status, 201);
    assert.equal(boundary.body.source.documents.length, 1000);
    assert.equal(await db.source.count({ where: { projectId: user.projectId } }), 2);
  });
});

test("project/source ids cannot be used to cross project boundaries", async () => {
  await scenario(async (app, db) => {
    const owner = await fixture(db);
    const outsider = await fixture(db);
    const response = await importSource(app, owner.cookie, owner.projectId);
    assert.equal(response.status, 201);
    const sourceId = response.body.source.id;
    const hidden = await request(app).get(`/api/projects/${owner.projectId}/sources/${sourceId}`).set("Cookie", outsider.cookie);
    const missing = await request(app).get(`/api/projects/${owner.projectId}/sources/${randomUUID()}`).set("Cookie", outsider.cookie);
    assert.equal(hidden.status, 404);
    assert.deepEqual(hidden.body, missing.body);
    assert.equal((await request(app).get(`/api/projects/${owner.projectId}/sources`).set("Cookie", outsider.cookie)).status, 404);
    assert.equal((await importSource(app, outsider.cookie, owner.projectId)).status, 404);
    assert.equal((await request(app).get(`/api/projects/${outsider.projectId}/sources/${sourceId}`).set("Cookie", outsider.cookie)).status, 404);
    assert.equal((await request(app).get(`/api/projects/${owner.projectId}/sources/not-a-uuid`).set("Cookie", owner.cookie)).status, 400);
    assert.deepEqual((await request(app).get(`/api/projects/${outsider.projectId}/sources`).set("Cookie", outsider.cookie)).body, { sources: [] });
  });
});

test("membership and session revocation immediately block source access and imports", async () => {
  await scenario(async (app, db) => {
    const owner = await fixture(db);
    const outgoing = await fixture(db, "OUTGOING", owner.projectId);
    const source = await importSource(app, outgoing.cookie, owner.projectId);
    assert.equal(source.status, 201);
    assert.equal((await request(app).delete(`/api/projects/${owner.projectId}/members/${outgoing.memberId}`).set("Cookie", owner.cookie)).status, 204);
    assert.equal((await request(app).get(`/api/projects/${owner.projectId}/sources/${source.body.source.id}`).set("Cookie", outgoing.cookie)).status, 404);
    assert.equal((await importSource(app, outgoing.cookie, owner.projectId, csv)).status, 404);
    assert.equal((await request(app).post("/api/auth/logout").set("Cookie", owner.cookie)).status, 204);
    assert.equal((await request(app).get(`/api/projects/${owner.projectId}/sources`).set("Cookie", owner.cookie)).status, 401);
    assert.equal((await importSource(app, owner.cookie, owner.projectId, csv)).status, 401);
  });
});

function uploadSource(app: App, cookie: string, projectId: string, content: string | Buffer, filename = "notes.md", contentType = "text/markdown") {
  return request(app).post(`/api/projects/${projectId}/sources`).set("Cookie", cookie)
    .attach("file", Buffer.isBuffer(content) ? content : Buffer.from(content), { filename, contentType });
}

test("multipart md, txt and csv uploads preserve bytes, filenames, provenance and documents", async () => {
  await scenario(async (app, db) => {
    const user = await fixture(db, "OUTGOING");
    for (const [filename, contentType, type, content] of [
      ["notes.md", "text/markdown", "MARKDOWN", markdown.content],
      ["notes.txt", "text/plain", "TXT", "\uFEFFDécision 🧭\r\n  original text\r\n"],
      ["tasks.csv", "text/csv", "CSV", csv.content],
    ]) {
      const result = await uploadSource(app, user.cookie, user.projectId, content!, filename, contentType).field("metadata", JSON.stringify({ origin: "upload fixture" }));
      assert.equal(result.status, 201, JSON.stringify(result.body));
      const source = result.body.source;
      assert.equal(source.filename, filename);
      assert.deepEqual(source.metadata, { origin: "upload fixture" });
      assert.equal(source.type, type);
      assert.equal(source.originalContent, content);
      assert.equal(source.byteSize, Buffer.byteLength(content!));
      assert.equal(source.sha256, createHash("sha256").update(content!).digest("hex"));
      assert.equal(source.importedById, user.id);
      assert.equal(source.provenance.method, "file_upload");
      assert.equal(source.provenance.encoding, "utf-8");
      assert.equal(source.provenance.mediaType, contentType);
      assert.equal(source.documents.length, type === "CSV" ? 2 : 1);
      assert.ok(source.documents.every((doc: { projectId: string }) => doc.projectId === user.projectId));
      if (type !== "CSV") assert.equal(source.documents[0].content, content);
      assert.equal((await db.source.findUniqueOrThrow({ where: { id: source.id } })).originalContent, content);
    }
  });
});

test("multipart validates UTF-8, file types, MIME, empty/binary content, CSV and form shape without writes", async () => {
  await scenario(async (app, db) => {
    const user = await fixture(db);
    for (const [content, filename, mime] of [
      [Buffer.from([0xc3, 0x28]), "bad.txt", "text/plain"],
      [Buffer.from([0xff, 0xfe, 0x41, 0]), "bad.txt", "text/plain"],
      [Buffer.from("bad\u0000text"), "bad.txt", "text/plain"],
      [Buffer.from(" \r\n"), "empty.md", "text/markdown"],
      [Buffer.from("text"), "bad.exe", "text/plain"],
      [Buffer.from("text"), "bad.txt", "image/png"],
      [Buffer.from('title\n"unclosed'), "bad.csv", "text/csv"],
      [Buffer.from("title\n" + "Task\n".repeat(1001)), "bad.csv", "text/csv"],
    ] as const) {
      const result = await uploadSource(app, user.cookie, user.projectId, content, filename, mime);
      assert.equal(result.status, 400, `${filename}: ${JSON.stringify(result.body)}`);
    }
    const path = `/api/projects/${user.projectId}/sources`;
    const traversal = '--relay-boundary\r\nContent-Disposition: form-data; name="file"; filename="../bad.md"\r\nContent-Type: text/markdown\r\n\r\ntext\r\n--relay-boundary--\r\n';
    assert.equal((await request(app).post(path).set("Cookie", user.cookie).set("Content-Type", "multipart/form-data; boundary=relay-boundary").send(traversal)).status, 400);
    assert.equal((await request(app).post(path).set("Cookie", user.cookie).field("type", "MARKDOWN")).status, 400);
    assert.equal((await uploadSource(app, user.cookie, user.projectId, "text").field("unexpected", "value")).status, 400);
    assert.equal((await uploadSource(app, user.cookie, user.projectId, "text").attach("file", Buffer.from("second"), "second.md")).status, 400);
    assert.equal((await uploadSource(app, user.cookie, user.projectId, "text").attach("other", Buffer.from("second"), "second.md")).status, 400);
    assert.equal((await request(app).post(path).set("Cookie", user.cookie).set("Content-Type", "multipart/form-data; boundary=broken").send("broken")).status, 400);
    assert.equal(await db.source.count({ where: { projectId: user.projectId } }), 0);
    assert.equal(await db.sourceDocument.count({ where: { projectId: user.projectId } }), 0);
  });
});

test("multipart file bytes and CSV task boundaries are enforced", async () => {
  await scenario(async (app, db) => {
    const user = await fixture(db);
    assert.equal((await uploadSource(app, user.cookie, user.projectId, "x".repeat(256 * 1024), "limit.txt", "text/plain")).status, 201);
    assert.equal((await uploadSource(app, user.cookie, user.projectId, "é".repeat(131073), "large.txt", "text/plain")).status, 413);
    assert.equal((await uploadSource(app, user.cookie, user.projectId, "x".repeat(1024 * 1024), "huge.txt", "text/plain")).status, 413);
    const result = await uploadSource(app, user.cookie, user.projectId, "title\n" + "Task\n".repeat(1000), "limit.csv", "text/csv");
    assert.equal(result.status, 201);
    assert.equal(result.body.source.documents.length, 1000);
    assert.equal(await db.source.count({ where: { projectId: user.projectId } }), 2);
  });
});

test("multipart reuses JSON deduplication, permissions and project isolation", async () => {
  await scenario(async (app, db) => {
    const owner = await fixture(db);
    const incoming = await fixture(db, "INCOMING", owner.projectId);
    const outsider = await fixture(db);
    const path = `/api/projects/${owner.projectId}/sources`;
    assert.equal((await request(app).post(path).attach("file", Buffer.from("text"), "notes.md")).status, 401);
    assert.equal((await uploadSource(app, incoming.cookie, owner.projectId, "text")).status, 403);
    assert.equal((await uploadSource(app, outsider.cookie, owner.projectId, "text")).status, 404);
    assert.equal((await uploadSource(app, owner.cookie, owner.projectId, "text").set("Origin", "https://attacker.test")).status, 403);
    assert.equal((await importSource(app, owner.cookie, owner.projectId)).status, 201);
    assert.equal((await uploadSource(app, owner.cookie, owner.projectId, markdown.content, "renamed.txt", "text/plain")).status, 409);
    const other = await uploadSource(app, outsider.cookie, outsider.projectId, markdown.content);
    assert.equal(other.status, 201);
    assert.equal((await request(app).get(`${path}/${other.body.source.id}`).set("Cookie", owner.cookie)).status, 404);
    assert.equal(await db.source.count({ where: { projectId: owner.projectId } }), 1);
    assert.equal(await db.sourceDocument.count({ where: { projectId: owner.projectId } }), 1);
  });
});
