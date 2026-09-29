/* eslint-disable @typescript-eslint/no-explicit-any */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { ASSISTANT_IDENTITY } from "@/lib/assistant-identity";
import { persistDurableMemoryFromMessage } from "@/lib/chat.functions";
import { loadHpoAgentContext } from "@/lib/hpo-agent-context";
import { inferEmeryDomain, domainPrompt, domainMetadata } from "@/lib/emery-domain";
import {
  selectRelevantMemories,
  buildExecutiveFocus,
  refreshRollingConversationState,
} from "@/lib/emery-intelligence";
import { MODEL_POLICY } from "@/lib/model-policy";
import { recordRuntimeEvent } from "@/lib/runtime-telemetry";
import { VOICE_PROFILE_CONTRACT } from "@/lib/voice-profile";
import { processVoiceStudioTurn } from "@/lib/voice-studio.functions";
import { processCalendarAction } from "@/lib/calendar-agent";
import { processHpoAction } from "@/lib/hpo-action-controller";
import { processHpoRouteStopAction } from "@/lib/hpo-route-action-controller";
import { processHpoFieldReadCommand } from "@/lib/hpo-field-read-controller";
import {
  hasPendingHpoRouteClarification,
  processHpoRouteCommand,
} from "@/lib/hpo-route-command-controller";
import { recentExecutionReceipts } from "@/lib/execution-ledger";
import { executionCapabilityPrompt } from "@/lib/execution-capabilities";
import { executeCanonicalTaskCreate } from "@/lib/execution-kernel";
import { planEmeryRequest } from "@/lib/emery/planner";
import { processEmeryMultiIntentDayPlan } from "@/lib/emery/multi-intent-executor";

const STABLE_RUNTIME_POLICY = `EXECUTION POLICY:
- There is one Emery across chat, capture, Shortcut, Voice, Calendar, HPO, memory, and future integrations.
- Never claim a structured write unless the canonical controller confirms it succeeded.
- Never invent a completed action, record id, date, time, person, office, address, relationship fact, or external sync.
- Casual discussion is not permission to create, complete, move, or log records.
- Tasks and Calendar are distinct: an open task may remain unscheduled in the Task List; due_at is a deadline, while scheduled_start_at/scheduled_end_at are an optional Calendar time block.
- Do not assume every task belongs on the Calendar. When Adam has free time, use the open unscheduled task pool, priorities, deadlines, and estimated duration to suggest useful work.
- Treat an incomplete task with a past due_at as overdue. Treat a past Calendar block as a missed block that can be rescheduled; do not silently redefine it as the task's deadline.
- Emery's Calendar is internal unless an external calendar integration explicitly confirms otherwise.
- HPO intelligence is referral-source/account/relationship work only. Never request, store, infer, or repeat patient PHI in HPO relationship records.
- Use live web search for current, recent, local, changing, online, or explicitly fact-checked questions when it materially improves the answer.
- Favor one highest-value next action when Adam is overloaded instead of a large dashboard dump.
- Preserve Adam's control. Low-risk learned configuration may adapt only through the allowlisted, measured, reversible improvement system.`;

function behaviorSignals(message: string) {
  const text = message.toLowerCase();
  return {
    userCorrectionSignal:
      /\b(actually|correction|no[, ]+i meant|i meant|not that|i said|that's wrong|that is wrong|instead)\b/.test(
        text,
      ),
    userReversalSignal:
      /\b(undo|revert|cancel that|move it back|put it back|change it back|never mind|nevermind)\b/.test(
        text,
      ),
  };
}
function hpoConfirmation(result: any) {
  if (result?.needsClarification && result?.question) return String(result.question);
  if (!result?.performed) {
    if (result?.recognized && result?.error)
      return "I understood the HPO action, but I couldn’t save it. I’m not going to claim it was logged.";
    return null;
  }
  if (result.action === "log_touch")
    return result.nextAction
      ? `Logged the ${result.accountName} relationship update. Next: ${result.nextAction}.`
      : `Logged the ${result.accountName} relationship update.`;
  if (result.action === "set_followup")
    return result.dueAt
      ? `Updated ${result.accountName}: ${result.nextAction}.`
      : `Set the next action for ${result.accountName}: ${result.nextAction}.`;
  if (result.action === "update_account") {
    const fields = Array.isArray(result.changedFields) ? result.changedFields : [];
    return fields.length
      ? `Updated ${result.accountName}: ${fields.map((field: string) => field.replaceAll("_", " ")).join(", ")}.`
      : `Updated ${result.accountName}.`;
  }
  return "Updated the HPO relationship record.";
}
function hpoRouteStopConfirmation(result: any) {
  if (result?.needsClarification && result?.question) return String(result.question);
  if (!result?.performed) {
    if (result?.recognized && result?.error)
      return "I understood the route update, but I couldn’t save it. The stop was not changed.";
    return null;
  }
  const label = String(result.status ?? "updated").replaceAll("_", " ");
  const office = result.officeName || "That stop";
  if (result.action === "hpo.route_stop.arrive")
    return `Arrived at ${office}. You're on the current stop.`;
  const saved =
    result.action === "hpo.route_stop.log_visit"
      ? `Saved the visit for ${office}${result.followupTaskId ? " and added the authorized follow-up task" : ""}.`
      : `${office} marked ${label}.`;
  return result.nextStopName
    ? `${saved} Next: ${result.nextStopName}.`
    : `${saved} There are no unfinished stops left on this route.`;
}
function hpoFieldReadConfirmation(result: any) {
  if (!result?.recognized) return null;
  return result.reply ? String(result.reply) : null;
}
function hpoRouteCommandConfirmation(result: any) {
  if (!result?.recognized) return null;
  if (result?.needsClarification && result?.question) return String(result.question);
  if (result?.performed && result?.reply) return String(result.reply);
  if (result?.error)
    return `I understood the HPO route change, but I couldn't complete it: ${result.error}`;
  return result?.reply ? String(result.reply) : null;
}

type AttachmentInput = {
  storagePath: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
};
type SourceMetadata = {
  entryPoint?: "chat" | "capture" | "shortcut" | "voice";
  inputMode?: "typed" | "dictated" | "voice";
  shortcutName?: string;
  surface?: string;
  hpoRouteId?: string | null;
  hpoRouteDate?: string | null;
  hpoStopId?: string | null;
  selectedAccountId?: string | null;
  selectedProspectId?: string | null;
  hpoEphemeral?: boolean;
  hpoEphemeralSession?: string | null;
  hpoPlanningArea?: string | null;
  hpoPlanningAccountIds?: string[];
  hpoPlanningProspectIds?: string[];
  hpoPlanningSelectedAccountIds?: string[];
  hpoPlanningSelectedProspectIds?: string[];
};
type ChatInput = { message?: string; attachments?: AttachmentInput[]; source?: SourceMetadata };
type ChatAttachment = {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  url: string | null;
};
const safe = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
async function mainConversation(db: any, userId: string) {
  const { data } = await db
    .from("conversations")
    .select("id, metadata")
    .eq("user_id", userId)
    .eq("channel", "main")
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (data) return data;
  const { data: created, error } = await db
    .from("conversations")
    .insert({
      user_id: userId,
      channel: "main",
      title: "Emery",
      metadata: { primary: true, identity: "central-v1" },
    })
    .select("id, metadata")
    .single();
  if (error) throw error;
  return created;
}
async function history(db: any, userId: string, conversationId: string) {
  const { data } = await db
    .from("conversation_messages")
    .select("id,role,content,created_at,source_metadata")
    .eq("user_id", userId)
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: false })
    .limit(24);
  return (data ?? [])
    .reverse()
    .map((x: any) => ({
      id: x.id,
      role: x.role,
      text: x.content,
      createdAt: x.created_at,
      sourceMetadata: x.source_metadata ?? null,
    }));
}
async function loadHpoPlanningSessionContext(
  db: any,
  userId: string,
  source: SourceMetadata,
) {
  const accountIds = [...new Set(source.hpoPlanningAccountIds ?? [])].filter(Boolean);
  const prospectIds = [...new Set(source.hpoPlanningProspectIds ?? [])].filter(Boolean);
  if (!accountIds.length && !prospectIds.length) return null;

  let accounts: any[] = [];
  if (accountIds.length) {
    const { data, error } = await db
      .from("hpo_accounts")
      .select(
        "id,name,account_type,specialty,address,city,priority,relationship_stage,relationship_health,last_touch_at,next_action,next_action_due_at,opportunity,blockers,notes,status,owner_name",
      )
      .eq("user_id", userId)
      .eq("status", "active")
      .in("id", accountIds);
    if (error) throw error;
    accounts = data ?? [];
  }

  let prospects: any[] = [];
  if (prospectIds.length) {
    const { data, error } = await db
      .from("hpo_prospects")
      .select(
        "id,name,prospect_type,specialty,address,city,fit_status,verification_status,notes,metadata,promoted_account_id",
      )
      .eq("user_id", userId)
      .in("id", prospectIds);
    if (error) throw error;
    prospects = data ?? [];
  }

  const interactionByAccount = new Map<string, any>();
  if (accountIds.length) {
    const { data, error } = await db
      .from("hpo_interactions")
      .select(
        "account_id,occurred_at,summary,outcome,relationship_signal,next_action,next_action_due_at",
      )
      .eq("user_id", userId)
      .in("account_id", accountIds)
      .order("occurred_at", { ascending: false })
      .limit(600);
    if (error) throw error;
    for (const interaction of data ?? []) {
      if (!interactionByAccount.has(String(interaction.account_id))) {
        interactionByAccount.set(String(interaction.account_id), interaction);
      }
    }
  }

  const selectedAccountIds = new Set(source.hpoPlanningSelectedAccountIds ?? []);
  const selectedProspectIds = new Set(source.hpoPlanningSelectedProspectIds ?? []);

  return {
    area: source.hpoPlanningArea ?? null,
    instruction:
      "This is the exact live office pool currently shown in the HPO route game-plan UI. Use it to discuss, compare, prioritize, remove, or swap offices. Never say the territory has no accounts when rows are present here. Keep office lists in bullets grouped as Doctors / Medical, Attorneys, PT / Chiro, then Other. Do not claim a route was built unless a deterministic route receipt confirms it.",
    accounts: accounts.map((row: any) => ({
      id: row.id,
      selected: selectedAccountIds.has(String(row.id)),
      name: row.name,
      type: row.account_type,
      specialty: row.specialty,
      city: row.city,
      priority: row.priority,
      relationship_stage: row.relationship_stage,
      relationship_health: row.relationship_health,
      last_touch_at: row.last_touch_at,
      next_action: row.next_action,
      next_action_due_at: row.next_action_due_at,
      opportunity: row.opportunity,
      blockers: row.blockers,
      notes: row.notes,
      latest_interaction: interactionByAccount.get(String(row.id)) ?? null,
    })),
    prospects: prospects.map((row: any) => ({
      id: row.id,
      selected: selectedProspectIds.has(String(row.id)),
      name: row.name,
      type: row.prospect_type,
      specialty: row.specialty,
      city: row.city,
      fit_status: row.fit_status,
      verification_status: row.verification_status,
      notes: row.notes,
      metadata: row.metadata,
    })),
  };
}

async function sign(db: any, rows: any[]): Promise<ChatAttachment[]> {
  return Promise.all(
    rows.map(async (r) => {
      const { data } = await db.storage
        .from("emery-attachments")
        .createSignedUrl(r.storage_path, 600);
      return {
        id: r.id,
        fileName: r.file_name,
        mimeType: r.mime_type,
        sizeBytes: Number(r.size_bytes ?? 0),
        url: data?.signedUrl ?? null,
      };
    }),
  );
}
async function actionContext(db: any, userId: string) {
  const nowIso = new Date().toISOString();
  const nowMs = Date.now();
  const [t, p, m, executionReceipts] = await Promise.all([
    db
      .from("tasks")
      .select(
        "id,title,details,status,priority,due_at,scheduled_start_at,scheduled_end_at,reminder_at,estimated_minutes,metadata,project_id",
      )
      .eq("user_id", userId)
      .neq("status", "completed")
      .order("priority", { ascending: false })
      .order("due_at", { ascending: true, nullsFirst: false })
      .limit(60),
    db
      .from("projects")
      .select("id,name,description,status,priority,goal,next_action")
      .eq("user_id", userId)
      .eq("status", "active")
      .order("priority", { ascending: false })
      .limit(10),
    db
      .from("meetings")
      .select("id,title,meeting_at,end_at,participants,metadata")
      .eq("user_id", userId)
      .gte("meeting_at", nowIso)
      .order("meeting_at", { ascending: true })
      .limit(20),
    recentExecutionReceipts({ db, userId, limit: 12 }).catch(() => []),
  ]);
  const tasks = t.data ?? [];
  const taskPool = tasks.filter((task: any) => !task.scheduled_start_at);
  const scheduledTasks = tasks.filter((task: any) => Boolean(task.scheduled_start_at));
  const overdueTasks = tasks.filter((task: any) => task.due_at && Date.parse(task.due_at) < nowMs);
  const missedBlocks = scheduledTasks.filter((task: any) => {
    const end = task.scheduled_end_at ?? task.scheduled_start_at;
    return end && Date.parse(end) < nowMs;
  });
  return {
    tasks,
    task_pool: taskPool,
    scheduled_tasks: scheduledTasks,
    overdue_tasks: overdueTasks,
    missed_time_blocks: missedBlocks,
    projects: p.data ?? [],
    meetings: m.data ?? [],
    recent_execution_receipts: executionReceipts,
  };
}
function responseText(p: any) {
  return typeof p.output_text === "string"
    ? p.output_text.trim()
    : (p.output ?? [])
        .flatMap((x: any) => x.content ?? [])
        .filter((x: any) => x.type === "output_text")
        .map((x: any) => x.text ?? "")
        .join("")
        .trim();
}
function calendarConfirmation(result: any, timezone: string) {
  if (result?.needsClarification && result?.question) return String(result.question);
  if (!result?.performed) {
    if (result?.recognized && result?.error)
      return "I couldn’t save that change, so I’m not going to pretend it was added. Please try that request once more.";
    return null;
  }

  const fmt = (value: string | null | undefined, includeDate = true) => {
    if (!value) return null;
    return new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      ...(includeDate ? { dateStyle: "medium" as const } : {}),
      timeStyle: "short",
    }).format(new Date(value));
  };

  const items = Array.isArray(result.items)
    ? result.items.filter((item: any) => item?.performed)
    : [];
  const lines = items.map((item: any) => {
    const start = fmt(item.scheduledFor, true);
    const end = fmt(item.endsAt, false);
    const range = start && end ? `${start}–${end}` : start;
    if (item.action === "create_task") {
      if (range) return `• ${item.title} — ${range}`;
      if (item.dueAt) return `• ${item.title} — deadline ${fmt(item.dueAt, true)}`;
      return `• ${item.title} — added to Task List`;
    }
    if (item.action === "schedule_task") return `• ${item.title} — ${range}`;
    if (item.action === "unschedule_task") return `• ${item.title} — moved back to Task List`;
    if (item.action === "set_task_deadline")
      return `• ${item.title} — deadline ${fmt(item.dueAt, true)}`;
    if (item.action === "complete_task") return `• ${item.title} — completed`;
    if (item.action === "create_event" || item.action === "reschedule_event")
      return `• ${item.title} — ${range}`;
    if (item.action === "create_reminder")
      return `• Reminder: ${item.title} — ${fmt(item.reminderAt, true)}`;
    return `• ${item.title ?? "Calendar item"}`;
  });

  const reminderItems = items.filter(
    (item: any) => item.reminderAt || item.action === "create_reminder",
  );
  const reminderNote = result.notificationScheduled
    ? result.pushConnected === true
      ? ` Notification${reminderItems.length === 1 ? "" : "s"} scheduled, and this iPhone is connected for background push.`
      : " The reminder is saved in Emery, but iPhone push is not connected yet—open Calendar → bell to enable it."
    : "";

  if (items.length > 1) {
    const partial = result.partialSuccess
      ? " I saved the successful items below; one or more requested changes failed."
      : "";
    return `Done — I saved ${items.length} item${items.length === 1 ? "" : "s"}.${partial}\n\n${lines.join("\n")}${reminderNote}`;
  }

  const item = items[0];
  if (!item) return "Done.";
  const single = lines[0]?.replace(/^• /, "") ?? "Done";
  return `${single}.${reminderNote}`;
}

export const sendEmeryMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: ChatInput) => {
    const message = String(input?.message ?? "").trim();
    const attachments = Array.isArray(input?.attachments) ? input.attachments.slice(0, 5) : [];
    const raw = input?.source ?? {};
    const source = {
      entryPoint: ["chat", "capture", "shortcut", "voice"].includes(String(raw.entryPoint))
        ? raw.entryPoint
        : "chat",
      inputMode: ["typed", "dictated", "voice"].includes(String(raw.inputMode))
        ? raw.inputMode
        : "typed",
      shortcutName: raw.shortcutName ? String(raw.shortcutName).slice(0, 100) : undefined,
      surface: raw.surface ? String(raw.surface).slice(0, 120) : undefined,
      hpoRouteId: raw.hpoRouteId ? String(raw.hpoRouteId).slice(0, 80) : null,
      hpoRouteDate:
        raw.hpoRouteDate && /^\d{4}-\d{2}-\d{2}$/.test(String(raw.hpoRouteDate))
          ? String(raw.hpoRouteDate)
          : null,
      hpoStopId: raw.hpoStopId ? String(raw.hpoStopId).slice(0, 80) : null,
      selectedAccountId: raw.selectedAccountId ? String(raw.selectedAccountId).slice(0, 80) : null,
      selectedProspectId: raw.selectedProspectId
        ? String(raw.selectedProspectId).slice(0, 80)
        : null,
      hpoEphemeral: raw.hpoEphemeral === true,
      hpoEphemeralSession: raw.hpoEphemeralSession
        ? String(raw.hpoEphemeralSession).slice(0, 120)
        : null,
      hpoPlanningArea: raw.hpoPlanningArea ? String(raw.hpoPlanningArea).slice(0, 180) : null,
      hpoPlanningAccountIds: Array.isArray(raw.hpoPlanningAccountIds)
        ? raw.hpoPlanningAccountIds.slice(0, 120).map((id) => String(id).slice(0, 80))
        : [],
      hpoPlanningProspectIds: Array.isArray(raw.hpoPlanningProspectIds)
        ? raw.hpoPlanningProspectIds.slice(0, 120).map((id) => String(id).slice(0, 80))
        : [],
      hpoPlanningSelectedAccountIds: Array.isArray(raw.hpoPlanningSelectedAccountIds)
        ? raw.hpoPlanningSelectedAccountIds.slice(0, 30).map((id) => String(id).slice(0, 80))
        : [],
      hpoPlanningSelectedProspectIds: Array.isArray(raw.hpoPlanningSelectedProspectIds)
        ? raw.hpoPlanningSelectedProspectIds.slice(0, 30).map((id) => String(id).slice(0, 80))
        : [],
    };
    if (!message && !attachments.length) throw new Error("Message or attachment is required");
    return { message, attachments, source };
  })
  .handler(async ({ data, context }) => {
    const startedAt = Date.now();
    const apiKey = process.env["OPENAI_API_KEY"];
    if (!apiKey) return { error: "The AI service isn't configured yet." } as const;
    const db = context.supabase as any,
      userId = context.userId;
    const conversation = await mainConversation(db, userId);
    const route = inferEmeryDomain(data.message);
    const actionPlan = planEmeryRequest(data.message);
    const hpoPlanned = actionPlan.intents.some(
      (intent) => intent.capability.startsWith("hpo.") || intent.capability === "entities",
    );
    const hpoSurface = String(data.source.surface ?? "").startsWith("hpo");
    let hpoEligible =
      route.domain === "hpo" || route.domain === "mixed" || hpoPlanned || hpoSurface;
    const sourceMetadata = { ...data.source, domain: route.domain, emery_identity: "central-v1" };
    const { data: userMessage, error: saveError } = await db
      .from("conversation_messages")
      .insert({
        user_id: userId,
        conversation_id: conversation.id,
        role: "user",
        content: data.message,
        source_metadata: sourceMetadata,
      })
      .select("id,created_at")
      .single();
    if (saveError) return { error: "Couldn't save your message. Please try again." } as const;
    if (data.attachments.length) {
      for (const a of data.attachments)
        if (!a.storagePath.startsWith(`${userId}/`))
          return { error: "One attachment doesn't belong to your account." } as const;
      await db.from("message_attachments").insert(
        data.attachments.map((a) => ({
          user_id: userId,
          conversation_id: conversation.id,
          message_id: userMessage.id,
          storage_path: a.storagePath,
          file_name: a.fileName,
          mime_type: a.mimeType,
          size_bytes: a.sizeBytes,
        })),
      );
    }
    const memoryWrite = data.source.hpoEphemeral
      ? {
          memorySaved: false,
          memoryUpdated: false,
          memoryError: null,
          savedMemory: null,
        }
      : await persistDurableMemoryFromMessage({
          supabase: db,
          userId,
          apiKey,
          message: data.message,
        });
    const recent = await history(db, userId, conversation.id);
    const nonEphemeralRecent = recent.filter(
      (turn: any) => turn.sourceMetadata?.hpoEphemeral !== true,
    );
    const hpoSessionHistory =
      data.source.hpoEphemeral && data.source.hpoEphemeralSession
        ? recent.filter(
            (turn: any) =>
              turn.sourceMetadata?.hpoEphemeralSession === data.source.hpoEphemeralSession,
          )
        : nonEphemeralRecent;
    const turnRecent = data.source.hpoEphemeral ? hpoSessionHistory : nonEphemeralRecent;
    if (!hpoEligible && hasPendingHpoRouteClarification(hpoSessionHistory)) {
      hpoEligible = true;
    }
    const workingState = data.source.hpoEphemeral
      ? { summary: "", updatedAt: null, summarizedMessageId: null, summarizedMessageCount: 0 }
      : await refreshRollingConversationState({
          apiKey,
          db,
          userId,
          conversation,
          newestMessage: data.message,
          recentHistory: turnRecent,
        }).catch((error: any) => {
          console.error("Rolling conversation state refresh failed", error);
          return {
            summary: "",
            updatedAt: null,
            summarizedMessageId: null,
            summarizedMessageCount: 0,
          };
        });
    const voiceStudio = await processVoiceStudioTurn({
      db,
      userId,
      apiKey,
      text: data.message,
      recent: turnRecent,
    }).catch((error: any) => {
      console.error("Voice Studio operation failed", error);
      return {
        stage: "error",
        operationSucceeded: false,
        note: "Voice Studio could not complete that operation.",
      } as const;
    });
    const voiceStudioPrompt = voiceStudio
      ? {
          ...(voiceStudio as any),
          previewAudioDataUri: (voiceStudio as any).previewAudioDataUri
            ? "[real provider preview available in app]"
            : null,
        }
      : null;
    const hpoContext = hpoEligible
      ? await loadHpoAgentContext(db, userId, data.message).catch((error: any) => {
          console.error("Central Emery HPO context failed", error);
          return null;
        })
      : null;
    const hpoPlanningContext = hpoEligible
      ? await loadHpoPlanningSessionContext(db, userId, data.source).catch((error: any) => {
          console.error("HPO planning-session context failed", error);
          return null;
        })
      : null;
    const [
      { data: profile },
      { data: memories },
      { data: voiceProfile },
      { data: config },
      actions,
    ] = await Promise.all([
      db
        .from("profiles")
        .select("display_name,assistant_name,timezone,profile_summary")
        .eq("user_id", userId)
        .maybeSingle(),
      db
        .from("memories")
        .select("id,title,content,memory_type,importance,confidence,created_at,updated_at")
        .eq("user_id", userId)
        .order("importance", { ascending: false })
        .limit(100),
      db
        .from("voice_profiles")
        .select(
          "base_voice_id,stable_identity,delivery_preferences,contextual_preferences,pronunciation_preferences,provider_capabilities,approved_at,version",
        )
        .eq("user_id", userId)
        .maybeSingle(),
      db
        .from("emery_config")
        .select(
          "response_verbosity,memory_max_items,memory_max_characters,proactive_focus_enabled,auto_apply_low_risk",
        )
        .eq("user_id", userId)
        .maybeSingle(),
      actionContext(db, userId),
    ]);
    const multiIntent = await processEmeryMultiIntentDayPlan({
      db,
      userId,
      message: data.message,
      timezone: profile?.timezone ?? "America/New_York",
      sourceMessageId: userMessage.id,
      sourceChannel: String(data.source.entryPoint ?? "chat"),
      routeId: data.source.hpoRouteId ?? null,
      stopId: data.source.hpoStopId ?? null,
      selectedAccountId: data.source.selectedAccountId ?? null,
      selectedProspectId: data.source.selectedProspectId ?? null,
    }).catch((error: any) => {
      console.error("Emery multi-intent executor failed", error);
      return { handled: false as const, plan: actionPlan, receipts: [] };
    });
    if (multiIntent.handled) {
      const attachmentRows = data.attachments.length
        ? await db
            .from("message_attachments")
            .select("id,storage_path,file_name,mime_type,size_bytes")
            .eq("user_id", userId)
            .eq("message_id", userMessage.id)
        : { data: [] };
      const signed = await sign(db, attachmentRows.data ?? []);
      const { data: assistantMessage } = await db
        .from("conversation_messages")
        .insert({
          user_id: userId,
          conversation_id: conversation.id,
          role: "assistant",
          content: multiIntent.reply,
          source_metadata: {
            entryPoint: "emery",
            replyTo: data.source.entryPoint,
            domain: "mixed",
            emery_identity: "central-v2",
            hpoEphemeral: data.source.hpoEphemeral === true,
            hpoEphemeralSession: data.source.hpoEphemeralSession ?? null,
            action_plan: multiIntent.plan,
            execution_receipts: multiIntent.receipts,
          },
        })
        .select("id,created_at")
        .single();
      await db
        .from("conversations")
        .update({
          metadata: {
            ...safe(conversation.metadata),
            last_domain: "mixed",
            identity: "central-v2",
          },
          updated_at: new Date().toISOString(),
        })
        .eq("id", conversation.id)
        .eq("user_id", userId);
      await recordRuntimeEvent(db, userId, {
        channel: data.source.entryPoint as any,
        eventType: "emery_turn",
        domain: "mixed",
        action: "execute_action_plan",
        status: multiIntent.needsClarification
          ? "clarification"
          : multiIntent.performed
            ? "ok"
            : "error",
        durationMs: Date.now() - startedAt,
        model: null,
        metadata: {
          intentCount: multiIntent.plan.intents.length,
          receiptCount: multiIntent.receipts.length,
          performed: multiIntent.performed,
          deterministic: true,
        },
      });
      return {
        reply: multiIntent.reply,
        conversationId: conversation.id,
        route,
        memoryWrite,
        voiceStudio,
        userMessage: {
          id: userMessage.id,
          role: "user" as const,
          text: data.message,
          createdAt: userMessage.created_at,
          attachments: signed,
        },
        assistantMessage: assistantMessage
          ? {
              id: assistantMessage.id,
              role: "assistant" as const,
              text: multiIntent.reply,
              createdAt: assistantMessage.created_at,
              attachments: [] as ChatAttachment[],
            }
          : null,
      } as const;
    }
    const calendarAction = await processCalendarAction({
      db,
      userId,
      apiKey,
      message: data.message,
      recent: turnRecent.filter((x: any) => x.id !== userMessage.id),
      timezone: profile?.timezone ?? "America/New_York",
      openTasks: actions.tasks ?? [],
      upcomingMeetings: actions.meetings ?? [],
      sourceMessageId: userMessage.id,
      sourceChannel: String(data.source.entryPoint ?? "text"),
    }).catch((error: any) => {
      console.error("Calendar action controller failed", error);
      return {
        recognized: false,
        performed: false,
        partialSuccess: false,
        needsClarification: false,
        question: null,
        action: "none",
        recordId: null,
        title: null,
        scheduledFor: null,
        endsAt: null,
        dueAt: null,
        eventType: null,
        items: [],
        notificationScheduled: false,
        pushConnected: null,
        error: "calendar_action_failed",
      };
    });
    const hpoFieldRead = hpoEligible
      ? await processHpoFieldReadCommand({ db, userId, message: data.message }).catch(
          (error: any) => {
            console.error("HPO field-read controller failed", error);
            return {
              recognized: false,
              action: "none",
              routeId: null,
              routeDate: null,
              routeArea: null,
              completed: 0,
              total: 0,
              remaining: 0,
              nextStop: null,
              lastCompletedStop: null,
              accountContext: null,
              reply: null,
            };
          },
        )
      : {
          recognized: false,
          action: "none",
          routeId: null,
          routeDate: null,
          routeArea: null,
          completed: 0,
          total: 0,
          remaining: 0,
          nextStop: null,
          lastCompletedStop: null,
          accountContext: null,
          reply: null,
        };
    const routeWritePlanned = actionPlan.writes.some((action) => action.startsWith("hpo.route."));
    const hpoRouteCommand =
      hpoEligible && (!hpoFieldRead.recognized || routeWritePlanned)
        ? await processHpoRouteCommand({
            db,
            userId,
            message: data.message,
            timezone: profile?.timezone ?? "America/New_York",
            sourceMessageId: userMessage.id,
            sourceChannel: String(data.source.entryPoint ?? "text"),
            routeId: data.source.hpoRouteId ?? null,
            routeDateHint: data.source.hpoRouteDate ?? null,
            history: hpoSessionHistory,
          }).catch((error: any) => {
            console.error("HPO route command controller failed", error);
            return {
              recognized: false,
              performed: false,
              needsClarification: false,
              question: null,
              action: "none",
              routeId: null,
              executionRunId: null,
              reply: null,
              error: "hpo_route_command_failed",
            };
          })
        : {
            recognized: false,
            performed: false,
            needsClarification: false,
            question: null,
            action: "none",
            routeId: null,
            executionRunId: null,
            reply: null,
            error: null,
          };
    const routeStopAction =
      hpoEligible && !hpoFieldRead.recognized && !hpoRouteCommand.recognized
        ? await processHpoRouteStopAction({
            db,
            userId,
            message: data.message,
            timezone: profile?.timezone ?? "America/New_York",
            sourceMessageId: userMessage.id,
            sourceChannel: String(data.source.entryPoint ?? "text"),
            routeId: data.source.hpoRouteId ?? null,
            stopId: data.source.hpoStopId ?? null,
          }).catch((error: any) => {
            console.error("HPO route-stop action controller failed", error);
            return {
              recognized: false,
              performed: false,
              needsClarification: false,
              question: null,
              action: "none",
              routeId: null,
              stopId: null,
              officeName: null,
              status: null,
              executionRunId: null,
              nextStopId: null,
              nextStopName: null,
              error: "hpo_route_stop_action_failed",
            };
          })
        : {
            recognized: false,
            performed: false,
            needsClarification: false,
            question: null,
            action: "none",
            routeId: null,
            stopId: null,
            officeName: null,
            status: null,
            executionRunId: null,
            nextStopId: null,
            nextStopName: null,
          };
    const hpoAction =
      hpoEligible &&
      !hpoFieldRead.recognized &&
      !hpoRouteCommand.recognized &&
      !routeStopAction.recognized
        ? await processHpoAction({
            db,
            userId,
            apiKey,
            message: data.message,
            recent: turnRecent.filter((x: any) => x.id !== userMessage.id),
            timezone: profile?.timezone ?? "America/New_York",
            sourceMessageId: userMessage.id,
            selectedAccountId: data.source.selectedAccountId ?? null,
          }).catch((error: any) => {
            console.error("HPO action controller failed", error);
            return {
              recognized: false,
              performed: false,
              needsClarification: false,
              question: null,
              action: "none",
              accountId: null,
              accountName: null,
              recordId: null,
              nextAction: null,
              dueAt: null,
              error: "hpo_action_failed",
            };
          })
        : {
            recognized: false,
            performed: false,
            needsClarification: false,
            question: null,
            action: "none",
            accountId: null,
            accountName: null,
            recordId: null,
            nextAction: null,
            dueAt: null,
          };
    const memoryMaxItems = Math.min(30, Math.max(6, Number(config?.memory_max_items ?? 16)));
    const memoryMaxCharacters = Math.min(
      12000,
      Math.max(2000, Number(config?.memory_max_characters ?? 6500)),
    );
    const selected = selectRelevantMemories(memories ?? [], data.message, turnRecent, {
      maxItems: memoryMaxItems,
      maxCharacters: memoryMaxCharacters,
    });
    const signals = behaviorSignals(data.message);
    const focus = buildExecutiveFocus(actions);
    const workingStateBlock = workingState.summary ? workingState.summary.slice(0, 5000) : "";
    const memoryBlock = selected
      .map((m: any) => `- [${m.memory_type}] ${m.title ? `${m.title}: ` : ""}${m.content}`)
      .join("\n");
    const profileBlock = profile
      ? `Name: ${profile.display_name ?? ""}\nTimezone: ${profile.timezone ?? ""}\nAbout: ${profile.profile_summary ?? ""}`
      : "";
    const actionBlock = JSON.stringify(actions).slice(0, 14000);
    const hpoBlock = hpoContext ? JSON.stringify(hpoContext).slice(0, 10000) : "";
    const attachmentRows = data.attachments.length
      ? await db
          .from("message_attachments")
          .select("id,storage_path,file_name,mime_type,size_bytes")
          .eq("user_id", userId)
          .eq("message_id", userMessage.id)
      : { data: [] };
    const signed = await sign(db, attachmentRows.data ?? []);
    const userContent: any[] = [
      { type: "input_text", text: data.message || "Please review the attachment." },
    ];
    for (const a of signed) {
      if (!a.url) continue;
      userContent.push(
        a.mimeType.startsWith("image/")
          ? { type: "input_image", image_url: a.url }
          : { type: "input_file", file_url: a.url },
      );
    }
    const previous = turnRecent.filter((x: any) => x.id !== userMessage.id).slice(-18);
    const hpoFieldReadReply = hpoFieldReadConfirmation(hpoFieldRead);
    const hpoRouteCommandReply = hpoRouteCommandConfirmation(hpoRouteCommand);
    const routeStopReply = hpoRouteStopConfirmation(routeStopAction);
    const hpoReply = hpoConfirmation(hpoAction);
    const calendarReply = calendarConfirmation(
      calendarAction,
      profile?.timezone ?? "America/New_York",
    );
    const primaryHpoReply = hpoRouteCommandReply ?? routeStopReply ?? hpoReply ?? hpoFieldReadReply;
    if (primaryHpoReply) {
      const combinedReply =
        calendarAction.performed && calendarReply
          ? `${calendarReply}\n\n${primaryHpoReply}`
          : primaryHpoReply;
      const { data: orchestratedAssistantMessage } = await db
        .from("conversation_messages")
        .insert({
          user_id: userId,
          conversation_id: conversation.id,
          role: "assistant",
          content: combinedReply,
          source_metadata: {
            entryPoint: "emery",
            replyTo: data.source.entryPoint,
            domain: hpoEligible ? "hpo" : route.domain,
            emery_identity: "central-v1",
            hpoEphemeral: data.source.hpoEphemeral === true,
            hpoEphemeralSession: data.source.hpoEphemeralSession ?? null,
            action_plan: actionPlan,
            calendar_action: calendarAction,
            hpo_field_read: hpoFieldRead,
            hpo_route_command: hpoRouteCommand,
            hpo_route_stop_action: routeStopAction,
            hpo_action: hpoAction,
          },
        })
        .select("id,created_at")
        .single();
      await db
        .from("conversations")
        .update({
          metadata: {
            ...safe(conversation.metadata),
            last_domain: hpoEligible ? "hpo" : route.domain,
            identity: "central-v1",
          },
          updated_at: new Date().toISOString(),
        })
        .eq("id", conversation.id)
        .eq("user_id", userId);
      await recordRuntimeEvent(db, userId, {
        channel: data.source.entryPoint as any,
        eventType: "emery_orchestrated_turn",
        domain: hpoEligible ? "hpo" : route.domain,
        action:
          hpoRouteCommand.action !== "none"
            ? hpoRouteCommand.action
            : routeStopAction.action !== "none"
              ? routeStopAction.action
              : hpoAction.action !== "none"
                ? hpoAction.action
                : hpoFieldRead.action,
        status:
          hpoRouteCommand.needsClarification ||
          routeStopAction.needsClarification ||
          hpoAction.needsClarification
            ? "clarification"
            : hpoRouteCommand.error ||
                ("error" in routeStopAction && routeStopAction.error) ||
                ("error" in hpoAction && hpoAction.error)
              ? "error"
              : "ok",
        durationMs: Date.now() - startedAt,
        model: null,
        metadata: {
          plannedIntents: actionPlan.intents.map((intent) => intent.action),
          calendarRecognized: calendarAction.recognized,
          calendarPerformed: calendarAction.performed,
          routeId:
            hpoRouteCommand.routeId ?? routeStopAction.routeId ?? hpoFieldRead.routeId ?? null,
          executionRunId: hpoRouteCommand.executionRunId ?? routeStopAction.executionRunId ?? null,
          deterministic: true,
        },
      });
      return {
        reply: combinedReply,
        conversationId: conversation.id,
        route,
        memoryWrite,
        voiceStudio,
        actionPlan,
        calendarAction,
        hpoFieldRead,
        hpoRouteCommand,
        routeStopAction,
        hpoAction,
        userMessage: {
          id: userMessage.id,
          role: "user" as const,
          text: data.message,
          createdAt: userMessage.created_at,
          attachments: signed,
        },
        assistantMessage: orchestratedAssistantMessage
          ? {
              id: orchestratedAssistantMessage.id,
              role: "assistant" as const,
              text: combinedReply,
              createdAt: orchestratedAssistantMessage.created_at,
              attachments: [] as ChatAttachment[],
            }
          : null,
      } as const;
    }
    if (calendarReply) {
      const { data: calendarAssistantMessage } = await db
        .from("conversation_messages")
        .insert({
          user_id: userId,
          conversation_id: conversation.id,
          role: "assistant",
          content: calendarReply,
          source_metadata: {
            entryPoint: "emery",
            replyTo: data.source.entryPoint,
            domain: route.domain,
            emery_identity: "central-v1",
            hpoEphemeral: data.source.hpoEphemeral === true,
            hpoEphemeralSession: data.source.hpoEphemeralSession ?? null,
            calendar_action: calendarAction,
          },
        })
        .select("id,created_at")
        .single();
      await db
        .from("conversations")
        .update({
          metadata: {
            ...safe(conversation.metadata),
            last_domain: route.domain,
            identity: "central-v1",
          },
          updated_at: new Date().toISOString(),
        })
        .eq("id", conversation.id)
        .eq("user_id", userId);
      await recordRuntimeEvent(db, userId, {
        channel: data.source.entryPoint as any,
        eventType: "emery_turn",
        domain: route.domain,
        action: calendarAction.action,
        status: calendarAction.needsClarification ? "clarification" : "ok",
        durationMs: Date.now() - startedAt,
        model: MODEL_POLICY.action,
        metadata: {
          calendarPerformed: calendarAction.performed,
          memorySaved: memoryWrite.memorySaved,
          memoryUpdated: memoryWrite.memoryUpdated,
          workingStateUsed: Boolean(workingStateBlock),
          selectedMemoryCount: selected.length,
          memoryMaxItems,
          memoryMaxCharacters,
          ...signals,
        },
      });
      return {
        reply: calendarReply,
        conversationId: conversation.id,
        route,
        memoryWrite,
        voiceStudio,
        calendarAction,
        userMessage: {
          id: userMessage.id,
          role: "user" as const,
          text: data.message,
          createdAt: userMessage.created_at,
          attachments: signed,
        },
        assistantMessage: calendarAssistantMessage
          ? {
              id: calendarAssistantMessage.id,
              role: "assistant" as const,
              text: calendarReply,
              createdAt: calendarAssistantMessage.created_at,
              attachments: [] as ChatAttachment[],
            }
          : null,
      } as const;
    }
    if (hpoFieldReadReply) {
      const { data: hpoFieldReadAssistantMessage } = await db
        .from("conversation_messages")
        .insert({
          user_id: userId,
          conversation_id: conversation.id,
          role: "assistant",
          content: hpoFieldReadReply,
          source_metadata: {
            entryPoint: "emery",
            replyTo: data.source.entryPoint,
            domain: "hpo",
            emery_identity: "central-v1",
            hpoEphemeral: data.source.hpoEphemeral === true,
            hpoEphemeralSession: data.source.hpoEphemeralSession ?? null,
            hpo_field_read: hpoFieldRead,
          },
        })
        .select("id,created_at")
        .single();
      await db
        .from("conversations")
        .update({
          metadata: { ...safe(conversation.metadata), last_domain: "hpo", identity: "central-v1" },
          updated_at: new Date().toISOString(),
        })
        .eq("id", conversation.id)
        .eq("user_id", userId);
      await recordRuntimeEvent(db, userId, {
        channel: data.source.entryPoint as any,
        eventType: "hpo_field_read",
        domain: "hpo",
        action: hpoFieldRead.action,
        status: "ok",
        durationMs: Date.now() - startedAt,
        model: null,
        metadata: {
          routeId: hpoFieldRead.routeId,
          nextStopId: hpoFieldRead.nextStop?.id ?? null,
          completed: hpoFieldRead.completed,
          total: hpoFieldRead.total,
          deterministic: true,
        },
      });
      return {
        reply: hpoFieldReadReply,
        conversationId: conversation.id,
        route,
        memoryWrite,
        voiceStudio,
        hpoFieldRead,
        userMessage: {
          id: userMessage.id,
          role: "user" as const,
          text: data.message,
          createdAt: userMessage.created_at,
          attachments: signed,
        },
        assistantMessage: hpoFieldReadAssistantMessage
          ? {
              id: hpoFieldReadAssistantMessage.id,
              role: "assistant" as const,
              text: hpoFieldReadReply,
              createdAt: hpoFieldReadAssistantMessage.created_at,
              attachments: [] as ChatAttachment[],
            }
          : null,
      } as const;
    }
    if (hpoRouteCommandReply) {
      const { data: hpoRouteCommandAssistantMessage } = await db
        .from("conversation_messages")
        .insert({
          user_id: userId,
          conversation_id: conversation.id,
          role: "assistant",
          content: hpoRouteCommandReply,
          source_metadata: {
            entryPoint: "emery",
            replyTo: data.source.entryPoint,
            domain: "hpo",
            emery_identity: "central-v1",
            hpoEphemeral: data.source.hpoEphemeral === true,
            hpoEphemeralSession: data.source.hpoEphemeralSession ?? null,
            hpo_route_command: hpoRouteCommand,
          },
        })
        .select("id,created_at")
        .single();
      await db
        .from("conversations")
        .update({
          metadata: { ...safe(conversation.metadata), last_domain: "hpo", identity: "central-v1" },
          updated_at: new Date().toISOString(),
        })
        .eq("id", conversation.id)
        .eq("user_id", userId);
      await recordRuntimeEvent(db, userId, {
        channel: data.source.entryPoint as any,
        eventType: "hpo_route_command",
        domain: "hpo",
        action: hpoRouteCommand.action,
        status: hpoRouteCommand.needsClarification
          ? "clarification"
          : hpoRouteCommand.performed
            ? "ok"
            : "error",
        durationMs: Date.now() - startedAt,
        model: null,
        metadata: {
          routeId: hpoRouteCommand.routeId,
          executionRunId: hpoRouteCommand.executionRunId,
          deterministic: true,
        },
      });
      return {
        reply: hpoRouteCommandReply,
        conversationId: conversation.id,
        route,
        memoryWrite,
        voiceStudio,
        hpoRouteCommand,
        userMessage: {
          id: userMessage.id,
          role: "user" as const,
          text: data.message,
          createdAt: userMessage.created_at,
          attachments: signed,
        },
        assistantMessage: hpoRouteCommandAssistantMessage
          ? {
              id: hpoRouteCommandAssistantMessage.id,
              role: "assistant" as const,
              text: hpoRouteCommandReply,
              createdAt: hpoRouteCommandAssistantMessage.created_at,
              attachments: [] as ChatAttachment[],
            }
          : null,
      } as const;
    }
    if (routeStopReply) {
      const { data: routeStopAssistantMessage } = await db
        .from("conversation_messages")
        .insert({
          user_id: userId,
          conversation_id: conversation.id,
          role: "assistant",
          content: routeStopReply,
          source_metadata: {
            entryPoint: "emery",
            replyTo: data.source.entryPoint,
            domain: route.domain,
            emery_identity: "central-v1",
            hpoEphemeral: data.source.hpoEphemeral === true,
            hpoEphemeralSession: data.source.hpoEphemeralSession ?? null,
            hpo_route_stop_action: routeStopAction,
          },
        })
        .select("id,created_at")
        .single();
      await db
        .from("conversations")
        .update({
          metadata: {
            ...safe(conversation.metadata),
            last_domain: route.domain,
            identity: "central-v1",
          },
          updated_at: new Date().toISOString(),
        })
        .eq("id", conversation.id)
        .eq("user_id", userId);
      await recordRuntimeEvent(db, userId, {
        channel: data.source.entryPoint as any,
        eventType: "emery_turn",
        domain: "hpo",
        action: routeStopAction.action,
        status: routeStopAction.needsClarification
          ? "clarification"
          : routeStopAction.performed
            ? "ok"
            : "error",
        durationMs: Date.now() - startedAt,
        model: null,
        metadata: {
          routeId: routeStopAction.routeId,
          stopId: routeStopAction.stopId,
          status: routeStopAction.status,
          executionRunId: routeStopAction.executionRunId,
          deterministic: true,
        },
      });
      return {
        reply: routeStopReply,
        conversationId: conversation.id,
        route,
        memoryWrite,
        voiceStudio,
        routeStopAction,
        userMessage: {
          id: userMessage.id,
          role: "user" as const,
          text: data.message,
          createdAt: userMessage.created_at,
          attachments: signed,
        },
        assistantMessage: routeStopAssistantMessage
          ? {
              id: routeStopAssistantMessage.id,
              role: "assistant" as const,
              text: routeStopReply,
              createdAt: routeStopAssistantMessage.created_at,
              attachments: [] as ChatAttachment[],
            }
          : null,
      } as const;
    }
    if (hpoReply) {
      const { data: hpoAssistantMessage } = await db
        .from("conversation_messages")
        .insert({
          user_id: userId,
          conversation_id: conversation.id,
          role: "assistant",
          content: hpoReply,
          source_metadata: {
            entryPoint: "emery",
            replyTo: data.source.entryPoint,
            domain: route.domain,
            emery_identity: "central-v1",
            hpoEphemeral: data.source.hpoEphemeral === true,
            hpoEphemeralSession: data.source.hpoEphemeralSession ?? null,
            hpo_action: hpoAction,
          },
        })
        .select("id,created_at")
        .single();
      await db
        .from("conversations")
        .update({
          metadata: {
            ...safe(conversation.metadata),
            last_domain: route.domain,
            identity: "central-v1",
          },
          updated_at: new Date().toISOString(),
        })
        .eq("id", conversation.id)
        .eq("user_id", userId);
      await recordRuntimeEvent(db, userId, {
        channel: data.source.entryPoint as any,
        eventType: "emery_turn",
        domain: route.domain,
        action: hpoAction.action,
        status: hpoAction.needsClarification ? "clarification" : "ok",
        durationMs: Date.now() - startedAt,
        model: MODEL_POLICY.action,
        metadata: {
          hpoPerformed: hpoAction.performed,
          memorySaved: memoryWrite.memorySaved,
          memoryUpdated: memoryWrite.memoryUpdated,
          workingStateUsed: Boolean(workingStateBlock),
          selectedMemoryCount: selected.length,
          ...signals,
        },
      });
      return {
        reply: hpoReply,
        conversationId: conversation.id,
        route,
        memoryWrite,
        voiceStudio,
        hpoAction,
        userMessage: {
          id: userMessage.id,
          role: "user" as const,
          text: data.message,
          createdAt: userMessage.created_at,
          attachments: signed,
        },
        assistantMessage: hpoAssistantMessage
          ? {
              id: hpoAssistantMessage.id,
              role: "assistant" as const,
              text: hpoReply,
              createdAt: hpoAssistantMessage.created_at,
              attachments: [] as ChatAttachment[],
            }
          : null,
      } as const;
    }
    const resp = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: MODEL_POLICY.primary,
        tools: [{ type: "web_search" }],
        tool_choice: "auto",
        input: [
          {
            role: "system",
            content:
              ASSISTANT_IDENTITY +
              "\n\n" +
              VOICE_PROFILE_CONTRACT +
              "\n\n" +
              STABLE_RUNTIME_POLICY +
              "\n\nEXECUTION CAPABILITY REGISTRY:\n" +
              executionCapabilityPrompt() +
              "\n\nCAPABILITY RULE: If Adam asks you to execute something outside the registry's executable actions, say what is not connected instead of implying you performed it. If a recent execution receipt says failed or needs_clarification, do not describe that action as completed.",
          },
          {
            role: "system",
            content: `DOMAIN ROUTING:\n${route.domain.toUpperCase()} (${route.reason}). ${domainPrompt(route)}\nEntry point: ${data.source.entryPoint}; input mode: ${data.source.inputMode}; surface: ${data.source.surface ?? "main"}. Entry source is metadata only and must not alter Emery's personality.\nActive HPO UI context: route=${data.source.hpoRouteId ?? "none"}, stop=${data.source.hpoStopId ?? "none"}, account=${data.source.selectedAccountId ?? "none"}, prospect=${data.source.selectedProspectId ?? "none"}.\n\nCurrent stored voice profile: ${JSON.stringify(voiceProfile ?? {})}\nVoice Studio operation this turn: ${JSON.stringify(voiceStudioPrompt)}\nVOICE STUDIO RESPONSE RULES:\n- The Voice Studio operation above is the only source of truth for what the app actually did.\n- If stage=designing, continue conversationally with ONE useful voice-design question at a time. Never dump a giant questionnaire.\n- When suggesting candidates, use only candidates returned by the operation. Recommend a small audition set and do not state unverified acoustic traits as facts.\n- If stage=previewed and operationSucceeded=true, tell Adam the real provider preview is available in the in-app player. Ask what he likes or wants changed. A preview is never approval. When he is ready to lock it in, require an explicit phrase such as “I approve Marin as Emery’s base voice” using the candidate he actually previewed.\n- If stage=preview_failed, say the provider preview failed. Do not imply Adam heard it and do not approve it.\n- If stage=design_refined_needs_preview, acknowledge the refinement and tell Adam the candidate must be previewed again before approval so he approves the sound he actually heard.\n- If stage=approval_needs_preview, tell Adam to preview that exact candidate first.\n- If stage=approval_realtime_unsupported, explain that the candidate was not approved because Realtime validation failed and choose another supported candidate.\n- If the stored voice profile shows voice_studio.stage=designing, previewed, or candidate_selected, continue the Voice Studio naturally even when this turn did not trigger a database operation. Ask only the next useful question.\n- If stage=approved, operationSucceeded=true, and micUnlocked=true, tell Adam the approved base voice and full Voice Profile were saved and the live mic is unlocked. Tell him to tap the mic for the first live conversation.\n- If stage=delivery_refined, profile_refined, or delivery_reset and operationSucceeded=true, confirm the refinement briefly and do NOT restart Voice Studio or ask another design questionnaire. If the change needs a new Voice session to be heard reliably, say that plainly.\n- Never claim a live Voice session has started until Adam actually taps the mic and the Realtime session connects.\n- Voice Studio never creates a second assistant. It is always the same Emery, same memory, same main conversation, same tools, and same domain routing.\n- Never claim any voice/profile/database operation succeeded unless Voice Studio operationSucceeded=true.\n\nMEMORY PERSISTENCE THIS TURN: ${JSON.stringify(memoryWrite)}\nIf savedMemory is present, briefly confirm that explicit memory naturally. Otherwise do not expose memory-system mechanics.\n\nPERMISSION: Do not claim a structured write unless a tool/control layer confirms it. Do not claim any database action unless it says the action succeeded. Do not claim external calendar sync; internal meetings are not Apple or Google Calendar. Use live web search when Adam asks for current, recent, changing, online, local, or fact-checked information; do not browse needlessly for stable personal/context questions. Casual mentions are not permission to create tasks/projects/meetings.`,
          },
          {
            role: "system",
            content: `CURRENT LEARNED CONFIG: response verbosity=${config?.response_verbosity ?? "concise"}; memory item budget=${memoryMaxItems}; memory character budget=${memoryMaxCharacters}; proactive focus=${config?.proactive_focus_enabled !== false}. Honor these preferences when they do not conflict with safety or Adam's current explicit request.`,
          },
          ...(profileBlock ? [{ role: "system", content: `CORE PROFILE:\n${profileBlock}` }] : []),
          ...(memoryBlock
            ? [{ role: "system", content: `SELECTED LONG-TERM MEMORY:\n${memoryBlock}` }]
            : []),
          ...(workingStateBlock
            ? [
                {
                  role: "system",
                  content: `WORKING STATE (current threads, referents, commitments; not long-term memory):\n${workingStateBlock}`,
                },
              ]
            : []),
          {
            role: "system",
            content: `CURRENT ACTIVE OS CONTEXT (bounded):\n${actionBlock}\n\nQUIET FOCUS:\n${focus}\nUse only when relevant. Favor one highest-value next action; never dump a dashboard.`,
          },
          ...(hpoBlock
            ? [
                {
                  role: "system",
                  content: `CURRENT HPO OPERATING CONTEXT (bounded, non-PHI):\n${hpoBlock}\nUse only when this turn actually concerns HPO. Never infer or request PHI from this block.`,
                },
              ]
            : []),
          ...(hpoPlanningContext
            ? [
                {
                  role: "system",
                  content: `CURRENT HPO ROUTE GAME-PLAN CONTEXT (server-verified, non-PHI):\n${JSON.stringify(
                    hpoPlanningContext,
                  ).slice(0, 18000)}\nWork directly with these offices when Adam asks route-planning questions. Explain recommendations from the recorded relationship facts; distinguish saved facts from your judgment.`,
                },
              ]
            : []),
          ...previous.map((x: any) => ({
            role: x.role,
            content: [
              { type: x.role === "assistant" ? "output_text" : "input_text", text: x.text },
            ],
          })),
          { role: "user", content: userContent },
        ],
      }),
    });
    if (!resp.ok) return { error: "Emery couldn't answer right now. Please try again." } as const;
    const responsePayload = await resp.json();
    const reply = responseText(responsePayload);
    if (!reply) return { error: "Emery returned an empty response." } as const;
    const usage = safe(responsePayload?.usage);
    const inputDetails = safe(usage["input_tokens_details"]);
    const inputTokens = Number(usage["input_tokens"] ?? 0) || 0;
    const outputTokens = Number(usage["output_tokens"] ?? 0) || 0;
    const cachedInputTokens = Number(inputDetails["cached_tokens"] ?? 0) || 0;
    const webUsed =
      Array.isArray(responsePayload?.output) &&
      responsePayload.output.some(
        (item: any) => item?.type === "web_search_call" || item?.type === "web_search",
      );
    const { data: assistantMessage } = await db
      .from("conversation_messages")
      .insert({
        user_id: userId,
        conversation_id: conversation.id,
        role: "assistant",
        content: reply,
        source_metadata: {
          entryPoint: "emery",
          replyTo: data.source.entryPoint,
          domain: route.domain,
          emery_identity: "central-v1",
          hpoEphemeral: data.source.hpoEphemeral === true,
          hpoEphemeralSession: data.source.hpoEphemeralSession ?? null,
        },
      })
      .select("id,created_at")
      .single();
    await db
      .from("conversations")
      .update({
        metadata: {
          ...safe(conversation.metadata),
          last_domain: route.domain,
          identity: "central-v1",
        },
        updated_at: new Date().toISOString(),
      })
      .eq("id", conversation.id)
      .eq("user_id", userId);
    await recordRuntimeEvent(db, userId, {
      channel: data.source.entryPoint as any,
      eventType: "emery_turn",
      domain: route.domain,
      action: "respond",
      status: "ok",
      durationMs: Date.now() - startedAt,
      model: MODEL_POLICY.primary,
      metadata: {
        memorySaved: memoryWrite.memorySaved,
        memoryUpdated: memoryWrite.memoryUpdated,
        workingStateUsed: Boolean(workingStateBlock),
        selectedMemoryCount: selected.length,
        memoryMaxItems,
        memoryMaxCharacters,
        responseVerbosity: config?.response_verbosity ?? "concise",
        inputTokens,
        outputTokens,
        cachedInputTokens,
        cacheHitRate: inputTokens > 0 ? cachedInputTokens / inputTokens : 0,
        webUsed,
        ...signals,
      },
    });
    return {
      reply,
      conversationId: conversation.id,
      route,
      memoryWrite,
      voiceStudio,
      userMessage: {
        id: userMessage.id,
        role: "user" as const,
        text: data.message,
        createdAt: userMessage.created_at,
        attachments: signed,
      },
      assistantMessage: assistantMessage
        ? {
            id: assistantMessage.id,
            role: "assistant" as const,
            text: reply,
            createdAt: assistantMessage.created_at,
            attachments: [] as ChatAttachment[],
          }
        : null,
    } as const;
  });

export const getMainConversation = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const db = context.supabase as any,
      c = await mainConversation(db, context.userId);
    const { data } = await db
      .from("conversation_messages")
      .select("id,role,content,created_at,source_metadata")
      .eq("user_id", context.userId)
      .eq("conversation_id", c.id)
      .order("created_at", { ascending: true })
      .limit(500);
    return {
      conversationId: c.id,
      messages: (data ?? [])
        .filter((x: any) => x.source_metadata?.hpoEphemeral !== true)
        .map((x: any) => ({
          id: x.id,
          role: x.role,
          text: x.content,
          createdAt: x.created_at,
          attachments: [],
        })),
    };
  });
export const getMainConversationPage = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (i: { before?: string | null; beforeCreatedAt?: string | null; limit?: number } = {}) => ({
      before: i.beforeCreatedAt ?? i.before ?? null,
      limit: Math.min(100, Math.max(20, Number(i.limit ?? 80))),
    }),
  )
  .handler(async ({ data, context }) => {
    const db = context.supabase as any,
      c = await mainConversation(db, context.userId);
    let q = db
      .from("conversation_messages")
      .select("id,role,content,created_at,source_metadata")
      .eq("user_id", context.userId)
      .eq("conversation_id", c.id)
      .order("created_at", { ascending: false })
      .limit(data.limit + 1);
    if (data.before) q = q.lt("created_at", data.before);
    const { data: rows } = await q;
    const visibleRows = (rows ?? []).filter(
      (row: any) => row.source_metadata?.hpoEphemeral !== true,
    );
    const page = visibleRows.slice(0, data.limit).reverse();
    const cursor = page[0]?.created_at ?? null;
    return {
      conversationId: c.id,
      messages: page.map((x: any) => ({
        id: x.id,
        role: x.role,
        text: x.content,
        createdAt: x.created_at,
        attachments: [],
      })),
      hasMore: visibleRows.length > data.limit || (rows ?? []).length > data.limit,
      nextBefore: cursor,
      nextCursor: cursor,
    };
  });
export const listTasks = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await (context.supabase as any)
      .from("tasks")
      .select("*")
      .eq("user_id", context.userId)
      .order("priority", { ascending: false });
    if (error) throw error;
    return { tasks: data ?? [] };
  });
export const createTask = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (i: {
      title: string;
      details?: string;
      dueAt?: string | null;
      priority?: number;
      idempotencyKey?: string | null;
    }) => ({
      title: String(i.title).trim(),
      details: i.details?.trim() || null,
      dueAt: i.dueAt || null,
      priority: Math.min(5, Math.max(1, Number(i.priority ?? 3))),
      idempotencyKey: i.idempotencyKey?.trim() || null,
    }),
  )
  .handler(async ({ data, context }) => {
    const receipt = await executeCanonicalTaskCreate({
      db: context.supabase as any,
      userId: context.userId,
      idempotencyKey: data.idempotencyKey || `legacy-ui:${crypto.randomUUID()}:task.create`,
      title: data.title,
      details: data.details,
      dueAt: data.dueAt,
      priority: data.priority,
      sourceChannel: "ui",
      source: "manual",
    });
    if (!receipt.ok || receipt.status !== "completed" || !receipt.task?.id)
      throw new Error(receipt.errorMessage || "Task creation failed");
    return { id: receipt.task.id, executionRunId: receipt.executionRunId, reused: receipt.reused };
  });
export const setTaskCompleted = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { id: string; completed: boolean }) => ({
    id: String(i.id),
    completed: Boolean(i.completed),
  }))
  .handler(async ({ data, context }) => {
    const { error } = await (context.supabase as any)
      .from("tasks")
      .update({
        status: data.completed ? "completed" : "inbox",
        completed_at: data.completed ? new Date().toISOString() : null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", data.id)
      .eq("user_id", context.userId);
    if (error) throw error;
    return { ok: true };
  });
export const listProjects = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await (context.supabase as any)
      .from("projects")
      .select("*")
      .eq("user_id", context.userId)
      .order("priority", { ascending: false });
    if (error) throw error;
    return { projects: data ?? [] };
  });
export const saveProject = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (i: {
      id?: string;
      name: string;
      description?: string;
      status?: string;
      priority?: number;
      goal?: string;
      nextAction?: string;
    }) => ({
      ...i,
      name: String(i.name).trim(),
      priority: Math.min(5, Math.max(1, Number(i.priority ?? 3))),
    }),
  )
  .handler(async ({ data, context }) => {
    const db = context.supabase as any,
      payload = {
        name: data.name,
        description: data.description?.trim() || null,
        status: data.status || "active",
        priority: data.priority,
        goal: data.goal?.trim() || null,
        next_action: data.nextAction?.trim() || null,
      };
    if (data.id) {
      const { error } = await db
        .from("projects")
        .update({ ...payload, updated_at: new Date().toISOString() })
        .eq("id", data.id)
        .eq("user_id", context.userId);
      if (error) throw error;
      return { id: data.id };
    }
    const { data: p, error } = await db
      .from("projects")
      .insert({ user_id: context.userId, ...payload })
      .select("id")
      .single();
    if (error) throw error;
    return { id: p.id };
  });
export const listMeetings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await (context.supabase as any)
      .from("meetings")
      .select("*")
      .eq("user_id", context.userId)
      .order("meeting_at", { ascending: true });
    if (error) throw error;
    return { meetings: data ?? [] };
  });
export const createMeeting = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (i: { title: string; meetingAt: string; endAt?: string | null; participants?: string[] }) => {
      const meetingAt = String(i.meetingAt ?? "");
      if (!meetingAt || Number.isNaN(Date.parse(meetingAt)))
        throw new Error("Meeting date and time are required");
      const endAt = i.endAt
        ? String(i.endAt)
        : new Date(Date.parse(meetingAt) + 60 * 60 * 1000).toISOString();
      if (Number.isNaN(Date.parse(endAt)) || Date.parse(endAt) <= Date.parse(meetingAt))
        throw new Error("Meeting end time must be after the start time");
      return {
        title: String(i.title).trim(),
        meetingAt,
        endAt,
        participants: i.participants ?? [],
      };
    },
  )
  .handler(async ({ data, context }) => {
    const { data: m, error } = await (context.supabase as any)
      .from("meetings")
      .insert({
        user_id: context.userId,
        title: data.title,
        meeting_at: data.meetingAt,
        end_at: data.endAt,
        participants: data.participants,
        metadata: { source_type: "manual", ...domainMetadata("general") },
      })
      .select("id")
      .single();
    if (error) throw error;
    return { id: m.id };
  });
