import assert from "node:assert/strict";
import {
  AMBIENT_CONTEXT_WINDOW_MS,
  appendAmbientSnippet,
  ambientUserRequest,
  buildAmbientResponseInstructions,
  deleteRealtimeAmbientItems,
  isAmbientAddressedTurn,
  pruneAmbientSnippets,
  requestRealtimeAmbientResponse,
  setRealtimeAmbientMode,
} from "../src/lib/emery/ambient-context.ts";

const now = 500_000;
const old = {
  itemId: "old-item",
  text: "Old nearby discussion that must expire.",
  heardAt: now - AMBIENT_CONTEXT_WINDOW_MS - 1,
};
const recent = {
  itemId: "recent-item",
  text: "We were comparing whether to visit Macri or another office first.",
  heardAt: now - 15_000,
};

const pruned = pruneAmbientSnippets([old, recent], now);
assert.deepEqual(pruned.expiredItemIds, ["old-item"]);
assert.deepEqual(pruned.active.map((item) => item.itemId), ["recent-item"]);

const appended = appendAmbientSnippet(
  pruned.active,
  { itemId: "new-item", text: "  The front desk said the attorney may be free later.  ", heardAt: now },
  now,
);
assert.equal(appended.active.length, 2);
assert.equal(appended.active[1]?.text, "The front desk said the attorney may be free later.");

assert(isAmbientAddressedTurn("Emery, what do you think?"));
assert(isAmbientAddressedTurn("Hey Emery should I go to Macri first?"));
assert(isAmbientAddressedTurn("What do you think, Emery?"));
assert(!isAmbientAddressedTurn("I think Emery is a good name for the app."));
assert.equal(ambientUserRequest("Emery, what do you think?"), "what do you think?");

const instructions = buildAmbientResponseInstructions({
  snippets: appended.active,
  currentTurn: "Emery, what do you think?",
  now,
});
assert(instructions.includes("in-memory only"));
assert(instructions.includes("Never save"));
assert(instructions.includes("Only the CURRENT ADDRESSED REQUEST"));
assert(instructions.includes("Macri"));
assert(!instructions.includes("Old nearby discussion"));

const sent = [];
const channel = {
  readyState: "open",
  send(payload) {
    sent.push(JSON.parse(payload));
  },
};

assert(setRealtimeAmbientMode(channel, true));
assert.equal(sent.at(-1)?.type, "session.update");
assert.equal(sent.at(-1)?.session?.audio?.input?.turn_detection?.create_response, false);
assert.equal(sent.at(-1)?.session?.audio?.input?.turn_detection?.interrupt_response, true);

assert(requestRealtimeAmbientResponse(channel, instructions));
assert.equal(sent.at(-1)?.type, "response.create");
assert(sent.at(-1)?.response?.instructions?.includes("TEMPORARY AMBIENT CONTEXT"));

const deleted = deleteRealtimeAmbientItems(channel, ["old-item", "old-item", "recent-item"]);
assert.equal(deleted, 2);
assert.equal(sent.filter((event) => event.type === "conversation.item.delete").length, 2);

assert(setRealtimeAmbientMode(channel, false));
assert.equal(sent.at(-1)?.session?.audio?.input?.turn_detection?.create_response, true);

console.log("Emery Phase 6 ambient context foundation validation passed.");
