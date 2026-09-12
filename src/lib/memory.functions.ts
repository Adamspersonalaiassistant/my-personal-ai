import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const MEMORY_TYPES = new Set([
  "core",
  "goal",
  "preference",
  "relationship",
  "routine",
  "responsibility",
  "working_preference",
  "decision",
  "constraint",
  "project_context",
]);

export const updateSavedMemory = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: {
      id: string;
      title?: string | null;
      content: string;
      memoryType: string;
      importance: number;
    }) => {
      const id = String(input?.id ?? "").trim();
      const content = String(input?.content ?? "").trim();
      const memoryType = String(input?.memoryType ?? "core").trim();
      const importance = Math.min(5, Math.max(1, Number(input?.importance ?? 3)));
      const title =
        String(input?.title ?? "")
          .trim()
          .slice(0, 160) || null;
      if (!id) throw new Error("Memory id is required");
      if (!content) throw new Error("Memory content is required");
      if (content.length > 2000) throw new Error("Memory content is too long");
      if (!MEMORY_TYPES.has(memoryType)) throw new Error("Unsupported memory type");
      return { id, title, content, memoryType, importance };
    },
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: memory, error } = await supabase
      .from("memories")
      .update({
        title: data.title,
        content: data.content,
        memory_type: data.memoryType,
        importance: data.importance,
        confidence: 1,
        source_type: "manual_correction",
        updated_at: new Date().toISOString(),
      })
      .eq("id", data.id)
      .eq("user_id", userId)
      .select("id, title, content, memory_type, importance, created_at, updated_at")
      .maybeSingle();

    if (error) throw error;
    if (!memory) throw new Error("Memory not found");
    return { memory };
  });

export const deleteSavedMemory = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string }) => {
    const id = String(input?.id ?? "").trim();
    if (!id) throw new Error("Memory id is required");
    return { id };
  })
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { error } = await supabase
      .from("memories")
      .delete()
      .eq("id", data.id)
      .eq("user_id", userId);
    if (error) throw error;
    return { ok: true };
  });
