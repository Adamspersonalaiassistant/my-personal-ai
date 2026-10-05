// JARVIS structured-knowledge retrieval and ingestion.
//
// Retrieval returns only the items relevant to the current request, ordered by:
//   latest explicit Adam decision → current JARVIS/Emery contract → live/source
//   truth → relevant historical context.
// Ingestion turns Adam's engineering statements into structured items with
// provenance, supports superseding older decisions, and refuses sensitive data.

export type KnowledgeCategory =
  | "product_decision"
  | "user_preference"
  | "constraint"
  | "failure_signal"
  | "workflow_requirement"
  | "acceptance_test"
  | "architecture"
  | "history"
  | "lesson"
  | "research_reference";

export const KNOWLEDGE_CATEGORIES: KnowledgeCategory[] = [
  "product_decision",
  "user_preference",
  "constraint",
  "failure_signal",
  "workflow_requirement",
  "acceptance_test",
  "architecture",
  "history",
  "lesson",
  "research_reference",
];

export type KnowledgeItem = {
  id: string;
  category: KnowledgeCategory;
  title: string;
  content: string;
  status: "current" | "historical" | "superseded";
  importance: number;
  source_type: string;
  source_ref?: string | null;
  source_timestamp?: string | null;
  supersedes_id?: string | null;
  metadata?: Record<string, unknown> | null;
  created_at?: string;
  updated_at?: string;
};

export type RankedKnowledge = KnowledgeItem & { score: number; tier: number };

/** Sources that represent Adam speaking directly (newest wins). */
export const ADAM_DIRECT_SOURCES = new Set([
  "adam",
  "jarvis_room",
  "emery_conversation",
  "adam_explicit",
]);

const STOPWORDS = new Set(
  "a an the and or but if of to in on for with at by from is are was were be been being do does did i me my you your we our it its this that these those what how why when where who which about jarvis emery please can could would should will just like know tell".split(
    " ",
  ),
);

export function tokenize(text: string): string[] {
  return String(text ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .map((token) => token.replace(/^-+|-+$/g, ""))
    .filter((token) => token.length > 2 && !STOPWORDS.has(token))
    .map(stem);
}

function stem(token: string) {
  return token
    .replace(/(ings|ing|ies|ed|es|s)$/, (suffix) => (suffix === "ies" ? "y" : ""))
    .slice(0, 14);
}

const INTENT_CATEGORIES: Array<{ pattern: RegExp; categories: KnowledgeCategory[] }> = [
  {
    pattern:
      /\b(how (i|adam) (like|want|prefer)|preferences?|built|build|engineer|architecture|rules|style|standards?)\b/i,
    categories: [
      "user_preference",
      "product_decision",
      "constraint",
      "architecture",
      "workflow_requirement",
    ],
  },
  { pattern: /\b(decid|decision|chose|choice|direction)\w*/i, categories: ["product_decision"] },
  {
    pattern: /\b(never|must not|constraint|forbid|protect|safe|approval)\w*/i,
    categories: ["constraint"],
  },
  {
    pattern: /\b(fail|error|broke|bug|problem|struggl|issue|regress)\w*/i,
    categories: ["failure_signal", "lesson"],
  },
  { pattern: /\b(test|accept|verify|expected)\w*/i, categories: ["acceptance_test"] },
  {
    pattern: /\b(history|lesson|learn|before|previous|past)\w*/i,
    categories: ["history", "lesson"],
  },
  {
    pattern: /\b(research|github|library|source|reference)\w*/i,
    categories: ["research_reference"],
  },
  {
    pattern: /\b(hpo|planner|maps?|accounts?|activity|crm|route|field)\b/i,
    categories: ["workflow_requirement", "product_decision", "constraint"],
  },
];

function tierFor(item: KnowledgeItem) {
  if (item.status === "superseded") return 4;
  if (item.status === "historical" || item.category === "history" || item.category === "lesson")
    return 3;
  if (
    ADAM_DIRECT_SOURCES.has(item.source_type) &&
    (item.category === "product_decision" ||
      item.category === "user_preference" ||
      item.category === "constraint")
  )
    return 0;
  if (
    [
      "product_decision",
      "constraint",
      "architecture",
      "workflow_requirement",
      "acceptance_test",
      "user_preference",
    ].includes(item.category)
  )
    return 1;
  return 2;
}

const TIER_BONUS = [6, 4, 2, 0, -50];

function timestamp(item: KnowledgeItem) {
  const value = item.source_timestamp ?? item.updated_at ?? item.created_at;
  const parsed = value ? Date.parse(value) : NaN;
  return Number.isFinite(parsed) ? parsed : 0;
}

export function rankKnowledge(
  items: KnowledgeItem[],
  query: string,
  limit = 8,
  opts: { includeSuperseded?: boolean } = {},
): RankedKnowledge[] {
  const queryTokens = new Set(tokenize(query));
  const intentCategories = new Set(
    INTENT_CATEGORIES.filter((entry) => entry.pattern.test(query)).flatMap(
      (entry) => entry.categories,
    ),
  );
  const newest = Math.max(1, ...items.map(timestamp));
  const ranked = items
    .filter((item) => opts.includeSuperseded || item.status !== "superseded")
    .map((item) => {
      const titleTokens = tokenize(item.title);
      const bodyTokens = tokenize(`${item.content} ${JSON.stringify(item.metadata ?? {})}`);
      let relevance = 0;
      for (const token of queryTokens) {
        if (titleTokens.includes(token)) relevance += 3;
        else if (bodyTokens.includes(token)) relevance += 1;
      }
      if (intentCategories.has(item.category)) relevance += 2.5;
      const tier = tierFor(item);
      const recency = timestamp(item) / newest; // 0..1
      // Relevance dominates; tier (Adam decision → contract → live → history) breaks near-ties.
      const score =
        relevance * 3 + (TIER_BONUS[tier] ?? 0) + Number(item.importance ?? 3) + recency;
      return { ...item, score, tier, relevance };
    })
    .filter((item) => item.relevance > 0)
    .sort((a, b) => b.score - a.score || a.tier - b.tier || timestamp(b) - timestamp(a))
    .slice(0, limit);
  return ranked.map(({ relevance: _r, ...rest }) => rest);
}

export function formatKnowledgeForPrompt(items: RankedKnowledge[]) {
  if (!items.length) return "No stored knowledge matched this request.";
  const tierLabel = [
    "Adam's explicit decision",
    "current contract",
    "live/source context",
    "historical context",
    "superseded",
  ];
  return items
    .map(
      (item) =>
        `- [${item.category} · ${tierLabel[item.tier]} · importance ${item.importance}${item.source_timestamp ? ` · ${item.source_timestamp.slice(0, 10)}` : ""}] ${item.title}: ${item.content}`,
    )
    .join("\n");
}

// ---------------------------------------------------------------- ingestion

const SENSITIVE_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /\b(password|passcode|passwd|pin code)\b\s*(is|:|=)/i, reason: "password" },
  { pattern: /\b(api[_ -]?key|secret|token|bearer)\b\s*(is|:|=)\s*\S{8,}/i, reason: "credential" },
  {
    pattern:
      /sk-(?:proj-)?[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9]{30,}|github_pat_\w{30,}|sb_secret_\S{10,}|eyJhbGciOi\S{20,}/,
    reason: "credential",
  },
  { pattern: /\b\d{3}-\d{2}-\d{4}\b/, reason: "SSN-like number" },
  { pattern: /\b(?:\d[ -]?){13,19}\b/, reason: "card/account-like number" },
  {
    pattern:
      /\b(patient|mrn|medical record|date of birth|dob|diagnos(is|ed)|prescription|insurance id)\b/i,
    reason: "possible PHI",
  },
  {
    pattern: /\b(social security|bank account|routing number)\b/i,
    reason: "sensitive personal data",
  },
];

export function sensitiveReason(text: string): string | null {
  const hit = SENSITIVE_PATTERNS.find((entry) => entry.pattern.test(text));
  return hit ? hit.reason : null;
}

export type KnowledgeCandidate = {
  category: KnowledgeCategory;
  title: string;
  content: string;
  importance: number;
  signal: string;
};

const ENGINEERING_SUBJECT =
  /\b(emery|jarvis|app|feature|build|ui|screen|voice|chat|memory|planner|maps?|accounts?|activity|hpo|crm|route|calendar|notifications?|agent|engineer|code|deploy|release|lovable|github|supabase|test|workflow)\b/i;

const RULES: Array<{
  category: KnowledgeCategory;
  pattern: RegExp;
  importance: number;
  signal: string;
}> = [
  {
    category: "acceptance_test",
    pattern: /\b(acceptance test|expected:|when i ask .{3,80}(she|he|it|emery|jarvis) should)\b/i,
    importance: 4,
    signal: "acceptance",
  },
  {
    category: "constraint",
    pattern:
      /\b(never|must not|don'?t ever|do not ever|under no circumstances|always protect|not allowed to)\b/i,
    importance: 5,
    signal: "constraint",
  },
  {
    category: "product_decision",
    pattern:
      /\b(decision:|i('ve| have)? decided|we('re| are) going with|from now on|going forward|instead of|replace .{2,40} with|keep using|newest decision)\b/i,
    importance: 5,
    signal: "decision",
  },
  {
    category: "failure_signal",
    pattern:
      /\b(keeps? (failing|breaking)|is broken|doesn'?t work|didn'?t work|still (fails|broken)|bug|regress(ed|ion)|frustrat\w*|annoying)\b/i,
    importance: 4,
    signal: "failure",
  },
  {
    category: "workflow_requirement",
    pattern: /\b(should be able to|needs? to (be able to|work)|must (work|be able)|workflow)\b/i,
    importance: 4,
    signal: "workflow",
  },
  {
    category: "user_preference",
    pattern: /\b(i (prefer|like|love|hate|want|don'?t want|need)|i'?d rather)\b/i,
    importance: 4,
    signal: "preference",
  },
  {
    category: "lesson",
    pattern: /\b(lesson( learned)?|we learned|learned that|next time)\b/i,
    importance: 3,
    signal: "lesson",
  },
  {
    category: "research_reference",
    pattern: /https?:\/\/(github\.com|[\w.-]*docs?[\w.-]*|supabase\.com|lovable\.dev)\S*/i,
    importance: 3,
    signal: "reference",
  },
];

function sentences(text: string) {
  return String(text ?? "")
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+(?=[A-Z"'(])/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 12 && s.length <= 600);
}

export function titleFor(sentence: string) {
  const cleaned = sentence
    .replace(/^(jarvis|emery)[,:]?\s*/i, "")
    .replace(
      /^(decision:|from now on,?|going forward,?|i (want|prefer|like|need)( you)? (to )?)/i,
      "",
    )
    .trim();
  const words = cleaned.split(/\s+/).slice(0, 9).join(" ");
  return (words.charAt(0).toUpperCase() + words.slice(1)).replace(/[.,;:!?]+$/, "").slice(0, 90);
}

/**
 * Deterministic extraction. `requireEngineeringSubject` is used for Emery's main
 * conversation, where only engineering/product statements should become JARVIS
 * knowledge; inside the JARVIS room everything Adam says is engineering context.
 */
export function extractKnowledgeCandidates(
  text: string,
  opts: { requireEngineeringSubject?: boolean } = {},
): KnowledgeCandidate[] {
  const out: KnowledgeCandidate[] = [];
  const seen = new Set<string>();
  for (const sentence of sentences(text)) {
    if (sentence.endsWith("?") && !/\b(should|must|never)\b/i.test(sentence)) continue;
    if (sensitiveReason(sentence)) continue;
    if (opts.requireEngineeringSubject && !ENGINEERING_SUBJECT.test(sentence)) continue;
    const rule = RULES.find((entry) => entry.pattern.test(sentence));
    if (!rule) continue;
    const key = `${rule.category}:${sentence.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      category: rule.category,
      title: titleFor(sentence),
      content: sentence,
      importance: rule.importance,
      signal: rule.signal,
    });
    if (out.length >= 5) break;
  }
  return out;
}

/** Topic key used to find an older item a new decision supersedes. */
export function topicKey(text: string) {
  return tokenize(text).slice(0, 6).sort().join(" ");
}

export function findSuperseded(
  existing: KnowledgeItem[],
  candidate: Pick<KnowledgeCandidate, "category" | "title" | "content">,
  explicitTitle?: string | null,
) {
  const current = existing.filter((item) => item.status === "current");
  if (explicitTitle) {
    const wanted = explicitTitle.trim().toLowerCase();
    return current.find((item) => item.title.trim().toLowerCase() === wanted) ?? null;
  }
  if (!["product_decision", "user_preference", "constraint"].includes(candidate.category))
    return null;
  const tokens = new Set(tokenize(`${candidate.title} ${candidate.content}`));
  let best: { item: KnowledgeItem; overlap: number } | null = null;
  for (const item of current) {
    if (item.category !== candidate.category) continue;
    const other = tokenize(`${item.title} ${item.content}`);
    const overlap =
      other.filter((t) => tokens.has(t)).length /
      Math.max(4, Math.min(tokens.size, new Set(other).size));
    if (overlap >= 0.6 && (!best || overlap > best.overlap)) best = { item, overlap };
  }
  return best?.item ?? null;
}

export function isDuplicateKnowledge(
  existing: KnowledgeItem[],
  candidate: Pick<KnowledgeCandidate, "content">,
) {
  const normalized = candidate.content.trim().toLowerCase().replace(/\s+/g, " ");
  return existing.some(
    (item) => item.content.trim().toLowerCase().replace(/\s+/g, " ") === normalized,
  );
}
