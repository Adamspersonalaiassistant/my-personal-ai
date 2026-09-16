/* eslint-disable @typescript-eslint/no-explicit-any */
import { loadHpoAgentContext } from "@/lib/hpo-agent-context";

type JsonRecord = Record<string, unknown>;

type HpoPending = {
  intent: "log_interaction" | "create_account";
  account_id: string | null;
  account_name: string;
  interaction_type: string;
  summary: string;
  outcome: string;
  relationship_signal: string;
  next_action: string;
  next_action_due_at: string | null;
  account_type: string;
  specialty: string;
  city: string;
  address: string;
  priority: number | null;
};

type HpoParse = Omit<HpoPending, "intent"> & {
  intent: HpoPending["intent"] | "none";
  is_hpo: boolean;
  confidence: number;
  needs_clarification: boolean;
  question: string;
  privacy_risk: boolean;
};

export type HpoTurnResult = {
  isHpo: boolean;
  accountId: string | null;
  accountName: string | null;
  suppressGenericAction: boolean;
  instruction: string;
  context: unknown | null;
  metadata: unknown;
};

function object(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : {};
}

function normalize(text: string) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function outputText(payload: {
  output_text?: string;
  output?: Array<{ content?: Array<{ type?: string; text?: string }> }>;
}) {
  if (typeof payload.output_text === "string") return payload.output_text.trim();
  return (payload.output ?? [])
    .flatMap((item) => item.content ?? [])
    .filter((item) => item.type === "output_text")
    .map((item) => item.text ?? "")
    .join("")
    .trim();
}

function isApproval(message: string) {
  return /^(?:yes|yep|yeah|correct|exactly|do it|please do|go ahead|save it|log it|add it|sure|okay|ok)[.! ]*$/i.test(
    message.trim(),
  );
}

function isCancellation(message: string) {
  return /^(?:no|nope|never mind|nevermind|cancel|don't|do not|forget it)[.! ]*$/i.test(
    message.trim(),
  );
}

function explicitHpoWrite(message: string) {
  if (/^\s*HPO quick capture:/i.test(message)) return true;
  return (
    /\b(?:log|save|record|capture|add)\b[\s\S]{0,80}\b(?:hpo|hudson pro|account|office|visit|touch|relationship|route|follow[- ]?up)\b/i.test(
      message,
    ) || /\b(?:add|create)\b[\s\S]{0,80}\b(?:to|in)\s+(?:my\s+)?HPO\b/i.test(message)
  );
}

function likelyHpo(message: string, accounts: Array<{ name: string }>) {
  if (/^\s*HPO quick capture:/i.test(message)) return true;
  if (
    /\b(?:HPO|Hudson Pro|marketing route|office visit|referral source|relationship account|PCP|primary care|law firm|attorney office|PIP|workers? comp|case manager|lunch meeting|vein services?|hand services?)\b/i.test(
      message,
    )
  )
    return true;
  const haystack = normalize(message);
  return accounts.some((account) => {
    const name = normalize(account.name);
    return name.length >= 4 && haystack.includes(name);
  });
}

function safePriority(value: number | null) {
  if (value === null || !Number.isFinite(value)) return 3;
  return Math.min(5, Math.max(1, Math.round(value)));
}

async function setPending(
  db: any,
  userId: string,
  conversationId: string,
  currentMetadata: unknown,
  pending: HpoPending | null,
) {
  const metadata = { ...object(currentMetadata) };
  if (pending) metadata["hpo_pending"] = pending;
  else delete metadata["hpo_pending"];
  const { error } = await db
    .from("conversations")
    .update({ metadata, updated_at: new Date().toISOString() })
    .eq("id", conversationId)
    .eq("user_id", userId);
  if (error) throw error;
  return metadata;
}

function readPending(metadata: unknown): HpoPending | null {
  const value = object(metadata)["hpo_pending"];
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Partial<HpoPending>;
  if (row.intent !== "log_interaction" && row.intent !== "create_account") return null;
  return {
    intent: row.intent,
    account_id: typeof row.account_id === "string" ? row.account_id : null,
    account_name: typeof row.account_name === "string" ? row.account_name : "",
    interaction_type: typeof row.interaction_type === "string" ? row.interaction_type : "visit",
    summary: typeof row.summary === "string" ? row.summary : "",
    outcome: typeof row.outcome === "string" ? row.outcome : "",
    relationship_signal: typeof row.relationship_signal === "string" ? row.relationship_signal : "",
    next_action: typeof row.next_action === "string" ? row.next_action : "",
    next_action_due_at: typeof row.next_action_due_at === "string" ? row.next_action_due_at : null,
    account_type: typeof row.account_type === "string" ? row.account_type : "",
    specialty: typeof row.specialty === "string" ? row.specialty : "",
    city: typeof row.city === "string" ? row.city : "",
    address: typeof row.address === "string" ? row.address : "",
    priority: typeof row.priority === "number" ? row.priority : null,
  };
}

async function parseHpoTurn(
  apiKey: string,
  message: string,
  nowIso: string,
  accounts: Array<Record<string, unknown>>,
): Promise<HpoParse> {
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-5.6-luna",
      input: [
        {
          role: "system",
          content:
            "You are Emery's private HPO routing parser. Do not answer Adam. Decide whether the newest message belongs to Hudson Pro work and, if so, whether it describes an account creation or a meaningful referral-source relationship interaction. Use ONLY the supplied HPO account IDs; never invent an ID or pretend an uncertain account is matched. HPO stores referral-source/account/field-sales intelligence only. Set privacy_risk=true if the message contains patient-identifying medical/case information such as a patient name tied to care, DOB, diagnosis, claim/case number, medical record, or other PHI; do not extract that material into summary/outcome. Account/business contact names are allowed. For a relationship interaction, summarize only the professional account touch, outcome/opportunity, relationship signal, and next action. Resolve relative dates using current_time. If the account is ambiguous, set needs_clarification=true with one concise question. If the message merely asks HPO Agent a question or requests advice and does not report something to store, intent=none while is_hpo may still be true. Account creation should only be selected when Adam clearly wants an HPO account added/created.",
        },
        {
          role: "user",
          content: JSON.stringify({
            current_time: nowIso,
            hpo_accounts: accounts.map((account) => ({
              id: account["id"],
              name: account["name"],
              account_type: account["account_type"],
              specialty: account["specialty"],
              city: account["city"],
              address: account["address"],
            })),
            newest_message: message,
          }),
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "hpo_turn",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              is_hpo: { type: "boolean" },
              intent: { type: "string", enum: ["log_interaction", "create_account", "none"] },
              confidence: { type: "number", minimum: 0, maximum: 1 },
              account_id: { type: ["string", "null"] },
              account_name: { type: "string" },
              interaction_type: { type: "string" },
              summary: { type: "string" },
              outcome: { type: "string" },
              relationship_signal: { type: "string" },
              next_action: { type: "string" },
              next_action_due_at: { type: ["string", "null"] },
              account_type: { type: "string" },
              specialty: { type: "string" },
              city: { type: "string" },
              address: { type: "string" },
              priority: { type: ["integer", "null"], minimum: 1, maximum: 5 },
              needs_clarification: { type: "boolean" },
              question: { type: "string" },
              privacy_risk: { type: "boolean" },
            },
            required: [
              "is_hpo",
              "intent",
              "confidence",
              "account_id",
              "account_name",
              "interaction_type",
              "summary",
              "outcome",
              "relationship_signal",
              "next_action",
              "next_action_due_at",
              "account_type",
              "specialty",
              "city",
              "address",
              "priority",
              "needs_clarification",
              "question",
              "privacy_risk",
            ],
          },
        },
      },
    }),
  });
  if (!response.ok) throw new Error(`HPO routing failed with ${response.status}`);
  const text = outputText(await response.json());
  return JSON.parse(text) as HpoParse;
}

async function executePending(db: any, userId: string, pending: HpoPending, sourceRef: string) {
  if (pending.intent === "create_account") {
    const existing = await db
      .from("hpo_accounts")
      .select("id, name")
      .eq("user_id", userId)
      .ilike("name", pending.account_name)
      .limit(2);
    if (existing.error) throw existing.error;
    if ((existing.data ?? []).length) {
      return {
        accountId: existing.data[0].id as string,
        accountName: existing.data[0].name as string,
        instruction: `${existing.data[0].name} is already in HPO. Do not claim a duplicate was created.`,
      };
    }
    const { data, error } = await db
      .from("hpo_accounts")
      .insert({
        user_id: userId,
        name: pending.account_name,
        account_type: pending.account_type || null,
        specialty: pending.specialty || null,
        city: pending.city || null,
        address: pending.address || null,
        priority: safePriority(pending.priority),
        relationship_stage: "prospect",
        source_origin: "emery_chat",
        metadata: { source_ref: sourceRef },
      })
      .select("id, name")
      .single();
    if (error || !data) throw error ?? new Error("HPO account creation failed");
    return {
      accountId: data.id as string,
      accountName: data.name as string,
      instruction: `${data.name} was added to the HPO account system successfully.`,
    };
  }

  if (!pending.account_id) throw new Error("A verified HPO account is required");
  const { data: account, error: accountError } = await db
    .from("hpo_accounts")
    .select("id, name")
    .eq("user_id", userId)
    .eq("id", pending.account_id)
    .maybeSingle();
  if (accountError) throw accountError;
  if (!account) throw new Error("HPO account not found");

  const { data: interaction, error } = await db
    .from("hpo_interactions")
    .insert({
      user_id: userId,
      account_id: pending.account_id,
      interaction_type: pending.interaction_type || "visit",
      occurred_at: new Date().toISOString(),
      summary: pending.summary,
      outcome: pending.outcome || null,
      relationship_signal: pending.relationship_signal || null,
      next_action: pending.next_action || null,
      next_action_due_at: pending.next_action_due_at,
      source_type: "emery_chat",
      source_ref: sourceRef,
    })
    .select("id")
    .single();
  if (error || !interaction) throw error ?? new Error("HPO interaction save failed");

  const updates: Record<string, unknown> = {
    last_touch_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  if (pending.next_action) updates["next_action"] = pending.next_action;
  if (pending.next_action_due_at) updates["next_action_due_at"] = pending.next_action_due_at;
  const { error: updateError } = await db
    .from("hpo_accounts")
    .update(updates)
    .eq("id", pending.account_id)
    .eq("user_id", userId);
  if (updateError) throw updateError;

  return {
    accountId: account.id as string,
    accountName: account.name as string,
    instruction: `The HPO relationship touch for ${account.name} was saved successfully.`,
  };
}

export async function processHpoTurn(input: {
  apiKey: string;
  db: any;
  userId: string;
  conversationId: string;
  conversationMetadata: unknown;
  message: string;
  sourceRef: string;
}): Promise<HpoTurnResult> {
  const { apiKey, db, userId, conversationId, message, sourceRef } = input;
  let metadata = input.conversationMetadata;
  const pending = readPending(metadata);

  if (pending && isCancellation(message)) {
    metadata = await setPending(db, userId, conversationId, metadata, null);
    return {
      isHpo: true,
      accountId: pending.account_id,
      accountName: pending.account_name || null,
      suppressGenericAction: true,
      instruction: "Adam cancelled the pending HPO write. Do not save it.",
      context: await loadHpoAgentContext(db, userId, message),
      metadata,
    };
  }

  if (pending && isApproval(message)) {
    const saved = await executePending(db, userId, pending, sourceRef);
    metadata = await setPending(db, userId, conversationId, metadata, null);
    return {
      isHpo: true,
      accountId: saved.accountId,
      accountName: saved.accountName,
      suppressGenericAction: false,
      instruction: saved.instruction,
      context: await loadHpoAgentContext(db, userId, message),
      metadata,
    };
  }

  const accountsResult = await db
    .from("hpo_accounts")
    .select("id, name, account_type, specialty, city, address")
    .eq("user_id", userId)
    .eq("status", "active")
    .order("priority", { ascending: false })
    .limit(100);
  if (accountsResult.error) throw accountsResult.error;
  const accounts = accountsResult.data ?? [];

  if (!likelyHpo(message, accounts)) {
    return {
      isHpo: false,
      accountId: null,
      accountName: null,
      suppressGenericAction: false,
      instruction: "No HPO-specific write or routing occurred.",
      context: null,
      metadata,
    };
  }

  const parsed = await parseHpoTurn(apiKey, message, new Date().toISOString(), accounts);
  if (!parsed.is_hpo || parsed.confidence < 0.78) {
    return {
      isHpo: false,
      accountId: null,
      accountName: null,
      suppressGenericAction: false,
      instruction: "No HPO-specific write or routing occurred.",
      context: null,
      metadata,
    };
  }

  const account = parsed.account_id
    ? accounts.find((candidate: any) => candidate.id === parsed.account_id)
    : null;
  const verifiedAccountId = account?.id ?? null;
  const verifiedAccountName = account?.name ?? null;

  if (parsed.privacy_risk) {
    return {
      isHpo: true,
      accountId: verifiedAccountId,
      accountName: verifiedAccountName,
      suppressGenericAction: true,
      instruction:
        "Do not save the HPO content because it appears to include patient-identifying medical/case information. Tell Adam briefly to keep HPO account updates non-PHI and use the approved patient/case workflow for identifiable information.",
      context: await loadHpoAgentContext(db, userId, message),
      metadata,
    };
  }

  if (parsed.intent === "none") {
    return {
      isHpo: true,
      accountId: verifiedAccountId,
      accountName: verifiedAccountName,
      suppressGenericAction: false,
      instruction:
        "This is HPO context, but no HPO relationship/account write occurred. Use the scoped HPO operating context when it improves the answer.",
      context: await loadHpoAgentContext(db, userId, message),
      metadata,
    };
  }

  const candidate: HpoPending = {
    intent: parsed.intent,
    account_id: parsed.intent === "log_interaction" ? verifiedAccountId : null,
    account_name: parsed.account_name || verifiedAccountName || "",
    interaction_type: parsed.interaction_type || "visit",
    summary: parsed.summary,
    outcome: parsed.outcome,
    relationship_signal: parsed.relationship_signal,
    next_action: parsed.next_action,
    next_action_due_at: parsed.next_action_due_at,
    account_type: parsed.account_type,
    specialty: parsed.specialty,
    city: parsed.city,
    address: parsed.address,
    priority: parsed.priority,
  };

  const missingAccount = parsed.intent === "log_interaction" && !candidate.account_id;
  if (parsed.needs_clarification || missingAccount || !candidate.account_name) {
    metadata = await setPending(db, userId, conversationId, metadata, candidate);
    const question =
      parsed.question ||
      (missingAccount
        ? `Which HPO account should I attach that update to?`
        : `What account name should I use?`);
    return {
      isHpo: true,
      accountId: candidate.account_id,
      accountName: candidate.account_name || null,
      suppressGenericAction: true,
      instruction: `Ask only this HPO clarification before writing anything: ${question}`,
      context: await loadHpoAgentContext(db, userId, message),
      metadata,
    };
  }

  if (explicitHpoWrite(message)) {
    const saved = await executePending(db, userId, candidate, sourceRef);
    metadata = await setPending(db, userId, conversationId, metadata, null);
    return {
      isHpo: true,
      accountId: saved.accountId,
      accountName: saved.accountName,
      suppressGenericAction: false,
      instruction: `${saved.instruction} Any task/meeting created from this same turn should be tagged as HPO and linked to the account when available.`,
      context: await loadHpoAgentContext(db, userId, message),
      metadata,
    };
  }

  metadata = await setPending(db, userId, conversationId, metadata, candidate);
  return {
    isHpo: true,
    accountId: candidate.account_id,
    accountName: candidate.account_name || null,
    suppressGenericAction: false,
    instruction:
      parsed.intent === "log_interaction"
        ? `This sounds like an HPO relationship update for ${candidate.account_name}. Ask one brief combined confirmation to log the update${candidate.next_action ? ` and preserve the follow-up '${candidate.next_action}'` : ""}.`
        : `Adam mentioned creating ${candidate.account_name} as an HPO account but did not clearly command the write. Ask one brief confirmation before adding it.`,
    context: await loadHpoAgentContext(db, userId, message),
    metadata,
  };
}
