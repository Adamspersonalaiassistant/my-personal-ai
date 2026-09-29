import { createServerFn } from "@tanstack/react-start";
/* eslint-disable @typescript-eslint/no-explicit-any -- HPO CRM rows are intentionally read from the live Supabase schema. */
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { geocodeHpoOfficeAddress } from "@/lib/hpo-geocode";
import { appendHpoWriteAudit, sanitizeHpoMetadata } from "@/lib/hpo-prospect-write.core";

type Db = any;

const optionalText = (max: number) => z.string().trim().max(max).optional().nullable();
const evidenceSource = z.object({
  url: z.string().trim().url().max(1000),
  type: z.enum([
    "official_website",
    "independent_business",
    "bar_directory",
    "medical_directory",
    "government",
    "manual_review",
    "conversation_history",
    "field_note",
    "other",
  ]),
  title: z.string().trim().max(240).optional(),
  observedAt: z.string().datetime().optional(),
});
const evidence = z.array(evidenceSource).min(1).max(12);

const accountFactsInput = z.object({
  accountId: z.string().uuid(),
  expectedUpdatedAt: z.string().datetime().optional().nullable(),
  reason: z.string().trim().min(1).max(1000),
  verifiedAt: z.string().datetime(),
  sources: evidence,
  name: z.string().trim().min(1).max(220).optional(),
  accountType: optionalText(120),
  specialty: optionalText(160),
  territory: optionalText(120),
  city: optionalText(120),
  address: z.string().trim().min(5).max(400).optional(),
  notes: optionalText(8000),
  opportunity: optionalText(4000),
  blockers: optionalText(4000),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

const relationshipInput = z.object({
  accountId: z.string().uuid(),
  expectedUpdatedAt: z.string().datetime().optional().nullable(),
  reason: z.string().trim().min(1).max(1000),
  relationshipStage: z.string().trim().min(1).max(80).optional(),
  relationshipHealth: optionalText(80),
  priority: z.number().int().min(1).max(5).optional(),
  nextAction: optionalText(1000),
  nextActionDueAt: z.string().datetime().optional().nullable(),
  nextInteractionAt: z.string().datetime().optional().nullable(),
  addTags: z.array(z.string().trim().min(1).max(80)).max(20).default([]),
  removeTags: z.array(z.string().trim().min(1).max(80)).max(20).default([]),
});

const contactInput = z.object({
  accountId: z.string().uuid(),
  contactId: z.string().uuid().optional().nullable(),
  expectedUpdatedAt: z.string().datetime().optional().nullable(),
  reason: z.string().trim().min(1).max(1000),
  name: z.string().trim().min(1).max(220),
  roleTitle: optionalText(160),
  phone: optionalText(60),
  email: z.string().trim().email().max(320).optional().nullable(),
  preferredContactMethod: optionalText(80),
  relationshipNotes: optionalText(4000),
  sourceRef: optionalText(500),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

const historicalInteractionInput = z.object({
  accountId: z.string().uuid(),
  contactId: z.string().uuid().optional().nullable(),
  interactionType: z.string().trim().min(1).max(80),
  occurredAt: z.string().datetime(),
  summary: z.string().trim().min(1).max(8000),
  outcome: optionalText(2000),
  relationshipSignal: optionalText(1000),
  nextAction: optionalText(1000),
  nextActionDueAt: z.string().datetime().optional().nullable(),
  sourceRef: z.string().trim().min(1).max(500),
  sourceType: z.enum(["conversation_history", "field_note", "spreadsheet", "manual_review"]),
  containsPhi: z.literal(false),
  reason: z.string().trim().min(1).max(1000),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function stale(expected: string | null | undefined, actual: string | null | undefined) {
  return Boolean(expected && actual && expected !== actual);
}

function normalizedContact(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

async function ownedAccount(db: Db, userId: string, accountId: string) {
  const { data, error } = await db
    .from("hpo_accounts")
    .select("*")
    .eq("id", accountId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Account not found in the authenticated HPO workspace.");
  return data;
}

function sourcePayload(sources: z.infer<typeof evidence>) {
  return sources.map((source) => ({
    url: source.url,
    type: source.type,
    title: source.title ?? null,
    observed_at: source.observedAt ?? new Date().toISOString(),
  }));
}

export const updateVerifiedHpoAccountFacts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: z.input<typeof accountFactsInput>) => accountFactsInput.parse(input))
  .handler(async ({ context, data }) => {
    const db = context.supabase as Db;
    const current = await ownedAccount(db, context.userId, data.accountId);
    if (stale(data.expectedUpdatedAt, current.updated_at)) {
      return { status: "conflict_review" as const, requiresReview: true, current };
    }

    const changes: Record<string, unknown> = {};
    const fieldMap: Record<string, string> = {
      name: "name",
      accountType: "account_type",
      specialty: "specialty",
      territory: "territory",
      city: "city",
      address: "address",
      notes: "notes",
      opportunity: "opportunity",
      blockers: "blockers",
    };
    for (const [inputKey, column] of Object.entries(fieldMap)) {
      if (!(inputKey in data)) continue;
      const proposed = (data as Record<string, unknown>)[inputKey] ?? null;
      if (current[column] !== proposed) changes[column] = proposed;
    }

    if (changes["address"] !== undefined) {
      const point = await geocodeHpoOfficeAddress(
        String(changes["address"]),
        String(changes["city"] ?? current.city ?? ""),
      ).catch(() => null);
      if (!point) {
        return {
          status: "verification_incomplete" as const,
          requiresReview: true,
          reason: "The changed physical address could not be geocoded, so the current account pin was preserved.",
          current,
        };
      }
      changes["latitude"] = point.lat;
      changes["longitude"] = point.lon;
      changes["geocoded_at"] = new Date().toISOString();
    }

    const now = new Date().toISOString();
    const currentMeta = asObject(current.metadata);
    const history = Array.isArray(currentMeta["research_provenance"])
      ? currentMeta["research_provenance"]
      : [];
    changes["metadata"] = appendHpoWriteAudit(
      {
        ...currentMeta,
        ...sanitizeHpoMetadata(data.metadata),
        research_provenance: [...history, ...sourcePayload(data.sources)].slice(-40),
        last_verified_at: data.verifiedAt,
      },
      { action: "update_verified_account_facts", at: now, reason: data.reason },
    );
    changes["updated_at"] = now;

    const result = await db
      .from("hpo_accounts")
      .update(changes)
      .eq("id", current.id)
      .eq("user_id", context.userId)
      .select("*")
      .single();
    if (result.error) throw result.error;
    return { status: "updated" as const, requiresReview: false, account: result.data };
  });

export const correctHpoAccountRelationship = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: z.input<typeof relationshipInput>) => relationshipInput.parse(input))
  .handler(async ({ context, data }) => {
    const db = context.supabase as Db;
    const current = await ownedAccount(db, context.userId, data.accountId);
    if (stale(data.expectedUpdatedAt, current.updated_at)) {
      return { status: "conflict_review" as const, requiresReview: true, current };
    }
    const existingTags = new Set<string>(Array.isArray(current.tags) ? current.tags : []);
    for (const tag of data.removeTags) existingTags.delete(tag);
    for (const tag of data.addTags) existingTags.add(tag);

    const patch: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
      tags: [...existingTags],
      metadata: appendHpoWriteAudit(asObject(current.metadata), {
        action: "correct_relationship_state",
        at: new Date().toISOString(),
        reason: data.reason,
      }),
    };
    if (data.relationshipStage !== undefined) patch["relationship_stage"] = data.relationshipStage;
    if (data.relationshipHealth !== undefined) patch["relationship_health"] = data.relationshipHealth;
    if (data.priority !== undefined) patch["priority"] = data.priority;
    if (data.nextAction !== undefined) patch["next_action"] = data.nextAction;
    if (data.nextActionDueAt !== undefined) patch["next_action_due_at"] = data.nextActionDueAt;
    if (data.nextInteractionAt !== undefined) patch["next_interaction_at"] = data.nextInteractionAt;

    const result = await db
      .from("hpo_accounts")
      .update(patch)
      .eq("id", current.id)
      .eq("user_id", context.userId)
      .select("*")
      .single();
    if (result.error) throw result.error;
    return { status: "updated" as const, requiresReview: false, account: result.data };
  });

export const upsertVerifiedHpoContact = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: z.input<typeof contactInput>) => contactInput.parse(input))
  .handler(async ({ context, data }) => {
    const db = context.supabase as Db;
    await ownedAccount(db, context.userId, data.accountId);
    let current: any = null;
    if (data.contactId) {
      const lookup = await db
        .from("hpo_contacts")
        .select("*")
        .eq("id", data.contactId)
        .eq("account_id", data.accountId)
        .eq("user_id", context.userId)
        .maybeSingle();
      if (lookup.error) throw lookup.error;
      if (!lookup.data) throw new Error("Contact not found on this authenticated HPO account.");
      current = lookup.data;
      if (stale(data.expectedUpdatedAt, current.updated_at)) {
        return { status: "conflict_review" as const, requiresReview: true, current };
      }
    } else {
      const matches = await db
        .from("hpo_contacts")
        .select("*")
        .eq("account_id", data.accountId)
        .eq("user_id", context.userId);
      if (matches.error) throw matches.error;
      const normalized = normalizedContact(data.name);
      const sameName = (matches.data ?? []).filter(
        (row: any) => normalizedContact(String(row.name ?? "")) === normalized,
      );
      if (sameName.length > 1) {
        return { status: "conflict_review" as const, requiresReview: true, matches: sameName };
      }
      current = sameName[0] ?? null;
    }

    const now = new Date().toISOString();
    const metadata = appendHpoWriteAudit(
      { ...asObject(current?.metadata), ...sanitizeHpoMetadata(data.metadata) },
      { action: current ? "update_verified_contact" : "create_verified_contact", at: now, reason: data.reason },
    );
    const payload = {
      name: data.name,
      role_title: data.roleTitle ?? null,
      phone: data.phone ?? null,
      email: data.email ?? null,
      preferred_contact_method: data.preferredContactMethod ?? null,
      relationship_notes: data.relationshipNotes ?? null,
      source_origin: "verified_research",
      source_ref: data.sourceRef ?? current?.source_ref ?? null,
      metadata,
      updated_at: now,
    };

    if (current) {
      const result = await db
        .from("hpo_contacts")
        .update(payload)
        .eq("id", current.id)
        .eq("account_id", data.accountId)
        .eq("user_id", context.userId)
        .select("*")
        .single();
      if (result.error) throw result.error;
      return { status: "updated" as const, requiresReview: false, contact: result.data };
    }

    const result = await db
      .from("hpo_contacts")
      .insert({
        user_id: context.userId,
        account_id: data.accountId,
        ...payload,
      })
      .select("*")
      .single();
    if (result.error) throw result.error;
    return { status: "created" as const, requiresReview: false, contact: result.data };
  });

export const importVerifiedHpoInteractionHistory = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: z.input<typeof historicalInteractionInput>) =>
    historicalInteractionInput.parse(input),
  )
  .handler(async ({ context, data }) => {
    const db = context.supabase as Db;
    const account = await ownedAccount(db, context.userId, data.accountId);
    if (data.contactId) {
      const contact = await db
        .from("hpo_contacts")
        .select("id")
        .eq("id", data.contactId)
        .eq("account_id", data.accountId)
        .eq("user_id", context.userId)
        .maybeSingle();
      if (contact.error) throw contact.error;
      if (!contact.data) throw new Error("Interaction contact is not owned by this account.");
    }

    const existing = await db
      .from("hpo_interactions")
      .select("*")
      .eq("user_id", context.userId)
      .eq("account_id", data.accountId)
      .eq("source_ref", data.sourceRef)
      .maybeSingle();
    if (existing.error) throw existing.error;
    if (existing.data) {
      return { status: "already_imported" as const, requiresReview: false, interaction: existing.data };
    }

    const now = new Date().toISOString();
    const result = await db
      .from("hpo_interactions")
      .insert({
        user_id: context.userId,
        account_id: data.accountId,
        contact_id: data.contactId ?? null,
        interaction_type: data.interactionType,
        occurred_at: data.occurredAt,
        summary: data.summary,
        outcome: data.outcome ?? null,
        relationship_signal: data.relationshipSignal ?? null,
        next_action: data.nextAction ?? null,
        next_action_due_at: data.nextActionDueAt ?? null,
        source_type: data.sourceType,
        source_ref: data.sourceRef,
        metadata: appendHpoWriteAudit(sanitizeHpoMetadata(data.metadata), {
          action: "import_verified_interaction_history",
          at: now,
          reason: data.reason,
          non_phi_confirmed: true,
        }),
      })
      .select("*")
      .single();
    if (result.error) throw result.error;

    const occurred = Date.parse(data.occurredAt);
    const existingTouch = Date.parse(account.last_touch_at ?? "");
    if (Number.isFinite(occurred) && (!Number.isFinite(existingTouch) || occurred > existingTouch)) {
      const patch: Record<string, unknown> = {
        last_touch_at: data.occurredAt,
        updated_at: now,
      };
      if (data.nextAction) patch["next_action"] = data.nextAction;
      if (data.nextActionDueAt) patch["next_action_due_at"] = data.nextActionDueAt;
      const update = await db
        .from("hpo_accounts")
        .update(patch)
        .eq("id", data.accountId)
        .eq("user_id", context.userId);
      if (update.error) throw update.error;
    }

    return { status: "imported" as const, requiresReview: false, interaction: result.data };
  });
