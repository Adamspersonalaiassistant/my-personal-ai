import type { EntityResolution } from "./orchestration.types.ts";

export type ResolvableEntity = {
  id: string;
  name: string;
  aliases?: string[];
  email?: string | null;
  phone?: string | null;
  domain?: string | null;
  address?: string | null;
};

export function normalizeEntityText(value: string): string {
  return value
    .toLowerCase()
    .replace(/\b(llc|llp|pllc|pc|p\.c\.|inc|corp|corporation|company|co)\b/g, " ")
    .replace(/\b(suite|ste)\b/g, " ")
    .replace(/\b(www\.|https?:\/\/)/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function resolveEntity<T extends ResolvableEntity>(
  query: string,
  candidates: T[],
): EntityResolution<T> {
  const normalizedQuery = normalizeEntityText(query);
  if (!normalizedQuery)
    return { status: "not_found", question: "Who or which office did you mean?", evidence: [] };

  const scored = candidates
    .map((candidate) => {
      const values = [
        candidate.name,
        ...(candidate.aliases ?? []),
        candidate.email ?? "",
        candidate.phone ?? "",
        candidate.domain ?? "",
        candidate.address ?? "",
      ]
        .map(normalizeEntityText)
        .filter(Boolean);
      const exact = values.some((value) => value === normalizedQuery);
      const contained = values.some(
        (value) => value.includes(normalizedQuery) || normalizedQuery.includes(value),
      );
      const score = exact ? 1 : contained ? 0.86 : 0;
      return {
        candidate,
        score,
        evidence: exact
          ? ["exact normalized match"]
          : contained
            ? ["contained structured-field match"]
            : [],
      };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score);

  if (!scored.length)
    return {
      status: "not_found",
      question: `I couldn't safely identify ${query}. Which person or office did you mean?`,
      evidence: [],
    };
  const top = scored[0];
  if (!top)
    return {
      status: "not_found",
      question: `I couldn't safely identify ${query}. Which person or office did you mean?`,
      evidence: [],
    };
  const tied = scored.filter((item) => item.score === top.score);
  if (tied.length > 1) {
    return {
      status: "ambiguous",
      candidates: tied.map((item) => item.candidate),
      question: `I found more than one match for ${query}. Which one did you mean?`,
      evidence: tied.flatMap((item) => item.evidence),
    };
  }
  return {
    status: "resolved",
    value: top.candidate,
    confidence: top.score,
    evidence: top.evidence,
  };
}
