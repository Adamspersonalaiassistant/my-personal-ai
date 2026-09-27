import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { EMERY_EXECUTION_CAPABILITIES } from "@/lib/execution-capabilities";

export const getExecutionHealth = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const db = context.supabase as any;
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const { data, error } = await db
      .from("emery_execution_runs")
      .select(
        "id,domain,action,status,target_type,target_id,result_payload,error_code,error_message,retryable,created_at,completed_at,parent_run_id",
      )
      .eq("user_id", context.userId)
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(40);
    if (error) throw error;

    const runs = data ?? [];
    const topLevel = runs.filter((run: any) => !run.parent_run_id);
    return {
      counts: {
        completed: topLevel.filter((run: any) => run.status === "completed").length,
        failed: topLevel.filter((run: any) => run.status === "failed").length,
        clarification: topLevel.filter((run: any) => run.status === "needs_clarification").length,
        running: topLevel.filter((run: any) => ["requested", "validated", "running"].includes(run.status)).length,
      },
      recent: topLevel.slice(0, 10),
      capabilities: EMERY_EXECUTION_CAPABILITIES,
    };
  });
