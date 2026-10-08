/* eslint-disable @typescript-eslint/no-explicit-any */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { geocodeHpoOfficeAddress } from "@/lib/hpo-geocode";
import { MODEL_POLICY } from "@/lib/model-policy";

const contactSchema = z.object({
  name: z.string().trim().min(1).max(150),
  roleTitle: z.string().trim().max(150).default(""),
  phone: z.string().trim().max(50).default(""),
  email: z.union([z.literal(""), z.string().trim().email().max(200)]).default(""),
  relationshipNotes: z.string().trim().max(1500).default(""),
});
const accountSchema = z.object({
  name: z.string().trim().min(2).max(180),
  accountType: z.string().trim().max(100).default(""),
  specialty: z.string().trim().max(120).default(""),
  territory: z.string().trim().max(120).default(""),
  address: z.string().trim().max(350).default(""),
  city: z.string().trim().max(100).default(""),
  priority: z.number().int().min(1).max(5).default(3),
  ownerName: z.string().trim().max(150).default(""),
  relationshipStage: z.string().trim().max(80).default("prospect"),
  notes: z.string().trim().max(4000).default(""),
});
const createSchema = z.object({
  account: accountSchema,
  contacts: z.array(contactSchema).max(20),
});
const draftSchema = z.object({ message: z.string().trim().min(8).max(9000) });
type Contact = z.infer<typeof contactSchema>;
type Account = z.infer<typeof accountSchema>;
export type HpoAccountDraft = { account: Account; contacts: Contact[] };

const outputText = (payload: any): string => {
  if (typeof payload?.output_text === "string") return payload.output_text.trim();
  return (payload?.output ?? [])
    .flatMap((part: any) => Array.isArray(part.content) ? part.content : [])
    .filter((part: any) => part.type === "output_text")
    .map((part: any) => String(part.text ?? ""))
    .join("").trim();
};

export const emeryDraftHpoAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: z.input<typeof draftSchema>) => draftSchema.parse(data))
  .handler(async ({ data }) => {
    const key = process.env["OPENAI_API_KEY"];
    if (!key) throw new Error("Emery's AI service is not configured.");
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: MODEL_POLICY.action,
        instructions: [
          "You are Emery, preparing an HPO account form draft for Adam to review.",
          "Extract ONLY facts actually stated in Adam's description. Never guess an address, phone, email, contact name, or specialty.",
          "If the user asks to research or find information, leave unknown fields blank and say you need verified details in the notice. No web search is connected to this draft step.",
          "Create only people explicitly identified by the user as business contacts. Do not include patients, patient case details, diagnoses, DOBs, or claim numbers.",
          "Treat this as a draft: never save or perform any business action.",
          "Use standard category labels like Attorney, Primary Care, Urgent Care, PT/Chiro only if the text clearly establishes them.",
          "Priority 3 by default, relationshipStage prospect by default. Blank strings mean missing. In notice explain missing address or unclear fields.",
        ].join("\n"),
        input: [{ role: "user", content: [{ type: "input_text", text: data.message }] }],
        text: { format: {
          type: "json_schema", name: "hpo_account_form_draft", strict: true,
          schema: {
            type: "object", additionalProperties: false,
            properties: {
              name: { type: "string" }, accountType: { type: "string" },
              specialty: { type: "string" }, territory: { type: "string" },
              address: { type: "string" }, city: { type: "string" },
              priority: { type: "integer" }, ownerName: { type: "string" },
              relationshipStage: { type: "string" }, notes: { type: "string" },
              contacts: {
                type: "array", maxItems: 20,
                items: {
                  type: "object", additionalProperties: false,
                  properties: {
                    name: { type: "string" }, roleTitle: { type: "string" },
                    phone: { type: "string" }, email: { type: "string" },
                    relationshipNotes: { type: "string" },
                  },
                  required: ["name", "roleTitle", "phone", "email", "relationshipNotes"],
                },
              },
              notice: { type: "string" },
            },
            required: ["name", "accountType", "specialty", "territory", "address",
              "city", "priority", "ownerName", "relationshipStage", "notes", "contacts", "notice"],
          },
        }},
      }),
    });
    if (!response.ok) throw new Error("Emery couldn't prepare the form. Enter details manually or retry.");
    let parsed: any;
    try { parsed = JSON.parse(outputText(await response.json())); }
    catch { throw new Error("Emery returned an unreadable draft. Please retry."); }
    const account = accountSchema.parse({
      ...parsed,
      // Missing office names are permitted in preview, not when saving.
      name: String(parsed.name || "").trim() || "Needs office name",
      priority: Number(parsed.priority) >= 1 && Number(parsed.priority) <= 5 ? Number(parsed.priority) : 3,
      relationshipStage: parsed.relationshipStage || "prospect",
    });
    const contacts = z.array(contactSchema).max(20).parse(parsed.contacts ?? []);
    return { account: { ...account, name: parsed.name || "" }, contacts,
      notice: String(parsed.notice || "Review all fields before saving.").slice(0, 500) };
  });

export const saveHpoAccountWithContacts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: z.input<typeof createSchema>) => createSchema.parse(data))
  .handler(async ({ data, context }) => {
    const db = context.supabase as any;
    const text = [data.account.name, data.account.notes,
      ...data.contacts.map(c => c.relationshipNotes)].join(" ");
    if (/\b(?:patient\s+(?:dob|date of birth|diagnosis|claim number)|medical record number|social security number)\b/i.test(text))
      throw new Error("Remove patient-identifying details. HPO Account notes are for business relationships.");

    // Perform the duplicate check before calling an external geocoder.
    const existing = await db.from("hpo_accounts")
      .select("id,name,address,city").eq("user_id", context.userId)
      .ilike("name", data.account.name).limit(20);
    if (existing.error) throw existing.error;
    const normalized = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");
    const duplicate = (existing.data ?? []).find((row: any) =>
      normalized(row.name) === normalized(data.account.name) &&
      (data.account.address
        ? normalized(row.address || "") === normalized(data.account.address)
        : normalized(row.city || "") === normalized(data.account.city || "")));
    if (duplicate) return { created: false, duplicate: true, accountId: String(duplicate.id),
      contactsCreated: 0, geocoded: false };

    const point = data.account.address && data.account.city
      ? await geocodeHpoOfficeAddress(data.account.address, data.account.city).catch(() => null)
      : null;
    const { data: receipt, error } = await db.rpc("hpo_create_account_with_contacts", {
      p_account: data.account, p_contacts: data.contacts,
      p_latitude: point?.lat ?? null, p_longitude: point?.lon ?? null,
    });
    if (error) throw error;
    if (!receipt?.accountId) throw new Error("Account save returned no confirmed account ID.");
    return {
      created: Boolean(receipt.created), duplicate: Boolean(receipt.duplicate),
      accountId: String(receipt.accountId),
      contactsCreated: Number(receipt.contactsCreated ?? 0),
      geocoded: Boolean(point && receipt.created),
    };
  });
