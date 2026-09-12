# Emery Agent Family V1

Emery's first specialist-agent system uses a manager pattern: Emery remains Adam's primary assistant and orchestrator while specialists contribute focused work behind the same relationship.

## Team
- **Emery** — commander/orchestrator and Adam's primary assistant.
- **HPO Agent** — Hudson Pro operating lead. Adam and Emery speak with HPO Agent; HPO Agent delegates internally to Scout, Route, and Relationship only when their specialty is useful.
  - **Scout Agent** — current prospect, office, provider, attorney and field-intelligence research/verification.
  - **Route Agent** — stop ordering, geography, driving efficiency, field timing and backups.
  - **Relationship Agent** — account/referral history, follow-ups, relationship strategy and next relationship action.
- **Research Agent** — broad research specialist. Uses live web research when freshness or external verification materially helps, then translates findings into what Adam can do today. Applies Adam's saved Dan Martell / Buy Back Your Time principles only when relevant and never invents advice.
- **Strategy Agent** — independent second set of eyes. Stress-tests Emery's plan, assumptions, tradeoffs and execution friction; it offers a better alternative when one exists and can explicitly agree when Emery's direction is already best.

## Product rules
- Agents are one family under Emery. Emery remains in charge and is visibly present in every user-facing specialist conversation.
- The Agents tab shows HPO, Research, Strategy and future user-facing specialist agents.
- Agent chats are persistent group conversations: **Adam + Emery + selected agent**.
- HPO's Scout, Route and Relationship agents are internal only. They never have direct Adam chat routes and report through HPO Agent.
- HPO delegation is selective and capped at three internal calls per user turn; simple questions can use zero subagents.
- Main Emery can explicitly consult HPO, Research or Strategy and the assignment/report is saved into that specialist's persistent group history. Emery still gives the final synthesis in the main chat.
- Group history stored in Supabase is persistent; model calls use only a bounded recent slice.
- Research web search is conditional rather than automatic, reducing latency and API spend on timeless/personal questions.
- Agents receive scoped context rather than Adam's entire memory/action history. HPO gets work-relevant context; Research receives request-relevant goals/context; Strategy receives the active goals/projects/tasks needed to judge tradeoffs; custom agents get a conservative mission-relevant subset.

## Agent creation and safety
- Direct instructions such as "Emery, create an agent for X" authorize creation. Casual discussion or hypothetical language does not.
- New agents are configuration/data records with a mission, specialty and persona; creating an agent does not write executable code.
- Agent creation never grants spending authority, destructive tools, external messaging, calendar authority or recursive agent-creation powers.
- User-facing specialists cannot recursively summon other user-facing specialists. HPO's internal delegation is a fixed bounded hierarchy.
- Agents inherit Emery's truthfulness, privacy, Maximum Responsible Progress and Adam-first operating principles.
- Supabase RLS keeps agent rows, threads and messages user-owned. Additional integrity guards require parent agents, threads and messages to reference records owned by the same user.

## Implementation
- Supabase tables: `agents`, `agent_threads`, `agent_messages` with per-user RLS and an optional `parent_agent_id` hierarchy.
- Default agents are seeded idempotently per user.
- Routes: `/agents` and `/agents/$agentId`; internal HPO subagents are rejected by the user-facing thread endpoint.
- OpenAI Responses API remains the orchestration layer; no separate agent framework is required for V1.
- Research Agent can use the Responses API built-in `web_search` tool only when current verification is warranted.
- HPO Agent selects relevant internal specialists, runs selected work in parallel where useful, and returns one synthesis.
- Strategy Agent uses an independent prompt instead of echoing Emery's answer.

## Cost and privacy boundaries
- Do not run an agent swarm on every message.
- Prefer zero or one specialist call when sufficient; use parallel calls only when multiple specialties materially improve the result.
- Never include unrelated private memories in a specialist payload just because they are available.
- Do not expose raw internal subagent control prompts or hidden reports in normal UI.
- Preserve source links when Research or Scout uses live web research.
