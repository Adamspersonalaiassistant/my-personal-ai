import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * An explicit human recap, not an AI assumption. Planner notes remain distinct
 * from completed visits until Adam chooses the correct activity classification.
 */
const activityInput = z.object({
  activityType: z.enum(["office_visit", "lunch", "dinner", "event"]),
  accountId: z.string().uuid().nullable().optional(),
  meetingId: z.string().uuid().nullable().optional(),
  noteInteractionId: z.string().uuid().nullable().optional(),
  title: z.string().trim().min(1).max(250),
  summary: z.string().trim().min(3).max(6000),
  outcome: z.string().trim().max(1500).optional(),
  nextAction: z.string().trim().max(500).optional(),
}).refine((value) => Boolean(value.meetingId) !== Boolean(value.noteInteractionId), {
  message: "Choose one calendar activity or planner note to log.",
});

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : {};

export const saveHpoActivityLog = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((value: z.input<typeof activityInput>) => activityInput.parse(value))
  .handler(async ({ context, data }) => {
    const db = context.supabase;
    const userId = context.userId;
    // No patient information belongs in the field relationship CRM.
    if (/\b(?:patient\s+(?:dob|date of birth|diagnosis|claim number)|medical record number|ssn)\b/i.test(data.summary))
      throw new Error("Remove patient-identifying details before saving an HPO activity.");

    let accountId = data.accountId ?? null;
    let meeting: any = null;
    let note: any = null;
    if (data.meetingId) {
      const found = await db.from("meetings")
        .select("id,title,meeting_at,metadata")
        .eq("id", data.meetingId).eq("user_id", userId).maybeSingle();
      if (found.error) throw found.error;
      if (!found.data) throw new Error("Calendar event not found.");
      meeting = found.data;
      const meta = record(meeting.metadata);
      accountId ||= typeof meta.hpo_account_id === "string" ? meta.hpo_account_id
        : typeof meta.account_id === "string" ? meta.account_id : null;
      const existing = await db.from("hpo_interactions").select("id")
        .eq("user_id", userId).eq("meeting_id", meeting.id).limit(1);
      if (existing.error) throw existing.error;
      if (existing.data?.length) return { ok: true, alreadyLogged: true, interactionId: existing.data[0].id };
    } else if (data.noteInteractionId) {
      const found = await db.from("hpo_interactions")
        .select("id,account_id,source_type,interaction_type,activity_type,occurred_at,metadata")
        .eq("id", data.noteInteractionId).eq("user_id", userId).maybeSingle();
      if (found.error) throw found.error;
      if (!found.data || found.data.source_type !== "route" || found.data.interaction_type !== "note")
        throw new Error("Planner field note was not found or has already been classified.");
      if (!record(found.data.metadata).field_note)
        throw new Error("Only saved Planner field notes can be classified here.");
      if (found.data.activity_type)
        return { ok: true, alreadyLogged: true, interactionId: found.data.id };
      note = found.data;
      if (accountId && accountId !== note.account_id)
        throw new Error("A Planner note must stay attached to its original account.");
      accountId = note.account_id;
    }
    let account: any = null;
    if (accountId) {
      const found = await db.from("hpo_accounts")
        .select("id,last_touch_at")
        .eq("id", accountId).eq("user_id", userId).maybeSingle();
      if (found.error) throw found.error;
      if (!found.data) throw new Error("HPO account not found.");
      account = found.data;
    }
    // An Office Visit must have an account so that the visit is not lost.
    if (data.activityType === "office_visit" && !accountId)
      throw new Error("Select the office for this visit.");

    const timestamp = note?.occurred_at ?? meeting?.meeting_at ?? new Date().toISOString();
    const values = {
      account_id: accountId,
      interaction_type: data.activityType === "office_visit" ? "visit" : data.activityType,
      activity_type: data.activityType,
      activity_title: data.title,
      occurred_at: timestamp,
      summary: data.summary,
      outcome: data.outcome || null,
      next_action: data.nextAction || null,
    };
    let interactionId: string;
    if (note) {
      const updated = await db.from("hpo_interactions")
        .update({ ...values, metadata: { ...record(note.metadata), activity_confirmed_by_user: true } })
        .eq("id", note.id).eq("user_id", userId).is("activity_type", null).select("id").single();
      if (updated.error) throw updated.error;
      interactionId = updated.data.id;
    } else {
      const inserted = await db.from("hpo_interactions").insert({
        ...values, user_id: userId, meeting_id: meeting?.id ?? null,
        source_type: "hpo_activity_recap",
        source_ref: `meeting:${meeting.id}`,
        metadata: { non_phi: true, confirmed_by_user: true },
      }).select("id").single();
      if (inserted.error) throw inserted.error;
      interactionId = inserted.data.id;
    }

    if (account) {
      const lastTouch = account.last_touch_at && Date.parse(account.last_touch_at) > Date.parse(timestamp)
        ? account.last_touch_at : timestamp;
      const patch: Record<string, unknown> = {
        last_touch_at: lastTouch, updated_at: new Date().toISOString(),
      };
      if (data.nextAction) patch.next_action = data.nextAction;
      const updated = await db.from("hpo_accounts").update(patch)
        .eq("id", account.id).eq("user_id", userId);
      if (updated.error) throw updated.error;
    }
    if (meeting) {
      const meta = record(meeting.metadata);
      const updated = await db.from("meetings")
        .update({ metadata: {
          ...meta, domain: "hpo", hpo: true,
          hpo_activity_type: data.activityType,
          hpo_account_id: accountId, hpo_recap_required: true,
          hpo_recap_status: "complete", hpo_interaction_id: interactionId,
          hpo_recap_completed_at: new Date().toISOString(),
        } })
        .eq("id", meeting.id).eq("user_id", userId);
      if (updated.error) throw updated.error;
      const dismissed = await db.from("app_notifications")
        .update({ status: "cancelled", updated_at: new Date().toISOString() })
        .eq("user_id", userId).eq("source_type", "hpo_activity_recap")
        .eq("source_ref", meeting.id).eq("status", "pending");
      if (dismissed.error) throw dismissed.error;
    }
    return { ok: true, alreadyLogged: false, interactionId, accountId };
  });
