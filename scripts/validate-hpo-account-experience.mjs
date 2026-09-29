import fs from "node:fs";

const read = (path) => fs.readFileSync(path, "utf8");
const detail = read("src/components/HpoAccountFieldDetail.tsx");
const sheet = read("src/components/HpoEmerySheet.tsx");
const voiceControl = read("src/components/EmeryVoiceControl.tsx");
const voiceFns = read("src/lib/voice.functions.ts");
const emeryFns = read("src/lib/emery.functions.ts");
const controller = read("src/lib/hpo-action-controller.ts");

const checks = [
  [detail.includes('z-[150]'), "account detail must sit above app navigation"],
  [detail.includes("flex h-[100dvh]") && detail.includes("min-h-0 flex-1 overflow-y-auto"), "account detail must use a fixed shell with one internal scroll region"],
  [detail.includes("Edit with Emery"), "account detail must expose the Emery edit experience"],
  [/hpoAccountId=\{accountId\}/.test(detail), "account detail voice must bind the selected account"],
  [sheet.includes('z-[180]'), "HPO Emery sheet must layer above account detail"],
  [controller.includes('"update_account"'), "HPO action controller must support update_account"],
  [controller.includes("selectedAccountId?: string | null"), "HPO action controller must accept selected account context"],
  [controller.includes("Every unrequested update field must be null"), "HPO account editing must be explicit-field-only"],
  [emeryFns.includes("selectedAccountId: data.source.selectedAccountId ?? null"), "text Emery must pass selected account context"],
  [voiceFns.includes("accountId?: string | null"), "voice HPO action input must accept selected account context"],
  [voiceFns.includes("selectedAccountId: data.accountId ?? null"), "voice server action must pass selected account context"],
  [voiceControl.includes("accountId: hpoAccountId ?? null"), "realtime voice tool call must pass selected account context"],
];

const failures = checks.filter(([ok]) => !ok).map(([, message]) => message);
if (failures.length) {
  console.error("HPO account experience validation failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
console.log("HPO account experience validation PASS");
