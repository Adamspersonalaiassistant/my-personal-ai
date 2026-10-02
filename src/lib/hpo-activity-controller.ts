/* eslint-disable @typescript-eslint/no-explicit-any */
import { MODEL_POLICY } from "@/lib/model-policy";
import {
  beginExecution,
  clarifyExecution,
  completeExecution,
  failExecution,
} from "@/lib/execution-ledger";

export type HpoActivityType = "office_visit" | "lunch" | "dinner" | "event";
export type HpoActivityResult = {
  recognized: boolean;
  performed: boolean;
  needsClarification: boolean;
  question: string | null;
  action: "none" | "schedule_activity" | "log_activity";
  activityType: HpoActivityType | null;
  activityTitle: string | null;
  meetingId: string | null;
  accountId: string | null;
  accountName: string | null;
  recordId: string | null;
  nextAction: string | null;
  dueAt: string | null;
  alreadySaved?: boolean;
  error?: string | null;
};

function responseText(payload: any) {
  if (typeof payload?.output_text === "string") return payload.output_text.trim();
  return (payload?.output ?? [])
    .flatMap((item: any) => (Array.isArray(item?.content) ? item.content : []))
    .filter((item: any) => item?.type === "output_text")
    .map((item: any) => item?.text ?? "")
    .join("")
    .trim();
}
function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
function isoOrNull(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
function emptyResult(): HpoActivityResult {
  return {
    recognized: false,
    performed: false,
    needsClarification: false,
    question: null,
    action: "none",
    activityType: null,
    activityTitle: null,
    meetingId: null,
    accountId: null,
    accountName: null,
    recordId: null,
    nextAction: null,
    dueAt: null,
  };
}
function label(type: HpoActivityType) {
  return ({ office_visit: "Office visit", lunch: "Lunch", dinner: "Dinner", event: "Event" })[
    type
  ];
}

export async function processHpoActivity(input: {
  db: any;
  userId: string;
  apiKey: string;
  message: string;
  recent?: Array<{ role?: string; text?: string; createdAt?: string }>;
  timezone?: string;
  sourceMessageId?: string | null;
  selectedAccountId?: string | null;
  calendarAction?: any;
}): Promise<HpoActivityResult> {
  const { db, userId, apiKey, message } = input;
  if (!message.trim()) return emptyResult();
  const timezone = input.timezone ?? "America/New_York";
  const now = Date.now();
  const from = new Date(now - 21 * 24 * 60 * 60 * 1000).toISOString();
  const to = new Date(now + 120 * 24 * 60 * 60 * 1000).toISOString();

  const [accountsResult, meetingsResult] = await Promise.all([
    db
      .from("hpo_accounts")
      .select("id,name,account_type,specialty,city,status,priority")
      .eq("user_id", userId)
      .eq("status", "active")
      .order("priority", { ascending: false })
      .limit(180),
    db
      .from("meetings")
      .select("id,title,meeting_at,end_at,participants,metadata")
      .eq("user_id", userId)
      .gte("meeting_at", from)
      .lte("meeting_at", to)
      .order("meeting_at", { ascending: false })
      .limit(120),
  ]);
  if (accountsResult.error) throw accountsResult.error;
  if (meetingsResult.error) throw meetingsResult.error;
  const accounts = accountsResult.data ?? [];
  const meetings = meetingsResult.data ?? [];
  const justCreatedIds = (input.calendarAction?.items ?? [])
    .filter((item: any) => item?.performed && item?.action === "create_event" && item?.recordId)
    .map((item: any) => String(item.recordId));

  const localNow = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    dateStyle: "full",
    timeStyle: "long",
  }).format(new Date());
  const context = JSON.stringify({
    selected_account_id: input.selectedAccountId ?? null,
    just_created_calendar_event_ids: justCreatedIds,
    accounts: accounts.map((row: any) => ({
      id: row.id,
      name: row.name,
      account_type: row.account_type,
      specialty: row.specialty,
      city: row.city,
    })),
    calendar_events: meetings.map((row: any) => ({
      id: row.id,
      title: row.title,
      meeting_at: row.meeting_at,
      end_at: row.end_at,
      metadata: row.metadata,
    })),
    recent_conversation: (input.recent ?? []).slice(-10),
  }).slice(0, 22000);

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODEL_POLICY.action,
      input: [
        {
          role: "system",
          content: `You are Emery's canonical HPO Activity controller. HPO Activity is a professional CRM timeline with exactly four activity types:

1. office_visit — a routine in-person relationship/marketing visit to an office. Route stops and field visit notes belong here.
2. lunch — a business lunch with a doctor, attorney, medical provider, referral partner, office, or professional contact, whether at an office or restaurant.
3. dinner — the same relationship purpose as Lunch, but a dinner/evening meal.
4. event — a broader networking, industry, relationship, social-business, conference, open-house, or hosted event such as the Paramus MRI Oktoberfest. Do not use Event for routine office visits or meals.

Do not classify calls, texts, emails, or ordinary personal activities into these four types.

A future HPO activity is a Calendar event plus an HPO Activity classification. Use schedule_activity only when Adam clearly asks Emery to put/schedule/add the business activity on his calendar or schedule. The Calendar controller runs before you, so a just-created event id may appear in just_created_calendar_event_ids. Match the exact current event; never invent an id.

Use log_activity when Adam clearly asks to log/save a completed activity OR when he is plainly answering an Emery recap prompt for a pending HPO activity with substantive details. If a completed activity is mentioned but Emery does not yet know what happened, who he spoke with, or any useful outcome, ask one short recap question instead of inventing a summary. For a pending activity from yesterday/recently, if exactly one event clearly fits the user's recap, you may attach it even if the user does not repeat the title.

Office visits created through the route/stop workflow are normally logged by the route controller; do not duplicate a visit that is already represented in HPO interaction history.

For schedule_activity, activity_type and meeting_id are required. For log_activity, activity_type and a factual summary are required; meeting_id may be null for a retrospective activity that was never on the Calendar. Lunches, dinners, and events may be accountless if they involved multiple contacts or no exact HPO account. An office_visit should target an exact office/account when possible.

Never store patient names, DOBs, diagnoses, claim/case identifiers, treatment details, or other PHI. Business contact names are allowed.

Resolve relative dates from CURRENT LOCAL TIME. Do not invent a follow-up date or time. Return strict JSON only.`,
        },
        { role: "system", content: `CURRENT LOCAL TIME: ${localNow} (${timezone})` },
        { role: "system", content: `CURRENT HPO ACTIVITY CONTEXT:\n${context}` },
        { role: "user", content: [{ type: "input_text", text: message }] },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "emery_hpo_activity",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              recognized: { type: "boolean" },
              action: { type: "string", enum: ["none", "schedule_activity", "log_activity"] },
              needs_clarification: { type: "boolean" },
              clarification_question: { type: ["string", "null"] },
              activity_type: {
                type: ["string", "null"],
                enum: ["office_visit", "lunch", "dinner", "event", null],
              },
              activity_title: { type: ["string", "null"] },
              meeting_id: { type: ["string", "null"] },
              target_account_id: { type: ["string", "null"] },
              occurred_at: { type: ["string", "null"] },
              summary: { type: "string" },
              outcome: { type: "string" },
              relationship_signal: { type: "string" },
              next_action: { type: "string" },
              due_at: { type: ["string", "null"] },
              contains_phi: { type: "boolean" },
            },
            required: [
              "recognized",
              "action",
              "needs_clarification",
              "clarification_question",
              "activity_type",
              "activity_title",
              "meeting_id",
              "target_account_id",
              "occurred_at",
              "summary",
              "outcome",
              "relationship_signal",
              "next_action",
              "due_at",
              "contains_phi",
            ],
          },
        },
      },
    }),
  });
  if (!response.ok) throw new Error(`HPO Activity model failed: ${response.status}`);
  const parsed = JSON.parse(responseText(await response.json()) || "{}");
  if (!parsed.recognized || !["schedule_activity", "log_activity"].includes(parsed.action)) {
    return emptyResult();
  }
  const action = parsed.action as "schedule_activity" | "log_activity";
  const activityType = parsed.activity_type as HpoActivityType | null;

  const execution = await beginExecution({
    db,
    userId,
    domain: "hpo",
    action: `hpo.activity.${action}`,
    sourceMessageId: input.sourceMessageId ?? null,
    idempotencyKey: input.sourceMessageId
      ? `message:${input.sourceMessageId}:hpo-activity:${action}`
      : null,
    targetType: action === "schedule_activity" ? "meeting" : "hpo_interaction",
    targetId: parsed.meeting_id ?? null,
    requestPayload: {
      message,
      activityType,
      activityTitle: parsed.activity_title ?? null,
      meetingId: parsed.meeting_id ?? null,
      targetAccountId: parsed.target_account_id ?? null,
    },
  });
  if (execution.reused && execution.resultPayload["hpoActivityResult"]) {
    return execution.resultPayload["hpoActivityResult"] as HpoActivityResult;
  }

  const clarify = async (question: string): Promise<HpoActivityResult> => {
    const result: HpoActivityResult = {
      recognized: true,
      performed: false,
      needsClarification: true,
      question,
      action,
      activityType,
      activityTitle: parsed.activity_title ?? null,
      meetingId: parsed.meeting_id ?? null,
      accountId: parsed.target_account_id ?? null,
      accountName: null,
      recordId: null,
      nextAction: parsed.next_action || null,
      dueAt: isoOrNull(parsed.due_at),
    };
    await clarifyExecution({
      db,
      userId,
      runId: execution.id,
      question,
      resultPayload: { hpoActivityResult: result as unknown as Record<string, unknown> },
    });
    return result;
  };

  if (parsed.contains_phi) {
    return clarify(
      "Tell me only the non-patient relationship details from that activity so I can save it safely.",
    );
  }
  if (parsed.needs_clarification) {
    return clarify(
      String(
        parsed.clarification_question ||
          "What happened at that activity, who did you speak with, and is there any follow-up?",
      ),
    );
  }
  if (!activityType) return clarify("Should I file this as an Office visit, Lunch, Dinner, or Event?");

  let meetingId = typeof parsed.meeting_id === "string" ? parsed.meeting_id : null;
  if (!meetingId && justCreatedIds.length === 1 && action === "schedule_activity") {
    meetingId = justCreatedIds[0];
  }
  let meeting = meetingId ? meetings.find((row: any) => row.id === meetingId) ?? null : null;
  if (meetingId && !meeting) {
    const exact = await db
      .from("meetings")
      .select("id,title,meeting_at,end_at,participants,metadata")
      .eq("user_id", userId)
      .eq("id", meetingId)
      .maybeSingle();
    if (exact.error) throw exact.error;
    meeting = exact.data ?? null;
  }
  const account = accounts.find((row: any) => row.id === parsed.target_account_id) ?? null;

  if (action === "schedule_activity") {
    if (!meeting) return clarify("What date and time should I put this HPO activity on your calendar?");
    const currentMeta = object(meeting.metadata);
    const inferredAccountId =
      account?.id ??
      (typeof currentMeta["account_id"] === "string" ? String(currentMeta["account_id"]) : null);
    const activityTitle = String(parsed.activity_title || meeting.title || label(activityType)).trim();
    const nextMeta = {
      ...currentMeta,
      domain: "hpo",
      hpo: true,
      hpo_activity_type: activityType,
      hpo_activity_title: activityTitle,
      hpo_account_id: inferredAccountId,
      hpo_recap_required: true,
      hpo_recap_status: "pending",
      hpo_activity_source: "emery",
      hpo_activity_source_message_id: input.sourceMessageId ?? null,
    };
    const updated = await db
      .from("meetings")
      .update({ metadata: nextMeta })
      .eq("user_id", userId)
      .eq("id", meeting.id)
      .select("id,title")
      .single();
    if (updated.error || !updated.data) {
      await failExecution({
        db,
        userId,
        runId: execution.id,
        errorCode: "hpo_activity_schedule_failed",
        errorMessage: String(updated.error?.message ?? updated.error ?? "Activity classification failed"),
        retryable: true,
      });
      throw updated.error ?? new Error("HPO Activity classification failed");
    }
    const result: HpoActivityResult = {
      recognized: true,
      performed: true,
      needsClarification: false,
      question: null,
      action,
      activityType,
      activityTitle,
      meetingId: meeting.id,
      accountId: inferredAccountId,
      accountName: account?.name ?? null,
      recordId: meeting.id,
      nextAction: null,
      dueAt: null,
    };
    await completeExecution({
      db,
      userId,
      runId: execution.id,
      resultPayload: { hpoActivityResult: result as unknown as Record<string, unknown> },
      targetType: "meeting",
      targetId: meeting.id,
    });
    return result;
  }

  const summary = String(parsed.summary ?? "").trim();
  if (!summary) {
    const title = String(parsed.activity_title || meeting?.title || label(activityType));
    return clarify(
      `How did ${title} go? Who did you speak with, what happened, and is there any follow-up I should save?`,
    );
  }
  if (meetingId) {
    const existing = await db
      .from("hpo_interactions")
      .select("id,account_id,activity_type,activity_title,next_action,next_action_due_at")
      .eq("user_id", userId)
      .eq("meeting_id", meetingId)
      .limit(1)
      .maybeSingle();
    if (existing.error) throw existing.error;
    if (existing.data) {
      const result: HpoActivityResult = {
        recognized: true,
        performed: true,
        needsClarification: false,
        question: null,
        action,
        activityType: (existing.data.activity_type ?? activityType) as HpoActivityType,
        activityTitle:
          existing.data.activity_title ?? parsed.activity_title ?? meeting?.title ?? null,
        meetingId,
        accountId: existing.data.account_id ?? null,
        accountName: account?.name ?? null,
        recordId: existing.data.id,
        nextAction: existing.data.next_action ?? null,
        dueAt: existing.data.next_action_due_at ?? null,
        alreadySaved: true,
      };
      await completeExecution({
        db,
        userId,
        runId: execution.id,
        resultPayload: { hpoActivityResult: result as unknown as Record<string, unknown> },
        targetType: "hpo_interaction",
        targetId: existing.data.id,
      });
      return result;
    }
  }

  const meetingMeta = object(meeting?.metadata);
  const meetingAccountId =
    typeof meetingMeta["hpo_account_id"] === "string"
      ? String(meetingMeta["hpo_account_id"])
      : typeof meetingMeta["account_id"] === "string"
        ? String(meetingMeta["account_id"])
        : null;
  const resolvedAccount =
    account ?? accounts.find((row: any) => row.id === meetingAccountId) ?? null;
  if (activityType === "office_visit" && !resolvedAccount && !meeting) {
    return clarify("Which office should I attach that office visit to?");
  }
  const occurredAt = isoOrNull(parsed.occurred_at) ?? meeting?.meeting_at ?? new Date().toISOString();
  const activityTitle = String(
    parsed.activity_title ||
      meeting?.title ||
      (resolvedAccount ? `${label(activityType)} · ${resolvedAccount.name}` : label(activityType)),
  ).trim();
  const dueAt = isoOrNull(parsed.due_at);
  const inserted = await db
    .from("hpo_interactions")
    .insert({
      user_id: userId,
      account_id: resolvedAccount?.id ?? null,
      interaction_type: activityType === "office_visit" ? "visit" : activityType,
      activity_type: activityType,
      activity_title: activityTitle,
      meeting_id: meeting?.id ?? null,
      occurred_at: occurredAt,
      summary,
      outcome: String(parsed.outcome || "").trim() || null,
      relationship_signal: String(parsed.relationship_signal || "").trim() || null,
      next_action: String(parsed.next_action || "").trim() || null,
      next_action_due_at: dueAt,
      source_type: "emery_activity",
      source_ref: input.sourceMessageId ?? null,
      metadata: {
        non_phi: true,
        structured_activity: true,
        source_message_id: input.sourceMessageId ?? null,
      },
    })
    .select("id")
    .single();
  if (inserted.error || !inserted.data) {
    await failExecution({
      db,
      userId,
      runId: execution.id,
      errorCode: "hpo_activity_log_failed",
      errorMessage: String(inserted.error?.message ?? inserted.error ?? "Activity write failed"),
      retryable: true,
    });
    throw inserted.error ?? new Error("HPO Activity write failed");
  }

  if (resolvedAccount) {
    const accountUpdate: Record<string, unknown> = {
      last_touch_at: occurredAt,
      updated_at: new Date().toISOString(),
    };
    if (String(parsed.next_action || "").trim()) {
      accountUpdate["next_action"] = String(parsed.next_action).trim();
    }
    if (dueAt) accountUpdate["next_action_due_at"] = dueAt;
    const updated = await db
      .from("hpo_accounts")
      .update(accountUpdate)
      .eq("user_id", userId)
      .eq("id", resolvedAccount.id);
    if (updated.error) throw updated.error;
  }

  if (meeting) {
    const completedMeta = {
      ...meetingMeta,
      domain: "hpo",
      hpo: true,
      hpo_activity_type: activityType,
      hpo_activity_title: activityTitle,
      hpo_account_id: resolvedAccount?.id ?? meetingAccountId,
      hpo_recap_required: true,
      hpo_recap_status: "complete",
      hpo_recap_completed_at: new Date().toISOString(),
      hpo_interaction_id: inserted.data.id,
    };
    const completed = await db
      .from("meetings")
      .update({ metadata: completedMeta })
      .eq("user_id", userId)
      .eq("id", meeting.id);
    if (completed.error) throw completed.error;
  }

  const result: HpoActivityResult = {
    recognized: true,
    performed: true,
    needsClarification: false,
    question: null,
    action,
    activityType,
    activityTitle,
    meetingId: meeting?.id ?? null,
    accountId: resolvedAccount?.id ?? null,
    accountName: resolvedAccount?.name ?? null,
    recordId: inserted.data.id,
    nextAction: String(parsed.next_action || "").trim() || null,
    dueAt,
  };
  await completeExecution({
    db,
    userId,
    runId: execution.id,
    resultPayload: { hpoActivityResult: result as unknown as Record<string, unknown> },
    targetType: "hpo_interaction",
    targetId: inserted.data.id,
  });
  return result;
}
