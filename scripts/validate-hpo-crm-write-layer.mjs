import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  findHpoDuplicateMatches,
  isNewerIso,
  normalizeHpoAddress,
  normalizeHpoPhone,
  normalizeHpoProspectName,
  normalizeHpoWebsite,
  sanitizeHpoMetadata,
} from "../src/lib/hpo-prospect-write.core.ts";

assert.equal(normalizeHpoProspectName("Smith & Jones, LLP"), "smith and jones");
assert.equal(normalizeHpoAddress("10 Main Street, Suite 200"), "10 main st");
assert.equal(normalizeHpoPhone("+1 (201) 555-1212"), "2015551212");
assert.equal(normalizeHpoWebsite("https://www.Example.com/team"), "example.com");

const exact = findHpoDuplicateMatches(
  {
    name: "Smith and Jones",
    address: "10 Main St #200",
    city: "Clifton",
    phone: "201-555-1212",
    website: "https://example.com",
  },
  [
    {
      id: "candidate-1",
      entity: "prospect",
      name: "Smith & Jones LLP",
      address: "10 Main Street, Suite 200",
      city: "Clifton",
      phone: "(201) 555-1212",
      website: "https://www.example.com/team",
    },
  ],
);
assert.equal(exact[0]?.confidence, "strong");
assert.ok(exact[0]?.reasons.includes("physical_address"));
assert.ok(exact[0]?.reasons.includes("website_domain"));

const reviewOnly = findHpoDuplicateMatches({ name: "Hudson Medical", city: "Newark" }, [
  { id: "candidate-2", entity: "account", name: "Hudson Medical PC", city: "Newark" },
]);
assert.equal(reviewOnly[0]?.confidence, "review");
assert.equal(isNewerIso("2026-09-29T13:00:00.000Z", "2026-09-28T13:00:00.000Z"), true);
assert.deepEqual(sanitizeHpoMetadata({ safe: true, __proto__: "blocked" }), { safe: true });

const serverSource = await readFile(
  new URL("../src/lib/hpo-prospect-write.functions.ts", import.meta.url),
  "utf8",
);
for (const operation of [
  "findHpoProspectDuplicates",
  "createVerifiedHpoProspect",
  "updateHpoProspectVerification",
  "updateVerifiedHpoProspectFacts",
  "rejectHpoProspect",
  "mergeHpoProspects",
  "linkHpoProspectLocationToAccount",
  "promoteHpoProspectToAccount",
]) {
  const start = serverSource.indexOf(`export const ${operation}`);
  assert.ok(start >= 0, `${operation} must be exported`);
  const boundary = serverSource.indexOf("export const ", start + 20);
  const block = serverSource.slice(start, boundary < 0 ? undefined : boundary);
  assert.match(block, /\.middleware\(\[requireSupabaseAuth\]\)/, `${operation} must enforce auth`);
  assert.match(block, /context\.userId/, `${operation} must derive ownership from auth context`);
}
assert.doesNotMatch(serverSource, /userId:\s*z\./, "Client-controlled userId input is forbidden");
assert.doesNotMatch(serverSource, /service_role|serviceRole/, "Service-role access is forbidden");

console.log("HPO controlled CRM write validation passed.");
