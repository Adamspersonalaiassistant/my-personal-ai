// Opportunity Radar. Pure: consumes rows from Emery's EXISTING telemetry and
// evaluation systems (emery_runtime_events, emery_execution_runs,
// emery_improvement_backlog, emery_self_evaluations) and turns recurring,
// high-value problem signals into ranked, de-duplicated engineering tasks.
//
// score = impact × frequency × severity × confidence × feasibility ÷ risk

export type RadarSignal =
  | "capability_gap"
  | "tool_misroute"
  | "missing_context"
  | "research_insufficient"
  | "write_blocked"
  | "integration_missing"
  | "user_correction"
  | "goal_incomplete"
  | "runtime_error"
  | "regression"
  | "self_weakness";

export const SIGNAL_IMPACT: Record<RadarSignal, number> = {
  capability_gap: 4,
  tool_misroute: 3,
  missing_context: 3,
  research_insufficient: 2,
  write_blocked: 5,
  integration_missing: 3,
  user_correction: 5,
  goal_incomplete: 4,
  runtime_error: 4,
  regression: 5,
  // JARVIS's own engineering failures (tool errors, worker step errors).
  self_weakness: 4,
};

const SIGNALS = new Set(Object.keys(SIGNAL_IMPACT));

export type RadarInputs = {
  events: Array<{
    event_type: string;
    status: string;
    action: string | null;
    domain: string | null;
    channel?: string | null;
    metadata: any;
    created_at: string;
  }>;
  receipts: Array<{
    action: string;
    domain: string | null;
    status: string;
    error_code: string | null;
    error_message: string | null;
    created_at: string;
  }>;
  backlog: Array<{
    id: string;
    area: string;
    title: string;
    problem_statement: string;
    severity: number;
    confidence: number;
    status: string;
    occurrence_count: number;
    last_observed_at: string;
  }>;
  evaluations: Array<{
    target_type: string;
    target_ref: string | null;
    findings: any;
    created_at: string;
  }>;
  /** JARVIS's own jarvis_tool / jarvis_worker error events (self-observation). */
  selfEvents?: Array<{
    event_type: string;
    status: string;
    action: string | null;
    metadata: any;
    created_at: string;
  }>;
};

/** Where JARVIS's own engineering code lives, per failing subsystem. */
export const SELF_TARGETS: Record<string, string[]> = {
  tool: ["src/lib/jarvis/tool-gateway.ts", "src/lib/jarvis/tool-registry.ts"],
  worker: ["supabase/functions/jarvis-worker/engine.ts"],
};

export type Opportunity = {
  dedupe_key: string;
  signal: RadarSignal;
  subject: string;
  title: string;
  objective: string;
  score: number;
  occurrences: number;
  severity: number;
  confidence: number;
  feasibility: number;
  risk: number;
  kind: "code_change" | "diagnostic";
  target_paths: string[];
  evidence: Array<Record<string, unknown>>;
  fixture: boolean;
};

type Cluster = {
  signal: RadarSignal;
  subject: string;
  occurrences: number;
  severity: number;
  confidence: number;
  evidence: Array<Record<string, unknown>>;
  fixture: boolean;
  capability?: string;
  request?: string;
};

function str(value: unknown) {
  return typeof value === "string" ? value : value == null ? "" : String(value);
}

/** Classify one runtime event into a radar signal (or null when it is not a problem). */
export function classifyEvent(event: RadarInputs["events"][number]): RadarSignal | null {
  const meta = event.metadata && typeof event.metadata === "object" ? event.metadata : {};
  const declared = str(meta.signal ?? meta.category);
  if (SIGNALS.has(declared)) return declared as RadarSignal;
  const type = str(event.event_type);
  if (
    /capability_gap|unsupported/.test(type) ||
    /capability_gap|unsupported/.test(str(event.action))
  )
    return "capability_gap";
  if (/user_correction|correction/.test(type)) return "user_correction";
  if (/regression/.test(type)) return "regression";
  if (
    event.event_type === "jarvis_tool" ||
    event.event_type === "jarvis_worker" ||
    event.event_type === "jarvis_radar"
  )
    return null;
  if (event.status === "error") return "runtime_error";
  if (
    event.status === "clarification" &&
    /route|tool|hpo_action/.test(`${type} ${str(event.action)}`)
  )
    return "tool_misroute";
  if (event.status === "clarification") return "missing_context";
  return null;
}

function receiptSignal(receipt: RadarInputs["receipts"][number]): RadarSignal | null {
  if (receipt.status !== "failed") return null;
  if (
    /permission|forbidden|rls|blocked|denied/i.test(
      `${receipt.error_code ?? ""} ${receipt.error_message ?? ""}`,
    )
  )
    return "write_blocked";
  return "runtime_error";
}

const CAPABILITY_TARGETS = [
  "src/lib/execution-capabilities.ts",
  "src/lib/emery/capability-registry.ts",
];

export function scoreCluster(cluster: Cluster) {
  const impact = SIGNAL_IMPACT[cluster.signal];
  const frequency = Math.min(3, 1 + Math.log2(Math.max(1, cluster.occurrences)));
  const severity = Math.min(5, Math.max(1, cluster.severity)) / 3;
  const confidence = Math.min(1, Math.max(0.1, cluster.confidence));
  const feasibility =
    (cluster.signal === "capability_gap" && cluster.capability) ||
    cluster.signal === "self_weakness" // JARVIS's own code: known location, high feasibility
      ? 0.9
      : cluster.signal === "integration_missing"
        ? 0.4
        : 0.6;
  const risk = cluster.signal === "write_blocked" ? 1.6 : 1.1;
  const score = (impact * frequency * severity * confidence * feasibility) / risk;
  return { score: Math.round(score * 100) / 100, feasibility, risk };
}

export function buildOpportunities(
  inputs: RadarInputs,
  opts: { minScore?: number; minOccurrences?: number } = {},
): Opportunity[] {
  const clusters = new Map<string, Cluster>();
  const add = (
    signal: RadarSignal,
    subject: string,
    severity: number,
    confidence: number,
    evidence: Record<string, unknown>,
    extra: Partial<Cluster> = {},
  ) => {
    const key = `${signal}:${subject}`.toLowerCase();
    const existing = clusters.get(key);
    if (existing) {
      existing.occurrences += 1;
      existing.severity = Math.max(existing.severity, severity);
      existing.confidence = Math.max(existing.confidence, confidence);
      if (existing.evidence.length < 6) existing.evidence.push(evidence);
      existing.fixture = existing.fixture && Boolean(extra.fixture);
      return;
    }
    clusters.set(key, {
      signal,
      subject,
      occurrences: 1,
      severity,
      confidence,
      evidence: [evidence],
      fixture: Boolean(extra.fixture),
      ...extra,
    });
  };

  for (const event of inputs.events) {
    const signal = classifyEvent(event);
    if (!signal) continue;
    const meta = event.metadata && typeof event.metadata === "object" ? event.metadata : {};
    const capability = str(meta.capability);
    const subject = capability || str(event.action) || str(event.domain) || event.event_type;
    add(
      signal,
      subject,
      Number(meta.severity ?? (signal === "runtime_error" ? 3 : 3)),
      Number(meta.confidence ?? 0.7),
      {
        source: "emery_runtime_events",
        at: event.created_at,
        event_type: event.event_type,
        action: event.action,
        request: meta.request ?? null,
        observed: meta.observed ?? meta.error ?? null,
      },
      {
        fixture: meta.fixture === true,
        ...(capability ? { capability } : {}),
        ...(meta.request ? { request: str(meta.request) } : {}),
      },
    );
  }
  for (const receipt of inputs.receipts) {
    const signal = receiptSignal(receipt);
    if (!signal) continue;
    add(signal, receipt.action, 3, 0.8, {
      source: "emery_execution_runs",
      at: receipt.created_at,
      action: receipt.action,
      error: receipt.error_code ?? receipt.error_message,
    });
  }
  for (const item of inputs.backlog) {
    if (!["observed", "proposed"].includes(item.status)) continue;
    const text = `${item.title} ${item.problem_statement}`.toLowerCase();
    const signal: RadarSignal = /capabil|not connected|cannot|can't/.test(text)
      ? "capability_gap"
      : /correct/.test(text)
        ? "user_correction"
        : "goal_incomplete";
    const cluster = { signal, subject: item.title.slice(0, 80) };
    for (let i = 0; i < Math.max(1, Math.min(item.occurrence_count, 8)); i += 1)
      add(cluster.signal, cluster.subject, item.severity, Number(item.confidence ?? 0.6), {
        source: "emery_improvement_backlog",
        id: item.id,
        at: item.last_observed_at,
        title: item.title,
      });
  }
  for (const evaluation of inputs.evaluations) {
    const findings = Array.isArray(evaluation.findings) ? evaluation.findings : [];
    for (const finding of findings) {
      if (!finding || finding.passed !== false) continue;
      const signal: RadarSignal = SIGNALS.has(str(finding.category))
        ? (finding.category as RadarSignal)
        : "regression";
      add(
        signal,
        str(finding.category || evaluation.target_type),
        Number(finding.severity ?? 3),
        0.6,
        {
          source: "emery_self_evaluations",
          at: evaluation.created_at,
          expected: finding.expected ?? null,
          observed: finding.observed ?? null,
        },
      );
    }
  }

  // Self-observation: recurring failures in JARVIS's own tools and worker stages.
  // Expected refusals (policy, not_configured) are not weaknesses.
  for (const event of inputs.selfEvents ?? []) {
    if (event.status !== "error") continue;
    const meta = event.metadata && typeof event.metadata === "object" ? event.metadata : {};
    if (["policy", "not_configured"].includes(str(meta.kind))) continue;
    const isTool = event.event_type === "jarvis_tool";
    const subject = isTool
      ? `jarvis_tool:${str(event.action)}`
      : `jarvis_worker:${str(event.action).replace(/:error$/, "")}`;
    add(
      "self_weakness",
      subject,
      Number(meta.severity ?? 3),
      Number(meta.confidence ?? 0.8),
      {
        source: "jarvis_self_observation",
        at: event.created_at,
        event_type: event.event_type,
        action: event.action,
        observed: str(meta.error).slice(0, 300) || null,
      },
      { fixture: meta.fixture === true, capability: isTool ? "tool" : "worker" },
    );
  }

  const minScore = opts.minScore ?? 6;
  const minOccurrences = opts.minOccurrences ?? 2;
  const out: Opportunity[] = [];
  for (const cluster of clusters.values()) {
    if (cluster.occurrences < minOccurrences && cluster.severity < 4) continue;
    const { score, feasibility, risk } = scoreCluster(cluster);
    if (score < minScore) continue;
    const self = cluster.signal === "self_weakness";
    const codeChange =
      (cluster.signal === "capability_gap" && Boolean(cluster.capability)) ||
      (self && cluster.capability === "tool");
    out.push({
      dedupe_key: `radar:${cluster.signal}:${cluster.subject}`
        .toLowerCase()
        .replace(/[^a-z0-9:._-]+/g, "-")
        .slice(0, 120),
      signal: cluster.signal,
      subject: cluster.subject,
      title: self
        ? `Improve JARVIS: recurring failure in ${cluster.subject}`.slice(0, 160)
        : codeChange
          ? `Close capability gap: ${cluster.capability}`
          : `Investigate recurring ${cluster.signal.replace(/_/g, " ")}: ${cluster.subject}`.slice(
              0,
              160,
            ),
      objective: self
        ? `JARVIS self-improvement: ${cluster.subject} failed ${cluster.occurrences} times (evidence attached). Find the root cause in JARVIS's own code and make it handle this case correctly; keep all policy guards intact.`
        : codeChange
          ? `Emery repeatedly hit a capability gap for "${cluster.capability}"${cluster.request ? ` (e.g. Adam asked: "${cluster.request}")` : ""}. Make Emery's capability registry truthful about it so she states clearly what is and is not connected instead of implying success. Smallest safe change; preserve existing capability behaviour.`
          : `Recurring ${cluster.signal} signal (${cluster.occurrences} occurrences) for "${cluster.subject}". Reproduce from telemetry and identify the root cause with evidence.`,
      score,
      occurrences: cluster.occurrences,
      severity: cluster.severity,
      confidence: cluster.confidence,
      feasibility,
      risk,
      kind: codeChange ? "code_change" : "diagnostic",
      target_paths: self
        ? (SELF_TARGETS[cluster.capability ?? "tool"] ?? [])
        : codeChange
          ? CAPABILITY_TARGETS
          : [],
      evidence: cluster.evidence,
      fixture: cluster.fixture,
    });
  }
  return out.sort((a, b) => b.score - a.score);
}
