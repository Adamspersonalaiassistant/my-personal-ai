# Emery History and Engineering Lessons

This is a curated history for JARVIS. It is intentionally a durable summary rather than a raw transcript dump.

## Product evolution

Emery evolved from a personal AI/chat application into a persistent personal operating system with long-term memory, tasks/calendar, Voice, iPhone capture, HPO work workflows, agents, route planning, CRM-style account history, execution receipts, telemetry and self-evaluation.

The recurring pattern is that Adam pushes Emery toward one coherent assistant rather than a collection of disconnected features.

## Major lessons

### 1. One brain beats duplicated systems

When the same intent is implemented separately in Chat, Voice, UI and Shortcut code, drift appears. Canonical controllers and one action architecture are the desired direction.

### 2. Working field workflows are more valuable than elegant rewrites

HPO Planner/Maps/Accounts/Activity became useful through iterative field testing. Do not rewrite working systems merely because a generic framework looks cleaner.

### 3. Mapping reliability matters

A MapLibre/WebGL path previously caused a blank HPO map in production. Leaflet became the reliable replacement and is now an explicit preserve decision.

### 4. Planner won over Today

The separate HPO Today surface was removed because Adam naturally resumed work from Planner and found it clearer. Do not reintroduce duplicate daily-route surfaces without strong evidence.

### 5. CRM truth must be durable

Field notes should lock to the actual visit/account, carry timestamps, remain editable deliberately, and accumulate into account history so relationship progress can be understood over time.

### 6. Voice must be the same Emery

Voice is not a separate assistant. It should share memory, context and actions with typed Emery.

### 7. Visual polish cannot invent capability

The professional command-center redesign should reflect real states only. UI must not claim Emery is searching, syncing, remembering or executing unless runtime evidence supports that state.

### 8. Self-evaluation without self-development is incomplete

Emery already gained telemetry/evaluation/self-improvement proposal foundations, but Adam's desired end state requires turning recurring failures into isolated, tested candidate software improvements.

### 9. Expensive AI runs must leave checkpoints

A previous autonomy attempt consumed premium model usage but left its working branch identical to `main`. Future JARVIS/Claude/GPT engineering runs must create branches and commit useful checkpoints early. Never wait until the end of a long run to preserve work.

### 10. Research must produce leverage

Jarvis/open-source research is valuable only when it informs a concrete Emery improvement. Do not repeatedly research broad Jarvis architecture after the relevant patterns are already captured.

## Jarvis-inspired architecture direction

Useful patterns identified from Jarvis projects include:

- capability/tool discovery before giving up;
- a bounded multi-step goal-completion loop;
- plugin/MCP-style extensibility;
- deep research that identifies evidence gaps and searches again;
- trace-based learning from failures/habits;
- coding-agent loops that branch, edit, test, repair and commit;
- sandboxing generated code;
- separating the user-facing assistant from the engineering system.

Do not copy code with incompatible commercial licensing. Preserve license/provenance when permissively licensed code is actually adapted.

## Latest architecture decision

Emery remains Adam's personal assistant.

JARVIS Engineer becomes the technical control plane whose job is to make Emery better.

JARVIS is not a second consumer-facing assistant competing for Adam's attention. Adam may talk to JARVIS for engineering status and direction, but normal life/work interaction stays with Emery.
