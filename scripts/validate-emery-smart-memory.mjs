import assert from "node:assert/strict";
import fs from "node:fs";
import {
  buildSmartMemoryPrompt,
  retrieveSmartMemories,
  scoreSmartMemory,
} from "../src/lib/emery/smart-memory.ts";
import { rankHpoRelationshipAccounts } from "../src/lib/emery/hpo-smart-relevance.ts";

const now = Date.now();
const isoDaysAgo = (days) => new Date(now - days * 86_400_000).toISOString();

const memories = [
  {
    id: "relationship-spouse",
    title: "Family",
    content: "Adam's spouse is Denice and they make major household plans together.",
    memory_type: "relationship",
    importance: 5,
    confidence: 1,
    source_type: "explicit_user",
    updated_at: isoDaysAgo(20),
  },
  {
    id: "manual-preference",
    title: "Response preference",
    content: "Adam prefers concise step-by-step plans for implementation work.",
    memory_type: "preference",
    importance: 4,
    confidence: 1,
    source_type: "manual_correction",
    updated_at: isoDaysAgo(5),
  },
  {
    id: "weak-inference",
    title: "Possible response preference",
    content: "Adam prefers concise step-by-step plans for implementation work.",
    memory_type: "preference",
    importance: 4,
    confidence: 0.6,
    source_type: "assistant_inference",
    metadata: { inferred: true },
    updated_at: isoDaysAgo(1),
  },
  {
    id: "secret",
    title: "API key",
    content: "The API key is sk-test-secret-value.",
    memory_type: "core",
    importance: 5,
    confidence: 1,
    source_type: "explicit_user",
    updated_at: isoDaysAgo(1),
  },
  {
    id: "expired",
    title: "Temporary plan",
    content: "Use the temporary old apartment plan next week.",
    memory_type: "project_context",
    importance: 5,
    confidence: 1,
    source_type: "explicit_user",
    expires_at: isoDaysAgo(2),
    updated_at: isoDaysAgo(10),
  },
  {
    id: "irrelevant-high",
    title: "Favorite dessert",
    content: "Adam likes fudgy brownies.",
    memory_type: "preference",
    importance: 5,
    confidence: 1,
    source_type: "explicit_user",
    updated_at: isoDaysAgo(1),
  },
];

const family = await retrieveSmartMemories({
  memories,
  query: "What did I tell you about my wife?",
  recent: [],
  allowSemantic: false,
  maxItems: 6,
  maxCharacters: 3000,
});
assert.equal(family.strategy, "hybrid_lexical");
assert.equal(family.selected[0]?.id, "relationship-spouse");
assert(!family.selected.some((memory) => memory.id === "secret"));
assert(!family.selected.some((memory) => memory.id === "expired"));
assert(!family.selected.some((memory) => memory.id === "irrelevant-high"));

assert(
  scoreSmartMemory(memories[1], "How do I prefer implementation plans?") >
    scoreSmartMemory(memories[2], "How do I prefer implementation plans?"),
  "manual correction / explicit memory authority should outrank assistant inference",
);

const preference = await retrieveSmartMemories({
  memories,
  query: "How do I prefer implementation plans?",
  allowSemantic: false,
});
assert.equal(preference.selected[0]?.id, "manual-preference");
assert(!preference.selected.some((memory) => memory.id === "weak-inference"));

const prompt = buildSmartMemoryPrompt(preference);
assert(prompt.includes("id=manual-preference"));
assert(prompt.includes("source=manual_correction"));
assert(!prompt.includes("sk-test-secret-value"));

const hpoAccounts = [
  {
    id: "macri",
    name: "The Macri Law Firm",
    account_type: "Attorney",
    city: "Parsippany",
    priority: 3,
    relationship_stage: "prospecting",
    last_touch_at: isoDaysAgo(18),
  },
  {
    id: "other-law",
    name: "Other Injury Lawyers",
    account_type: "Attorney",
    city: "Newark",
    priority: 5,
    relationship_stage: "active",
    last_touch_at: isoDaysAgo(2),
  },
];
const hpoContacts = [
  {
    id: "macri-contact",
    account_id: "macri",
    name: "Erica",
    role_title: "Receptionist",
    relationship_notes: "Provided the paralegal contact information.",
  },
];
const hpoInteractions = [
  {
    id: "macri-touch",
    account_id: "macri",
    occurred_at: isoDaysAgo(18),
    summary: "Receptionist Erica gave the paralegal's contact information and said to email the paralegal and attorney to schedule a meeting.",
    outcome: "Strong meeting opportunity",
    relationship_signal: "positive",
    next_action: "Email paralegal and attorney",
  },
];
const hpoRank = rankHpoRelationshipAccounts({
  query: "What was that attorney where the receptionist gave me the paralegal information?",
  accounts: hpoAccounts,
  contacts: hpoContacts,
  interactions: hpoInteractions,
});
assert.equal(hpoRank[0]?.accountId, "macri");
assert(hpoRank[0]?.reasons.some((reason) => reason.includes("interaction")));

const smartSource = fs.readFileSync(
  new URL("../src/lib/emery/smart-memory.ts", import.meta.url),
  "utf8",
);
const voiceSource = fs.readFileSync(
  new URL("../src/lib/emery/unified-voice-context.ts", import.meta.url),
  "utf8",
);
const voicePromptSource = fs.readFileSync(
  new URL("../src/lib/emery/voice-context-prompt.ts", import.meta.url),
  "utf8",
);
const hpoSource = fs.readFileSync(
  new URL("../src/lib/hpo-agent-context.ts", import.meta.url),
  "utf8",
);
const chatSource = fs.readFileSync(
  new URL("../src/lib/emery.functions.ts", import.meta.url),
  "utf8",
);

assert(smartSource.includes("semanticRerank"));
assert(smartSource.includes("No relevant durable personal memory selected."));
assert(smartSource.includes("contains_phi"));
assert(smartSource.includes("manual_correction"));
assert(voiceSource.includes("retrieveSmartMemories"));
assert(voiceSource.includes("const memoryPrompt = buildSmartMemoryPrompt"));
assert(voiceSource.includes("memories: memoryContext.digest ? [] : memoryContext.selected"));
assert(voicePromptSource.includes("SMART DURABLE MEMORY CONTEXT"));
assert(voicePromptSource.includes("Structured domain truth"));
assert(hpoSource.includes("rankHpoRelationshipAccounts"));
assert(hpoSource.includes("Structured HPO CRM truth outranks personal durable memory"));

// Final Phase 5 integration gate. Normal Chat must consume the same smart-memory
// retrieval/digest as Voice instead of keeping the legacy lexical-only path.
assert(
  chatSource.includes("retrieveSmartMemories") && chatSource.includes("buildSmartMemoryPrompt"),
  "central Emery Chat must consume Phase 5 smart memory retrieval and prompt output",
);

console.log("Emery Phase 5 smart memory validation passed.");
