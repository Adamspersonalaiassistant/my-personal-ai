# Emery Agent Team V1

This feature adds Emery's first persistent specialist-agent family.

## Team
- Emery — commander/orchestrator and Adam's primary assistant.
- HPO Agent — Hudson Pro operating lead. Adam and Emery speak with HPO Agent; HPO Agent delegates internally to Scout, Route, and Relationship subagents. The subagents do not have user-facing chats in V1.
- Research Agent — broad research specialist. Uses current web research when needed and applies Adam's saved Dan Martell principles (buy back time, audit/transfer/fill, DRIP, protect high-value work, avoid reactive work) without inventing advice not in saved context.
- Strategy Agent — independent second set of eyes. Stress-tests Emery's plan, identifies tradeoffs/risks, and offers a better alternative when one exists.

## Product rules
- Agents are one family under Emery. Emery remains in charge and is always a participant in every user-facing agent conversation.
- The Agents tab shows all user-facing agents and their chat history.
- Agent chats are group conversations: Adam + Emery + the selected agent.
- HPO subagents report only to HPO Agent; Adam does not chat with them directly.
- Emery can create new internal specialist agents as data/configuration, not executable code. Direct commands to create an agent are authorization; casual mentions should be treated conservatively.
- Agent creation never grants external side effects, spending authority, or new tools automatically.
- Agents inherit Emery's truthfulness, privacy, Maximum Responsible Progress, and Adam-first operating principles.
- Agent prompts should receive only the Adam context useful for the assignment.

## V1 implementation
- Supabase tables for agents, agent threads, agent messages, and optional agent hierarchy.
- Seed the three user-facing agents and HPO's three internal subagents per user on first load.
- `/agents` list and `/agents/$agentId` group chat.
- OpenAI Responses API orchestration. Research Agent receives the built-in web_search tool. HPO Agent can run Scout, Route, and Relationship subagent calls internally and synthesize their findings.
- Strategy Agent receives the current request plus relevant Emery context and is explicitly asked to challenge rather than echo.
- Emery can create new specialist agent records through an explicit agent-creation flow.
