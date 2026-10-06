/* eslint-disable @typescript-eslint/no-explicit-any */
// The dedicated JARVIS engineering room: Adam ↔ JARVIS Engineer only.
// Reuses Emery's existing agents / agent_threads / agent_messages tables (one
// conversation system), but never appends an Emery commander reply.

import { MODEL_POLICY } from "../model-policy.ts";
import { runJarvisTurn, type ToolTraceEntry } from "./runtime.ts";
import * as state from "./state.ts";
import { createGithubClient, resolvePresence, ingestKnowledgeFromMessage } from "./tool-gateway.ts";
import { assessPaidCreditRequest } from "./policy.ts";

export const JARVIS_AGENT_SLUG = "jarvis-engineer";

export type JarvisRoomMessage = {
  id: string;
  speaker: "user" | "agent";
  speaker_name: string;
  content: string;
  created_at: string;
  metadata?: {
    tool_trace?: ToolTraceEntry[];
    approval_required?: boolean;
    recoverable_error?: boolean;
  } | null;
};

const JARVIS_AGENT_DEFAULT = {
  name: "JARVIS Engineer",
  slug: JARVIS_AGENT_SLUG,
  description: "AI CTO and principal engineer behind Emery",
  persona: "Calm, precise, composed, cost-conscious, protective of working systems.",
  mission:
    "Make Emery better for Adam, make JARVIS better at making Emery better, and execute Adam's engineering tasks reliably.",
  sort_order: 5,
  capabilities: {
    web_research: true,
    github_engineering: true,
    supabase_diagnostics: true,
    lovable_observability: true,
    default_cost_policy: "free_first",
    daily_task_intake_limit: 50,
    paid_credit_use_requires_adam_approval: true,
  },
};

export function isJarvisAgent(agent: { slug?: string | null } | null | undefined) {
  return agent?.slug === JARVIS_AGENT_SLUG;
}

export async function ensureJarvisAgent(db: any, userId: string) {
  const { data: existing, error } = await db
    .from("agents")
    .select("*")
    .eq("user_id", userId)
    .eq("slug", JARVIS_AGENT_SLUG)
    .maybeSingle();
  if (error) throw error;
  if (existing) return existing;
  const { data, error: insertError } = await db
    .from("agents")
    .insert({
      user_id: userId,
      ...JARVIS_AGENT_DEFAULT,
      is_internal: false,
      is_active: true,
      metadata: { role: "engineering_control_plane", family: "Emery" },
    })
    .select("*")
    .single();
  if (insertError || !data) throw insertError ?? new Error("Could not create JARVIS Engineer");
  return data;
}

export async function ensureJarvisThread(db: any, userId: string, agentId: string) {
  const { data: existing, error } = await db
    .from("agent_threads")
    .select("*")
    .eq("user_id", userId)
    .eq("agent_id", agentId)
    .maybeSingle();
  if (error) throw error;
  if (existing) return existing;
  const { data, error: insertError } = await db
    .from("agent_threads")
    .insert({
      user_id: userId,
      agent_id: agentId,
      title: "JARVIS Engineering Control Plane",
      metadata: { participants: ["Adam", "JARVIS Engineer"] },
    })
    .select("*")
    .single();
  if (!insertError && data) return data;
  if (insertError?.code === "23505") {
    const { data: raced } = await db
      .from("agent_threads")
      .select("*")
      .eq("user_id", userId)
      .eq("agent_id", agentId)
      .single();
    if (raced) return raced;
  }
  throw insertError ?? new Error("Could not open the JARVIS room");
}

export async function loadJarvisMessages(
  db: any,
  userId: string,
  threadId: string,
  limit = 40,
): Promise<JarvisRoomMessage[]> {
  const { data, error } = await db
    .from("agent_messages")
    .select("id,speaker,speaker_name,content,metadata,created_at")
    .eq("user_id", userId)
    .eq("thread_id", threadId)
    .in("speaker", ["user", "agent"])
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return ((data ?? []) as JarvisRoomMessage[]).reverse();
}

async function saveMessage(
  db: any,
  userId: string,
  threadId: string,
  speaker: "user" | "agent",
  content: string,
  metadata: Record<string, unknown> = {},
) {
  const { data, error } = await db
    .from("agent_messages")
    .insert({
      user_id: userId,
      thread_id: threadId,
      speaker,
      speaker_name: speaker === "user" ? "Adam" : "JARVIS Engineer",
      content,
      metadata,
    })
    .select("id,speaker,speaker_name,content,metadata,created_at")
    .single();
  if (error || !data) throw error ?? new Error("Could not save message");
  return data as JarvisRoomMessage;
}

export async function handleJarvisTurn(
  db: any,
  userId: string,
  agent: any,
  message: string,
  authToken: string | null = null,
) {
  const apiKey = process.env["OPENAI_API_KEY"];
  const thread = await ensureJarvisThread(db, userId, agent.id);
  const userMessage = await saveMessage(db, userId, thread.id, "user", message);
  const history = await loadJarvisMessages(db, userId, thread.id, 14);
  const prior = history.filter((m) => m.id !== userMessage.id);

  const credit = assessPaidCreditRequest(message);
  const gateway = {
    db,
    userId,
    agentId: agent.id as string,
    approvals: { paidCreditApproved: credit.approved, highRiskApproved: false },
    openAiKey: apiKey ?? null,
    researchModel: MODEL_POLICY.primary,
    sourceRef: userMessage.id,
    authToken,
  };

  // Continuous knowledge ingestion from Adam's engineering conversation.
  const ingestion = await ingestKnowledgeFromMessage(gateway, message, {
    sourceType: "jarvis_room",
    requireEngineeringSubject: false,
  }).catch(() => ({ candidates: 0, stored: [] }));

  if (!apiKey && !(credit.requestsPaidPath && !credit.approved)) {
    const agentMessage = await saveMessage(
      db,
      userId,
      thread.id,
      "agent",
      "My reasoning service isn't configured (OPENAI_API_KEY is missing on the server), so I can't think this turn through. Your message is saved.",
      { recoverable_error: true },
    );
    return { userMessage, agentMessage, error: null };
  }

  try {
    const turn = await runJarvisTurn({
      gateway,
      message,
      history: prior.map((m) => ({ speaker: m.speaker, content: m.content })),
      apiKey: apiKey ?? "",
      model: MODEL_POLICY.primary,
    });
    const agentMessage = await saveMessage(db, userId, thread.id, "agent", turn.text, {
      tool_trace: turn.toolTrace,
      approval_required: turn.approvalRequired,
      gate: turn.gate,
      knowledge_used: turn.knowledgeUsed,
      knowledge_ingested: ingestion.stored.length,
      runtime: "jarvis-run1",
    });
    await db
      .from("agent_threads")
      .update({ updated_at: new Date().toISOString() })
      .eq("id", thread.id)
      .eq("user_id", userId);
    return { userMessage, agentMessage, error: null };
  } catch (error: any) {
    console.error("JARVIS turn failed", error?.message ?? error);
    const agentMessage = await saveMessage(
      db,
      userId,
      thread.id,
      "agent",
      "That turn didn't complete — the engineering runtime hit an error before I could verify an answer. Your message is saved; ask again and I'll retry.",
      { recoverable_error: true, error: String(error?.message ?? error).slice(0, 300) },
    ).catch(() => null);
    return { userMessage, agentMessage, error: "JARVIS couldn't finish that turn." };
  }
}

/** Real engineering status for the room header. No synthetic progress. */
export async function jarvisStatusPanel(db: any, userId: string, authToken: string | null = null) {
  const gateway = {
    db,
    userId,
    agentId: null,
    approvals: { paidCreditApproved: false, highRiskApproved: false },
    openAiKey: null,
    researchModel: MODEL_POLICY.primary,
    authToken,
  };
  const presence = await resolvePresence(gateway);
  const github = presence["JARVIS_GITHUB_TOKEN"] ? createGithubClient(gateway) : null;
  const [status, deployment, releases] = await Promise.all([
    state.getJarvisStatus(db, userId),
    state
      .deploymentTruth(db, userId, github)
      .catch((error) => ({ error: String(error?.message ?? error) })),
    state.releaseLedger(db, userId, 4),
  ]);
  const reconciliation = (deployment as any).reconciliation ?? null;
  return {
    production: reconciliation
      ? {
          commit: reconciliation.production_commit,
          source: reconciliation.production_commit_source,
          github_main: reconciliation.github_main,
          in_sync: reconciliation.in_sync,
          discrepancies: reconciliation.discrepancies,
          served_build_id: (deployment as any).served?.build_id ?? null,
        }
      : {
          commit: null,
          source: "unknown",
          github_main: null,
          in_sync: null,
          discrepancies: [(deployment as any).error ?? "Deployment state unavailable"],
          served_build_id: null,
        },
    status,
    latest_improvements: [
      ...releases.map((r: any) => ({
        kind: "release",
        title: r.release_name ?? r.production_commit_sha.slice(0, 7),
        detail: r.summary,
        at: r.deployed_at ?? r.created_at,
        verified: r.deployment_verified,
      })),
      ...status.recently_completed.map((t: any) => ({
        kind: "task",
        title: t.title,
        detail: t.result_summary,
        at: t.completed_at ?? t.updated_at,
        verified: null,
      })),
    ]
      .sort((a, b) => Date.parse(b.at ?? 0) - Date.parse(a.at ?? 0))
      .slice(0, 5),
    configuration: state.jarvisToolConfiguration(presence),
  };
}
