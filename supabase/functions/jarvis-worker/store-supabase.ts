// Supabase implementation of the engine Store. Runs only inside the worker Edge
// Function with the service role. Writes are limited to JARVIS ledger tables,
// emery_runtime_events (receipts) and candidate rows in emery_releases.
// Task writes are fenced by lease_token.

import type { RadarInputs } from "./radar.ts";
import type { SessionRow, Store, TaskRow } from "./engine.ts";

type Db = any;

const TASK_COLUMNS =
  "id,user_id,session_id,source_type,source_ref,title,objective,why_it_matters,priority,risk_level,status,branch_name,commit_sha,pr_url,test_results,result_summary,blocker,attempt_count,task_spec,stage_state,metadata,dedupe_key,depends_on,merged_into,lease_token,next_attempt_at,is_fixture,approval_state,created_at,completed_at";

function must(result: { data: any; error: any }, what: string): any {
  if (result.error) throw new Error(`${what}: ${result.error.message ?? result.error}`);
  return result.data;
}

export class SupabaseStore implements Store {
  private readonly db: Db;
  private owner: string | null = null;

  constructor(db: Db) {
    this.db = db;
  }

  async ownerId() {
    if (this.owner) return this.owner;
    const rows = must(
      await this.db.from("emery_owner_registry").select("user_id").limit(1),
      "owner lookup",
    );
    if (!rows?.[0]?.user_id) throw new Error("No Emery owner registered.");
    this.owner = rows[0].user_id as string;
    return this.owner;
  }

  async claim(workerId: string, limit: number) {
    return must(
      await this.db.rpc("jarvis_claim_tasks", {
        p_worker: workerId,
        p_limit: limit,
        p_lease_seconds: 240,
        p_max_active: 4,
        p_max_writers: 1,
      }),
      "claim",
    ) as TaskRow[];
  }

  async update(id: string, leaseToken: string, patch: Partial<TaskRow>) {
    const rows = must(
      await this.db
        .from("jarvis_engineering_tasks")
        .update(patch)
        .eq("id", id)
        .eq("lease_token", leaseToken)
        .select("id"),
      "task update",
    );
    return (rows ?? []).length === 1;
  }

  async release(id: string, leaseToken: string, patch: Partial<TaskRow>) {
    return this.update(id, leaseToken, {
      ...patch,
      lease_token: null,
      lease_expires_at: null,
      leased_by: null,
    } as any);
  }

  async tasks(filter: {
    userId: string;
    statuses?: string[];
    sinceIso?: string;
    ids?: string[];
    sessionId?: string;
  }) {
    let q = this.db
      .from("jarvis_engineering_tasks")
      .select(TASK_COLUMNS)
      .eq("user_id", filter.userId);
    if (filter.statuses) q = q.in("status", filter.statuses);
    if (filter.sinceIso) q = q.gte("created_at", filter.sinceIso);
    if (filter.ids) q = q.in("id", filter.ids);
    if (filter.sessionId) q = q.eq("session_id", filter.sessionId);
    return must(
      await q.order("created_at", { ascending: true }).limit(1000),
      "task query",
    ) as TaskRow[];
  }

  async insertTask(row: Partial<TaskRow>) {
    const result = await this.db.from("jarvis_engineering_tasks").insert(row).select("id").single();
    if (result.error?.code === "23505") return { duplicate: true as const };
    return { id: must(result, "task insert").id as string };
  }

  async openSession(userId: string, date: string) {
    const rows = must(
      await this.db
        .from("jarvis_engineering_sessions")
        .select("id,user_id,session_date,status,intake_limit,accepted_count,started_at,metadata")
        .eq("user_id", userId)
        .eq("session_date", date)
        .in("status", ["queued", "running"])
        .order("created_at", { ascending: false })
        .limit(1),
      "session lookup",
    );
    return (rows?.[0] as SessionRow) ?? null;
  }

  async insertSession(row: Partial<SessionRow>) {
    return must(
      await this.db
        .from("jarvis_engineering_sessions")
        .insert(row)
        .select("id,user_id,session_date,status,intake_limit,accepted_count,started_at,metadata")
        .single(),
      "session insert",
    ) as SessionRow;
  }

  async updateSession(id: string, patch: Record<string, unknown>, expectStatus?: string) {
    let q = this.db.from("jarvis_engineering_sessions").update(patch).eq("id", id);
    if (expectStatus) q = q.eq("status", expectStatus);
    const rows = must(await q.select("id"), "session update");
    return (rows ?? []).length === 1;
  }

  async runningSessions(userId: string) {
    return must(
      await this.db
        .from("jarvis_engineering_sessions")
        .select("id,user_id,session_date,status,intake_limit,accepted_count,started_at,metadata")
        .eq("user_id", userId)
        .eq("status", "running"),
      "running sessions",
    ) as SessionRow[];
  }

  async acceptedOn(userId: string, date: string) {
    const sessions = must(
      await this.db
        .from("jarvis_engineering_sessions")
        .select("id")
        .eq("user_id", userId)
        .eq("session_date", date),
      "sessions for date",
    );
    const ids = (sessions ?? []).map((s: any) => s.id);
    if (!ids.length) return 0;
    // Real production intake only: fixtures, unapproved, cancelled/deferred and merged rows never count.
    const result = await this.db
      .from("jarvis_engineering_tasks")
      .select("id", { count: "exact", head: true })
      .in("session_id", ids)
      .eq("is_fixture", false)
      .eq("approval_state", "approved")
      .not("status", "in", "(cancelled,deferred)")
      .is("merged_into", null);
    if (result.error) throw new Error(`accepted count: ${result.error.message}`);
    return result.count ?? 0;
  }

  async acceptInto(
    taskId: string,
    leaseToken: string,
    sessionId: string,
    date: string,
    limit: number,
  ) {
    const ok = must(
      await this.db.rpc("jarvis_accept_task", {
        p_task: taskId,
        p_lease: leaseToken,
        p_session: sessionId,
        p_date: date,
        p_limit: limit,
      }),
      "accept task",
    );
    return ok === true;
  }

  async count(table: string, userId: string, sinceIso: string) {
    const result = await this.db
      .from(table)
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .gte("created_at", sinceIso);
    if (result.error) throw new Error(result.error.message);
    return result.count ?? 0;
  }

  async radarInputs(userId: string, sinceIso: string): Promise<RadarInputs> {
    const [events, receipts, backlog, evaluations] = await Promise.all([
      this.db
        .from("emery_runtime_events")
        .select("event_type,status,action,domain,channel,metadata,created_at")
        .eq("user_id", userId)
        .gte("created_at", sinceIso)
        .neq("status", "ok")
        .not("event_type", "in", "(jarvis_tool,jarvis_worker,jarvis_radar)")
        .order("created_at", { ascending: false })
        .limit(1000),
      this.db
        .from("emery_execution_runs")
        .select("action,domain,status,error_code,error_message,created_at")
        .eq("user_id", userId)
        .eq("status", "failed")
        .gte("created_at", sinceIso)
        .limit(500),
      this.db
        .from("emery_improvement_backlog")
        .select(
          "id,area,title,problem_statement,severity,confidence,status,occurrence_count,last_observed_at",
        )
        .eq("user_id", userId)
        .in("status", ["observed", "proposed"])
        .limit(100),
      this.db
        .from("emery_self_evaluations")
        .select("target_type,target_ref,findings,created_at")
        .eq("user_id", userId)
        .gte("created_at", sinceIso)
        .limit(200),
    ]);
    return {
      events: must(events, "radar events") ?? [],
      receipts: must(receipts, "radar receipts") ?? [],
      backlog: must(backlog, "radar backlog") ?? [],
      evaluations: must(evaluations, "radar evaluations") ?? [],
    };
  }

  async lastEventAt(userId: string, eventType: string) {
    const rows = must(
      await this.db
        .from("emery_runtime_events")
        .select("created_at")
        .eq("user_id", userId)
        .eq("event_type", eventType)
        .order("created_at", { ascending: false })
        .limit(1),
      "last event",
    );
    return rows?.[0]?.created_at ?? null;
  }

  async logEvent(
    userId: string,
    event: {
      event_type: string;
      action: string;
      status: "ok" | "error" | "skipped";
      duration_ms?: number;
      metadata?: Record<string, unknown>;
    },
  ) {
    await this.db.from("emery_runtime_events").insert({
      user_id: userId,
      channel: "system",
      event_type: event.event_type,
      domain: "engineering",
      action: event.action.slice(0, 120),
      status: event.status,
      duration_ms: event.duration_ms ?? null,
      model: null,
      metadata: event.metadata ?? {},
    });
  }

  async insertFinding(row: Record<string, unknown>) {
    must(await this.db.from("jarvis_research_findings").insert(row), "finding insert");
  }

  async recordCandidate(row: Record<string, unknown>) {
    const result = await this.db.from("emery_releases").insert(row);
    if (result.error && result.error.code !== "23505")
      throw new Error(`candidate insert: ${result.error.message}`);
  }
}
