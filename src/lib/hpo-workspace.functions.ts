import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { deriveHpoAccountIntelligence, latestHpoTimestamp } from "@/lib/hpo-account-intelligence";
import { geocodeHpoOfficeAddress } from "@/lib/hpo-geocode";

const pageInput = z.object({ page: z.number().int().min(0).max(1000).default(0) });
const accountInput = z.object({
  accountId: z.string().uuid(),
  name: z.string().trim().min(1).max(180),
  accountType: z.string().trim().max(100).nullable(),
  specialty: z.string().trim().max(100).nullable(),
  city: z.string().trim().max(100).nullable(),
  territory: z.string().trim().max(100).nullable(),
  address: z.string().trim().max(300).nullable(),
  priority: z.number().int().min(1).max(5),
  relationshipStage: z.string().trim().max(80),
  relationshipHealth: z.string().trim().max(100).nullable(),
  opportunity: z.string().trim().max(1000).nullable(),
  blockers: z.string().trim().max(1000).nullable(),
  notes: z.string().trim().max(4000).nullable(),
});

export const getHpoWorkspace = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { page?: number }) => pageInput.parse(input))
  .handler(async ({ context, data }) => {
    const db = context.supabase;
    const [accounts, interactions, meetings, visitInteractions, routeVisits] = await Promise.all([
      db
        .from("hpo_accounts")
        .select(
          "id,name,account_type,specialty,territory,city,address,priority,owner_name,relationship_stage,relationship_health,status,notes,last_touch_at,next_action,next_action_due_at,opportunity,blockers,updated_at",
        )
        .eq("user_id", context.userId)
        .eq("status", "active")
        .order("name")
        .range(0, 999),
      db
        .from("hpo_interactions")
        .select(
          "id,account_id,contact_id,interaction_type,activity_type,activity_title,meeting_id,occurred_at,summary,outcome,relationship_signal,next_action,next_action_due_at,metadata",
        )
        .eq("user_id", context.userId)
        .order("occurred_at", { ascending: false })
        .range(data.page * 50, data.page * 50 + 49),
      db
        .from("meetings")
        .select("id,title,meeting_at,end_at,participants,metadata")
        .eq("user_id", context.userId)
        .gte("meeting_at", new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString())
        .lte("meeting_at", new Date(Date.now() + 120 * 24 * 60 * 60 * 1000).toISOString())
        .order("meeting_at")
        .limit(300),
      db
        .from("hpo_interactions")
        .select("account_id,occurred_at")
        .eq("user_id", context.userId)
        .eq("interaction_type", "visit")
        .not("account_id", "is", null)
        .order("occurred_at", { ascending: false })
        .range(0, 4999),
      db
        .from("hpo_route_stops")
        .select("account_id,visited_at,updated_at,status")
        .eq("user_id", context.userId)
        .not("account_id", "is", null)
        .in("status", ["completed", "visited", "closed"])
        .order("visited_at", { ascending: false, nullsFirst: false })
        .range(0, 4999),
    ]);
    if (accounts.error) throw accounts.error;
    if (interactions.error) throw interactions.error;
    if (meetings.error) throw meetings.error;
    if (visitInteractions.error) throw visitInteractions.error;
    if (routeVisits.error) throw routeVisits.error;
    const lastVisitByAccount = new Map<string, string>();
    const recordVisit = (accountId: string | null, timestamp: string | null) => {
      if (!accountId || !timestamp) return;
      const latest = latestHpoTimestamp([lastVisitByAccount.get(accountId), timestamp]);
      if (latest) lastVisitByAccount.set(accountId, latest);
    };
    for (const visit of visitInteractions.data ?? [])
      recordVisit(visit.account_id, visit.occurred_at);
    for (const visit of routeVisits.data ?? [])
      recordVisit(visit.account_id, visit.visited_at ?? visit.updated_at);
    const now = Date.now();
    return {
      accounts: (accounts.data ?? []).map((account) => ({
        ...account,
        ...deriveHpoAccountIntelligence(account, lastVisitByAccount.get(account.id) ?? null, now),
      })),
      interactions: interactions.data ?? [],
      hasMore: (interactions.data?.length ?? 0) === 50,
      meetings: (meetings.data ?? []).filter((row) => {
        const meta = row.metadata;
        return (
          meta &&
          typeof meta === "object" &&
          !Array.isArray(meta) &&
          (meta["domain"] === "hpo" ||
            meta["hpo"] === true ||
            typeof meta["hpo_account_id"] === "string" ||
            typeof meta["account_id"] === "string" ||
            typeof meta["hpo_activity_type"] === "string" ||
            ["lunch", "dinner"].includes(String(meta["event_type"] || "").toLowerCase()) ||
            (String(meta["event_type"] || "").toLowerCase() === "event" &&
              /\\b(attorney|law firm|esq\\.?|mri|medical|physician|doctor|clinic|orthop|networking|grand opening|5k|race booth|hudson pro)\\b/i.test(String(row.title || ""))))
        );
      }),
      accountLimitReached: (accounts.data?.length ?? 0) === 1000,
    };
  });

export const updateHpoFieldAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: z.input<typeof accountInput>) => accountInput.parse(input))
  .handler(async ({ context, data }) => {
    const { data: existing, error: existingError } = await context.supabase
      .from("hpo_accounts")
      .select("id,address,city")
      .eq("id", data.accountId)
      .eq("user_id", context.userId)
      .maybeSingle();
    if (existingError) throw existingError;
    if (!existing) throw new Error("Account not found");

    const addressChanged =
      String(existing.address ?? "").trim() !== String(data.address ?? "").trim() ||
      String(existing.city ?? "").trim() !== String(data.city ?? "").trim();
    const point =
      addressChanged && data.address
        ? await geocodeHpoOfficeAddress(data.address, data.city).catch(() => null)
        : null;

    const { data: account, error } = await context.supabase
      .from("hpo_accounts")
      .update({
        name: data.name,
        account_type: data.accountType || null,
        specialty: data.specialty || null,
        city: data.city || null,
        territory: data.territory || null,
        address: data.address || null,
        priority: data.priority,
        relationship_stage: data.relationshipStage,
        relationship_health: data.relationshipHealth || null,
        opportunity: data.opportunity || null,
        blockers: data.blockers || null,
        notes: data.notes || null,
        ...(addressChanged
          ? {
              latitude: point?.lat ?? null,
              longitude: point?.lon ?? null,
              geocoded_at: point ? new Date().toISOString() : null,
            }
          : {}),
        updated_at: new Date().toISOString(),
      })
      .eq("id", data.accountId)
      .eq("user_id", context.userId)
      .select("id")
      .maybeSingle();
    if (error) throw error;
    if (!account) throw new Error("Account not found");
    return account;
  });

export const setHpoFieldAccountFollowup = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { accountId: string; nextAction: string; dueAt?: string | null }) =>
    z
      .object({
        accountId: z.string().uuid(),
        nextAction: z.string().trim().min(1).max(500),
        dueAt: z.string().datetime({ offset: true }).nullable().optional(),
      })
      .parse(input),
  )
  .handler(async ({ context, data }) => {
    const { data: account, error } = await context.supabase
      .from("hpo_accounts")
      .update({ next_action: data.nextAction, next_action_due_at: data.dueAt ?? null })
      .eq("id", data.accountId)
      .eq("user_id", context.userId)
      .select("id")
      .maybeSingle();
    if (error) throw error;
    if (!account) throw new Error("Account not found");
    return account;
  });

export const addHpoFieldContact = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: {
      accountId: string;
      name: string;
      roleTitle?: string;
      phone?: string;
      email?: string;
      relationshipNotes?: string;
    }) =>
      z
        .object({
          accountId: z.string().uuid(),
          name: z.string().trim().min(1).max(150),
          roleTitle: z.string().trim().max(150).optional(),
          phone: z.string().trim().max(50).optional(),
          email: z.union([z.literal(""), z.string().trim().email().max(200)]).optional(),
          relationshipNotes: z.string().trim().max(1500).optional(),
        })
        .parse(input),
  )
  .handler(async ({ context, data }) => {
    const { data: account, error: fetchError } = await context.supabase
      .from("hpo_accounts")
      .select("id")
      .eq("id", data.accountId)
      .eq("user_id", context.userId)
      .maybeSingle();
    if (fetchError) throw fetchError;
    if (!account) throw new Error("Account not found");
    const { data: contact, error } = await context.supabase
      .from("hpo_contacts")
      .insert({
        account_id: account.id,
        user_id: context.userId,
        name: data.name,
        role_title: data.roleTitle || null,
        phone: data.phone || null,
        email: data.email || null,
        relationship_notes: data.relationshipNotes || null,
      })
      .select("id")
      .single();
    if (error) throw error;
    return contact;
  });
