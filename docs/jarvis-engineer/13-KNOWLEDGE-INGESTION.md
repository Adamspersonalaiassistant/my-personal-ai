# JARVIS Knowledge Ingestion Foundation

JARVIS now has a durable structured knowledge store in Supabase: `jarvis_knowledge_items`.

## Why structured knowledge instead of dumping raw chats

Adam wants JARVIS to inherit the hours of Emery product/engineering discussion so he does not need to repeat himself.

Raw chat dumping would create several problems:

- stale decisions would compete with newer corrections;
- prompts would become expensive and noisy;
- credentials/PHI/unrelated sensitive content could leak into engineering context;
- JARVIS would have difficulty distinguishing a current product contract from an old idea.

The ingestion design therefore converts project history into structured items such as:

- product decision;
- user preference;
- constraint;
- failure signal;
- workflow requirement;
- acceptance test;
- architecture;
- history/lesson;
- research reference.

Items have `current`, `historical`, or `superseded` status so newer decisions can outrank older guidance.

## Initial seed

The first seed contains high-value Emery project knowledge extracted from available project chat history and handoff material, including:

- one Emery identity;
- Planner / Maps / Accounts / Activity HPO structure;
- Planner as primary and Today removed;
- Leaflet preserve decision;
- production verification standard;
- surgical-change preference;
- Lovable/AI usage discipline;
- proof-before-done requirement;
- mobile field reality;
- professional CRM note/history behavior;
- no-PHI boundary;
- one-highest-value-next-action preference;
- the failed premium-agent run lesson;
- Emery release/self-awareness failure;
- capability-gap autonomy loop;
- JARVIS Engineer separation;
- JARVIS 50-task capacity;
- session-complete notification requirement;
- end-of-session JARVIS self-research requirement;
- approval boundary for high-risk changes;
- Adam's goal of leaving the normal engineering loop.

## Important truthfulness note

This is a structured ingestion of the Emery project history currently accessible to the engineering bootstrap, not a claim that every raw ChatGPT transcript has been copied byte-for-byte.

The target architecture should continue by adding an authorized conversation-history ingestion/extraction path so new Emery-project discussions can propose knowledge updates automatically.

## Retrieval rule

JARVIS should retrieve only the knowledge relevant to the active engineering task and always prefer:

1. newer explicit Adam decisions;
2. current product contracts;
3. current live/source state;
4. older historical items only when they add context.

## Sensitive-data rule

Never ingest passwords, API keys/tokens, patient PHI, or unrelated sensitive personal information into general JARVIS engineering knowledge.
