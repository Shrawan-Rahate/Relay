import { createHash } from "node:crypto";
import { parse } from "csv-parse/sync";
import type { Info } from "csv-parse";
import { z } from "zod";
import type { Prisma } from "./generated/prisma/client.js";

export const MAX_BYTES = 256 * 1024;
const MAX_TASKS = 1000;
const input = z.object({
  type: z.enum(["MARKDOWN", "TXT", "CSV"]),
  filename: z.string().min(1).max(255).regex(/^[^/\\\u0000-\u001f\u007f]+$/),
  content: z.string(),
  metadata: z.record(z.string(), z.json()).default({}).refine(value => Buffer.byteLength(JSON.stringify(value), "utf8") <= 8192),
}).strict();

export class IngestionError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message); }
}
const invalid = () => new IngestionError(400, "INVALID_INPUT", "Invalid source content or import details");
export const sha256 = (content: string) => createHash("sha256").update(content, "utf8").digest("hex");

type Document = { position: number; content: string; sha256: string; metadata: Prisma.InputJsonObject };
type CsvRecord = { record: string[]; info: Info };

export function prepareImport(body: unknown) {
  const parsed = input.safeParse(body);
  if (!parsed.success) throw invalid();
  const { type, filename, content, metadata } = parsed.data;
  const bytes = Buffer.from(content, "utf8");
  if (bytes.length > MAX_BYTES) throw new IngestionError(413, "PAYLOAD_TOO_LARGE", "Source content exceeds 256 KiB");
  if (!content.trim() || bytes.toString("utf8") !== content || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(content)) throw invalid();
  if (!(type === "MARKDOWN" ? /\.(md|markdown)$/i : type === "TXT" ? /\.txt$/i : /\.csv$/i).test(filename)) throw invalid();

  const documents: Document[] = [];
  const provenance: { [key: string]: Prisma.InputJsonValue } = {
    method: "manual_import", encoding: "utf-8", formatVersion: 1,
    mediaType: type === "MARKDOWN" ? "text/markdown" : type === "TXT" ? "text/plain" : "text/csv",
  };
  if (type !== "CSV") {
    documents.push({ position: 1, content, sha256: sha256(content), metadata: { startByte: 0, endByte: bytes.length } });
  } else {
    let records: CsvRecord[];
    try {
      records = parse(content, {
        bom: true, info: true, skip_empty_lines: true,
        relax_column_count: false, max_record_size: 65536,
        // At most one header plus the limit and one overflow record.
        to: MAX_TASKS + 2,
      }) as unknown as CsvRecord[];
    } catch { throw invalid(); }
    if (records.length < 2 || records.length > MAX_TASKS + 1) throw invalid();
    const headers = records[0]!.record;
    const normalized = headers.map(header => header.trim().toLowerCase());
    const titleIndex = normalized.indexOf("title");
    if (headers.length > 50 || normalized.some(header => !header) || new Set(normalized).size !== headers.length || titleIndex < 0) throw invalid();
    provenance.parser = "csv-parse@7.0.3";
    let startByte = records[0]!.info.bytes_records;
    for (const [index, record] of records.slice(1).entries()) {
      if (record.record.length !== headers.length || !record.record[titleIndex]?.trim()) throw invalid();
      const endByte = record.info.bytes_records;
      const originalRecord = bytes.subarray(startByte, endByte).toString("utf8");
      documents.push({
        position: index + 1, content: originalRecord, sha256: sha256(originalRecord),
        metadata: { recordNumber: index + 2, endLine: record.info.lines, startByte, endByte, headers, values: record.record },
      });
      startByte = endByte;
    }
  }
  return {
    type, filename, originalContent: content, metadata: metadata as Prisma.InputJsonObject,
    sha256: sha256(content), byteSize: bytes.length, provenance, documents,
  };
}
