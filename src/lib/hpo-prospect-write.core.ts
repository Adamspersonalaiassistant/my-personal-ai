export const HPO_PROSPECT_TYPES = [
  "attorney",
  "pcp",
  "chiropractor",
  "physical_therapy",
  "imaging",
  "medical_provider",
  "other",
] as const;

export type HpoProspectType = (typeof HPO_PROSPECT_TYPES)[number];

export type HpoDuplicateCandidate = {
  id: string;
  entity: "prospect" | "account";
  name: string;
  address?: string | null;
  city?: string | null;
  phone?: string | null;
  website?: string | null;
  metadata?: Record<string, unknown> | null;
};

export type HpoDuplicateInput = {
  name: string;
  address?: string | null | undefined;
  city?: string | null | undefined;
  phone?: string | null | undefined;
  website?: string | null | undefined;
};

const LEGAL_SUFFIX = /\b(?:llc|llp|pllc|pc|pa|inc|incorporated|corp|corporation|company|co)\b/g;
const UNIT = /\b(?:suite|ste|unit|floor|fl|room|rm)\s*[a-z0-9-]+\b/g;

export function normalizeHpoProspectName(value: string) {
  return value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(LEGAL_SUFFIX, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeHpoAddress(value?: string | null) {
  return String(value ?? "")
    .normalize("NFKD")
    .toLowerCase()
    .replace(/#/g, " suite ")
    .replace(/\bstreet\b/g, "st")
    .replace(/\bavenue\b/g, "ave")
    .replace(/\bboulevard\b/g, "blvd")
    .replace(/\broad\b/g, "rd")
    .replace(/\bdrive\b/g, "dr")
    .replace(/\bhighway\b/g, "hwy")
    .replace(UNIT, " ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeHpoPhone(value?: string | null) {
  const digits = String(value ?? "").replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) return digits.slice(1);
  return digits;
}

export function normalizeHpoWebsite(value?: string | null) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  try {
    const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    return url.hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

function metadataString(candidate: HpoDuplicateCandidate, key: string) {
  const value = candidate.metadata?.[key];
  return typeof value === "string" ? value : null;
}

export function scoreHpoDuplicate(input: HpoDuplicateInput, candidate: HpoDuplicateCandidate) {
  const reasons: string[] = [];
  let score = 0;
  const name = normalizeHpoProspectName(input.name);
  const candidateName = normalizeHpoProspectName(candidate.name);
  const address = normalizeHpoAddress(input.address);
  const candidateAddress = normalizeHpoAddress(candidate.address);
  const phone = normalizeHpoPhone(input.phone);
  const candidatePhone = normalizeHpoPhone(candidate.phone ?? metadataString(candidate, "phone"));
  const website = normalizeHpoWebsite(input.website);
  const candidateWebsite = normalizeHpoWebsite(
    candidate.website ?? metadataString(candidate, "website"),
  );
  const city = String(input.city ?? "")
    .trim()
    .toLowerCase();
  const candidateCity = String(candidate.city ?? "")
    .trim()
    .toLowerCase();

  if (name && name === candidateName) {
    score += 45;
    reasons.push("normalized_name");
  }
  if (address && address === candidateAddress) {
    score += 40;
    reasons.push("physical_address");
  }
  if (phone && phone === candidatePhone) {
    score += 70;
    reasons.push("phone");
  }
  if (website && website === candidateWebsite) {
    score += 70;
    reasons.push("website_domain");
  }
  if (city && city === candidateCity) {
    score += 10;
    reasons.push("city");
  }

  const confidence = score >= 70 ? "strong" : score >= 50 ? "review" : "none";
  return { score, confidence, reasons } as const;
}

export function findHpoDuplicateMatches(
  input: HpoDuplicateInput,
  candidates: HpoDuplicateCandidate[],
) {
  return candidates
    .map((candidate) => ({ candidate, ...scoreHpoDuplicate(input, candidate) }))
    .filter((match) => match.confidence !== "none")
    .sort((a, b) => b.score - a.score);
}

export function isNewerIso(currentUpdatedAt: string | null | undefined, verifiedAt: string) {
  if (!currentUpdatedAt) return false;
  const current = Date.parse(currentUpdatedAt);
  const verified = Date.parse(verifiedAt);
  return Number.isFinite(current) && Number.isFinite(verified) && current > verified;
}

export function sanitizeHpoMetadata(value: Record<string, unknown> | undefined) {
  if (!value) return {};
  const blocked = new Set(["__proto__", "constructor", "prototype"]);
  const output: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (!blocked.has(key)) output[key] = item;
  }
  if (JSON.stringify(output).length > 12_000) {
    throw new Error("Prospect metadata exceeds the 12 KB safety limit.");
  }
  return output;
}

export function mergeHpoProvenance(
  current: Array<Record<string, unknown>> | null | undefined,
  incoming: Array<Record<string, unknown>>,
) {
  const byUrl = new Map<string, Record<string, unknown>>();
  for (const source of [...(current ?? []), ...incoming]) {
    const url = typeof source["url"] === "string" ? source["url"].trim() : "";
    if (!url) continue;
    try {
      byUrl.set(normalizeHpoWebsite(url) + new URL(url).pathname.replace(/\/$/, ""), source);
    } catch {
      // Ignore malformed legacy provenance rather than blocking a verified update.
    }
  }
  return [...byUrl.values()];
}

export function appendHpoWriteAudit(
  metadata: Record<string, unknown> | null | undefined,
  event: Record<string, unknown>,
) {
  const current = Array.isArray(metadata?.["crm_write_audit"])
    ? (metadata?.["crm_write_audit"] as Array<Record<string, unknown>>)
    : [];
  return {
    ...(metadata ?? {}),
    crm_write_audit: [...current, event].slice(-25),
  };
}
