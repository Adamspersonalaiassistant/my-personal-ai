// Focused candidate verification for JARVIS branches (run in GitHub Actions).
// Emits GitHub annotations so the JARVIS worker can read failures through the
// Checks API and perform bounded repair. Exit code 1 = candidate not verified.
import { spawnSync } from "node:child_process";

const STEPS = [
  { name: "typecheck", cmd: "npx", args: ["tsc", "--noEmit", "-p", "."] },
  { name: "validate:jarvis", cmd: "npm", args: ["run", "-s", "validate:jarvis"] },
  { name: "validate:phase0", cmd: "npm", args: ["run", "-s", "validate:phase0"] },
  { name: "validate:behavior", cmd: "npm", args: ["run", "-s", "validate:behavior"] },
  { name: "build", cmd: "npm", args: ["run", "-s", "build"] },
];

const escape = (text) => String(text).replace(/%/g, "%25").replace(/\r/g, "").replace(/\n/g, "%0A");
let failed = 0;
let annotations = 0;

for (const step of STEPS) {
  const started = Date.now();
  const run = spawnSync(step.cmd, step.args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  const output = `${run.stdout ?? ""}\n${run.stderr ?? ""}`;
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  if (run.status === 0) {
    console.log(`PASS ${step.name} (${seconds}s)`);
    continue;
  }
  failed += 1;
  console.log(`FAIL ${step.name} (${seconds}s)\n${output.slice(-6000)}`);
  if (step.name === "typecheck") {
    // file(line,col): error TS1234: message
    for (const match of output.matchAll(/^(.+?)\((\d+),(\d+)\): error (TS\d+): (.+)$/gm)) {
      if (annotations >= 40) break;
      annotations += 1;
      console.log(
        `::error file=${match[1]},line=${match[2]},col=${match[3]},title=${match[4]}::${escape(match[5])}`,
      );
    }
  }
  const tail = output.trim().split("\n").filter(Boolean).slice(-15).join("\n");
  console.log(`::error title=jarvis-candidate ${step.name} failed::${escape(tail.slice(-1800))}`);
}

if (failed) {
  console.log(`JARVIS candidate check: ${failed} step(s) failed.`);
  process.exit(1);
}
console.log(
  "::notice title=jarvis-candidate::All candidate checks passed (typecheck, validate:jarvis, validate:phase0, validate:behavior, build).",
);
