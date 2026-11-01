import busboy from "busboy";
import type { Request } from "express";
import { IngestionError, MAX_BYTES } from "./ingestion.js";

const invalid = () => new IngestionError(400, "INVALID_INPUT", "Invalid multipart source upload");
const tooLarge = () => new IngestionError(413, "PAYLOAD_TOO_LARGE", "Source content exceeds 256 KiB");

// One in-memory file; bounded wire size also caps multipart headers and fields.
export function readUpload(req: Request): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let parser: ReturnType<typeof busboy>;
    try {
      parser = busboy({ headers: req.headers, preservePath: true, defParamCharset: "utf8",
        limits: { files: 1, fields: 1, parts: 3, fileSize: MAX_BYTES + 1, fieldSize: 8192 } });
    } catch { reject(invalid()); return; }
    let failure: IngestionError | undefined;
    let wireBytes = 0;
    let file: { type: string; filename: string; content: string } | undefined;
    let metadata: unknown = {};
    const onData = (chunk: Buffer) => {
      wireBytes += chunk.length;
      if (wireBytes > MAX_BYTES + 16384) {
        failure = tooLarge();
        req.unpipe(parser);
        parser.destroy();
        req.resume();
      }
    };
    const onAborted = () => { failure = invalid(); parser.destroy(); };
    req.on("data", onData);
    req.once("aborted", onAborted);
    req.once("error", onAborted);
    parser.on("file", (name, stream, info) => {
      const extension = /\.(md|txt|csv)$/i.exec(info.filename)?.[1]?.toLowerCase();
      const type = extension === "md" ? "MARKDOWN" : extension === "txt" ? "TXT" : extension === "csv" ? "CSV" : undefined;
      const mediaType = type === "MARKDOWN" ? "text/markdown" : type === "TXT" ? "text/plain" : "text/csv";
      if (name !== "file" || !type || ![mediaType, "text/plain", "application/octet-stream"].includes(info.mimeType)) failure = invalid();
      const chunks: Buffer[] = [];
      let size = 0;
      stream.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > MAX_BYTES) failure = tooLarge();
        else chunks.push(chunk);
      });
      stream.on("limit", () => { failure = tooLarge(); });
      stream.on("error", () => { failure ??= invalid(); });
      stream.on("end", () => {
        if (failure) return;
        try {
          // Fatal decoding rejects malformed bytes; ignoreBOM preserves the original BOM.
          const content = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(Buffer.concat(chunks));
          file = { type: type!, filename: info.filename, content };
        } catch { failure = invalid(); }
      });
    });
    parser.on("field", (name, value, info) => {
      if (name !== "metadata" || info.valueTruncated || info.nameTruncated) { failure = invalid(); return; }
      try { metadata = JSON.parse(value); } catch { failure = invalid(); }
    });
    for (const event of ["filesLimit", "fieldsLimit", "partsLimit"] as const) {
      parser.on(event, () => { failure = invalid(); });
    }
    parser.on("error", () => { failure ??= invalid(); });
    parser.on("close", () => {
      req.off("data", onData);
      req.off("aborted", onAborted);
      req.off("error", onAborted);
      if (failure || !file) reject(failure ?? invalid());
      else resolve({ ...file, metadata });
    });
    req.pipe(parser);
  });
}
