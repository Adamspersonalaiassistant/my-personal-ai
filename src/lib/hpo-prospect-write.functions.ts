import { createServerFn } from "@tanstack/react-start";
/* eslint-disable @typescript-eslint/no-explicit-any -- Supabase's generated types do not yet include the HPO prospect-readiness columns. */
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { geocodeHpoOfficeAddress } from "@/lib/hpo-geocode";
import {
  HPO_PROSPECT_TYPES,
  appendHpoWriteAudit,
  findHpoDuplicateMatches,
  isNewerIso,
  mergeHpoProvenance,
  normalizeHpoProspectName,
  sanitizeHpoMetadata,
  type HpoDuplicateCandidate,
} from "@/lib/hpo-prospect-write.core";

const sourceType = z.enum([
  "official_website",
  "independent_business",
  "bar_directory",
  "medical_directory",
  "government",
  "manual_review",
  "other",
]);

const sourceInput = z.object({
  url: z.string().trim().url().max(1000),
  type: sourceType,
  title: z.string().trim().max(240).optional(),
  observedAt: z.string().datetime().optional(),
});

const optionalPhone = z
  .string()
  .trim()
  .max(40)
  .refine((value) => !value || /^\+?[0-9().\-\s]{10,40}$/.test(value), "Invalid phone number")
  .optional()
  .nullable();

const optionalWebsite = z.string().trim().url().max(1000).optional().nullable();
const metadataInput = z.record(z.string(), z.unknown()).optional();
const coordinatesInput = z
  .object({
    latitude: z.number().min(-90).max(90).optional().nullable(),
    longitude: z.number().min(-180).max(180).optional().nullable(),
  })
  .refine(
    (value) => (value.latitude == null) === (value.longitude == null),
    "Latitude and longitude must be supplied together.",
  );

const verifiedProspectInput = z
  .object({
    name: z.string().trim().min(1).max(220),
    prospectType: z.enum(HPO_PROSPECT_TYPES),
    specialty: z.string().trim().max(140).optional().nullable(),
    address: z.string().trim().min(5).max(400),
    city: z.string().trim().min(1).max(120),
    state: z.string().trim().length(2).default("NJ"),
    postalCode: z.string().trim().max(20).optional().nullable(),
    phone: optionalPhone,
    website: optionalWebsite,
    territory: z.string().trim().max(120).optional().nullable(),
    fitStatus: z.enum(["undecided", "qualified"]).default("qualified"),
    verificationStatus: z.enum(["partial", "verified"]).default("verified"),
    verifiedAt: z.string().datetime(),
    verificationConfidence: z.enum(["low", "medium", "high"]),
    sources: z.array(sourceInput).min(1).max(12),
    qualificationEvidence: z.string().trim().min(1).max(4000),
    sourceNotes: z.string().trim().max(4000).optional().nullable(),
    nearbyHpoLocation: z.string().trim().max(240).optional().nullable(),
    sourceRef: z.string().trim().max(240).optional().nullable(),
    metadata: metadataInput,
  })
  .and(coordinatesInput);

const duplicateSearchInput = z.object({
  name: z.string().trim().min(1).max(220),
  address: z.string().trim().max(400).optional().nullable(),
  city: z.string().trim().max(120).optional().nullable(),
  phone: optionalPhone,
  website: optionalWebsite,
});

const verificationUpdateInput = z.object({
  prospectId: z.string().uuid(),
  verificationStatus: z.enum(["unverified", "partial", "verified"]),
  verifiedAt: z.string().datetime(),
  verificationConfidence: z.enum(["low", "medium", "high"]),
  sources: z.array(sourceInput).min(1).max(12),
  qualificationEvidence: z.string().trim().max(4000).optional().nullable(),
  reason: z.string().trim().min(1).max(1000),
  expectedUpdatedAt: z.string().datetime().optional().nullable(),
});

const factUpdateInput = z
  .object({
    prospectId: z.string().uuid(),
    verifiedAt: z.string().datetime(),
    expectedUpdatedAt: z.string().datetime().optional().nullable(),
    reason: z.string().trim().min(1).max(1000),
    sources: z.array(sourceInput).min(1).max(12),
    name: z.string().trim().min(1).max(220).optional(),
    prospectType: z.enum(HPO_PROSPECT_TYPES).optional(),
    specialty: z.string().trim().max(140).optional().nullable(),
    territory: z.string().trim().max(120).optional().nullable(),
    city: z.string().trim().max(120).optional().nullable(),
    address: z.string().trim().min(5).max(400).optional(),
    phone: optionalPhone,
    website: optionalWebsite,
    notes: z.string().trim().max(8000).optional().nullable(),
    fitStatus: z.enum(["undecided", "qualified"]).optional(),
    metadata: metadataInput,
  })
  .and(coordinatesInput);

const rejectInput = z.object({
  prospectId: z.string().uuid(),
  reason: z.enum([
    "duplicate",
    "closed",
    "wrong_address",
    "virtual_or_mailbox_only",
    "defense_only",
    "irrelevant_practice",
    "unverifiable_physical_office",
    "low_quality",
    "owner_exclusion",
    "other",
  ]),
  details: z.string().trim().max(2000).optional().nullable(),
  expectedUpdatedAt: z.string().datetime().optional().nullable(),
});

const mergeInput = z.object({
  canonicalProspectId: z.string().uuid(),
  duplicateProspectId: z.string().uuid(),
  reason: z.string().trim().min(1).max(1000),
  expectedCanonicalUpdatedAt: z.string().datetime().optional().nullable(),
  expectedDuplicateUpdatedAt: z.string().datetime().optional().nullable(),
});

const linkInput = z.object({
  prospectId: z.string().uuid(),
  accountId: z.string().uuid(),
  reason: z.string().trim().min(1).max(1000),
  expectedProspectUpdatedAt: z.string().datetime().optional().nullable(),
});

const promoteInput = z.object({
  prospectId: z.string().uuid(),
  explicitApproval: z.literal(true),
  relationshipStage: z.string().trim().min(1).max(80).default("developing"),
  priority: z.number().int().min(1).max(5).default(3),
  reason: z.string().trim().min(1).max(1000),
  expectedUpdatedAt: z.string().datetime().optional().nullable(),
});

type Db = any;

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asProvenance(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> =>
        Boolean(item && typeof item === "object" && !Array.isArray(item)),
      )
    : [];
}

function normalizeSources(sources: z.infer<typeof sourceInput>[]) {
  return sources.map((source) => ({
    url: source.url,
    type: source.type,
    ...(source.title ? { title: source.title } : {}),
    observed_at: source.observedAt ?? new Date().toISOString(),
  }));
}

function staleResult(expected: string | null | undefined, actual: string | null | undefined) {
  return Boolean(expected && actual && expected !== actual);
}

function printableValue(value: unknown): string | number | boolean | null {
  if (
    value == null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value ?? null;
  }
  return JSON.stringify(value).slice(0, 2000);
}

function accountTypeFromProspect(value: string | null | undefined) {
  return (
    (
      {
        attorney: "Attorney",
        pcp: "Primary Care",
        chiropractor: "Chiropractor",
        physical_therapy: "Physical Therapy",
        imaging: "Imaging",
        medical_provider: "Provider",
        other: "Other",
      } as Record<string, string>
    )[String(value ?? "").toLowerCase()] ?? "Other"
  );
}

async function loadDuplicateCandidates(db: Db, userId: string) {
  const [prospects, accounts] = await Promise.all([
    db
      .from("hpo_prospects")
      .select("id,name,address,city,phone,website,metadata,fit_status,promoted_account_id")
      .eq("user_id", userId)
      .range(0, 4999),
    db
      .from("hpo_accounts")
      .select("id,name,address,city,metadata,status,updated_at")
      .eq("user_id", userId)
      .range(0, 4999),
  ]);
  if (prospects.error) throw prospects.error;
  if (accounts.error) throw accounts.error;
  const candidates: HpoDuplicateCandidate[] = [
    ...(prospects.data ?? []).map((row: any) => ({ ...row, entity: "prospect" as const })),
    ...(accounts.data ?? []).map((row: any) => ({ ...row, entity: "account" as const })),
  ];
  return candidates;
}

function duplicateResponse(matches: ReturnType<typeof findHpoDuplicateMatches>) {
  return matches.map((match) => ({
    entity: match.candidate.entity,
    id: match.candidate.id,
    name: match.candidate.name,
    address: match.candidate.address ?? null,
    score: match.score,
    confidence: match.confidence,
    reasons: match.reasons,
  }));
}

async function ownedProspect(db: Db, userId: string, prospectId: string) {
  const result = await db
    .from("hpo_prospects")
    .select("*")
    .eq("id", prospectId)
    .eq("user_id", userId)
    .maybeSingle();
  if (result.error) throw result.error;
  if (!result.data) throw new Error("Prospect not found in the authenticated HPO workspace.");
  return result.data;
}

async function ownedAccount(db: Db, userId: string, accountId: string) {
  const result = await db
    .from("hpo_accounts")
    .select("*")
    .eq("id", accountId)
    .eq("user_id", userId)
    .maybeSingle();
  if (result.error) throw result.error;
  if (!result.data) throw new Error("Account not found in the authenticated HPO workspace.");
  return result.data;
}

export const findHpoProspectDuplicates = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: z.input<typeof duplicateSearchInput>) =>
    duplicateSearchInput.parse(input),
  )
  .handler(async ({ context, data }) => {
    const matches = findHpoDuplicateMatches(
      data,
      await loadDuplicateCandidates(context.supabase, context.userId),
    );
    return {
      status: matches.some((match) => match.confidence === "strong")
        ? "duplicate_found"
        : matches.length
          ? "conflict_review"
          : "ready_to_add",
      requiresReview: matches.length > 0,
      matches: duplicateResponse(matches),
    };
  });

export const createVerifiedHpoProspect = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: z.input<typeof verifiedProspectInput>) =>
    verifiedProspectInput.parse(input),
  )
  .handler(async ({ context, data }) => {
    const db = context.supabase as Db;
    const matches = findHpoDuplicateMatches(
      data,
      await loadDuplicateCandidates(db, context.userId),
    );
    const strong = matches.find((match) => match.confidence === "strong");
    if (strong) {
      return {
        status: "duplicate_found" as const,
        created: false,
        requiresReview: strong.candidate.entity === "account",
        existing: duplicateResponse([strong])[0],
      };
    }
    if (matches.length) {
      return {
        status: "conflict_review" as const,
        created: false,
        requiresReview: true,
        matches: duplicateResponse(matches),
      };
    }

    let point =
      data.latitude != null && data.longitude != null
        ? { lat: data.latitude, lon: data.longitude, provider: "verified_source" }
        : null;
    if (!point) point = await geocodeHpoOfficeAddress(data.address, data.city);
    if (!point) {
      return {
        status: "verification_incomplete" as const,
        created: false,
        requiresReview: true,
        reason: "The verified physical address could not be geocoded safely.",
      };
    }

    const now = new Date().toISOString();
    const sources = normalizeSources(data.sources);
    const metadata = appendHpoWriteAudit(
      {
        ...sanitizeHpoMetadata(data.metadata),
        state: data.state.toUpperCase(),
        postal_code: data.postalCode ?? null,
        nearby_hpo_location: data.nearbyHpoLocation ?? null,
        verification: {
          status: data.verificationStatus,
          verified_at: data.verifiedAt,
          confidence: data.verificationConfidence,
          qualification_evidence: data.qualificationEvidence,
        },
      },
      { action: "create_verified_prospect", at: now, origin: "emery_research" },
    );
    const insert = await db
      .from("hpo_prospects")
      .insert({
        user_id: context.userId,
        name: data.name,
        normalized_name: normalizeHpoProspectName(data.name),
        prospect_type: data.prospectType,
        specialty: data.specialty ?? null,
        territory: data.territory ?? null,
        city: data.city,
        address: data.address,
        phone: data.phone ?? null,
        website: data.website ?? null,
        latitude: point.lat,
        longitude: point.lon,
        geocoded_at: now,
        fit_status: data.fitStatus,
        verification_status: data.verificationStatus,
        source_type: "emery_research",
        source_ref: data.sourceRef ?? null,
        provenance: sources,
        notes: data.sourceNotes ?? null,
        metadata,
        updated_at: now,
      })
      .select("*")
      .single();
    if (insert.error?.code === "23505") {
      const existing = await db
        .from("hpo_prospects")
        .select("*")
        .eq("user_id", context.userId)
        .eq("normalized_name", normalizeHpoProspectName(data.name))
        .eq("address", data.address)
        .maybeSingle();
      if (existing.error) throw existing.error;
      return {
        status: "duplicate_found" as const,
        created: false,
        requiresReview: false,
        prospect: existing.data,
      };
    }
    if (insert.error) throw insert.error;
    return {
      status: "created" as const,
      created: true,
      requiresReview: false,
      prospect: insert.data,
    };
  });

export const updateHpoProspectVerification = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: z.input<typeof verificationUpdateInput>) =>
    verificationUpdateInput.parse(input),
  )
  .handler(async ({ context, data }) => {
    const db = context.supabase as Db;
    const current = await ownedProspect(db, context.userId, data.prospectId);
    if (staleResult(data.expectedUpdatedAt, current.updated_at)) {
      return { status: "conflict_review" as const, requiresReview: true, current };
    }
    const now = new Date().toISOString();
    const metadata = appendHpoWriteAudit(
      {
        ...asObject(current.metadata),
        verification: {
          status: data.verificationStatus,
          verified_at: data.verifiedAt,
          confidence: data.verificationConfidence,
          qualification_evidence: data.qualificationEvidence ?? null,
        },
      },
      { action: "update_verification", at: now, origin: "emery_research", reason: data.reason },
    );
    const result = await db
      .from("hpo_prospects")
      .update({
        verification_status: data.verificationStatus,
        provenance: mergeHpoProvenance(
          asProvenance(current.provenance),
          normalizeSources(data.sources),
        ),
        metadata,
        updated_at: now,
      })
      .eq("id", current.id)
      .eq("user_id", context.userId)
      .select("*")
      .single();
    if (result.error) throw result.error;
    return { status: "updated" as const, requiresReview: false, prospect: result.data };
  });

export const updateVerifiedHpoProspectFacts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: z.input<typeof factUpdateInput>) => factUpdateInput.parse(input))
  .handler(async ({ context, data }) => {
    const db = context.supabase as Db;
    const current = await ownedProspect(db, context.userId, data.prospectId);
    if (staleResult(data.expectedUpdatedAt, current.updated_at)) {
      return { status: "conflict_review" as const, requiresReview: true, current };
    }
    const columnMap: Record<string, string> = {
      name: "name",
      prospectType: "prospect_type",
      specialty: "specialty",
      territory: "territory",
      city: "city",
      address: "address",
      phone: "phone",
      website: "website",
      notes: "notes",
      fitStatus: "fit_status",
    };
    const changes: Record<string, unknown> = {};
    const conflicts: Array<{
      field: string;
      current: string | number | boolean | null;
      proposed: string | number | boolean | null;
    }> = [];
    for (const [inputKey, column] of Object.entries(columnMap)) {
      if (!(inputKey in data)) continue;
      const proposed = (data as Record<string, unknown>)[inputKey];
      if (current[column] === proposed) continue;
      if (isNewerIso(current.updated_at, data.verifiedAt)) {
        conflicts.push({
          field: column,
          current: printableValue(current[column]),
          proposed: printableValue(proposed),
        });
      } else {
        changes[column] = proposed ?? null;
      }
    }
    if (conflicts.length) {
      return { status: "conflict_review" as const, requiresReview: true, conflicts, current };
    }
    if (typeof changes["name"] === "string") {
      changes["normalized_name"] = normalizeHpoProspectName(changes["name"]);
    }
    if (changes["address"] !== undefined) {
      let point =
        data.latitude != null && data.longitude != null
          ? { lat: data.latitude, lon: data.longitude }
          : null;
      if (!point) {
        point = await geocodeHpoOfficeAddress(
          String(changes["address"]),
          String(changes["city"] ?? current.city ?? ""),
        );
      }
      if (!point) {
        return {
          status: "verification_incomplete" as const,
          requiresReview: true,
          reason: "The changed address could not be geocoded; the existing pin was preserved.",
          current,
        };
      }
      changes["latitude"] = point.lat;
      changes["longitude"] = point.lon;
      changes["geocoded_at"] = new Date().toISOString();
    }
    const now = new Date().toISOString();
    changes["provenance"] = mergeHpoProvenance(
      asProvenance(current.provenance),
      normalizeSources(data.sources),
    );
    changes["metadata"] = appendHpoWriteAudit(
      { ...asObject(current.metadata), ...sanitizeHpoMetadata(data.metadata) },
      { action: "update_verified_facts", at: now, origin: "emery_research", reason: data.reason },
    );
    changes["updated_at"] = now;
    const result = await db
      .from("hpo_prospects")
      .update(changes)
      .eq("id", current.id)
      .eq("user_id", context.userId)
      .select("*")
      .single();
    if (result.error) throw result.error;
    return { status: "updated" as const, requiresReview: false, prospect: result.data };
  });

export const rejectHpoProspect = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: z.input<typeof rejectInput>) => rejectInput.parse(input))
  .handler(async ({ context, data }) => {
    const db = context.supabase as Db;
    const current = await ownedProspect(db, context.userId, data.prospectId);
    if (staleResult(data.expectedUpdatedAt, current.updated_at)) {
      return { status: "conflict_review" as const, requiresReview: true, current };
    }
    const now = new Date().toISOString();
    const fitStatus =
      data.reason === "duplicate" ? "duplicate" : data.reason === "closed" ? "closed" : "not_fit";
    const result = await db
      .from("hpo_prospects")
      .update({
        fit_status: fitStatus,
        disposition_reason: data.details ? `${data.reason}: ${data.details}` : data.reason,
        metadata: appendHpoWriteAudit(asObject(current.metadata), {
          action: "reject_or_archive",
          at: now,
          origin: "emery_research",
          reason: data.reason,
        }),
        updated_at: now,
      })
      .eq("id", current.id)
      .eq("user_id", context.userId)
      .select("*")
      .single();
    if (result.error) throw result.error;
    return { status: "rejected" as const, requiresReview: false, prospect: result.data };
  });

export const mergeHpoProspects = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: z.input<typeof mergeInput>) => mergeInput.parse(input))
  .handler(async ({ context, data }) => {
    if (data.canonicalProspectId === data.duplicateProspectId) {
      throw new Error("Canonical and duplicate prospect must be different records.");
    }
    const db = context.supabase as Db;
    const [canonical, duplicate] = await Promise.all([
      ownedProspect(db, context.userId, data.canonicalProspectId),
      ownedProspect(db, context.userId, data.duplicateProspectId),
    ]);
    if (
      staleResult(data.expectedCanonicalUpdatedAt, canonical.updated_at) ||
      staleResult(data.expectedDuplicateUpdatedAt, duplicate.updated_at)
    ) {
      return { status: "conflict_review" as const, requiresReview: true, canonical, duplicate };
    }
    const evidence = findHpoDuplicateMatches(canonical, [{ ...duplicate, entity: "prospect" }])[0];
    if (!evidence || evidence.confidence !== "strong") {
      return {
        status: "conflict_review" as const,
        requiresReview: true,
        reason: "These records do not share enough exact evidence for automatic consolidation.",
      };
    }
    const now = new Date().toISOString();
    const fillable = ["specialty", "territory", "city", "address", "phone", "website", "notes"];
    const canonicalPatch: Record<string, unknown> = {};
    for (const field of fillable) {
      if (!canonical[field] && duplicate[field]) canonicalPatch[field] = duplicate[field];
    }
    canonicalPatch["provenance"] = mergeHpoProvenance(
      asProvenance(canonical.provenance),
      asProvenance(duplicate.provenance),
    );
    canonicalPatch["metadata"] = appendHpoWriteAudit(asObject(canonical.metadata), {
      action: "merge_duplicate_prospect",
      at: now,
      duplicate_prospect_id: duplicate.id,
      reason: data.reason,
    });
    canonicalPatch["updated_at"] = now;
    const canonicalResult = await db
      .from("hpo_prospects")
      .update(canonicalPatch)
      .eq("id", canonical.id)
      .eq("user_id", context.userId)
      .select("*")
      .single();
    if (canonicalResult.error) throw canonicalResult.error;
    const duplicateResult = await db
      .from("hpo_prospects")
      .update({
        fit_status: "duplicate",
        disposition_reason: data.reason,
        metadata: appendHpoWriteAudit(
          { ...asObject(duplicate.metadata), canonical_prospect_id: canonical.id },
          { action: "consolidated_into_prospect", at: now, canonical_prospect_id: canonical.id },
        ),
        updated_at: now,
      })
      .eq("id", duplicate.id)
      .eq("user_id", context.userId)
      .select("*")
      .single();
    if (duplicateResult.error) throw duplicateResult.error;
    return {
      status: "merged" as const,
      requiresReview: false,
      canonical: canonicalResult.data,
      duplicate: duplicateResult.data,
    };
  });

export const linkHpoProspectLocationToAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: z.input<typeof linkInput>) => linkInput.parse(input))
  .handler(async ({ context, data }) => {
    const db = context.supabase as Db;
    const [prospect, account] = await Promise.all([
      ownedProspect(db, context.userId, data.prospectId),
      ownedAccount(db, context.userId, data.accountId),
    ]);
    if (staleResult(data.expectedProspectUpdatedAt, prospect.updated_at)) {
      return { status: "conflict_review" as const, requiresReview: true, prospect };
    }
    if (prospect.promoted_account_id && prospect.promoted_account_id !== account.id) {
      return {
        status: "conflict_review" as const,
        requiresReview: true,
        reason: "This location is already linked to another established account.",
      };
    }
    const now = new Date().toISOString();
    const result = await db
      .from("hpo_prospects")
      .update({
        fit_status: "promoted",
        promoted_account_id: account.id,
        promoted_at: prospect.promoted_at ?? now,
        metadata: appendHpoWriteAudit(
          { ...asObject(prospect.metadata), link_kind: "account_location" },
          {
            action: "link_location_to_account",
            at: now,
            account_id: account.id,
            reason: data.reason,
          },
        ),
        updated_at: now,
      })
      .eq("id", prospect.id)
      .eq("user_id", context.userId)
      .select("*")
      .single();
    if (result.error) throw result.error;
    return {
      status: "linked" as const,
      requiresReview: false,
      prospect: result.data,
      accountId: account.id,
    };
  });

export const promoteHpoProspectToAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: z.input<typeof promoteInput>) => promoteInput.parse(input))
  .handler(async ({ context, data }) => {
    const db = context.supabase as Db;
    const prospect = await ownedProspect(db, context.userId, data.prospectId);
    if (staleResult(data.expectedUpdatedAt, prospect.updated_at)) {
      return { status: "conflict_review" as const, requiresReview: true, prospect };
    }
    if (prospect.promoted_account_id) {
      const account = await ownedAccount(db, context.userId, prospect.promoted_account_id);
      return { status: "already_promoted" as const, requiresReview: false, account, prospect };
    }
    const matches = findHpoDuplicateMatches(
      prospect,
      (await loadDuplicateCandidates(db, context.userId)).filter(
        (candidate) => candidate.entity === "account",
      ),
    );
    if (matches.length) {
      return {
        status: "conflict_review" as const,
        requiresReview: true,
        reason: "An established account may already represent this office.",
        matches: duplicateResponse(matches),
      };
    }
    const now = new Date().toISOString();
    const prospectMeta = asObject(prospect.metadata);
    const accountMetadata = {
      phone: prospect.phone ?? null,
      website: prospect.website ?? null,
      prospect_id: prospect.id,
      research_provenance: asProvenance(prospect.provenance),
      promoted_at: now,
      promoted_by: "authenticated_hpo_write_layer",
      promotion_reason: data.reason,
    };
    const accountInsert = await db
      .from("hpo_accounts")
      .insert({
        user_id: context.userId,
        name: prospect.name,
        account_type: accountTypeFromProspect(prospect.prospect_type),
        specialty: prospect.specialty,
        territory: prospect.territory,
        city: prospect.city,
        address: prospect.address,
        priority: data.priority,
        relationship_stage: data.relationshipStage,
        status: "active",
        notes: prospect.notes,
        source_origin: "prospect_promotion",
        source_ref: prospect.id,
        latitude: prospect.latitude,
        longitude: prospect.longitude,
        geocoded_at: prospect.geocoded_at,
        dedupe_key: `prospect:${prospect.id}`,
        metadata: { ...prospectMeta, ...accountMetadata },
        updated_at: now,
      })
      .select("*")
      .single();
    if (accountInsert.error?.code === "23505") {
      const existing = await db
        .from("hpo_accounts")
        .select("*")
        .eq("user_id", context.userId)
        .eq("dedupe_key", `prospect:${prospect.id}`)
        .maybeSingle();
      if (existing.error) throw existing.error;
      if (!existing.data) throw accountInsert.error;
      const relink = await db
        .from("hpo_prospects")
        .update({
          promoted_account_id: existing.data.id,
          promoted_at: now,
          fit_status: "promoted",
          updated_at: now,
        })
        .eq("id", prospect.id)
        .eq("user_id", context.userId);
      if (relink.error) throw relink.error;
      return { status: "already_promoted" as const, requiresReview: false, account: existing.data };
    }
    if (accountInsert.error) throw accountInsert.error;
    const prospectUpdate = await db
      .from("hpo_prospects")
      .update({
        promoted_account_id: accountInsert.data.id,
        promoted_at: now,
        fit_status: "promoted",
        metadata: appendHpoWriteAudit(prospectMeta, {
          action: "promote_to_account",
          at: now,
          account_id: accountInsert.data.id,
          reason: data.reason,
        }),
        updated_at: now,
      })
      .eq("id", prospect.id)
      .eq("user_id", context.userId)
      .select("*")
      .single();
    if (prospectUpdate.error) throw prospectUpdate.error;
    return {
      status: "promoted" as const,
      requiresReview: false,
      account: accountInsert.data,
      prospect: prospectUpdate.data,
    };
  });
