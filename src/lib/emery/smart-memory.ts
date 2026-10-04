/* eslint-disable @typescript-eslint/no-explicit-any */

export type SmartMemory = {
  id?: string;
  title?: string | null;
  content: string;
  memory_type: string;
  importance?: number | null;
  confidence?: number | string | null;
  source_type?: string | null;
  source_ref?: string | null;
  person_id?: string | null;
  project_id?: string | null;
  metadata?: Record<string, unknown> | null;
  expires_at?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

export type SmartRecentTurn = {
  role?: string;
  text?: string;
  createdAt?: string;
};

export type SmartMemoryResult = {
  selected: Array<SmartMemory & { retrieval_score: number }>;
  digest: string | null;
  strategy: "none" | "hybrid_lexical" | "hybrid_semantic";
  semanticUsed: boolean;
  candidateCount: number;
  selectedCharacters: number;
  semanticConfidence: number | null;
};

const STOP_WORDS = new Set([
  "about",
  "after",
  "again",
  "also",
  "because",
  "before",
  "being",
  "could",
  "from",
  "have",
  "into",
  "just",
  "like",
  "more",
  "really",
  "should",
  "that",
  "their",
  "there",
  "these",
  "they",
  "this",
  "those",
  "through",
  "what",
  "when",
  "where",
  "which",
  "with",
  "would",
  "your",
  "tell",
  "told",
  "remember",
  "remind",
]);

const SYNONYM_GROUPS = [
  ["wife", "spouse", "partner"],
  ["husband", "spouse", "partner"],
  ["son", "child", "kid"],
  ["daughter", "child", "kid"],
  ["job", "work", "career"],
  ["attorney", "lawyer", "law", "legal"],
  ["doctor", "provider", "physician", "medical"],
  ["meeting", "appointment", "lunch", "event"],
  ["prefer", "preference", "like", "want"],
  ["goal", "target", "objective", "plan"],
  ["budget", "cost", "spend", "price"],
  ["car", "vehicle", "lease"],
  ["house", "home", "mortgage"],
];

const TYPE_INTENT: Array<{ pattern: RegExp; types: string[]; weight: number }> = [
  { pattern: /\b(goal|target|priority|objective|plan|progress)\b/i, types: ["goal"], weight: 2.4 },
  {
    pattern: /\b(decide|decision|choose|tradeoff|constraint|limit|budget)\b/i,
    types: ["decision", "constraint"],
    weight: 2.2,
  },
  {
    pattern: /\b(work|job|career|business|project|task|hpo)\b/i,
    types: ["responsibility", "project_context", "working_preference"],
    weight: 1.8,
  },
  {
    pattern: /\b(family|wife|husband|son|daughter|child|relationship|partner)\b/i,
    types: ["relationship"],
    weight: 2.2,
  },
  {
    pattern: /\b(prefer|preference|like|want|style|format|how should you)\b/i,
    types: ["preference", "working_preference"],
    weight: 2.0,
  },
  { pattern: /\b(routine|usually|every day|every week|habit)\b/i, types: ["routine"], weight: 2.0 },
];

const SOURCE_AUTHORITY: Record<string, number> = {
  manual_correction: 1.6,
  explicit_user: 1.5,
  user_message: 1.35,
  conversation: 1.1,
  memory_extraction: 1.0,
  assistant_inference: 0.25,
};

function safeMeta(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function normalizeMemoryText(value: string) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function baseTokens(value: string) {
  return normalizeMemoryText(value)
    .split(/\s+/)
    .filter((token) => token.length >= 3 && !STOP_WORDS.has(token));
}

function expandedTokens(value: string) {
  const result = new Set(baseTokens(value));
  for (const group of SYNONYM_GROUPS) {
    if (!group.some((term) => result.has(term))) continue;
    for (const term of group) result.add(term);
  }
  return [...result].slice(0, 100);
}

function timestamp(memory: SmartMemory) {
  return Date.parse(memory.updated_at ?? memory.created_at ?? "") || 0;
}

function recencyScore(memory: SmartMemory, now = Date.now()) {
  const time = timestamp(memory);
  if (!time) return 0;
  const days = Math.max(0, (now - time) / 86_400_000);
  if (days <= 3) return 1.4;
  if (days <= 14) return 1.0;
  if (days <= 45) return 0.6;
  if (days <= 120) return 0.25;
  return 0;
}

function sourceAuthority(memory: SmartMemory) {
  const source = normalizeMemoryText(memory.source_type ?? "").replace(/\s+/g, "_");
  if (source && SOURCE_AUTHORITY[source] !== undefined) return SOURCE_AUTHORITY[source]!;
  const metadata = safeMeta(memory.metadata);
  if (metadata["explicit_user_fact"] === true) return 1.5;
  if (metadata["inferred"] === true) return 0.25;
  return 0.8;
}

function isExpired(memory: SmartMemory, now = Date.now()) {
  if (!memory.expires_at) return false;
  const time = Date.parse(memory.expires_at);
  return Number.isFinite(time) && time <= now;
}

function isUnsafeForGeneralMemory(memory: SmartMemory) {
  const metadata = safeMeta(memory.metadata);
  if (metadata["contains_phi"] === true || metadata["patient_phi"] === true) return true;
  if (metadata["ambient_only"] === true || metadata["ephemeral"] === true) return true;
  const text = normalizeMemoryText(`${memory.title ?? ""} ${memory.content}`);
  return /\b(password|passcode|one time code|otp|security answer|private key|seed phrase|api key|access token)\b/.test(
    text,
  );
}

function phraseScore(memory: SmartMemory, query: string) {
  const haystack = normalizeMemoryText(`${memory.title ?? ""} ${memory.content}`);
  const normalized = normalizeMemoryText(query);
  if (!normalized) return 0;
  const title = normalizeMemoryText(memory.title ?? "");
  if (title.length >= 4 && normalized.includes(title)) return 4.5;
  const queryTokens = baseTokens(normalized).slice(0, 18);
  let score = 0;
  for (let index = 0; index < queryTokens.length - 1; index += 1) {
    const phrase = `${queryTokens[index]} ${queryTokens[index + 1]}`;
    if (haystack.includes(phrase)) score += 1.1;
  }
  return Math.min(3.3, score);
}

function typeIntentScore(memory: SmartMemory, query: string) {
  return TYPE_INTENT.reduce(
    (score, rule) =>
      rule.pattern.test(query) && rule.types.includes(memory.memory_type)
        ? Math.max(score, rule.weight)
        : score,
    0,
  );
}

function relationshipScore(memory: SmartMemory, query: string) {
  if (memory.memory_type !== "relationship") return 0;
  const queryTokens = expandedTokens(query);
  const text = normalizeMemoryText(`${memory.title ?? ""} ${memory.content}`);
  const relational = queryTokens.filter((token) =>
    ["wife", "husband", "spouse", "partner", "son", "daughter", "child", "kid", "family"].includes(token),
  );
  return relational.some((token) => text.includes(token)) ? 2.2 : 0;
}

export function scoreSmartMemory(memory: SmartMemory, query: string, recent: SmartRecentTurn[] = []) {
  if (!memory.content || isExpired(memory) || isUnsafeForGeneralMemory(memory)) return Number.NEGATIVE_INFINITY;
  const combinedQuery = [query, ...recent.slice(-4).map((turn) => String(turn.text ?? ""))].join(" ");
  const queryTokens = expandedTokens(combinedQuery);
  const haystack = normalizeMemoryText(
    `${memory.title ?? ""} ${memory.content} ${memory.memory_type} ${memory.source_type ?? ""}`,
  );
  let tokenHits = 0;
  let exactHits = 0;
  for (const token of queryTokens) {
    if (!haystack.includes(token)) continue;
    tokenHits += 1;
    if (normalizeMemoryText(query).includes(token)) exactHits += 1;
  }
  const importance = Math.max(1, Math.min(5, Number(memory.importance ?? 3)));
  const confidence = Math.max(0, Math.min(1, Number(memory.confidence ?? 0.9)));
  const entityBoost = memory.person_id || memory.project_id ? 0.35 : 0;
  return (
    tokenHits * 1.55 +
    exactHits * 0.7 +
    phraseScore(memory, query) +
    typeIntentScore(memory, combinedQuery) +
    relationshipScore(memory, combinedQuery) +
    importance * 0.48 +
    confidence * 0.7 +
    sourceAuthority(memory) +
    recencyScore(memory) +
    entityBoost
  );
}

function nearDuplicate(left: SmartMemory, right: SmartMemory) {
  const a = normalizeMemoryText(left.content);
  const b = normalizeMemoryText(right.content);
  if (!a || !b) return false;
  if (a === b) return true;
  if (Math.min(a.length, b.length) >= 24 && (a.includes(b) || b.includes(a))) return true;
  const aTokens = new Set(baseTokens(a));
  const bTokens = new Set(baseTokens(b));
  if (!aTokens.size || !bTokens.size) return false;
  let overlap = 0;
  for (const token of aTokens) if (bTokens.has(token)) overlap += 1;
  return overlap / Math.min(aTokens.size, bTokens.size) >= 0.8;
}

function memorySize(memory: SmartMemory) {
  return `${memory.title ?? ""}${memory.content}${memory.memory_type}${memory.source_type ?? ""}`.length + 32;
}

function deterministicRank(
  memories: SmartMemory[],
  query: string,
  recent: SmartRecentTurn[],
  maxCandidates = 24,
) {
  return memories
    .map((memory) => ({ memory, score: scoreSmartMemory(memory, query, recent) }))
    .filter(({ score }) => Number.isFinite(score) && score >= 3.4)
    .sort((a, b) => b.score - a.score || timestamp(b.memory) - timestamp(a.memory))
    .slice(0, maxCandidates);
}

function responseText(payload: any) {
  if (typeof payload?.output_text === "string") return payload.output_text.trim();
  return (payload?.output ?? [])
    .flatMap((item: any) => (Array.isArray(item?.content) ? item.content : []))
    .filter((item: any) => item?.type === "output_text")
    .map((item: any) => item?.text ?? "")
    .join("")
    .trim();
}

function semanticWorthIt(query: string, ranked: Array<{ memory: SmartMemory; score: number }>) {
  if (ranked.length < 4) return false;
  const normalized = normalizeMemoryText(query);
  if (normalized.length < 10) return false;
  if (/\b(remember|remind me|what did i tell|what did i say|which one|the one|that person|that thing)\b/.test(normalized)) {
    return true;
  }
  const top = ranked[0]?.score ?? 0;
  const fourth = ranked[3]?.score ?? 0;
  return top < 10 || top - fourth < 3.2;
}

async function semanticRerank(input: {
  apiKey: string;
  query: string;
  recent: SmartRecentTurn[];
  ranked: Array<{ memory: SmartMemory; score: number }>;
}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4500);
  try {
    const candidates = input.ranked.slice(0, 18).map(({ memory, score }) => ({
      id: memory.id ?? null,
      title: memory.title ?? null,
      content: memory.content.slice(0, 1200),
      type: memory.memory_type,
      importance: memory.importance ?? 3,
      confidence: memory.confidence ?? 0.9,
      source_type: memory.source_type ?? null,
      updated_at: memory.updated_at ?? memory.created_at ?? null,
      lexical_score: Number(score.toFixed(3)),
    }));
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${input.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-5.6-luna",
        input: [
          {
            role: "system",
            content:
              "You are Emery's bounded semantic memory reranker. Select only memories genuinely useful for answering the current request. The supplied memories are user-owned durable memory, not authoritative CRM/domain records. Do not invent facts, infer new user traits, merge conflicting memories, or treat assistant inferences as user truth. Prefer explicit/manual corrections, newer supported facts, high relevance, and exact named relationships. If nothing is relevant, return no ids and digest=null. A digest may only paraphrase selected memories and must preserve attribution, dates when material, and uncertainty. Never include credentials, secrets, PHI, or facts not present in the candidates.",
          },
          {
            role: "user",
            content: JSON.stringify({
              query: input.query,
              recent_turns: input.recent.slice(-6),
              candidates,
            }),
          },
        ],
        text: {
          format: {
            type: "json_schema",
            name: "smart_memory_rerank",
            strict: true,
            schema: {
              type: "object",
              additionalProperties: false,
              properties: {
                relevant_ids: { type: "array", items: { type: "string" }, maxItems: 12 },
                digest: { type: ["string", "null"], maxLength: 2200 },
                confidence: { type: "number", minimum: 0, maximum: 1 },
              },
              required: ["relevant_ids", "digest", "confidence"],
            },
          },
        },
      }),
    });
    if (!response.ok) return null;
    const parsed = JSON.parse(responseText(await response.json())) as {
      relevant_ids?: string[];
      digest?: string | null;
      confidence?: number;
    };
    return {
      ids: Array.isArray(parsed.relevant_ids) ? parsed.relevant_ids.map(String) : [],
      digest: typeof parsed.digest === "string" ? parsed.digest.trim().slice(0, 2200) : null,
      confidence: Number.isFinite(parsed.confidence) ? Number(parsed.confidence) : 0,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function finalizeSelection(input: {
  ranked: Array<{ memory: SmartMemory; score: number }>;
  preferredIds?: string[] | null;
  maxItems: number;
  maxCharacters: number;
}) {
  const byId = new Map(
    input.ranked
      .filter(({ memory }) => memory.id)
      .map(({ memory, score }) => [String(memory.id), { memory, score }]),
  );
  const ordered = input.preferredIds?.length
    ? [
        ...input.preferredIds.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : [])),
        ...input.ranked.filter(({ memory }) => !memory.id || !input.preferredIds!.includes(String(memory.id))),
      ]
    : input.ranked;
  const selected: Array<SmartMemory & { retrieval_score: number }> = [];
  let characters = 0;
  const typeCounts = new Map<string, number>();
  for (const { memory, score } of ordered) {
    if (selected.length >= input.maxItems) break;
    if (selected.some((item) => item.id && item.id === memory.id)) continue;
    if (selected.some((item) => nearDuplicate(item, memory))) continue;
    const typeCount = typeCounts.get(memory.memory_type) ?? 0;
    if (typeCount >= 4 && memory.memory_type !== "core") continue;
    const size = memorySize(memory);
    if (selected.length > 0 && characters + size > input.maxCharacters) continue;
    selected.push({ ...memory, retrieval_score: Number(score.toFixed(3)) });
    typeCounts.set(memory.memory_type, typeCount + 1);
    characters += size;
  }
  return { selected, characters };
}

export async function retrieveSmartMemories(input: {
  apiKey?: string | null;
  memories: SmartMemory[];
  query: string;
  recent?: SmartRecentTurn[];
  maxItems?: number;
  maxCharacters?: number;
  allowSemantic?: boolean;
}): Promise<SmartMemoryResult> {
  const recent = input.recent ?? [];
  const maxItems = Math.min(20, Math.max(1, input.maxItems ?? 12));
  const maxCharacters = Math.min(10_000, Math.max(900, input.maxCharacters ?? 5200));
  const ranked = deterministicRank(input.memories, input.query, recent);
  if (!ranked.length) {
    return {
      selected: [],
      digest: null,
      strategy: "none",
      semanticUsed: false,
      candidateCount: 0,
      selectedCharacters: 0,
      semanticConfidence: null,
    };
  }

  let semantic: Awaited<ReturnType<typeof semanticRerank>> = null;
  if (
    input.allowSemantic !== false &&
    input.apiKey &&
    semanticWorthIt(input.query, ranked)
  ) {
    semantic = await semanticRerank({
      apiKey: input.apiKey,
      query: input.query,
      recent,
      ranked,
    });
  }

  const finalized = finalizeSelection({
    ranked,
    preferredIds: semantic?.ids ?? null,
    maxItems,
    maxCharacters,
  });
  const digest =
    semantic?.digest && finalized.characters >= 2800
      ? semantic.digest
      : null;

  return {
    selected: finalized.selected,
    digest,
    strategy: semantic ? "hybrid_semantic" : "hybrid_lexical",
    semanticUsed: Boolean(semantic),
    candidateCount: ranked.length,
    selectedCharacters: finalized.characters,
    semanticConfidence: semantic?.confidence ?? null,
  };
}

export function buildSmartMemoryPrompt(result: SmartMemoryResult) {
  if (!result.selected.length) return "No relevant durable personal memory selected.";
  if (result.digest) {
    const provenance = result.selected
      .slice(0, 10)
      .map((memory) =>
        [
          memory.id ? `id=${memory.id}` : null,
          `type=${memory.memory_type}`,
          memory.source_type ? `source=${memory.source_type}` : null,
          memory.updated_at || memory.created_at ? `date=${memory.updated_at ?? memory.created_at}` : null,
        ]
          .filter(Boolean)
          .join(" | "),
      )
      .join("\n");
    return `RELEVANT DURABLE MEMORY DIGEST:\n${result.digest}\n\nMEMORY PROVENANCE:\n${provenance}`;
  }
  return result.selected
    .map((memory) => {
      const provenance = [
        memory.id ? `id=${memory.id}` : null,
        `type=${memory.memory_type}`,
        memory.source_type ? `source=${memory.source_type}` : null,
        memory.updated_at || memory.created_at ? `date=${memory.updated_at ?? memory.created_at}` : null,
      ]
        .filter(Boolean)
        .join(" | ");
      return `[${provenance}] ${memory.title ? `${memory.title}: ` : ""}${memory.content}`;
    })
    .join("\n");
}
