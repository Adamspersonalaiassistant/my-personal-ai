/* eslint-disable @typescript-eslint/no-explicit-any */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { beginExecution, completeExecution, failExecution } from "@/lib/execution-ledger";

export type HpoFollowupGroup = "overdue" | "today" | "this_week" | "no_date";

export type HpoFollowupItem = {
  accountId: string;
  name: string;
  nextAction: string;
  dueAt: string | null;
  dueDate: string | null;
  group: HpoFollowupGroup;
};

export type HpoFollowupList = {
  timezone: string;
  today: string;
  weekEnd: string;
  items: HpoFollowupItem[];
  counts: Record<HpoFollowupGroup, number>;
};

const GROUP_ORDER: HpoFollowupGroup[] = ["overdue", "today", "this_week", "no_date"];

function dateKey(value: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${map["year"]}-${map["month"]}-${map["day"]}`;
}

function addDays(key: string, days: number) {
  const [y, m, d] = key.split("-").map(Number);
  const date = new Date(Date.UTC(y!, m! - 1, d! + days, 12));
  return date.toISOString().slice(0, 10);
}

function weekEndKey(today: string) {
  const [y, m, d] = today.split("-").map(Number);
  const weekday = new Date(Date.UTC(y!, m! - 1, d!, 12)).getUTCDay();
  // Week runs through Sunday.
  return addDays(today, weekday === 0 ? 0 : 7 - weekday);
}

async function timezoneFor(db: any, userId: string) {
  const { data } = await db.from("profiles").select("timezone").eq("user_id", userId).maybeSingle();
  return data?.timezone || "America/New_York";
}

export async function listHpoFollowupsCore(input: { db: any; userId: string }): Promise<HpoFollowupList> {
  const timezone = await timezoneFor(input.db, input.userId);
  const today = dateKey(new Date(), timezone);
  const weekEnd = weekEndKey(today);
  const { data, error } = await input.db
    .from("hpo_accounts")
    .select("id,name,next_action,next_action_due_at")
    .eq("user_id", input.userId)
    .eq("status", "active")
    .not("next_action", "is", null)
    .order("next_action_due_at", { ascending: true, nullsFirst: false })
    .limit(200);
  if (error) throw error;

  const items: HpoFollowupItem[] = [];
  for (const row of data ?? []) {
    const nextAction = String(row.next_action ?? "").trim();
    if (!nextAction) continue;
    const dueAt = row.next_action_due_at ?? null;
    const dueDate = dueAt ? dateKey(new Date(dueAt), timezone) : null;
    let group: HpoFollowupGroup = "no_date";
    if (dueDate) {
      if (dueDate < today) group = "overdue";
      else if (dueDate === today) group = "today";
      else if (dueDate <= weekEnd) group = "this_week";
      else continue; // later than this week: not surfaced here
    }
    items.push({ accountId: row.id, name: row.name, nextAction, dueAt, dueDate, group });
  }
  items.sort((a, b) => {
    const g = GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group);
    if (g) return g;
    return (a.dueDate ?? "").localeCompare(b.dueDate ?? "") || a.name.localeCompare(b.name);
  });
  const counts = { overdue: 0, today: 0, this_week: 0, no_date: 0 } as Record<HpoFollowupGroup, number>;
  for (const item of items) counts[item.group] += 1;
  return { timezone, today, weekEnd, items, counts };
}

function shortDate(key: string) {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, d!, 12)).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

export function formatHpoFollowupReply(list: HpoFollowupList, scope: "all" | "week" | "overdue") {
  const pick =
    scope === "overdue"
      ? list.items.filter((item) => item.group === "overdue")
      : scope === "week"
        ? list.items.filter((item) => item.group !== "no_date")
        : list.items;
  if (!pick.length) {
    if (scope === "overdue") return "Nothing is overdue on your HPO follow ups.";
    if (scope === "week") return "You have no dated HPO follow ups due this week.";
    return "You have no open HPO follow ups right now.";
  }
  const labels: Record<HpoFollowupGroup, string> = {
    overdue: "Overdue",
    today: "Today",
    this_week: "This week",
    no_date: "No date",
  };
  const lines: string[] = [];
  for (const group of GROUP_ORDER) {
    const rows = pick.filter((item) => item.group === group);
    if (!rows.length) continue;
    const shown = rows.slice(0, 6).map((item) =>
      `${item.name}: ${item.nextAction}${item.dueDate ? ` (${shortDate(item.dueDate)})` : ""}`,
    );
    const more = rows.length > 6 ? `, plus ${rows.length - 6} more` : "";
    lines.push(`${labels[group]}: ${shown.join("; ")}${more}.`);
  }
  return lines.join("\n");
}

export const listHpoFollowups = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => listHpoFollowupsCore({ db: context.supabase as any, userId: context.userId }));

export const completeHpoFollowup = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { accountId: string; idempotencyKey?: string | null }) => ({
    accountId: String(input.accountId ?? "").trim(),
    idempotencyKey: String(input.idempotencyKey ?? "").trim() || null,
  }))
  .handler(async ({ data, context }) => {
    const db = context.supabase as any;
    const userId = context.userId;
    if (!data.accountId) throw new Error("Missing account.");
    const execution = await beginExecution({
      db,
      userId,
      domain: "hpo",
      action: "hpo.followup.complete",
      idempotencyKey: data.idempotencyKey ?? `ui:${crypto.randomUUID()}:hpo.followup.complete`,
      targetType: "hpo_account",
      targetId: data.accountId,
      requestPayload: { accountId: data.accountId, sourceChannel: "planner_ui" },
    });
    if (execution.reused && execution.status === "completed") return execution.resultPayload as any;
    try {
      const { data: account, error: accountError } = await db
        .from("hpo_accounts")
        .select("id,name,next_action")
        .eq("id", data.accountId)
        .eq("user_id", userId)
        .single();
      if (accountError) throw accountError;
      const action = String(account.next_action ?? "").trim() || "follow up";
      const now = new Date().toISOString();
      const { data: interaction, error: interactionError } = await db
        .from("hpo_interactions")
        .insert({
          user_id: userId,
          account_id: account.id,
          interaction_type: "follow_up",
          occurred_at: now,
          summary: `Follow up completed: ${action}`,
          source_type: "manual",
          metadata: { non_phi: true, execution_run_id: execution.id },
        })
        .select("id")
        .single();
      if (interactionError) throw interactionError;
      const { error: updateError } = await db
        .from("hpo_accounts")
        .update({ next_action: null, next_action_due_at: null, last_touch_at: now, updated_at: now })
        .eq("id", account.id)
        .eq("user_id", userId);
      if (updateError) throw updateError;
      const result = { ok: true, accountId: account.id, interactionId: interaction.id, executionRunId: execution.id };
      await completeExecution({
        db,
        userId,
        runId: execution.id,
        resultPayload: result,
        targetType: "hpo_account",
        targetId: account.id,
      });
      return result;
    } catch (error) {
      await failExecution({
        db,
        userId,
        runId: execution.id,
        errorCode: "hpo_followup_complete_failed",
        errorMessage: error instanceof Error ? error.message : String(error),
      }).catch(() => undefined);
      throw error;
    }
  });

export const setHpoFollowupDate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { accountId: string; date: string | null }) => {
    const date = input.date ? String(input.date).trim() : null;
    if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("Pick a valid date.");
    return { accountId: String(input.accountId ?? "").trim(), date };
  })
  .handler(async ({ data, context }) => {
    const db = context.supabase as any;
    const timezone = await timezoneFor(db, context.userId);
    let dueAt: string | null = null;
    if (data.date) {
      // Noon local time on the chosen day.
      const guess = new Date(`${data.date}T12:00:00Z`);
      const local = new Date(guess.toLocaleString("en-US", { timeZone: timezone }));
      const offset = guess.getTime() - local.getTime();
      dueAt = new Date(guess.getTime() + offset).toISOString();
    }
    const { error } = await db
      .from("hpo_accounts")
      .update({ next_action_due_at: dueAt, updated_at: new Date().toISOString() })
      .eq("id", data.accountId)
      .eq("user_id", context.userId);
    if (error) throw error;
    return { ok: true, accountId: data.accountId, dueAt };
  });
