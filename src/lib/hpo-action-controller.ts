/* eslint-disable @typescript-eslint/no-explicit-any */
import { MODEL_POLICY } from "@/lib/model-policy";

export type HpoActionResult = {
  recognized: boolean;
  performed: boolean;
  needsClarification: boolean;
  question: string | null;
  action: "none" | "log_touch" | "set_followup";
  accountId: string | null;
  accountName: string | null;
  recordId: string | null;
  nextAction: string | null;
  dueAt: string | null;
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

function isoOrNull(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

export async function processHpoAction(input: {
  db: any;
  userId: string;
  apiKey: string;
  message: string;
  recent?: Array<{ role?: string; text?: string; createdAt?: string }>;
  timezone?: string;
}): Promise<HpoActionResult> {
  const { db, userId, apiKey, message } = input;
  const timezone = input.timezone ?? "America/New_York";
  if (!message.trim()) {
    return { recognized: false, performed: false, needsClarification: false, question: null, action: "none", accountId: null, accountName: null, recordId: null, nextAction: null, dueAt: null };
  }

  const [{ data: accounts, error: accountError }, { data: contacts, error: contactError }] = await Promise.all([
    db.from("hpo_accounts")
      .select("id,name,account_type,city,address,priority,owner_name,relationship_stage,status,last_touch_at,next_action,next_action_due_at,tags,metadata")
      .eq("user_id", userId)
      .eq("status", "active")
      .order("priority", { ascending: false })
      .limit(100),
    db.from("hpo_contacts")
      .select("id,account_id,name,role_title,relationship_notes")
      .eq("user_id", userId)
      .limit(120),
  ]);
  if (accountError) throw accountError;
  if (contactError) throw contactError;

  const accountRows = accounts ?? [];
  if (!accountRows.length) {
    return { recognized: false, performed: false, needsClarification: false, question: null, action: "none", accountId: null, accountName: null, recordId: null, nextAction: null, dueAt: null };
  }

  const context = JSON.stringify({
    accounts: accountRows,
    contacts: contacts ?? [],
    recent_conversation: (input.recent ?? []).slice(-8),
  }).slice(0, 18000);

  const localNow = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    dateStyle: "full",
    timeStyle: "long",
  }).format(new Date());

  const resp = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODEL_POLICY.action,
      input: [
        {
          role: "system",
          content: `You are the canonical HPO relationship-action controller inside Emery.

Only recognize an HPO database write when Adam clearly authorizes it. Examples:
- "I just visited Weiner Mazzei and spoke with Jenni. Log that..."
- "Set my next follow-up with Lutz for Tuesday..."
- "Remember my next action for Parra Klein is..."
Discussion, brainstorming, route questions, or statements such as "I might follow up" are NOT write permission.

Allowed actions:
1. log_touch — log a non-PHI relationship interaction for one exact current HPO account.
2. set_followup — set a next relationship action for one exact current HPO account.
3. none — no write.

PRIVACY BOUNDARY:
Never put patient names, DOBs, diagnoses, claims/case numbers, treatment details, medical records, or other PHI into HPO account intelligence. If Adam's request contains patient-identifying material, do not write it; ask him to restate only the relationship-level/non-PHI part.

TARGETING:
- target_account_id must be an exact id from CURRENT HPO RECORDS.
- Never invent an account id or silently pick between genuinely ambiguous accounts.
- Respect ownership/exclusion tags. Do not create Adam follow-ups for accounts tagged exclude_from_adam_route unless Adam explicitly says he is acting on that account despite the ownership context.
- If account identity is ambiguous, ask one concise clarification question.
- If a follow-up has a relative date, resolve it from CURRENT LOCAL TIME in the supplied timezone.
- If no exact due time was provided, due_at may be null rather than inventing a clock time.

For log_touch, summary must contain only the relationship-level facts Adam actually supplied. next_action may be captured if he supplied one.
For set_followup, next_action is required.
Return strict JSON only.`,
        },
        { role: "system", content: `CURRENT LOCAL TIME: ${localNow} (${timezone})` },
        { role: "system", content: `CURRENT HPO RECORDS:\n${context}` },
        { role: "user", content: [{ type: "input_text", text: message }] },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "emery_hpo_action",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              recognized: { type: "boolean" },
              action: { type: "string", enum: ["none", "log_touch", "set_followup"] },
              needs_clarification: { type: "boolean" },
              clarification_question: { type: ["string", "null"] },
              target_account_id: { type: ["string", "null"] },
              interaction_type: { type: "string" },
              summary: { type: "string" },
              outcome: { type: "string" },
              relationship_signal: { type: "string" },
              next_action: { type: "string" },
              due_at: { type: ["string", "null"] },
              contains_phi: { type: "boolean" },
            },
            required: ["recognized","action","needs_clarification","clarification_question","target_account_id","interaction_type","summary","outcome","relationship_signal","next_action","due_at","contains_phi"],
          },
        },
      },
    }),
  });

  if (!resp.ok) throw new Error(`HPO action model failed: ${resp.status}`);
  const raw = responseText(await resp.json());
  const parsed = JSON.parse(raw || "{}");
  const action = ["log_touch", "set_followup"].includes(parsed.action) ? parsed.action : "none";

  if (!parsed.recognized || action === "none") {
    return { recognized: false, performed: false, needsClarification: false, question: null, action: "none", accountId: null, accountName: null, recordId: null, nextAction: null, dueAt: null };
  }

  if (parsed.contains_phi) {
    return {
      recognized: true, performed: false, needsClarification: true,
      question: "I can log the relationship update, but leave out patient-identifying or medical details. What non-PHI account update should I save?",
      action, accountId: null, accountName: null, recordId: null, nextAction: null, dueAt: null,
    };
  }

  if (parsed.needs_clarification) {
    return {
      recognized: true, performed: false, needsClarification: true,
      question: String(parsed.clarification_question || "Which HPO account do you mean?"),
      action, accountId: parsed.target_account_id ?? null, accountName: null, recordId: null,
      nextAction: parsed.next_action || null, dueAt: isoOrNull(parsed.due_at),
    };
  }

  const targetId = typeof parsed.target_account_id === "string" ? parsed.target_account_id : "";
  const target = accountRows.find((a: any) => a.id === targetId);
  if (!target) {
    return {
      recognized: true, performed: false, needsClarification: true,
      question: "Which HPO account should I apply that to?",
      action, accountId: null, accountName: null, recordId: null, nextAction: parsed.next_action || null, dueAt: isoOrNull(parsed.due_at),
    };
  }

  if (Array.isArray(target.tags) && target.tags.includes("exclude_from_adam_route") && !/\b(despite|even though|bilal|ownership|i am handling|i'm handling)\b/i.test(message)) {
    return {
      recognized: true, performed: false, needsClarification: true,
      question: `${target.name} is marked as owned by someone else. Do you want me to update that account anyway?`,
      action, accountId: target.id, accountName: target.name, recordId: null, nextAction: parsed.next_action || null, dueAt: isoOrNull(parsed.due_at),
    };
  }

  const dueAt = isoOrNull(parsed.due_at);

  if (action === "log_touch") {
    const summary = String(parsed.summary ?? "").trim();
    if (!summary) throw new Error("HPO interaction summary missing");
    const result = await db.rpc("emery_hpo_log_touch", {
      p_user_id: userId,
      p_account_id: target.id,
      p_interaction_type: String(parsed.interaction_type || "visit"),
      p_summary: summary,
      p_outcome: String(parsed.outcome || "").trim() || null,
      p_relationship_signal: String(parsed.relationship_signal || "").trim() || null,
      p_next_action: String(parsed.next_action || "").trim() || null,
      p_next_action_due_at: dueAt,
      p_source: "emery",
    });
    if (result.error) throw result.error;
    const row = Array.isArray(result.data) ? result.data[0] : result.data;
    return {
      recognized: true, performed: true, needsClarification: false, question: null, action,
      accountId: target.id, accountName: target.name, recordId: row?.id ?? null,
      nextAction: row?.next_action ?? null, dueAt: row?.next_action_due_at ?? dueAt,
    };
  }

  const nextAction = String(parsed.next_action ?? "").trim();
  if (!nextAction) {
    return {
      recognized: true, performed: false, needsClarification: true,
      question: `What should the next action be for ${target.name}?`,
      action, accountId: target.id, accountName: target.name, recordId: null, nextAction: null, dueAt,
    };
  }
  const result = await db.rpc("emery_hpo_set_followup", {
    p_user_id: userId,
    p_account_id: target.id,
    p_next_action: nextAction,
    p_due_at: dueAt,
    p_source: "emery",
  });
  if (result.error) throw result.error;
  const row = Array.isArray(result.data) ? result.data[0] : result.data;
  return {
    recognized: true, performed: true, needsClarification: false, question: null, action,
    accountId: target.id, accountName: target.name, recordId: row?.id ?? target.id,
    nextAction: row?.next_action ?? nextAction, dueAt: row?.next_action_due_at ?? dueAt,
  };
}
