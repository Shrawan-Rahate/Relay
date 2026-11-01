import { createHash } from "node:crypto";
import type { ClaimType, KnowledgeGapCategory } from "./generated/prisma/client.js";

export type GapClaim = { id: string; type: ClaimType; text: string };
type Field = "owner" | "status" | "dependency" | "decision";
type Statement = { claim: GapClaim; subject: string; key: string; field: Field; value: string };
export type GapCandidate = { category: KnowledgeGapCategory; fingerprint: string; question: string; subject: string; field: Field; reason: string; claimIds: string[] };
const clean = (value: string) => value.trim().replace(/[.!;]+$/, "").trim();
const normalize = (value: string) => clean(value).toLowerCase().replace(/\s+/g, " ");
const unknown = (value: string) => /^(?:\?|n\/a|none)$/i.test(clean(value)) || /\b(?:unknown|tbd|tba|unassigned|unspecified|unclear|undecided|not (?:yet )?(?:assigned|specified|known)|no owner)\b/i.test(value);

function statement(claim: GapClaim): Statement | undefined {
  const text = clean(claim.text);
  let match: RegExpMatchArray | null;
  const field = ({ OWNER: "owner", STATUS: "status", DEPENDENCY: "dependency", DECISION: "decision" } as const)[claim.type as Exclude<ClaimType, "RISK">];
  if (!field) return;
  // Only explicit subject/field syntax establishes shared scope. No fuzzy entity matching.
  const label = field === "owner" ? "(?:owner|assignee)" : field === "dependency" ? "(?:dependency|dependencies)" : field;
  match = text.match(new RegExp(`^(.+?)\\s+${label}(?:\\s+is|\\s*[:=])\\s*(.+)$`, "i"));
  if (match) return { claim, subject: clean(match[1]!), key: normalize(match[1]!), field, value: clean(match[2]!) };
  if (field === "owner" && (match = text.match(/^(.+?)\s+owns\s+(.+)$/i))) return { claim, subject: clean(match[2]!), key: normalize(match[2]!), field, value: clean(match[1]!) };
  if (field === "owner" && (match = text.match(/^owner (?:of|for) (.+?)(?:\s+is|\s*[:=])\s*(.+)$/i))) return { claim, subject: clean(match[1]!), key: normalize(match[1]!), field, value: clean(match[2]!) };
  if (field === "dependency" && (match = text.match(/^(.+?)\s+(?:depends on|requires|is blocked by)\s+(.+)$/i))) return { claim, subject: clean(match[1]!), key: normalize(match[1]!), field, value: clean(match[2]!) };
  if (field === "status" && (match = text.match(/^(.+?)\s+is\s+(.+)$/i))) return { claim, subject: clean(match[1]!), key: normalize(match[1]!), field, value: clean(match[2]!) };
  // An unstructured decision can prompt clarification, but cannot be equated to another subject.
  if (field === "decision") return { claim, subject: text, key: `decision:${normalize(text)}`, field, value: text };
  return;
}

function resolvedDependency(value: string) {
  // Explicit absence is different from an unknown dependency.
  if (/^(?:none|n\/a|no dependenc(?:y|ies)(?: required)?|not required)$/i.test(clean(value))) return true;
  // Completion words inside future, conditional or uncertain statements are not resolution.
  return !unknown(value) && !/\b(?:not|unresolved|pending|awaiting|blocked|possibly|maybe|if|unless|will|might|may|should|could|would|can|must|next|tomorrow|later|soon|planned|expected|scheduled)\b/i.test(value)
    && /\b(?:resolved|satisfied|completed|complete|done|available)$/i.test(clean(value));
}
function dependencyTarget(value: string) {
  // Remove only explicit trailing state labels, retaining the dependency's own wording.
  return normalize(value).replace(/(?:\s+(?:is|remains))?\s+(?:(?:not(?: yet)?|still)\s+)?(?:unresolved|resolved|pending|satisfied|completed|complete|done|available)$/, "");
}

export function detectKnowledgeGaps(claims: GapClaim[]): GapCandidate[] {
  const groups = new Map<string, Statement[]>();
  for (const claim of claims) {
    const parsed = statement(claim);
    if (!parsed) continue;
    const group = groups.get(parsed.key) ?? [];
    group.push(parsed); groups.set(parsed.key, group);
  }
  const candidates: GapCandidate[] = [];
  for (const [key, statements] of groups) {
    const subject = statements[0]!.subject;
    const add = (category: KnowledgeGapCategory, field: Field, evidence: Statement[], reason: string, question: string, detail = "") => {
      const fingerprint = createHash("sha256").update(JSON.stringify([category, key, field, detail])).digest("hex");
      candidates.push({ category, field, subject, reason, question, fingerprint, claimIds: [...new Set(evidence.map(item => item.claim.id))].sort() });
    };
    const owners = statements.filter(item => item.field === "owner");
    const statuses = statements.filter(item => item.field === "status");
    if (!owners.length || owners.some(item => unknown(item.value))) add("MISSING_OWNER", "owner", owners.length ? owners : statements,
      "No explicit, settled owner is established in the related extracted claims.",
      `Who is the current owner for “${subject}”, given the linked evidence and the absence of a clear owner in these extracted claims?`);
    if (!statuses.length || statuses.some(item => unknown(item.value))) add("UNCLEAR_STATUS", "status", statuses.length ? statuses : statements,
      "The related extracted claims do not establish a clear current status.",
      `What is the current status of “${subject}”, and which dated source confirms it?`);
    const dependencies = statements.filter(item => item.field === "dependency" && !resolvedDependency(item.value));
    // Group duplicate extractions of the same dependency without conflating distinct targets.
    const targets = new Map<string, Statement[]>();
    for (const item of dependencies) {
      const target = dependencyTarget(item.value); const related = targets.get(target) ?? [];
      related.push(item); targets.set(target, related);
    }
    for (const [target, related] of targets) add("UNRESOLVED_DEPENDENCY", "dependency", related,
      "The dependency is mentioned without an unqualified resolution in these claims; its present state needs confirmation.",
      `For “${subject}”, has the dependency described as “${related[0]!.value}” been satisfied, and what source confirms its current state?`, target);
    for (const field of ["owner", "status", "decision"] as const) {
      const related = statements.filter(item => item.field === field && !unknown(item.value));
      if (new Set(related.map(item => normalize(item.value))).size < 2) continue;
      const values = [...new Set(related.map(item => item.value))].map(value => `“${value}”`).join(" versus ");
      add("POTENTIAL_CONFLICT", field, related,
        "Different statements share an explicit subject. They may reflect different scope or a change over time, not a proven contradiction.",
        `For “${subject}”, do the ${field} statements ${values} reflect a change over time or different scope, and which applies now?`);
    }
  }
  return candidates;
}
