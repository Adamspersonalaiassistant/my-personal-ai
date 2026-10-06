// Emery/JARVIS response formatting: the renderer must never show raw markdown
// tokens, must keep structure, and must stay safe and phone-friendly.
import assert from "node:assert/strict";
import {
  inlineText,
  parseAssistantText,
  parseInline,
  toSpeakable,
} from "../src/lib/assistant-format.ts";
import {
  EMERY_TYPED_FORMAT_POLICY,
  JARVIS_TYPED_FORMAT_POLICY,
  RESPONSE_FORMAT_POLICY,
  VOICE_RESPONSE_POLICY,
} from "../src/lib/response-format-policy.ts";

let passed = 0;
async function check(name, fn) {
  await fn();
  passed += 1;
  console.log(`✓ ${name}`);
}

const visible = (blocks) =>
  blocks.map((b) => (b.type === "code" ? b.text : inlineText(b.inline))).join("\n");

await check(
  "typical model markdown renders as structure with no visible ## / ** / __ tokens",
  () => {
    const raw = [
      "## Current status",
      "",
      "**Production**",
      "- Live on `bb0ca62`",
      "- GitHub and production are __aligned__",
      "",
      "### Worker",
      "1. **Healthy** — 3 tasks running",
      "2. No failures",
      "",
      "Release #24 first. Keep *#25* isolated.",
    ].join("\n");
    const blocks = parseAssistantText(raw);
    assert.deepEqual(
      blocks.map((b) => b.type),
      ["title", "title", "bullet", "bullet", "title", "numbered", "numbered", "paragraph"],
    );
    const text = visible(blocks);
    for (const token of ["##", "**", "__", "###"]) assert.ok(!text.includes(token), token);
    assert.equal(inlineText(blocks[0].inline), "Current status");
    assert.equal(blocks[5].n, 1);
    assert.equal(blocks[5].inline[0].kind, "strong");
    assert.ok(blocks[2].inline.some((p) => p.kind === "code" && p.text === "bb0ca62"));
    assert.equal(inlineText(blocks[7].inline), "Release #24 first. Keep #25 isolated.");
  },
);

await check("deep nesting flattens to at most one indent level (phone readability)", () => {
  const blocks = parseAssistantText("- a\n  - b\n      - c\n- d");
  assert.deepEqual(
    blocks.map((b) => b.depth),
    [0, 1, 1, 0],
  );
});

await check("wide tables become one readable bullet per row", () => {
  const blocks = parseAssistantText(
    "| PR | State | CI |\n| --- | --- | --- |\n| #13 | draft | pass |\n| #14 | draft | pass |",
  );
  assert.deepEqual(
    blocks.map((b) => b.type),
    ["bullet", "bullet"],
  );
  assert.equal(inlineText(blocks[0].inline), "#13 · State: draft · CI: pass");
  assert.ok(!visible(blocks).includes("|"));
});

await check("code fences, commits, paths and identifiers keep code formatting", () => {
  const blocks = parseAssistantText(
    "Run this:\n```\nbun run validate:jarvis\n```\nThen check `src/lib/jarvis/voice.ts`.",
  );
  assert.equal(blocks[1].type, "code");
  assert.equal(blocks[1].text, "bun run validate:jarvis");
  assert.ok(blocks[2].inline.some((p) => p.kind === "code"));
});

await check("links are http(s) only; anything else stays literal text (no injection)", () => {
  const safe = parseInline("[PR](https://github.com/o/r/pull/16)");
  assert.deepEqual(safe, [{ kind: "link", text: "PR", href: "https://github.com/o/r/pull/16" }]);
  const unsafe = parseInline("[x](javascript:alert(1)) <img src=x onerror=alert(1)>");
  assert.ok(unsafe.every((p) => p.kind === "text"));
});

await check("identifiers with underscores and arithmetic asterisks are not mangled", () => {
  assert.equal(inlineText(parseInline("snake_case_name and 2*3*4")), "snake_case_name and 2*3*4");
  assert.equal(
    inlineText(parseInline("set accent_intensity to 0.4")),
    "set accent_intensity to 0.4",
  );
});

await check("plain conversational text is untouched (Emery's normal replies)", () => {
  const raw = "Morning, Adam. You've got three things today.\nThe first is the 10am call.";
  const blocks = parseAssistantText(raw);
  assert.equal(blocks.length, 1);
  assert.equal(
    inlineText(blocks[0].inline),
    "Morning, Adam. You've got three things today. The first is the 10am call.",
  );
});

await check("toSpeakable removes every markdown token for Voice", () => {
  const spoken = toSpeakable(
    "## Status\n**Production** is live on `bb0ca62`.\n- Worker healthy\n1. Next: review PR #14",
  );
  for (const token of ["#", "**", "`", "- "])
    assert.ok(!spoken.includes(token + " ") || token === "#", token);
  assert.ok(!spoken.includes("**") && !spoken.includes("`") && !spoken.includes("## "));
  assert.match(
    spoken,
    /^Status\.\nProduction is live on bb0ca62\.\nWorker healthy\n1\. Next: review PR #14$/,
  );
});

await check("one shared format policy feeds both assistants, with distinct personalities", () => {
  for (const policy of [EMERY_TYPED_FORMAT_POLICY, JARVIS_TYPED_FORMAT_POLICY])
    assert.ok(policy.includes(RESPONSE_FORMAT_POLICY));
  assert.match(RESPONSE_FORMAT_POLICY, /numbered/i);
  assert.match(RESPONSE_FORMAT_POLICY, /no emoji/i);
  assert.match(EMERY_TYPED_FORMAT_POLICY, /warm/i);
  assert.match(JARVIS_TYPED_FORMAT_POLICY, /technical/i);
  assert.match(VOICE_RESPONSE_POLICY, /1.?4/);
});

console.log(`\nResponse format validation: ${passed} checks passed.`);
