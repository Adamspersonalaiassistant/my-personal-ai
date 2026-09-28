import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

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
    const [accounts, interactions, meetings] = await Promise.all([
      db
        .from("hpo_accounts")
        .select(
          "id,name,account_type,specialty,territory,city,address,priority,owner_name,relationship_stage,relationship_health,status,notes,last_touch_at,next_action,next_action_due_at,opportunity,blockers,updated_at",
        )
        .eq("user_id", context.userId)
        .order("name")
        .range(0, 999),
      db
        .from("hpo_interactions")
        .select(
          "id,account_id,contact_id,interaction_type,occurred_at,summary,outcome,relationship_signal,next_action,next_action_due_at",
        )
        .eq("user_id", context.userId)
        .order("occurred_at", { ascending: false })
        .range(data.page * 50, data.page * 50 + 49),
      db
        .from("meetings")
        .select("id,title,meeting_at,metadata")
        .eq("user_id", context.userId)
        .gte("meeting_at", new Date().toISOString())
        .order("meeting_at")
        .limit(40),
    ]);
    if (accounts.error) throw accounts.error;
    if (interactions.error) throw interactions.error;
    if (meetings.error) throw meetings.error;
    return {
      accounts: accounts.data ?? [],
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
            typeof meta["hpo_account_id"] === "string")
        );
      }),
      accountLimitReached: (accounts.data?.length ?? 0) === 1000,
    };
  });

export const updateHpoFieldAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: z.input<typeof accountInput>) => accountInput.parse(input))
  .handler(async ({ context, data }) => {
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
