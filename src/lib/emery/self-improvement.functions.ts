/* eslint-disable @typescript-eslint/no-explicit-any */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { runCanonicalEmeryEvaluations } from "./evaluation-runner.ts";
import { buildSelfImprovementReport } from "./self-improvement.ts";

export const getEmerySelfImprovementReport = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const db = context.supabase as any;
    const { data: runtimeEvents, error } = await db
      .from("emery_runtime_events")
      .select("id,channel,event_type,domain,action,status,duration_ms,model,metadata,created_at")
      .eq("user_id", context.userId)
      .order("created_at", { ascending: false })
      .limit(500);

    if (error) {
      return {
        error: "Emery could not load recent runtime evaluation history.",
        report: null,
      } as const;
    }

    const canonical = runCanonicalEmeryEvaluations();
    const report = buildSelfImprovementReport({
      runtimeEvents: runtimeEvents ?? [],
      canonicalSignals: canonical.signals,
    });

    return {
      report,
      canonical: {
        corpusVersion: canonical.corpusVersion,
        cases: canonical.cases,
        summary: canonical.summary,
      },
      readOnly: true,
      autonomousProductionChangesAllowed: false,
    } as const;
  });
