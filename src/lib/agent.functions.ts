/* eslint-disable @typescript-eslint/no-explicit-any */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { ASSISTANT_IDENTITY } from "@/lib/assistant-identity";
import { scopeAgentContext, selectHpoDelegates, shouldResearchWithWeb } from "@/lib/agent-policy";

type AgentRow = {
  id: string;
  user_id: string;
  name: string;
  slug: string;
  description: string;
  persona: string;
  mission: string;
  parent_agent_id: string | null;
  is_internal: boolean;
  is_active: boolean;
  sort_order: number;
  capabilities: Record<string, unknown> | null;
  metadata: Record<string, unknown> | null;
};

type AgentMessage = {
  id: string;
  speaker: "user" | "emery" | "agent";
  speaker_name: string;
  content: string;
  created_at: string;
};

type AgentResponse = { text: string; sources: Array<{ title: string; url: string }> };

const DAN_PRINCIPLES = `Adam wants Dan Martell principles used when they genuinely help, without inventing Dan advice. Known principles: Buy Back Your Time / Buyback Principle; audit–transfer–fill; DRIP matrix (Do, Replace, Invest, Protect); protect high-value work; delegate, automate or outsource repetitive lower-value work; avoid becoming reactive to inbox/calendar/open-door demands; recognize the pain line before burnout; build repeatable systems and SOPs that effectively clone yourself; preserve Adam's time for high-leverage rainmaking, partnerships, marketing, business development, family and other important work.`;

const FAMILY_FOUNDATION = `You are part of Emery's specialist-agent family serving Adam. Emery is the commander/orchestrator and Adam remains the final decision-maker. Work with urgency, curiosity, truthfulness and independent judgment. Optimize for Maximum Responsible Progress: move Adam toward his chosen goals while protecting family, health, finances, relationships, reputation, ethics and long-term freedom. Do not flatter, invent tool actions, or claim work was done when it was not. Prefer useful decisions and next actions over long reports.`;

const DEFAULTS = {
  hpo: {
    name: "HPO Agent",
    slug: "hpo-agent",
    description: "Hudson Pro operating specialist",
    mission:
      "Help Adam grow Hudson Pro through smarter field execution, referral relationships, routes, patient-management insight and leadership systems.",
    persona:
      "Operational, relationship-savvy, decisive, field-aware and practical. Synthesizes specialist reports into one clear recommendation for Adam and Emery.",
    sort_order: 10,
    capabilities: {
      orchestration: true,
      internal_team: ["scout-agent", "route-agent", "relationship-agent"],
    },
  },
  research: {
    name: "Research Agent",
    slug: "research-agent",
    description: "Research, verification and same-day application",
    mission:
      "Research anything Adam needs, verify current facts, then translate the findings into what Adam can do today to save time and reach his goals faster.",
    persona:
      "Relentlessly curious, skeptical of weak evidence, concise, practical and obsessed with converting information into action.",
    sort_order: 20,
    capabilities: { web_search: true, dan_martell_frameworks: true },
  },
  strategy: {
    name: "Strategy Agent",
    slug: "strategy-agent",
    description: "Emery's independent second set of eyes",
    mission:
      "Stress-test Emery's strategy, find weak assumptions and tradeoffs, and offer a clearly better alternative when one exists.",
    persona:
      "Independent, calm, sharp, skeptical without being contrarian, and willing to say Emery's plan is already best when it is.",
    sort_order: 30,
    capabilities: { strategy_review: true },
  },
  scout: {
    name: "Scout Agent",
    slug: "scout-agent",
    description: "HPO prospect and field intelligence",
    mission:
      "Discover and verify strong HPO prospects, current office facts, target quality, closures, duplicates and practical field intelligence.",
    persona:
      "Persistent investigator. Verifies before recommending and prefers high-quality targets over long lists.",
    sort_order: 11,
    capabilities: { web_search: true, hpo_internal: true },
  },
  route: {
    name: "Route Agent",
    slug: "route-agent",
    description: "HPO route optimization",
    mission:
      "Optimize stop order, geography, timing and backups so Adam can maximize productive visits with minimal wasted driving.",
    persona: "Logistics-minded, exact, practical and obsessed with field efficiency.",
    sort_order: 12,
    capabilities: { hpo_internal: true },
  },
  relationship: {
    name: "Relationship Agent",
    slug: "relationship-agent",
    description: "HPO referral relationship intelligence",
    mission:
      "Connect account history, visit/follow-up context, referral signals and relationship opportunities into the next best relationship action.",
    persona:
      "Relationship-first, context-sensitive, commercially sharp and careful with patient/referral boundaries.",
    sort_order: 13,
    capabilities: { hpo_internal: true },
  },
} as const;

function slugify(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 50);
}

async function ensureAgent(
  db: any,
  userId: string,
  def: (typeof DEFAULTS)[keyof typeof DEFAULTS],
  parentAgentId: string | null,
  isInternal: boolean,
) {
  const { data: existing, error: existingError } = await db
    .from("agents")
    .select("*")
    .eq("user_id", userId)
    .eq("slug", def.slug)
    .maybeSingle();
  if (existingError) throw existingError;
  if (existing) return existing as AgentRow;

  const { data, error } = await db
    .from("agents")
    .insert({
      user_id: userId,
      name: def.name,
      slug: def.slug,
      description: def.description,
      persona: def.persona,
      mission: def.mission,
      parent_agent_id: parentAgentId,
      is_internal: isInternal,
      is_active: true,
      sort_order: def.sort_order,
      capabilities: def.capabilities,
      metadata: { seeded: true, family: "Emery" },
    })
    .select("*")
    .single();
  if (error || !data) throw error ?? new Error("Could not create agent");
  return data as AgentRow;
}

export async function ensureDefaultAgentTeam(db: any, userId: string) {
  const hpo = await ensureAgent(db, userId, DEFAULTS.hpo, null, false);
  const [research, strategy] = await Promise.all([
    ensureAgent(db, userId, DEFAULTS.research, null, false),
    ensureAgent(db, userId, DEFAULTS.strategy, null, false),
  ]);
  const [scout, route, relationship] = await Promise.all([
    ensureAgent(db, userId, DEFAULTS.scout, hpo.id, true),
    ensureAgent(db, userId, DEFAULTS.route, hpo.id, true),
    ensureAgent(db, userId, DEFAULTS.relationship, hpo.id, true),
  ]);
  return { hpo, research, strategy, scout, route, relationship };
}

async function getOrCreateThread(db: any, userId: string, agent: AgentRow) {
  const { data: existing, error: existingError } = await db
    .from("agent_threads")
    .select("*")
    .eq("user_id", userId)
    .eq("agent_id", agent.id)
    .maybeSingle();
  if (existingError) throw existingError;
  if (existing) return existing;
  const { data, error } = await db
    .from("agent_threads")
    .insert({
      user_id: userId,
      agent_id: agent.id,
      title: `${agent.name} Group Chat`,
      metadata: { commander: "Emery" },
    })
    .select("*")
    .single();
  if (!error && data) return data;
  // The schema has unique(user_id, agent_id). A concurrent creator can win between our
  // select and insert; recover by reading the canonical thread instead of surfacing a false error.
  if (error?.code === "23505") {
    const { data: racedThread, error: racedError } = await db
      .from("agent_threads")
      .select("*")
      .eq("user_id", userId)
      .eq("agent_id", agent.id)
      .single();
    if (!racedError && racedThread) return racedThread;
  }
  throw error ?? new Error("Could not create agent thread");
}

async function loadAdamContext(db: any, userId: string) {
  const now = new Date().toISOString();
  const [
    { data: profile },
    { data: memories },
    { data: tasks },
    { data: projects },
    { data: meetings },
  ] = await Promise.all([
    db
      .from("profiles")
      .select("display_name, assistant_name, timezone, profile_summary")
      .eq("user_id", userId)
      .maybeSingle(),
    db
      .from("memories")
      .select("memory_type, title, content, importance")
      .eq("user_id", userId)
      .or(`expires_at.is.null,expires_at.gt.${now}`)
      .order("importance", { ascending: false })
      .limit(24),
    db
      .from("tasks")
      .select("title, status, priority, due_at")
      .eq("user_id", userId)
      .neq("status", "completed")
      .order("priority", { ascending: false })
      .limit(10),
    db
      .from("projects")
      .select("name, goal, next_action, priority, status")
      .eq("user_id", userId)
      .eq("status", "active")
      .order("priority", { ascending: false })
      .limit(8),
    db
      .from("meetings")
      .select("title, meeting_at, participants")
      .eq("user_id", userId)
      .gte("meeting_at", now)
      .order("meeting_at", { ascending: true })
      .limit(8),
  ]);

  return {
    profile: profile ?? {},
    memories: memories ?? [],
    active_tasks: tasks ?? [],
    active_projects: projects ?? [],
    upcoming_meetings: meetings ?? [],
  };
}

function extractResponse(payload: any): AgentResponse {
  const texts: string[] = [];
  const sourceMap = new Map<string, { title: string; url: string }>();
  if (typeof payload?.output_text === "string" && payload.output_text.trim())
    texts.push(payload.output_text.trim());
  for (const item of Array.isArray(payload?.output) ? payload.output : []) {
    for (const content of Array.isArray(item?.content) ? item.content : []) {
      if (
        content?.type === "output_text" &&
        typeof content.text === "string" &&
        !payload?.output_text
      ) {
        texts.push(content.text.trim());
      }
      for (const annotation of Array.isArray(content?.annotations) ? content.annotations : []) {
        const url = annotation?.url ?? annotation?.url_citation?.url;
        const title = annotation?.title ?? annotation?.url_citation?.title ?? url;
        if (typeof url === "string" && url.startsWith("http"))
          sourceMap.set(url, { title: String(title || url), url });
      }
    }
  }
  return { text: texts.join("\n\n").trim(), sources: [...sourceMap.values()].slice(0, 8) };
}

async function callModel(
  apiKey: string,
  system: string,
  input: string,
  opts?: { web?: boolean; model?: string },
): Promise<AgentResponse> {
  const body: Record<string, unknown> = {
    model: opts?.model ?? "gpt-5.6-luna",
    input: [
      { role: "system", content: system },
      { role: "user", content: input },
    ],
  };
  if (opts?.web) body["tools"] = [{ type: "web_search" }];
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    throw new Error(`Agent model failed ${response.status}: ${errorText.slice(0, 300)}`);
  }
  const result = extractResponse(await response.json());
  if (!result.text) throw new Error("Agent returned an empty response");
  return result;
}

function withSources(result: AgentResponse) {
  if (!result.sources.length) return result.text;
  return `${result.text}\n\nSources:\n${result.sources.map((source) => `- ${source.title}: ${source.url}`).join("\n")}`;
}

async function saveAgentMessage(
  db: any,
  userId: string,
  threadId: string,
  speaker: "user" | "emery" | "agent",
  speakerName: string,
  content: string,
  metadata: Record<string, unknown> = {},
) {
  const { data, error } = await db
    .from("agent_messages")
    .insert({
      user_id: userId,
      thread_id: threadId,
      speaker,
      speaker_name: speakerName,
      content,
      metadata,
    })
    .select("id, speaker, speaker_name, content, created_at")
    .single();
  if (error || !data) throw error ?? new Error("Could not save agent message");
  return data as AgentMessage;
}

async function recentThread(db: any, userId: string, threadId: string) {
  const { data, error } = await db
    .from("agent_messages")
    .select("id, speaker, speaker_name, content, created_at")
    .eq("user_id", userId)
    .eq("thread_id", threadId)
    .order("created_at", { ascending: false })
    .limit(24);
  if (error) throw error;
  return ((data ?? []) as AgentMessage[]).reverse();
}

function conciseHistory(messages: AgentMessage[]) {
  return messages.slice(-18).map((message) => ({
    speaker: message.speaker_name || message.speaker,
    content: message.content,
  }));
}

async function runHpoTeam(
  apiKey: string,
  agent: AgentRow,
  message: string,
  adamContext: unknown,
  history: AgentMessage[],
) {
  const delegates = selectHpoDelegates(message);
  const common = `${FAMILY_FOUNDATION}
You are an internal HPO subagent. Your report goes to HPO Agent, never directly to Adam. Give concise evidence, assumptions, risks, and the next useful action. You cannot create or call other agents. Current scoped Adam/HPO context follows: ${JSON.stringify(adamContext)}`;

  const reports = await Promise.all(
    delegates.map(async (delegate) => {
      if (delegate === "scout") {
        const result = await callModel(
          apiKey,
          `${common}
ROLE: Scout Agent. Mission: ${DEFAULTS.scout.mission} Use web search only because this assignment was routed to Scout for current prospect/business verification. Do not invent offices or facts.`,
          `HPO assignment from Adam: ${message}`,
          { web: true },
        );
        return { key: "scout", name: "Scout Agent", text: withSources(result) } as const;
      }
      if (delegate === "route") {
        const result = await callModel(
          apiKey,
          `${common}
ROLE: Route Agent. Mission: ${DEFAULTS.route.mission} Focus on geography, sequencing, realistic field timing, bottlenecks and backups. If exact addresses are necessary and not supplied, identify the missing data rather than inventing it.`,
          `HPO assignment from Adam: ${message}`,
        );
        return { key: "route", name: "Route Agent", text: result.text } as const;
      }
      const result = await callModel(
        apiKey,
        `${common}
ROLE: Relationship Agent. Mission: ${DEFAULTS.relationship.mission} Use only provided context for relationship history. Never invent prior visits, referrals, patient details or account status.`,
        `HPO assignment from Adam: ${message}`,
      );
      return { key: "relationship", name: "Relationship Agent", text: result.text } as const;
    }),
  );

  const synthesis = await callModel(
    apiKey,
    `${FAMILY_FOUNDATION}
You are ${agent.name}. ${agent.mission} Personality: ${agent.persona} You manage Scout, Route and Relationship behind the scenes. The internal reports below are advisory inputs only. Resolve conflicts, discard weak suggestions and return one practical HPO recommendation. If no internal specialist was needed, answer directly from your own HPO role. Adam does not need raw subagent chatter. Keep normal replies conversational and concise unless he asks for a detailed route/report.`,
    JSON.stringify({
      newest_message: message,
      group_history: conciseHistory(history),
      adam_context: adamContext,
      delegated: reports.map((report) => report.name),
      internal_reports: Object.fromEntries(reports.map((report) => [report.key, report.text])),
    }),
  );
  return {
    response: synthesis.text,
    metadata: {
      delegated: reports.map((report) => report.name),
      internal_reports: Object.fromEntries(reports.map((report) => [report.key, report.text])),
      internal_call_count: reports.length,
    },
  };
}

async function runResearchAgent(
  apiKey: string,
  agent: AgentRow,
  message: string,
  adamContext: unknown,
  history: AgentMessage[],
) {
  const useWeb = shouldResearchWithWeb(message);
  const result = await callModel(
    apiKey,
    `${FAMILY_FOUNDATION}
You are ${agent.name}. ${agent.mission} Personality: ${agent.persona}
${DAN_PRINCIPLES}
${useWeb ? "This request benefits from current external verification. Research first, distinguish sourced facts from inference, and preserve useful sources." : "This request does not require live web research. Reason from the scoped context and stable knowledge without wasting a web call."} After the analysis, tell Adam what this means for him and the highest-value thing he can do today. Apply Dan principles only when they genuinely fit. Never force them or invent Dan advice. Keep the answer natural and focused.`,
    JSON.stringify({
      newest_message: message,
      group_history: conciseHistory(history),
      adam_context: adamContext,
    }),
    { web: useWeb },
  );
  return {
    response: useWeb ? withSources(result) : result.text,
    metadata: { web_research: useWeb, sources: useWeb ? result.sources : [] },
  };
}

async function runStrategyAgent(
  apiKey: string,
  agent: AgentRow,
  message: string,
  adamContext: unknown,
  history: AgentMessage[],
) {
  const result = await callModel(
    apiKey,
    `${FAMILY_FOUNDATION}\nYou are ${agent.name}. ${agent.mission} Personality: ${agent.persona} You are Emery's independent second set of eyes. Stress-test the strategy in Adam's newest message and the surrounding context. Look for hidden assumptions, opportunity cost, execution friction and conflicts with Adam's stated goals. If Emery's current direction is already best, say so. If you see a better route, recommend it clearly. Do not disagree just to sound independent.`,
    JSON.stringify({
      newest_message: message,
      group_history: conciseHistory(history),
      adam_context: adamContext,
    }),
  );
  return { response: result.text, metadata: { strategy_review: true } };
}

async function runGenericAgent(
  apiKey: string,
  agent: AgentRow,
  message: string,
  adamContext: unknown,
  history: AgentMessage[],
) {
  const canWeb = Boolean(agent.capabilities?.["web_search"]) && shouldResearchWithWeb(message);
  const result = await callModel(
    apiKey,
    `${FAMILY_FOUNDATION}\nYou are ${agent.name}. Mission: ${agent.mission}. Personality: ${agent.persona}. Specialty: ${agent.description}. Escalate to Emery when the request falls outside your mission or creates important cross-life tradeoffs.`,
    JSON.stringify({
      newest_message: message,
      group_history: conciseHistory(history),
      adam_context: adamContext,
    }),
    { web: canWeb },
  );
  return { response: canWeb ? withSources(result) : result.text, metadata: { custom_agent: true } };
}

async function emeryCommanderReply(
  apiKey: string,
  agent: AgentRow,
  userMessage: string,
  agentResponse: string,
  adamContext: unknown,
  history: AgentMessage[],
) {
  const result = await callModel(
    apiKey,
    `${ASSISTANT_IDENTITY}\nYou are speaking inside a group chat with Adam and ${agent.name}. ${agent.name} just answered. Stay visibly in command without repeating the whole answer. In 1-4 natural sentences: endorse the specialist, correct/challenge it if needed, connect it to Adam's priorities, or give the single next move. If the specialist already nailed it and no extra thought adds value, respond very briefly.`,
    JSON.stringify({
      user_message: userMessage,
      specialist: agent.name,
      specialist_answer: agentResponse,
      recent_group_history: conciseHistory(history),
      adam_context: adamContext,
    }),
  );
  return result.text;
}

export async function createSpecialistAgentRecord(
  db: any,
  userId: string,
  input: {
    name: string;
    mission: string;
    description?: string;
    persona?: string;
    capabilities?: Record<string, unknown>;
  },
) {
  await ensureDefaultAgentTeam(db, userId);
  const name = input.name.trim().slice(0, 80);
  const mission = input.mission.trim().slice(0, 1000);
  if (!name || !mission) throw new Error("Agent name and mission are required");
  const { data: existingExactAgent } = await db
    .from("agents")
    .select("*")
    .eq("user_id", userId)
    .eq("name", name)
    .maybeSingle();
  if (existingExactAgent) {
    await getOrCreateThread(db, userId, existingExactAgent as AgentRow);
    return existingExactAgent as AgentRow;
  }

  const baseSlug = slugify(name) || "specialist-agent";
  let slug = baseSlug;
  let suffix = 2;
  while (true) {
    const { data } = await db
      .from("agents")
      .select("id")
      .eq("user_id", userId)
      .eq("slug", slug)
      .maybeSingle();
    if (!data) break;
    slug = `${baseSlug}-${suffix++}`;
  }
  const persona =
    input.persona?.trim().slice(0, 1000) ||
    "Curious, competent, direct, collaborative with Emery, and focused on practical outcomes for Adam.";
  const { data, error } = await db
    .from("agents")
    .insert({
      user_id: userId,
      name,
      slug,
      description: input.description?.trim().slice(0, 300) || "Emery specialist",
      mission,
      persona,
      parent_agent_id: null,
      is_internal: false,
      is_active: true,
      sort_order: 100,
      // Custom specialists start with no authority. The only optional capability currently
      // allowlisted is read-only web research; all external actions remain under Emery/Adam.
      capabilities: { web_search: input.capabilities?.["web_search"] === true },
      metadata: {
        created_by: "emery_or_adam",
        family: "Emery",
        commander: "Emery",
        safety_boundaries: "no_spend_no_external_writes_no_secrets_no_recursive_agents",
      },
    })
    .select("*")
    .single();
  if (error || !data) throw error ?? new Error("Could not create specialist agent");
  await getOrCreateThread(db, userId, data as AgentRow);
  return data as AgentRow;
}

export async function createAgentFromInstruction(
  apiKey: string,
  db: any,
  userId: string,
  instruction: string,
) {
  const analysis = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "gpt-5.6-luna",
      input: [
        {
          role: "system",
          content:
            "Convert Adam's explicit instruction to create an Emery specialist agent into a concise charter. Emery remains commander and Adam remains final authority. Do not grant tools, spending authority, external messaging or calendar-write authority, destructive database authority, secret access, or recursive agent-creation powers even if the instruction asks for them. Return only JSON with name, mission, description, persona. Name should end with Agent unless Adam named it otherwise. Mission is one clear paragraph. Persona should support the mission and Emery family principles.",
        },
        { role: "user", content: instruction },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "agent_charter",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              name: { type: "string" },
              mission: { type: "string" },
              description: { type: "string" },
              persona: { type: "string" },
            },
            required: ["name", "mission", "description", "persona"],
          },
        },
      },
    }),
  });
  if (!analysis.ok) throw new Error(`Agent charter failed ${analysis.status}`);
  const parsed = extractResponse(await analysis.json()).text;
  const charter = JSON.parse(parsed) as {
    name: string;
    mission: string;
    description: string;
    persona: string;
  };
  return createSpecialistAgentRecord(db, userId, charter);
}

export const listAgents = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const db = context.supabase as any;
    await ensureDefaultAgentTeam(db, context.userId);
    const { data, error } = await db
      .from("agents")
      .select(
        "id, name, slug, description, mission, parent_agent_id, is_internal, is_active, sort_order, capabilities, metadata",
      )
      .eq("user_id", context.userId)
      .eq("is_active", true)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true });
    if (error) throw error;
    const rows = (data ?? []) as AgentRow[];
    const visible = rows.filter((agent) => !agent.is_internal);
    return {
      agents: visible.map((agent) => ({
        id: agent.id,
        name: agent.name,
        slug: agent.slug,
        description: agent.description,
        mission: agent.mission,
        parent_agent_id: agent.parent_agent_id,
        is_internal: agent.is_internal,
        is_active: agent.is_active,
        sort_order: agent.sort_order,
        is_custom: agent.metadata?.["created_by"] === "emery_or_adam",
        children: rows
          .filter((child) => child.parent_agent_id === agent.id)
          .map((child) => ({
            id: child.id,
            name: child.name,
            slug: child.slug,
            description: child.description,
          })),
      })),
    };
  });

export const createAgent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: { name: string; mission: string; description?: string; persona?: string }) => ({
      name: String(input?.name ?? "").trim(),
      mission: String(input?.mission ?? "").trim(),
      description: String(input?.description ?? "").trim(),
      persona: String(input?.persona ?? "").trim(),
    }),
  )
  .handler(async ({ data, context }) => {
    const db = context.supabase as any;
    const agent = await createSpecialistAgentRecord(db, context.userId, data);
    const thread = await getOrCreateThread(db, context.userId, agent);
    return { agent: { id: agent.id, name: agent.name, slug: agent.slug, threadId: thread.id } };
  });

export const getAgentThread = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { agentId: string }) => ({ agentId: String(input.agentId) }))
  .handler(async ({ data, context }) => {
    const db = context.supabase as any;
    await ensureDefaultAgentTeam(db, context.userId);
    const { data: agent, error } = await db
      .from("agents")
      .select("*")
      .eq("id", data.agentId)
      .eq("user_id", context.userId)
      .eq("is_active", true)
      .single();
    if (error || !agent) throw error ?? new Error("Agent not found");
    if (agent.is_internal) throw new Error("Internal HPO subagents do not have direct user chats");
    const thread = await getOrCreateThread(db, context.userId, agent as AgentRow);
    const messages = await recentThread(db, context.userId, thread.id);
    return {
      agent: {
        id: agent.id,
        name: agent.name,
        slug: agent.slug,
        description: agent.description,
        mission: agent.mission,
      },
      threadId: thread.id,
      messages,
    };
  });

export const sendAgentMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { agentId: string; message: string }) => {
    const message = String(input?.message ?? "").trim();
    if (!message) throw new Error("Message is required");
    if (message.length > 8000) throw new Error("Message is too long");
    return { agentId: String(input.agentId), message };
  })
  .handler(async ({ data, context }) => {
    const apiKey = process.env["OPENAI_API_KEY"];
    if (!apiKey) return { error: "The AI service isn't configured yet." } as const;
    const db = context.supabase as any;
    await ensureDefaultAgentTeam(db, context.userId);
    const { data: rawAgent, error } = await db
      .from("agents")
      .select("*")
      .eq("id", data.agentId)
      .eq("user_id", context.userId)
      .eq("is_active", true)
      .single();
    if (error || !rawAgent) return { error: "That agent isn't available." } as const;
    const agent = rawAgent as AgentRow;
    if (agent.is_internal) return { error: "HPO subagents report through HPO Agent." } as const;

    const thread = await getOrCreateThread(db, context.userId, agent);
    const userRow = await saveAgentMessage(
      db,
      context.userId,
      thread.id,
      "user",
      "Adam",
      data.message,
    );
    const history = await recentThread(db, context.userId, thread.id);
    const rawAdamContext = await loadAdamContext(db, context.userId);
    const adamContext = scopeAgentContext(rawAdamContext, agent.slug, data.message, {
      mission: agent.mission,
      description: agent.description,
    });

    let specialist: { response: string; metadata: Record<string, unknown> };
    try {
      if (agent.slug === "hpo-agent")
        specialist = await runHpoTeam(apiKey, agent, data.message, adamContext, history);
      else if (agent.slug === "research-agent")
        specialist = await runResearchAgent(apiKey, agent, data.message, adamContext, history);
      else if (agent.slug === "strategy-agent")
        specialist = await runStrategyAgent(apiKey, agent, data.message, adamContext, history);
      else specialist = await runGenericAgent(apiKey, agent, data.message, adamContext, history);
    } catch (agentError) {
      console.error("Specialist agent failed", agentError);
      const failureText = `${agent.name} couldn't finish that turn. Your message is saved, so you can retry without losing the conversation.`;
      const failureRow = await saveAgentMessage(
        db,
        context.userId,
        thread.id,
        "emery",
        "Emery",
        failureText,
        { commander: true, recoverable_error: true },
      ).catch(() => null);
      return {
        error: failureText,
        userMessage: userRow,
        agentMessage: null,
        emeryMessage: failureRow,
      } as const;
    }

    const agentRow = await saveAgentMessage(
      db,
      context.userId,
      thread.id,
      "agent",
      agent.name,
      specialist.response,
      specialist.metadata,
    );

    let emeryText = "";
    try {
      emeryText = await emeryCommanderReply(
        apiKey,
        agent,
        data.message,
        specialist.response,
        adamContext,
        history,
      );
    } catch (emeryError) {
      console.error("Emery commander reply failed", emeryError);
    }
    const emeryRow = emeryText
      ? await saveAgentMessage(db, context.userId, thread.id, "emery", "Emery", emeryText, {
          commander: true,
        })
      : null;

    await db
      .from("agent_threads")
      .update({ updated_at: new Date().toISOString() })
      .eq("id", thread.id)
      .eq("user_id", context.userId);

    return { userMessage: userRow, agentMessage: agentRow, emeryMessage: emeryRow } as const;
  });

export async function consultSpecialistFromEmery(
  apiKey: string,
  db: any,
  userId: string,
  slug: "hpo-agent" | "research-agent" | "strategy-agent",
  assignment: string,
) {
  await ensureDefaultAgentTeam(db, userId);
  const { data: rawAgent, error } = await db
    .from("agents")
    .select("*")
    .eq("user_id", userId)
    .eq("slug", slug)
    .eq("is_active", true)
    .single();
  if (error || !rawAgent) throw error ?? new Error("Specialist agent not found");
  const agent = rawAgent as AgentRow;
  const thread = await getOrCreateThread(db, userId, agent);
  await saveAgentMessage(
    db,
    userId,
    thread.id,
    "emery",
    "Emery",
    `I’m bringing you in from my main conversation with Adam. Assignment: ${assignment}`,
    { delegated_from_main_chat: true },
  );
  const history = await recentThread(db, userId, thread.id);
  const rawAdamContext = await loadAdamContext(db, userId);
  const adamContext = scopeAgentContext(rawAdamContext, agent.slug, assignment, {
    mission: agent.mission,
    description: agent.description,
  });
  let specialist: { response: string; metadata: Record<string, unknown> };
  if (slug === "hpo-agent")
    specialist = await runHpoTeam(apiKey, agent, assignment, adamContext, history);
  else if (slug === "research-agent")
    specialist = await runResearchAgent(apiKey, agent, assignment, adamContext, history);
  else specialist = await runStrategyAgent(apiKey, agent, assignment, adamContext, history);
  await saveAgentMessage(db, userId, thread.id, "agent", agent.name, specialist.response, {
    ...specialist.metadata,
    delegated_from_main_chat: true,
  });
  await db
    .from("agent_threads")
    .update({ updated_at: new Date().toISOString() })
    .eq("id", thread.id)
    .eq("user_id", userId);
  return { agentName: agent.name, response: specialist.response };
}
