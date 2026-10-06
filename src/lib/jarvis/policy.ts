// JARVIS runtime policy: risk gating, free-first / paid-credit enforcement,
// protected GitHub operations and sensitive-content guards.
//
// These checks run in code before any tool executes. Prompt text repeats them,
// but the prompt is not the enforcement point.

import type { JarvisToolDefinition } from "./tool-registry.ts";

export type PolicyDecision =
  | { allowed: true }
  | {
      allowed: false;
      reason: "approval_required" | "protected" | "paid_credit_approval_required";
      message: string;
    };

export type TurnApprovals = {
  /** Adam explicitly approved paid-credit use in this very message. */
  paidCreditApproved: boolean;
  /** Adam explicitly approved a high-risk write in this very message. */
  highRiskApproved: boolean;
};

export function evaluateToolPolicy(
  tool: JarvisToolDefinition,
  approvals: TurnApprovals,
): PolicyDecision {
  if (tool.paidCredit && !approvals.paidCreditApproved) {
    return {
      allowed: false,
      reason: "paid_credit_approval_required",
      message: `${tool.name} uses paid credits. Free-first policy: explain why the free path is insufficient, the expected benefit and cost, and wait for Adam's explicit approval.`,
    };
  }
  if (tool.risk === "PROTECTED") {
    return {
      allowed: false,
      reason: "protected",
      message: `${tool.name} is a protected operation (production/security/credential impact). JARVIS cannot run it autonomously; prepare the change for Adam instead.`,
    };
  }
  if (tool.risk === "HIGH_RISK_WRITE" && !approvals.highRiskApproved) {
    return {
      allowed: false,
      reason: "approval_required",
      message: `${tool.name} is a high-risk write and needs Adam's explicit approval first.`,
    };
  }
  return { allowed: true };
}

// ------------------------------------------------------------------ credits

const PAID_SERVICE_PATTERNS: Array<{ service: string; pattern: RegExp }> = [
  {
    service: "Lovable AI generation credits",
    pattern:
      /\b(lovable)\b[^.?!]{0,60}\b(ai|agent|prompt|generate|generation|credits?|build it|send (it|a message)|ask)\b|\b(use|spend|burn)\b[^.?!]{0,30}\blovable\b[^.?!]{0,20}\bcredits?\b/i,
  },
  {
    service: "Premium external coding credits",
    pattern:
      /\b(codex|devin|cursor|copilot workspace|claude code|replit agent|bolt|v0)\b[^.?!]{0,50}\b(credits?|run|session|agent|build|implement)\b/i,
  },
  {
    service: "Paid research/implementation credits",
    pattern:
      /\b(paid|premium)\b[^.?!]{0,40}\b(credits?|model|research|agent|implementation|api)\b/i,
  },
];

const APPROVAL_PATTERN =
  /\b(i (approve|authori[sz]e)|approved|go ahead and (use|spend)|you (have|can have) (my )?approval|yes,? (use|spend))\b[^.?!]{0,60}\b(credits?|lovable|paid|premium|codex|devin|cursor)\b/i;

const NEGATION_PATTERN =
  /\b(don'?t|do not|never|without|no)\b[^.?!]{0,25}\b(use|spend|burn|using|spending)?\b[^.?!]{0,15}\b(credits?|lovable ai|paid)\b/i;

export type PaidCreditAssessment = {
  requestsPaidPath: boolean;
  approved: boolean;
  services: string[];
};

export function assessPaidCreditRequest(message: string): PaidCreditAssessment {
  const text = message.trim();
  if (!text || NEGATION_PATTERN.test(text))
    return { requestsPaidPath: false, approved: false, services: [] };
  const services = PAID_SERVICE_PATTERNS.filter((entry) => entry.pattern.test(text)).map(
    (e) => e.service,
  );
  return {
    requestsPaidPath: services.length > 0,
    approved: services.length > 0 && APPROVAL_PATTERN.test(text),
    services,
  };
}

export function paidCreditApprovalMessage(assessment: PaidCreditAssessment, request: string) {
  const service = assessment.services.join(" + ") || "paid credits";
  return [
    `Stopping before spending anything. That request would use **${service}**, and my standing policy is free-first: paid credits need your explicit approval.`,
    "",
    `**What:** ${service} for: “${request.slice(0, 220)}${request.length > 220 ? "…" : ""}”`,
    "**Why I'd consider it:** only if the direct path (GitHub branch → edit → test → PR, Supabase, existing tests) cannot do the job well. I haven't established that yet.",
    "**Expected benefit:** faster generation of large UI scaffolding, at the cost of less control over the diff.",
    "**Expected cost:** Lovable/premium credits per request; exact usage isn't knowable in advance.",
    "**Free alternative (my default):** I inspect the source, create an isolated `jarvis/` branch, make the edit directly, run the checks and open a PR — no paid credits.",
    "",
    "Say “I approve using Lovable credits for this” if you want the paid route. Otherwise I'll proceed on the free path.",
  ].join("\n");
}

// ------------------------------------------------------------------- GitHub
// Repository guards live in guards.ts (shared verbatim with the edge function).
export {
  assertCandidateBranch,
  assertSafeContent,
  assertSafeRepoPath,
  PolicyError,
  redactSecrets,
} from "./guards.ts";
