import { runCanonicalEmeryEvaluations } from "../src/lib/emery/evaluation-runner.ts";

const result = runCanonicalEmeryEvaluations();
const output = {
  corpusVersion: result.corpusVersion,
  cases: result.cases,
  summary: result.summary,
  failures: result.signals
    .filter((signal) => !signal.passed)
    .map((signal) => ({
      id: signal.id ?? null,
      category: signal.category,
      request: signal.request ?? null,
      expected: signal.expected ?? null,
      observed: signal.observed ?? null,
      severity: signal.severity,
    })),
};

console.log(JSON.stringify(output, null, 2));
process.exitCode = result.summary.failed > 0 ? 1 : 0;
