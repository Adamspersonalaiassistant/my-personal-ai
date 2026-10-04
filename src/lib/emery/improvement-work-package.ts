import type { EmeryImprovementProposal } from "./self-improvement.ts";

function slug(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

export type EmeryImprovementWorkPackage = {
  status: "awaiting_user_approval";
  targetCategory: EmeryImprovementProposal["targetCategory"];
  proposedBranch: string;
  objective: string;
  evidence: EmeryImprovementProposal["evidence"];
  acceptanceCriteria: string[];
  requiredValidation: string[];
  constraints: string[];
  productionActionAllowed: false;
  mergeAllowed: false;
  deployAllowed: false;
  requiresExplicitApproval: true;
};

export function buildImprovementWorkPackage(
  proposal: EmeryImprovementProposal,
): EmeryImprovementWorkPackage {
  return {
    status: "awaiting_user_approval",
    targetCategory: proposal.targetCategory,
    proposedBranch: `emery-improvement-${slug(proposal.targetCategory)}`,
    objective: proposal.title,
    evidence: proposal.evidence,
    acceptanceCriteria: proposal.acceptanceCriteria,
    requiredValidation: [
      "node --experimental-strip-types scripts/run-emery-evals.mjs",
      "node --experimental-strip-types scripts/validate-emery-self-improvement.mjs",
      "node --experimental-strip-types scripts/validate-emery-ambient-context.mjs",
      "node --experimental-strip-types scripts/validate-emery-smart-memory.mjs",
      "node --experimental-strip-types scripts/validate-emery-natural-voice.mjs",
      "node --experimental-strip-types scripts/validate-emery-one-brain.mjs",
      "node --experimental-strip-types scripts/validate-emery-capability-router.mjs",
      "node --experimental-strip-types scripts/validate-emery-context.mjs",
      "npm run validate:orchestration",
      "npx tsc --noEmit",
    ],
    constraints: [
      ...proposal.protectedConstraints,
      "Compare baseline vs candidate evaluation summaries before proposing a PR.",
      "Reject the candidate if it worsens duplicate-write safety or introduces a critical regression.",
      "Do not merge or deploy without Adam's explicit approval.",
    ],
    productionActionAllowed: false,
    mergeAllowed: false,
    deployAllowed: false,
    requiresExplicitApproval: true,
  };
}
