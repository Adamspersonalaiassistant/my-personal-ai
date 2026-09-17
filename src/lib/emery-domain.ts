export type EmeryDomain = "hpo" | "personal" | "general" | "mixed";

export type DomainRoute = {
  domain: EmeryDomain;
  confidence: number;
  reason: string;
};

const HPO = /\b(hpo|hudson pro|patient management|pcc|pip|workers? comp|referral source|attorney office|provider office|marketing route|office visit|lunch meeting|referrals?|account visit)\b/i;
const PERSONAL = /\b(personal|family|denice|bryson|home|house|credit|budget|money|finance|workout|golf|music|dj|rave|routine|habit|birthday|vacation|appointment)\b/i;

/**
 * Cheap deterministic first-pass router. It never changes Emery's identity; it only
 * tells the operating system which data domain(s) are relevant for a turn.
 */
export function inferEmeryDomain(message: string): DomainRoute {
  const text = message.trim();
  if (!text) return { domain: "general", confidence: 1, reason: "empty/general input" };
  const hpo = HPO.test(text);
  const personal = PERSONAL.test(text);
  if (hpo && personal) return { domain: "mixed", confidence: 0.9, reason: "work and personal signals" };
  if (hpo) return { domain: "hpo", confidence: 0.92, reason: "Hudson Pro/work signal" };
  if (personal) return { domain: "personal", confidence: 0.86, reason: "personal/life signal" };
  return { domain: "general", confidence: 0.72, reason: "no durable domain signal" };
}

export function domainPrompt(route: DomainRoute) {
  const shared = "Domain is a data-routing hint only. Emery remains the same companion, personality, judgment and relationship everywhere.";
  if (route.domain === "hpo") return `${shared} Treat this turn as HPO/work context when saving or retrieving structured information.`;
  if (route.domain === "personal") return `${shared} Treat this turn as Personal context when saving or retrieving structured information.`;
  if (route.domain === "mixed") return `${shared} This turn spans HPO and Personal; relevant writes may update both domains without forcing Adam to choose a workspace.`;
  return `${shared} Keep this General/Unfiled unless stronger context establishes HPO or Personal.`;
}

export function domainMetadata(domain: EmeryDomain) {
  return { domain, emery_identity: "central-v1" } as const;
}
