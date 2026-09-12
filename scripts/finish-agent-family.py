from pathlib import Path
import re

path = Path("src/lib/agent.functions.ts")
text = path.read_text()

policy_import = '''import {
  scopeAgentContext,
  selectHpoDelegates,
  shouldResearchWithWeb,
} from "@/lib/agent-policy";'''
identity_import = 'import { ASSISTANT_IDENTITY } from "@/lib/assistant-identity";'
if 'from "@/lib/agent-policy"' not in text:
    text = text.replace(identity_import, identity_import + "\n" + policy_import)

new_hpo = r'''async function runHpoTeam(
  apiKey: string,
  agent: AgentRow,
  message: string,
  adamContext: unknown,
  history: AgentMessage[],
) {
  const delegates = selectHpoDelegates(message);
  const common = `${FAMILY_FOUNDATION}\nYou are an internal HPO subagent. Your report goes to HPO Agent, never directly to Adam. Give concise evidence, assumptions, risks, and the next useful action. You cannot create or call other agents. Current scoped Adam/HPO context follows: ${JSON.stringify(adamContext)}`;

  const reports = await Promise.all(
    delegates.map(async (delegate) => {
      if (delegate === "scout") {
        const result = await callModel(
          apiKey,
          `${common}\nROLE: Scout Agent. Mission: ${DEFAULTS.scout.mission} Use web search only because this assignment was routed to Scout for current prospect/business verification. Do not invent offices or facts.`,
          `HPO assignment from Adam: ${message}`,
          { web: true },
        );
        return { key: "scout", name: "Scout Agent", text: withSources(result) } as const;
      }
      if (delegate === "route") {
        const result = await callModel(
          apiKey,
          `${common}\nROLE: Route Agent. Mission: ${DEFAULTS.route.mission} Focus on geography, sequencing, realistic field timing, bottlenecks and backups. If exact addresses are necessary and not supplied, identify the missing data rather than inventing it.`,
          `HPO assignment from Adam: ${message}`,
        );
        return { key: "route", name: "Route Agent", text: result.text } as const;
      }
      const result = await callModel(
        apiKey,
        `${common}\nROLE: Relationship Agent. Mission: ${DEFAULTS.relationship.mission} Use only provided context for relationship history. Never invent prior visits, referrals, patient details or account status.`,
        `HPO assignment from Adam: ${message}`,
      );
      return { key: "relationship", name: "Relationship Agent", text: result.text } as const;
    }),
  );

  const synthesis = await callModel(
    apiKey,
    `${FAMILY_FOUNDATION}\nYou are ${agent.name}. ${agent.mission} Personality: ${agent.persona} You manage Scout, Route and Relationship behind the scenes. The internal reports below are advisory inputs only. Resolve conflicts, discard weak suggestions and return one practical HPO recommendation. If no internal specialist was needed, answer directly from your own HPO role. Adam does not need raw subagent chatter. Keep normal replies conversational and concise unless he asks for a detailed route/report.`,
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

async function runResearchAgent'''
text, count = re.subn(r"async function runHpoTeam\([\s\S]*?\nasync function runResearchAgent", new_hpo, text, count=1)
if count != 1:
    raise SystemExit("Could not replace runHpoTeam")

new_research = r'''async function runResearchAgent(
  apiKey: string,
  agent: AgentRow,
  message: string,
  adamContext: unknown,
  history: AgentMessage[],
) {
  const useWeb = shouldResearchWithWeb(message);
  const result = await callModel(
    apiKey,
    `${FAMILY_FOUNDATION}\nYou are ${agent.name}. ${agent.mission} Personality: ${agent.persona}\n${DAN_PRINCIPLES}\n${useWeb ? "This request benefits from current external verification. Research first, distinguish sourced facts from inference, and preserve useful sources." : "This request does not require live web research. Reason from the scoped context and stable knowledge without wasting a web call."} After the analysis, tell Adam what this means for him and the highest-value thing he can do today. Apply Dan principles only when they genuinely fit. Never force them or invent Dan advice. Keep the answer natural and focused.`,
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

async function runStrategyAgent'''
text, count = re.subn(r"async function runResearchAgent\([\s\S]*?\nasync function runStrategyAgent", new_research, text, count=1)
if count != 1:
    raise SystemExit("Could not replace runResearchAgent")

text = text.replace(
    '  const canWeb = Boolean(agent.capabilities?.["web_search"]);',
    '  const canWeb = Boolean(agent.capabilities?.["web_search"]) && shouldResearchWithWeb(message);',
)

old_direct_context = "    const adamContext = await loadAdamContext(db, context.userId);"
new_direct_context = '''    const rawAdamContext = await loadAdamContext(db, context.userId);
    const adamContext = scopeAgentContext(rawAdamContext, agent.slug, data.message, {
      mission: agent.mission,
      description: agent.description,
    });'''
if old_direct_context not in text:
    raise SystemExit("Direct agent context call not found")
text = text.replace(old_direct_context, new_direct_context, 1)

old_consult_context = "  const adamContext = await loadAdamContext(db, userId);"
new_consult_context = '''  const rawAdamContext = await loadAdamContext(db, userId);
  const adamContext = scopeAgentContext(rawAdamContext, agent.slug, assignment, {
    mission: agent.mission,
    description: agent.description,
  });'''
if old_consult_context not in text:
    raise SystemExit("Consult context call not found")
text = text.replace(old_consult_context, new_consult_context, 1)

path.write_text(text)

emery_path = Path("src/lib/emery.functions.ts")
emery = emery_path.read_text()
policy_line = 'import { isExplicitAgentCreationCommand } from "@/lib/agent-policy";'
agent_import = 'import { createAgentFromInstruction, consultSpecialistFromEmery } from "@/lib/agent.functions";'
if policy_line not in emery:
    emery = emery.replace(agent_import, agent_import + "\n" + policy_line)

creation_pattern = re.compile(
    r'    const explicitAgentCreation =\n\s*/\\b\(\?:create\|make\|build\)[\s\S]*?\n\s*\);'
)
emery, creation_count = creation_pattern.subn(
    '    const explicitAgentCreation = isExplicitAgentCreationCommand(data.message);', emery, count=1
)
if creation_count != 1:
    raise SystemExit("Explicit creation parser block not found")

emery_path.write_text(emery)
