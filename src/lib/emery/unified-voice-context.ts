/* eslint-disable @typescript-eslint/no-explicit-any */
import { loadHpoAgentContext } from "@/lib/hpo-agent-context";
import { buildExecutiveFocus, readConversationState } from "@/lib/emery-intelligence";
import { buildSmartMemoryPrompt, retrieveSmartMemories } from "./smart-memory.ts";
import { prepareVoiceRequest, type VoiceUiContext } from "./voice-request-context.ts";

export async function loadUnifiedVoiceContext(input: {
  db: any;
  userId: string;
  query: string;
  conversation: { id: string; metadata?: unknown };
  ui?: VoiceUiContext | null;
}) {
  const prepared = await prepareVoiceRequest({
    db: input.db,
    userId: input.userId,
    message: input.query,
    conversationId: input.conversation.id,
    ui: input.ui ?? null,
  });
  const loadPolicy = prepared.routing.loadPolicy;
  const now = new Date().toISOString();

  const [
    profileResult,
    memoryResult,
    voiceResult,
    configResult,
    taskResult,
    projectResult,
    meetingResult,
    recentResult,
  ] = await Promise.all([
    input.db
      .from("profiles")
      .select("display_name, assistant_name, timezone, profile_summary")
      .eq("user_id", input.userId)
      .maybeSingle(),
    loadPolicy.loadPersonalMemory
      ? input.db
          .from("memories")
          .select(
            "id,title,content,memory_type,importance,confidence,source_type,source_ref,person_id,project_id,metadata,expires_at,created_at,updated_at",
          )
          .eq("user_id", input.userId)
          .order("importance", { ascending: false })
          .order("updated_at", { ascending: false })
          .limit(120)
      : Promise.resolve({ data: [] }),
    input.db
      .from("voice_profiles")
      .select(
        "base_voice_id,stable_identity,delivery_preferences,contextual_preferences,pronunciation_preferences,provider_capabilities,approved_at,version",
      )
      .eq("user_id", input.userId)
      .maybeSingle(),
    input.db
      .from("emery_config")
      .select("response_verbosity,memory_max_items,memory_max_characters,proactive_focus_enabled")
      .eq("user_id", input.userId)
      .maybeSingle(),
    loadPolicy.loadCalendarContext
      ? input.db
          .from("tasks")
          .select(
            "id,title,details,status,priority,due_at,scheduled_start_at,scheduled_end_at,reminder_at,estimated_minutes,metadata,project_id",
          )
          .eq("user_id", input.userId)
          .neq("status", "completed")
          .order("priority", { ascending: false })
          .limit(12)
      : Promise.resolve({ data: [] }),
    loadPolicy.loadCalendarContext
      ? input.db
          .from("projects")
          .select("id,name,description,status,priority,goal,next_action")
          .eq("user_id", input.userId)
          .eq("status", "active")
          .order("priority", { ascending: false })
          .limit(8)
      : Promise.resolve({ data: [] }),
    loadPolicy.loadCalendarContext
      ? input.db
          .from("meetings")
          .select("id,title,meeting_at,end_at,participants,metadata")
          .eq("user_id", input.userId)
          .gte("meeting_at", now)
          .order("meeting_at", { ascending: true })
          .limit(8)
      : Promise.resolve({ data: [] }),
    input.db
      .from("conversation_messages")
      .select("role,content,created_at")
      .eq("user_id", input.userId)
      .eq("conversation_id", input.conversation.id)
      .in("role", ["user", "assistant"])
      .order("created_at", { ascending: false })
      .limit(16),
  ]);

  const recent = (recentResult.data ?? []).reverse().map((row: any) => ({
    role: row.role as "user" | "assistant",
    text: String(row.content ?? ""),
    createdAt: row.created_at as string,
  }));

  const memoryMaxItems = Math.min(
    20,
    Math.max(4, Number(configResult.data?.memory_max_items ?? 12)),
  );
  const memoryMaxCharacters = Math.min(
    10000,
    Math.max(1600, Number(configResult.data?.memory_max_characters ?? 5200)),
  );
  const memoryContext = loadPolicy.loadPersonalMemory
    ? await retrieveSmartMemories({
        apiKey: process.env["OPENAI_API_KEY"] ?? null,
        memories: memoryResult.data ?? [],
        query: input.query,
        recent,
        maxItems: memoryMaxItems,
        maxCharacters: memoryMaxCharacters,
        allowSemantic: true,
      })
    : {
        selected: [],
        digest: null,
        strategy: "none" as const,
        semanticUsed: false,
        candidateCount: 0,
        selectedCharacters: 0,
        semanticConfidence: null,
      };

  const voiceTasks = taskResult.data ?? [];
  const nowMs = Date.now();
  const actions = {
    tasks: voiceTasks,
    task_pool: voiceTasks.filter((task: any) => !task.scheduled_start_at),
    scheduled_tasks: voiceTasks.filter((task: any) => Boolean(task.scheduled_start_at)),
    overdue_tasks: voiceTasks.filter((task: any) => task.due_at && Date.parse(task.due_at) < nowMs),
    missed_time_blocks: voiceTasks.filter((task: any) => {
      const end = task.scheduled_end_at ?? task.scheduled_start_at;
      return end && Date.parse(end) < nowMs;
    }),
    projects: projectResult.data ?? [],
    meetings: meetingResult.data ?? [],
  };

  const hpoContext = loadPolicy.loadHpoOperatingContext
    ? await loadHpoAgentContext(input.db, input.userId, input.query).catch(() => null)
    : null;

  return {
    conversation: input.conversation,
    route: {
      domain: prepared.routing.capabilityRoute.domain,
      reason: prepared.routing.capabilityRoute.reason,
    },
    currentContext: prepared.currentContext,
    capabilityRoute: prepared.routing.capabilityRoute,
    actionPlan: prepared.routing.actionPlan,
    loadPolicy,
    profile: profileResult.data ?? null,
    voiceProfile: voiceResult.data ?? null,
    config: configResult.data ?? null,
    memories: memoryContext.selected,
    memoryContext,
    memoryPrompt: buildSmartMemoryPrompt(memoryContext),
    actions,
    focus: buildExecutiveFocus(actions),
    recent,
    hpoContext,
    workingState: readConversationState(input.conversation.metadata),
  };
}
