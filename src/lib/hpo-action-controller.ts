/* eslint-disable @typescript-eslint/no-explicit-any */
import { MODEL_POLICY } from "@/lib/model-policy";
import {
  beginExecution,
  clarifyExecution,
  completeExecution,
  failExecution,
} from "@/lib/execution-ledger";
import { geocodeHpoOfficeAddress } from "@/lib/hpo-geocode";

export type HpoActionResult = {
  recognized: boolean;
  performed: boolean;
  needsClarification: boolean;
  question: string | null;
  action: "none" | "log_touch" | "set_followup" | "create_account" | "update_account";
  accountId: string | null;
  accountName: string | null;
  recordId: string | null;
  nextAction: string | null;
  dueAt: string | null;
  changedFields?: string[];
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
  sourceMessageId?: string | null;
  selectedAccountId?: string | null;
}): Promise<HpoActionResult> {
  const { db, userId, apiKey, message } = input;
  const timezone = input.timezone ?? "America/New_York";
  if (!message.trim()) {
    return { recognized: false, performed: false, needsClarification: false, question: null, action: "none", accountId: null, accountName: null, recordId: null, nextAction: null, dueAt: null };
  }

  const [{ data: accounts, error: accountError }, { data: contacts, error: contactError }] = await Promise.all([
    db.from("hpo_accounts")
      .select("id,name,account_type,specialty,territory,city,address,priority,owner_name,relationship_stage,relationship_health,status,last_touch_at,next_action,next_action_due_at,opportunity,blockers,notes,tags,metadata,latitude,longitude,geocoded_at")
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

  const accountRows = [...(accounts ?? [])];
  if (
    input.selectedAccountId &&
    !accountRows.some((row: any) => row.id === input.selectedAccountId)
  ) {
    const selectedResult = await db
      .from("hpo_accounts")
      .select("id,name,account_type,specialty,territory,city,address,priority,owner_name,relationship_stage,relationship_health,status,last_touch_at,next_action,next_action_due_at,opportunity,blockers,notes,tags,metadata,latitude,longitude,geocoded_at")
      .eq("user_id", userId)
      .eq("id", input.selectedAccountId)
      .maybeSingle();
    if (selectedResult.error) throw selectedResult.error;
    if (selectedResult.data) accountRows.unshift(selectedResult.data);
  }
  if (!accountRows.length) {
    return { recognized: false, performed: false, needsClarification: false, question: null, action: "none", accountId: null, accountName: null, recordId: null, nextAction: null, dueAt: null };
  }

  const context = JSON.stringify({
    selected_account_id: input.selectedAccountId ?? null,
    accounts: accountRows,
    contacts: contacts ?? [],
    recent_conversation: (input.recent ?? []).slice(-8),
  }).slice(0, 20000);

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
- "Add a note to Weiner Mazzei that Jenni prefers email follow-up."
- "Set my next follow-up with Lutz for Tuesday..."
- "Remember my next action for Parra Klein is..."
- "Change this account to priority 5."
- "Update the address for this office to..."
Discussion, brainstorming, route questions, or statements such as "I might follow up" are NOT write permission.

Allowed actions:
1. log_touch — log a non-PHI relationship interaction for one exact current HPO account.
2. set_followup — set a next relationship action for one exact current HPO account.
3. create_account — create a new HPO account only when Adam explicitly tells Emery to add/create that office as an HPO account. Require an account name and a physical street address so the account can be plotted on the HPO map.
4. update_account — change only the explicitly requested non-PHI account fields on one exact current HPO account.
5. none — no write.

PRIVACY BOUNDARY:
Never put patient names, DOBs, diagnoses, claims/case numbers, treatment details, medical records, or other PHI into HPO account intelligence. If Adam's request contains patient-identifying material, do not write it; ask him to restate only the relationship-level/non-PHI part.

TARGETING:
- target_account_id must be an exact id from CURRENT HPO RECORDS.
- If SELECTED ACCOUNT ID is present and Adam says "this account", "this office", or otherwise clearly refers to the open account, use that exact selected id.
- Never invent an account id or silently pick between genuinely ambiguous accounts.
- Respect ownership/exclusion tags. Do not create Adam follow-ups for accounts tagged exclude_from_adam_route unless Adam explicitly says he is acting on that account despite the ownership context.
- If account identity is ambiguous, ask one concise clarification question.
- If a follow-up has a relative date, resolve it from CURRENT LOCAL TIME in the supplied timezone.
- If no exact due time was provided, due_at may be null rather than inventing a clock time.

For log_touch, summary must contain only the relationship-level facts Adam actually supplied. next_action may be captured if he supplied one.
If Adam explicitly says add/save/log a note, use log_touch with interaction_type="note". A pure note is relationship intelligence, not proof that a visit occurred.
For set_followup, next_action is required.
For create_account, target_account_id must be null. Extract account_name, account_type, specialty, city, address, and priority only from Adam's request or recent conversation. If account_name or address is missing, set needs_clarification=true and ask only for the missing information.
For update_account, populate ONLY fields Adam explicitly asked to change in updates. Every unrequested update field must be null. Never infer or "clean up" additional fields. Allowed update fields are name, account_type, specialty, territory, city, address, priority, relationship_stage, relationship_health, opportunity, blockers, and notes.
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
              action: { type: "string", enum: ["none", "log_touch", "set_followup", "create_account", "update_account"] },
              needs_clarification: { type: "boolean" },
              clarification_question: { type: ["string", "null"] },
              target_account_id: { type: ["string", "null"] },
              interaction_type: { type: "string" },
              summary: { type: "string" },
              outcome: { type: "string" },
              relationship_signal: { type: "string" },
              next_action: { type: "string" },
              due_at: { type: ["string", "null"] },
              account_name: { type: "string" },
              account_type: { type: "string" },
              specialty: { type: "string" },
              city: { type: "string" },
              address: { type: "string" },
              priority: { type: ["integer", "null"], minimum: 1, maximum: 5 },
              updates: {
                type: "object",
                additionalProperties: false,
                properties: {
                  name: { type: ["string", "null"] },
                  account_type: { type: ["string", "null"] },
                  specialty: { type: ["string", "null"] },
                  territory: { type: ["string", "null"] },
                  city: { type: ["string", "null"] },
                  address: { type: ["string", "null"] },
                  priority: { type: ["integer", "null"], minimum: 1, maximum: 5 },
                  relationship_stage: { type: ["string", "null"] },
                  relationship_health: { type: ["string", "null"] },
                  opportunity: { type: ["string", "null"] },
                  blockers: { type: ["string", "null"] },
                  notes: { type: ["string", "null"] }
                },
                required: ["name","account_type","specialty","territory","city","address","priority","relationship_stage","relationship_health","opportunity","blockers","notes"]
              },
              contains_phi: { type: "boolean" },
            },
            required: ["recognized","action","needs_clarification","clarification_question","target_account_id","interaction_type","summary","outcome","relationship_signal","next_action","due_at","account_name","account_type","specialty","city","address","priority","updates","contains_phi"],
          },
        },
      },
    }),
  });

  if (!resp.ok) throw new Error(`HPO action model failed: ${resp.status}`);
  const raw = responseText(await resp.json());
  const parsed = JSON.parse(raw || "{}");
  const action = ["log_touch", "set_followup", "create_account", "update_account"].includes(parsed.action) ? parsed.action : "none";

  if (!parsed.recognized || action === "none") {
    return { recognized: false, performed: false, needsClarification: false, question: null, action: "none", accountId: null, accountName: null, recordId: null, nextAction: null, dueAt: null };
  }

  const execution = await beginExecution({
    db,
    userId,
    domain: "hpo",
    action,
    sourceMessageId: input.sourceMessageId ?? null,
    idempotencyKey: input.sourceMessageId
      ? `message:${input.sourceMessageId}:hpo:${action}`
      : null,
    targetType: "hpo_account",
    targetId:
      typeof parsed.target_account_id === "string"
        ? parsed.target_account_id
        : action === "update_account"
          ? input.selectedAccountId ?? null
          : null,
    requestPayload: {
      message,
      action,
      targetAccountId: parsed.target_account_id ?? null,
      nextAction: parsed.next_action ?? null,
      dueAt: parsed.due_at ?? null,
      accountName: parsed.account_name ?? null,
      address: parsed.address ?? null,
      selectedAccountId: input.selectedAccountId ?? null,
      updates: parsed.updates ?? null,
    },
  });

  if (
    execution.reused &&
    (execution.status === "completed" ||
      execution.status === "needs_clarification" ||
      execution.status === "failed") &&
    execution.resultPayload["hpoResult"]
  ) {
    return execution.resultPayload["hpoResult"] as HpoActionResult;
  }

  if (parsed.contains_phi) {
    const result: HpoActionResult = {
      recognized: true, performed: false, needsClarification: true,
      question: "I can log the relationship update, but leave out patient-identifying or medical details. What non-PHI account update should I save?",
      action, accountId: null, accountName: null, recordId: null, nextAction: null, dueAt: null,
    };
    await clarifyExecution({
      db,
      userId,
      runId: execution.id,
      question: result.question ?? "What non-PHI account update should I save?",
      resultPayload: { hpoResult: result as unknown as Record<string, unknown> },
    });
    return result;
  }

  if (parsed.needs_clarification) {
    const result: HpoActionResult = {
      recognized: true, performed: false, needsClarification: true,
      question: String(parsed.clarification_question || "Which HPO account do you mean?"),
      action, accountId: parsed.target_account_id ?? null, accountName: null, recordId: null,
      nextAction: parsed.next_action || null, dueAt: isoOrNull(parsed.due_at),
    };
    await clarifyExecution({
      db,
      userId,
      runId: execution.id,
      question: result.question ?? "Which HPO account do you mean?",
      resultPayload: { hpoResult: result as unknown as Record<string, unknown> },
    });
    return result;
  }

  if (action === "create_account") {
    const accountName = String(parsed.account_name ?? "").trim();
    const address = String(parsed.address ?? "").trim();
    if (!accountName || !address) {
      const question = !accountName
        ? "What account name should I use?"
        : "What is the office street address so I can add it and plot it on the HPO map?";
      const result: HpoActionResult = {
        recognized: true,
        performed: false,
        needsClarification: true,
        question,
        action,
        accountId: null,
        accountName: accountName || null,
        recordId: null,
        nextAction: null,
        dueAt: null,
      };
      await clarifyExecution({
        db,
        userId,
        runId: execution.id,
        question,
        resultPayload: { hpoResult: result as unknown as Record<string, unknown> },
      });
      return result;
    }

    const existing = accountRows.find(
      (row: any) => String(row.name ?? "").trim().toLowerCase() === accountName.toLowerCase(),
    );
    if (existing) {
      const result: HpoActionResult = {
        recognized: true,
        performed: false,
        needsClarification: false,
        question: null,
        action,
        accountId: existing.id,
        accountName: existing.name,
        recordId: existing.id,
        nextAction: null,
        dueAt: null,
      };
      await completeExecution({
        db,
        userId,
        runId: execution.id,
        resultPayload: { hpoResult: result as unknown as Record<string, unknown> },
        targetType: "hpo_account",
        targetId: existing.id,
      });
      return result;
    }

    const city = String(parsed.city ?? "").trim() || null;
    const point = await geocodeHpoOfficeAddress(address, city).catch(() => null);
    const inserted = await db
      .from("hpo_accounts")
      .insert({
        user_id: userId,
        name: accountName,
        account_type: String(parsed.account_type ?? "").trim() || null,
        specialty: String(parsed.specialty ?? "").trim() || null,
        city,
        address,
        latitude: point?.lat ?? null,
        longitude: point?.lon ?? null,
        geocoded_at: new Date().toISOString(),
        priority:
          Number.isFinite(Number(parsed.priority))
            ? Math.max(1, Math.min(5, Math.round(Number(parsed.priority))))
            : 3,
        relationship_stage: "active",
        source_origin: "emery_voice_account_create",
        metadata: {
          source_message_id: input.sourceMessageId ?? null,
          map_ready: Boolean(point),
        },
      })
      .select("id,name,latitude,longitude")
      .single();
    if (inserted.error || !inserted.data) {
      await failExecution({
        db,
        userId,
        runId: execution.id,
        errorCode: "hpo_account_create_failed",
        errorMessage: String(inserted.error?.message ?? inserted.error ?? "Account creation failed"),
        retryable: true,
      });
      throw inserted.error ?? new Error("HPO account creation failed");
    }

    const result: HpoActionResult = {
      recognized: true,
      performed: true,
      needsClarification: false,
      question: null,
      action,
      accountId: inserted.data.id,
      accountName: inserted.data.name,
      recordId: inserted.data.id,
      nextAction: null,
      dueAt: null,
    };
    await completeExecution({
      db,
      userId,
      runId: execution.id,
      resultPayload: { hpoResult: result as unknown as Record<string, unknown> },
      targetType: "hpo_account",
      targetId: inserted.data.id,
    });
    return result;
  }

  const targetId =
    typeof parsed.target_account_id === "string" && parsed.target_account_id
      ? parsed.target_account_id
      : action === "update_account"
        ? input.selectedAccountId ?? ""
        : "";
  const target = accountRows.find((a: any) => a.id === targetId);
  if (!target) {
    const result: HpoActionResult = {
      recognized: true, performed: false, needsClarification: true,
      question: "Which HPO account should I apply that to?",
      action, accountId: null, accountName: null, recordId: null, nextAction: parsed.next_action || null, dueAt: isoOrNull(parsed.due_at),
    };
    await clarifyExecution({ db, userId, runId: execution.id, question: result.question ?? "Which HPO account?", resultPayload: { hpoResult: result as unknown as Record<string, unknown> } });
    return result;
  }

  if (Array.isArray(target.tags) && target.tags.includes("exclude_from_adam_route") && !/\b(despite|even though|bilal|ownership|i am handling|i'm handling)\b/i.test(message)) {
    const result: HpoActionResult = {
      recognized: true, performed: false, needsClarification: true,
      question: `${target.name} is marked as owned by someone else. Do you want me to update that account anyway?`,
      action, accountId: target.id, accountName: target.name, recordId: null, nextAction: parsed.next_action || null, dueAt: isoOrNull(parsed.due_at),
    };
    await clarifyExecution({ db, userId, runId: execution.id, question: result.question ?? "Update this account anyway?", resultPayload: { hpoResult: result as unknown as Record<string, unknown> } });
    return result;
  }

  const dueAt = isoOrNull(parsed.due_at);

  if (action === "update_account") {
    const rawUpdates =
      parsed.updates && typeof parsed.updates === "object" && !Array.isArray(parsed.updates)
        ? parsed.updates
        : {};
    const updatePayload: Record<string, unknown> = {};
    const changedFields: string[] = [];

    const setString = (
      sourceKey: string,
      targetKey: string,
      maxLength: number,
      options?: { allowEmpty?: boolean },
    ) => {
      const rawValue = rawUpdates[sourceKey];
      if (rawValue === null || rawValue === undefined) return;
      const value = String(rawValue).trim().slice(0, maxLength);
      if (!value && !options?.allowEmpty) return;
      updatePayload[targetKey] = value || null;
      changedFields.push(sourceKey);
    };

    setString("name", "name", 180);
    setString("account_type", "account_type", 100, { allowEmpty: true });
    setString("specialty", "specialty", 100, { allowEmpty: true });
    setString("territory", "territory", 100, { allowEmpty: true });
    setString("city", "city", 100, { allowEmpty: true });
    setString("address", "address", 300, { allowEmpty: true });
    setString("relationship_stage", "relationship_stage", 80);
    setString("relationship_health", "relationship_health", 100, { allowEmpty: true });
    setString("opportunity", "opportunity", 1000, { allowEmpty: true });
    setString("blockers", "blockers", 1000, { allowEmpty: true });
    setString("notes", "notes", 4000, { allowEmpty: true });

    if (rawUpdates.priority !== null && rawUpdates.priority !== undefined) {
      const priority = Math.round(Number(rawUpdates.priority));
      if (Number.isFinite(priority) && priority >= 1 && priority <= 5) {
        updatePayload["priority"] = priority;
        changedFields.push("priority");
      }
    }

    if (!changedFields.length) {
      const result: HpoActionResult = {
        recognized: true,
        performed: false,
        needsClarification: true,
        question: `What should I change on ${target.name}?`,
        action,
        accountId: target.id,
        accountName: target.name,
        recordId: null,
        nextAction: null,
        dueAt: null,
      };
      await clarifyExecution({
        db,
        userId,
        runId: execution.id,
        question: result.question ?? "What should I change?",
        resultPayload: { hpoResult: result as unknown as Record<string, unknown> },
      });
      return result;
    }

    if (changedFields.includes("address") || changedFields.includes("city")) {
      const addressWasExplicit = Object.prototype.hasOwnProperty.call(updatePayload, "address");
      const cityWasExplicit = Object.prototype.hasOwnProperty.call(updatePayload, "city");
      const nextAddress = addressWasExplicit
        ? String(updatePayload["address"] ?? "").trim()
        : String(target.address ?? "").trim();
      const nextCity = cityWasExplicit
        ? String(updatePayload["city"] ?? "").trim()
        : String(target.city ?? "").trim();

      if (!nextAddress) {
        updatePayload["latitude"] = null;
        updatePayload["longitude"] = null;
        updatePayload["geocoded_at"] = null;
      } else {
        const point = await geocodeHpoOfficeAddress(nextAddress, nextCity || null).catch(() => null);
        updatePayload["latitude"] = point?.lat ?? null;
        updatePayload["longitude"] = point?.lon ?? null;
        updatePayload["geocoded_at"] = point ? new Date().toISOString() : null;
      }
    }

    updatePayload["updated_at"] = new Date().toISOString();

    const updated = await db
      .from("hpo_accounts")
      .update(updatePayload)
      .eq("user_id", userId)
      .eq("id", target.id)
      .select("id,name,priority,account_type,specialty,territory,city,address,relationship_stage,relationship_health,opportunity,blockers,notes")
      .single();

    if (updated.error || !updated.data) {
      await failExecution({
        db,
        userId,
        runId: execution.id,
        errorCode: "hpo_account_update_failed",
        errorMessage: String(updated.error?.message ?? updated.error ?? "Account update failed"),
        retryable: true,
      });
      throw updated.error ?? new Error("HPO account update failed");
    }

    const hpoResult: HpoActionResult = {
      recognized: true,
      performed: true,
      needsClarification: false,
      question: null,
      action,
      accountId: target.id,
      accountName: updated.data.name ?? target.name,
      recordId: target.id,
      nextAction: null,
      dueAt: null,
      changedFields,
    };
    await completeExecution({
      db,
      userId,
      runId: execution.id,
      resultPayload: { hpoResult: hpoResult as unknown as Record<string, unknown> },
      targetType: "hpo_account",
      targetId: target.id,
    });
    return hpoResult;
  }

  if (action === "log_touch") {
    const summary = String(parsed.summary ?? "").trim();
    if (!summary) throw new Error("HPO interaction summary missing");
    const interactionType = String(parsed.interaction_type || "visit").trim().toLowerCase();

    if (interactionType === "note") {
      const { data: row, error: noteError } = await db
        .from("hpo_interactions")
        .insert({
          user_id: userId,
          account_id: target.id,
          interaction_type: "note",
          occurred_at: new Date().toISOString(),
          summary,
          source_type: "emery",
          metadata: {
            non_phi: true,
            note_only: true,
            source_message_id: input.sourceMessageId ?? null,
          },
        })
        .select("id")
        .single();
      if (noteError) {
        await failExecution({
          db,
          userId,
          runId: execution.id,
          errorCode: "hpo_note_write_failed",
          errorMessage: String(noteError.message ?? noteError),
          retryable: true,
        });
        throw noteError;
      }
      const previousAccountNotes = String(target.notes ?? "").trim();
      const combinedAccountNotes = previousAccountNotes
        ? `${previousAccountNotes}\n\n${summary}`
        : summary;
      const { error: accountError } = await db
        .from("hpo_accounts")
        .update({
          notes: combinedAccountNotes,
          updated_at: new Date().toISOString(),
        })
        .eq("user_id", userId)
        .eq("id", target.id);
      if (accountError) throw accountError;

      const hpoResult: HpoActionResult = {
        recognized: true,
        performed: true,
        needsClarification: false,
        question: null,
        action,
        accountId: target.id,
        accountName: target.name,
        recordId: row?.id ?? null,
        nextAction: null,
        dueAt: null,
      };
      await completeExecution({
        db,
        userId,
        runId: execution.id,
        resultPayload: { hpoResult: hpoResult as unknown as Record<string, unknown> },
        targetType: "hpo_interaction",
        targetId: hpoResult.recordId,
      });
      return hpoResult;
    }

    const result = await db.rpc("emery_hpo_log_touch", {
      p_user_id: userId,
      p_account_id: target.id,
      p_interaction_type: interactionType || "visit",
      p_summary: summary,
      p_outcome: String(parsed.outcome || "").trim() || null,
      p_relationship_signal: String(parsed.relationship_signal || "").trim() || null,
      p_next_action: String(parsed.next_action || "").trim() || null,
      p_next_action_due_at: dueAt,
      p_source: "emery",
    });
    if (result.error) {
      await failExecution({ db, userId, runId: execution.id, errorCode: "hpo_write_failed", errorMessage: String(result.error.message ?? result.error), retryable: true });
      throw result.error;
    }
    const row = Array.isArray(result.data) ? result.data[0] : result.data;
    const hpoResult: HpoActionResult = {
      recognized: true, performed: true, needsClarification: false, question: null, action,
      accountId: target.id, accountName: target.name, recordId: row?.id ?? null,
      nextAction: row?.next_action ?? null, dueAt: row?.next_action_due_at ?? dueAt,
    };
    await completeExecution({ db, userId, runId: execution.id, resultPayload: { hpoResult: hpoResult as unknown as Record<string, unknown> }, targetType: "hpo_interaction", targetId: hpoResult.recordId });
    return hpoResult;
  }

  const nextAction = String(parsed.next_action ?? "").trim();
  if (!nextAction) {
    const result: HpoActionResult = {
      recognized: true, performed: false, needsClarification: true,
      question: `What should the next action be for ${target.name}?`,
      action, accountId: target.id, accountName: target.name, recordId: null, nextAction: null, dueAt,
    };
    await clarifyExecution({ db, userId, runId: execution.id, question: result.question ?? "What should the next action be?", resultPayload: { hpoResult: result as unknown as Record<string, unknown> } });
    return result;
  }
  const result = await db.rpc("emery_hpo_set_followup", {
    p_user_id: userId,
    p_account_id: target.id,
    p_next_action: nextAction,
    p_due_at: dueAt,
    p_source: "emery",
  });
  if (result.error) {
    await failExecution({ db, userId, runId: execution.id, errorCode: "hpo_write_failed", errorMessage: String(result.error.message ?? result.error), retryable: true });
    throw result.error;
  }
  const row = Array.isArray(result.data) ? result.data[0] : result.data;
  const hpoResult: HpoActionResult = {
    recognized: true, performed: true, needsClarification: false, question: null, action,
    accountId: target.id, accountName: target.name, recordId: row?.id ?? target.id,
    nextAction: row?.next_action ?? nextAction, dueAt: row?.next_action_due_at ?? dueAt,
  };
  await completeExecution({ db, userId, runId: execution.id, resultPayload: { hpoResult: hpoResult as unknown as Record<string, unknown> }, targetType: "hpo_account", targetId: target.id });
  return hpoResult;
}
