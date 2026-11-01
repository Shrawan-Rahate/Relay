import type { ReviewAction } from "./generated/prisma/client.js";

export const finalReviewActions: ReviewAction[] = ["APPROVE", "EDIT", "REJECT"];
export const latestReview = { orderBy: { sequence: "desc" as const }, take: 1, select: { action: true, correctedText: true } };
const statuses = { APPROVE: "APPROVED", EDIT: "EDITED", REJECT: "REJECTED", DEFER: "DEFERRED" } as const;

export function reviewedAnswer<T extends { answerText: string; reviews: { action: ReviewAction; correctedText: string | null }[] }>(answer: T) {
  const { reviews, ...original } = answer;
  const decision = reviews[0];
  return { ...original, effectiveReviewStatus: decision ? statuses[decision.action] : "PENDING_REVIEW" as const,
    effectiveText: decision?.action === "APPROVE" ? answer.answerText : decision?.action === "EDIT" ? decision.correctedText : null };
}
