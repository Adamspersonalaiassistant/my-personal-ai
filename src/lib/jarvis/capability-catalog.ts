// Unified capability catalogue = Emery runtime capability registry
// + Emery execution capability families + JARVIS engineering tools.
//
// capability.search returns only relevant entries (not the whole catalogue
// every turn); capability.health is computed from real evidence by the caller
// (receipts/runtime events) via `healthFromEvidence`.

import { CAPABILITY_REGISTRY } from "../emery/capability-registry.ts";
import { EMERY_EXECUTION_CAPABILITIES } from "../execution-capabilities.ts";
import { tokenize } from "./knowledge.ts";
import { JARVIS_TOOLS, type JarvisToolRisk } from "./tool-registry.ts";

export type CatalogEntry = {
  name: string;
  owner: "emery" | "jarvis";
  family: string;
  risk: JarvisToolRisk;
  description: string;
  keywords: string[];
  executable: boolean;
  requiresEnv: string[];
  /** Emery execution ledger action names that evidence this capability. */
  evidenceActions: string[];
  paidCredit: boolean;
};

function emeryRisk(mode: "read" | "write", risk: string): JarvisToolRisk {
  if (mode === "read") return "READ";
  return risk === "high" ? "HIGH_RISK_WRITE" : "REVERSIBLE_WRITE";
}

function buildCatalog(): CatalogEntry[] {
  const entries: CatalogEntry[] = [];
  for (const def of Object.values(CAPABILITY_REGISTRY)) {
    entries.push({
      name: def.action,
      owner: "emery",
      family: def.action.split(".")[0] ?? "emery",
      risk: emeryRisk(def.mode, def.risk),
      description: `${def.name}: ${def.description}`,
      keywords: [...def.action.split(/[._]/), ...def.name.toLowerCase().split(/\s+/)],
      executable: true,
      requiresEnv: [],
      evidenceActions: [def.action, def.action.replace(/\./g, "_")],
      paidCredit: false,
    });
  }
  for (const [family, value] of Object.entries(EMERY_EXECUTION_CAPABILITIES)) {
    const actions = "actions" in value ? [...value.actions] : [];
    entries.push({
      name: `emery.${family}`,
      owner: "emery",
      family,
      risk: value.canExecute ? "REVERSIBLE_WRITE" : "READ",
      description: value.canExecute
        ? `Emery ${family.replace(/_/g, " ")}: ${actions.join("; ")}`
        : `Emery ${family.replace(/_/g, " ")} — not available: ${"note" in value ? value.note : "not connected"}`,
      keywords: [...family.split("_"), ...actions.flatMap((a) => a.toLowerCase().split(/\s+/))],
      executable: value.canExecute,
      requiresEnv: [],
      evidenceActions: [family],
      paidCredit: false,
    });
  }
  for (const tool of JARVIS_TOOLS) {
    entries.push({
      name: tool.name,
      owner: "jarvis",
      family: tool.family,
      risk: tool.risk,
      description: tool.description,
      keywords: tool.keywords,
      executable: tool.risk !== "PROTECTED",
      requiresEnv: tool.requiresEnv ?? [],
      evidenceActions: [tool.name],
      paidCredit: Boolean(tool.paidCredit),
    });
  }
  return entries;
}

export const CAPABILITY_CATALOG: CatalogEntry[] = buildCatalog();

export function searchCapabilities(query: string, opts: { limit?: number; owner?: "emery" | "jarvis" } = {}) {
  const queryTokens = tokenize(query);
  const raw = String(query ?? "").toLowerCase();
  const limit = Math.min(Math.max(opts.limit ?? 8, 1), 25);
  return CAPABILITY_CATALOG.filter((entry) => !opts.owner || entry.owner === opts.owner)
    .map((entry) => {
      const nameTokens = tokenize(entry.name.replace(/[._]/g, " "));
      const keywordTokens = new Set(entry.keywords.flatMap((k) => tokenize(k)));
      const descTokens = new Set(tokenize(entry.description));
      let score = raw.includes(entry.name.toLowerCase()) ? 10 : 0;
      for (const token of queryTokens) {
        if (nameTokens.includes(token)) score += 3;
        if (keywordTokens.has(token)) score += 2;
        else if (descTokens.has(token)) score += 1;
      }
      if (!entry.executable) score -= 0.5;
      return { entry, score };
    })
    .filter((hit) => hit.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ entry, score }) => ({
      name: entry.name,
      owner: entry.owner,
      family: entry.family,
      risk: entry.risk,
      executable: entry.executable,
      paid_credit: entry.paidCredit,
      description: entry.description,
      score: Math.round(score * 10) / 10,
    }));
}

export function describeCapability(name: string, env: Record<string, string | undefined> = {}) {
  const entry = CAPABILITY_CATALOG.find((item) => item.name === name);
  if (!entry) return null;
  const missingEnv = entry.requiresEnv.filter((key) => !env[key]);
  return {
    ...entry,
    configured: missingEnv.length === 0,
    missing_configuration: missingEnv,
    autonomy:
      entry.paidCredit
        ? "paid credits — Adam approval required"
        : entry.risk === "PROTECTED"
          ? "protected — never autonomous"
          : entry.risk === "HIGH_RISK_WRITE"
            ? "Adam approval required"
            : "autonomous",
  };
}

export type CapabilityHealth = "healthy" | "degraded" | "failing" | "not_configured" | "unavailable" | "configured_untested";

export type HealthEvidence = {
  receipts: Array<{ action: string; status: string; created_at: string; error_message?: string | null }>;
  toolEvents: Array<{ action: string; status: string; created_at: string }>;
  env: Record<string, string | undefined>;
};

export function healthFromEvidence(entry: CatalogEntry, evidence: HealthEvidence) {
  if (!entry.executable) return { name: entry.name, health: "unavailable" as CapabilityHealth, detail: entry.description };
  const missing = entry.requiresEnv.filter((key) => !evidence.env[key]);
  if (missing.length) return { name: entry.name, health: "not_configured" as CapabilityHealth, detail: `Missing server secret(s): ${missing.join(", ")}` };
  const wanted = new Set(entry.evidenceActions.map((a) => a.toLowerCase()));
  const matches = [
    ...evidence.receipts.filter((r) => wanted.has(String(r.action).toLowerCase())).map((r) => ({ ok: r.status === "completed", at: r.created_at, error: r.error_message ?? null })),
    ...evidence.toolEvents.filter((e) => wanted.has(String(e.action).toLowerCase())).map((e) => ({ ok: e.status === "ok", at: e.created_at, error: null })),
  ].sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  if (!matches.length) return { name: entry.name, health: "configured_untested" as CapabilityHealth, detail: "Configured; no recent execution evidence." };
  const recent = matches.slice(0, 20);
  const successRate = recent.filter((m) => m.ok).length / recent.length;
  const lastSuccess = recent.find((m) => m.ok)?.at ?? null;
  const lastFailure = recent.find((m) => !m.ok);
  const health: CapabilityHealth = successRate >= 0.9 ? "healthy" : successRate >= 0.5 ? "degraded" : "failing";
  return {
    name: entry.name,
    health,
    detail: `${Math.round(successRate * 100)}% success over last ${recent.length} executions`,
    last_success: lastSuccess,
    last_failure: lastFailure ? { at: lastFailure.at, error: lastFailure.error } : null,
  };
}
