import { isAmbientAddressedTurn } from "./ambient-context.ts";
import { routeEmeryCapabilities } from "./capability-router.ts";
import {
  EMERY_CANONICAL_EVAL_CORPUS,
  type EmeryCanonicalEvalCase,
} from "./evaluation-corpus.ts";
import {
  createEvaluationSignal,
  summarizeEvaluationSignals,
  type EmeryEvaluationSignal,
} from "./evaluation.ts";
import { createEmptyRequestContext, type EmerySurface } from "./orchestration.types.ts";
import { classifyVoiceTurn } from "./voice-conversation-policy.ts";

function contextForCase(test: EmeryCanonicalEvalCase) {
  const hpo = Boolean(test.surface?.startsWith("hpo_"));
  return createEmptyRequestContext({
    userId: "emery-eval-user",
    timezone: "America/New_York",
    entryPoint: test.channel,
    inputMode: test.channel === "voice" ? "voice" : "typed",
    surface: (test.surface ?? "chat") as EmerySurface,
    hpoTab: test.surface?.startsWith("hpo_")
      ? ((test.surface.replace("hpo_", "") || "planner") as any)
      : null,
    currentRouteId: hpo ? "eval-route" : null,
    currentStopId: hpo ? "eval-stop" : null,
    selectedAccountId: hpo ? "eval-account" : null,
    fieldSessionId: hpo ? "eval-field-session" : null,
    recentReceiptIds: hpo ? ["eval-receipt"] : [],
    location: test.expected.needsLocation
      ? { latitude: 40.6639, longitude: -74.2107, accuracyMeters: 20 }
      : null,
  });
}

function signal(input: {
  test: EmeryCanonicalEvalCase;
  category: EmeryEvaluationSignal["category"];
  passed: boolean;
  expected: unknown;
  observed: unknown;
  severity?: EmeryEvaluationSignal["severity"];
}) {
  return createEvaluationSignal({
    id: `${input.test.id}:${input.category}`,
    category: input.category,
    passed: input.passed,
    severity: input.severity ?? (input.passed ? "info" : "high"),
    source: "canonical_eval",
    request: input.test.prompt,
    expected: JSON.stringify(input.expected),
    observed: JSON.stringify(input.observed),
    metadata: { evalCaseId: input.test.id, channel: input.test.channel },
  });
}

export function runCanonicalEvalCase(test: EmeryCanonicalEvalCase): EmeryEvaluationSignal[] {
  const context = contextForCase(test);
  const route = routeEmeryCapabilities({
    message: test.prompt,
    context,
    domainHint: test.surface?.startsWith("hpo_") ? "hpo" : null,
  });
  const signals: EmeryEvaluationSignal[] = [];

  if (test.expected.domain) {
    signals.push(
      signal({
        test,
        category: "intent_accuracy",
        passed: route.domain === test.expected.domain,
        expected: test.expected.domain,
        observed: route.domain,
      }),
    );
  }

  if (test.expected.capability) {
    signals.push(
      signal({
        test,
        category: "capability_selection",
        passed: route.candidateCapabilities.includes(test.expected.capability as any),
        expected: test.expected.capability,
        observed: route.candidateCapabilities,
      }),
    );
  }

  const contextExpectations: Array<
    [keyof Pick<
      typeof test.expected,
      "needsCurrentContext" | "needsPersonalMemory" | "needsCalendar" | "needsLocation"
    >,
    boolean | undefined,
    boolean]
  > = [
    ["needsCurrentContext", test.expected.needsCurrentContext, route.needsCurrentContext],
    ["needsPersonalMemory", test.expected.needsPersonalMemory, route.needsPersonalMemory],
    ["needsCalendar", test.expected.needsCalendar, route.needsCalendar],
    ["needsLocation", test.expected.needsLocation, route.needsLocation],
  ];
  for (const [key, expected, observed] of contextExpectations) {
    if (typeof expected !== "boolean") continue;
    signals.push(
      signal({
        test,
        category: key === "needsPersonalMemory" ? "memory_retrieval" : "context_accuracy",
        passed: observed === expected,
        expected: { [key]: expected },
        observed: { [key]: observed },
      }),
    );
  }

  if (test.expected.voiceDisposition) {
    const observed = classifyVoiceTurn({
      transcript: test.prompt,
      now: 10_000,
      followUpUntil: 20_000,
      lastAssistantTranscript: "Macri Law is next, about twelve minutes away.",
      lastAssistantAt: 8_000,
    });
    signals.push(
      signal({
        test,
        category:
          test.expected.voiceDisposition === "correction"
            ? "voice_correction"
            : "intent_accuracy",
        passed: observed === test.expected.voiceDisposition,
        expected: test.expected.voiceDisposition,
        observed,
      }),
    );
  }

  if (typeof test.expected.ambientAddressed === "boolean") {
    const observed = isAmbientAddressedTurn(test.prompt);
    signals.push(
      signal({
        test,
        category: "context_accuracy",
        passed: observed === test.expected.ambientAddressed,
        expected: test.expected.ambientAddressed,
        observed,
      }),
    );
  }

  return signals;
}

export function runCanonicalEmeryEvaluations(
  corpus: EmeryCanonicalEvalCase[] = EMERY_CANONICAL_EVAL_CORPUS,
) {
  const signals = corpus.flatMap(runCanonicalEvalCase);
  return {
    corpusVersion: 1,
    cases: corpus.length,
    signals,
    summary: summarizeEvaluationSignals(signals),
  };
}
