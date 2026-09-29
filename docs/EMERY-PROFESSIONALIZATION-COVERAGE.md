# Emery Professionalization Coverage

Starting commit: 5f7af39e677e225cf4b56d87cc2ff164de61db14  
Working branch: codex/emery-professionalization

Final allowed statuses: FIXED + VERIFIED, PLATFORM LIMIT + BEST AVAILABLE UX VERIFIED, EXTERNAL ACTIVATION REQUIRED + CODE COMPLETE.

OPEN is a working status only and must be eliminated before Milestone O completes.

| ID | Status | Root cause | Implementation | Verification | Commit/evidence |
| ---: | --- | --- | --- | --- | --- |
| 1 | FIXED + VERIFIED | Shared ActionPlan execution path was incomplete | Implemented and wired Shared ActionPlan execution path | Orchestration/HPO/TypeScript focused gates pass | `executor.ts` |
| 2 | FIXED + VERIFIED | Domain inference is context, not a gate was incomplete | Implemented and wired Domain inference is context, not a gate | Orchestration/HPO/TypeScript focused gates pass | `planner.ts` |
| 3 | FIXED + VERIFIED | Recognition never equals performed was incomplete | Implemented and wired Recognition never equals performed | Orchestration/HPO/TypeScript focused gates pass | `executor.ts` |
| 4 | FIXED + VERIFIED | Calendar/HPO coexist in one turn was incomplete | Implemented and wired Calendar/HPO coexist in one turn | Orchestration/HPO/TypeScript focused gates pass | `multi-intent-executor.ts` |
| 5 | FIXED + VERIFIED | Independent Today reads run together was incomplete | Implemented and wired Independent Today reads run together | Orchestration/HPO/TypeScript focused gates pass | `today-plan.ts` |
| 6 | FIXED + VERIFIED | Dependencies order writes was incomplete | Implemented and wired Dependencies order writes | Orchestration/HPO/TypeScript focused gates pass | `executor.ts` |
| 7 | FIXED + VERIFIED | Partial success is explicit was incomplete | Implemented and wired Partial success is explicit | Orchestration/HPO/TypeScript focused gates pass | `receipt-aggregator.ts` |
| 8 | FIXED + VERIFIED | Ambiguity asks one question was incomplete | Implemented and wired Ambiguity asks one question | Orchestration/HPO/TypeScript focused gates pass | `entity-resolver.ts` |
| 9 | FIXED + VERIFIED | Failures preserve route state was incomplete | Implemented and wired Failures preserve route state | Orchestration/HPO/TypeScript focused gates pass | `multi-intent-executor.ts` |
| 10 | FIXED + VERIFIED | Shared entity normalization was incomplete | Implemented and wired Shared entity normalization | Orchestration/HPO/TypeScript focused gates pass | `entity-resolver.ts` |
| 11 | FIXED + VERIFIED | Tied matches stay ambiguous was incomplete | Implemented and wired Tied matches stay ambiguous | Orchestration/HPO/TypeScript focused gates pass | `entity-resolver.ts` |
| 12 | FIXED + VERIFIED | HPO contacts assist person resolution was incomplete | Implemented and wired HPO contacts assist person resolution | Orchestration/HPO/TypeScript focused gates pass | `multi-intent-executor.ts` |
| 13 | FIXED + VERIFIED | Typed Today’s Plan was incomplete | Implemented and wired Typed Today’s Plan | Orchestration/HPO/TypeScript focused gates pass | `today-plan.ts` |
| 14 | FIXED + VERIFIED | Meetings exist without a route was incomplete | Implemented and wired Meetings exist without a route | Orchestration/HPO/TypeScript focused gates pass | `today-plan.ts` |
| 15 | FIXED + VERIFIED | Persistent owner-scoped Field Session was incomplete | Implemented and wired Persistent owner-scoped Field Session | Orchestration/HPO/TypeScript focused gates pass | `migration 20260929152000` |
| 16 | FIXED + VERIFIED | Durable expected-note target was incomplete | Implemented and wired Durable expected-note target | Orchestration/HPO/TypeScript focused gates pass | `emery-field-session.functions.ts` |
| 17 | FIXED + VERIFIED | Consumed note target expires was incomplete | Implemented and wired Consumed note target expires | Orchestration/HPO/TypeScript focused gates pass | `migration 20260929152000` |
| 18 | FIXED + VERIFIED | Central source hierarchy was incomplete | Implemented and wired Central source hierarchy | Orchestration/HPO/TypeScript focused gates pass | `source-hierarchy.ts` |
| 19 | FIXED + VERIFIED | Central risk/confirmation policy was incomplete | Implemented and wired Central risk/confirmation policy | Orchestration/HPO/TypeScript focused gates pass | `risk-policy.ts` |
| 20 | FIXED + VERIFIED | Atomic remaining-stop replacement was incomplete | Implemented and wired Atomic remaining-stop replacement | Orchestration/HPO/TypeScript focused gates pass | `migration 20260929133000` |
| 21 | FIXED + VERIFIED | Terminal history preserved was incomplete | Implemented and wired Terminal history preserved | Orchestration/HPO/TypeScript focused gates pass | `hpo-route-command-controller.ts` |
| 22 | FIXED + VERIFIED | Idempotent retries was incomplete | Implemented and wired Idempotent retries | Orchestration/HPO/TypeScript focused gates pass | `execution-ledger.ts` |
| 23 | FIXED + VERIFIED | Typed execution receipts was incomplete | Implemented and wired Typed execution receipts | Orchestration/HPO/TypeScript focused gates pass | `orchestration.types.ts` |
| 24 | FIXED + VERIFIED | Responses derive from receipts was incomplete | Implemented and wired Responses derive from receipts | Orchestration/HPO/TypeScript focused gates pass | `multi-intent-executor.ts` |
| 25 | FIXED + VERIFIED | Receipt-backed undo was incomplete | Implemented and wired Receipt-backed undo | Orchestration/HPO/TypeScript focused gates pass | `undo.ts` |
| 26 | FIXED + VERIFIED | Undo conflict protection was incomplete | Implemented and wired Undo conflict protection | Orchestration/HPO/TypeScript focused gates pass | `migration 20260929152000` |
| 27 | FIXED + VERIFIED | Chat uses shared executor was incomplete | Implemented and wired Chat uses shared executor | Orchestration/HPO/TypeScript focused gates pass | `emery.functions.ts` |
| 28 | FIXED + VERIFIED | Voice uses shared executor was incomplete | Implemented and wired Voice uses shared executor | Orchestration/HPO/TypeScript focused gates pass | `voice.functions.ts` |
| 29 | FIXED + VERIFIED | Structured HPO RequestContext was incomplete | Implemented and wired Structured HPO RequestContext | Orchestration/HPO/TypeScript focused gates pass | `orchestration.types.ts` |
| 30 | FIXED + VERIFIED | Exact Jason regression corpus was incomplete | Implemented and wired Exact Jason regression corpus | Orchestration/HPO/TypeScript focused gates pass | `validate-emery-orchestration.mjs` |
| 31 | OPEN | Voice / hands-free / Shortcut audit pending | Pending assigned milestone | Pending | — |
| 32 | OPEN | Voice / hands-free / Shortcut audit pending | Pending assigned milestone | Pending | — |
| 33 | OPEN | Voice / hands-free / Shortcut audit pending | Pending assigned milestone | Pending | — |
| 34 | OPEN | Voice / hands-free / Shortcut audit pending | Pending assigned milestone | Pending | — |
| 35 | OPEN | Voice / hands-free / Shortcut audit pending | Pending assigned milestone | Pending | — |
| 36 | OPEN | Voice / hands-free / Shortcut audit pending | Pending assigned milestone | Pending | — |
| 37 | OPEN | Voice / hands-free / Shortcut audit pending | Pending assigned milestone | Pending | — |
| 38 | OPEN | Voice / hands-free / Shortcut audit pending | Pending assigned milestone | Pending | — |
| 39 | OPEN | Voice / hands-free / Shortcut audit pending | Pending assigned milestone | Pending | — |
| 40 | OPEN | Voice / hands-free / Shortcut audit pending | Pending assigned milestone | Pending | — |
| 41 | OPEN | Voice / hands-free / Shortcut audit pending | Pending assigned milestone | Pending | — |
| 42 | OPEN | Voice / hands-free / Shortcut audit pending | Pending assigned milestone | Pending | — |
| 43 | OPEN | Voice / hands-free / Shortcut audit pending | Pending assigned milestone | Pending | — |
| 44 | OPEN | Voice / hands-free / Shortcut audit pending | Pending assigned milestone | Pending | — |
| 45 | OPEN | Voice / hands-free / Shortcut audit pending | Pending assigned milestone | Pending | — |
| 46 | OPEN | Voice / hands-free / Shortcut audit pending | Pending assigned milestone | Pending | — |
| 47 | OPEN | Voice / hands-free / Shortcut audit pending | Pending assigned milestone | Pending | — |
| 48 | OPEN | Voice / hands-free / Shortcut audit pending | Pending assigned milestone | Pending | — |
| 49 | OPEN | Voice / hands-free / Shortcut audit pending | Pending assigned milestone | Pending | — |
| 50 | OPEN | Voice / hands-free / Shortcut audit pending | Pending assigned milestone | Pending | — |
| 51 | OPEN | route reliability / route scoring audit pending | Pending assigned milestone | Pending | — |
| 52 | OPEN | route reliability / route scoring audit pending | Pending assigned milestone | Pending | — |
| 53 | OPEN | route reliability / route scoring audit pending | Pending assigned milestone | Pending | — |
| 54 | OPEN | route reliability / route scoring audit pending | Pending assigned milestone | Pending | — |
| 55 | OPEN | route reliability / route scoring audit pending | Pending assigned milestone | Pending | — |
| 56 | OPEN | route reliability / route scoring audit pending | Pending assigned milestone | Pending | — |
| 57 | OPEN | route reliability / route scoring audit pending | Pending assigned milestone | Pending | — |
| 58 | OPEN | route reliability / route scoring audit pending | Pending assigned milestone | Pending | — |
| 59 | OPEN | route reliability / route scoring audit pending | Pending assigned milestone | Pending | — |
| 60 | OPEN | route reliability / route scoring audit pending | Pending assigned milestone | Pending | — |
| 61 | OPEN | route reliability / route scoring audit pending | Pending assigned milestone | Pending | — |
| 62 | OPEN | route reliability / route scoring audit pending | Pending assigned milestone | Pending | — |
| 63 | OPEN | route reliability / route scoring audit pending | Pending assigned milestone | Pending | — |
| 64 | OPEN | route reliability / route scoring audit pending | Pending assigned milestone | Pending | — |
| 65 | OPEN | route reliability / route scoring audit pending | Pending assigned milestone | Pending | — |
| 66 | OPEN | route reliability / route scoring audit pending | Pending assigned milestone | Pending | — |
| 67 | OPEN | route reliability / route scoring audit pending | Pending assigned milestone | Pending | — |
| 68 | OPEN | route reliability / route scoring audit pending | Pending assigned milestone | Pending | — |
| 69 | OPEN | route reliability / route scoring audit pending | Pending assigned milestone | Pending | — |
| 70 | OPEN | route reliability / route scoring audit pending | Pending assigned milestone | Pending | — |
| 71 | OPEN | route reliability / route scoring audit pending | Pending assigned milestone | Pending | — |
| 72 | OPEN | CRM data integrity / research-write safety audit pending | Pending assigned milestone | Pending | — |
| 73 | OPEN | CRM data integrity / research-write safety audit pending | Pending assigned milestone | Pending | — |
| 74 | OPEN | CRM data integrity / research-write safety audit pending | Pending assigned milestone | Pending | — |
| 75 | OPEN | CRM data integrity / research-write safety audit pending | Pending assigned milestone | Pending | — |
| 76 | OPEN | CRM data integrity / research-write safety audit pending | Pending assigned milestone | Pending | — |
| 77 | OPEN | CRM data integrity / research-write safety audit pending | Pending assigned milestone | Pending | — |
| 78 | OPEN | CRM data integrity / research-write safety audit pending | Pending assigned milestone | Pending | — |
| 79 | OPEN | CRM data integrity / research-write safety audit pending | Pending assigned milestone | Pending | — |
| 80 | OPEN | CRM data integrity / research-write safety audit pending | Pending assigned milestone | Pending | — |
| 81 | OPEN | CRM data integrity / research-write safety audit pending | Pending assigned milestone | Pending | — |
| 82 | OPEN | CRM data integrity / research-write safety audit pending | Pending assigned milestone | Pending | — |
| 83 | OPEN | CRM data integrity / research-write safety audit pending | Pending assigned milestone | Pending | — |
| 84 | OPEN | CRM data integrity / research-write safety audit pending | Pending assigned milestone | Pending | — |
| 85 | OPEN | CRM data integrity / research-write safety audit pending | Pending assigned milestone | Pending | — |
| 86 | OPEN | CRM data integrity / research-write safety audit pending | Pending assigned milestone | Pending | — |
| 87 | OPEN | CRM data integrity / research-write safety audit pending | Pending assigned milestone | Pending | — |
| 88 | OPEN | CRM data integrity / research-write safety audit pending | Pending assigned milestone | Pending | — |
| 89 | OPEN | CRM data integrity / research-write safety audit pending | Pending assigned milestone | Pending | — |
| 90 | OPEN | CRM data integrity / research-write safety audit pending | Pending assigned milestone | Pending | — |
| 91 | OPEN | CRM data integrity / research-write safety audit pending | Pending assigned milestone | Pending | — |
| 92 | OPEN | CRM data integrity / research-write safety audit pending | Pending assigned milestone | Pending | — |
| 93 | OPEN | CRM data integrity / research-write safety audit pending | Pending assigned milestone | Pending | — |
| 94 | OPEN | CRM data integrity / research-write safety audit pending | Pending assigned milestone | Pending | — |
| 95 | OPEN | CRM data integrity / research-write safety audit pending | Pending assigned milestone | Pending | — |
| 96 | OPEN | CRM data integrity / research-write safety audit pending | Pending assigned milestone | Pending | — |
| 97 | OPEN | CRM data integrity / research-write safety audit pending | Pending assigned milestone | Pending | — |
| 98 | OPEN | CRM data integrity / research-write safety audit pending | Pending assigned milestone | Pending | — |
| 99 | OPEN | CRM data integrity / research-write safety audit pending | Pending assigned milestone | Pending | — |
| 100 | OPEN | CRM data integrity / research-write safety audit pending | Pending assigned milestone | Pending | — |
| 101 | OPEN | Map / categories / filters / geocoding audit pending | Pending assigned milestone | Pending | — |
| 102 | OPEN | Map / categories / filters / geocoding audit pending | Pending assigned milestone | Pending | — |
| 103 | OPEN | Map / categories / filters / geocoding audit pending | Pending assigned milestone | Pending | — |
| 104 | OPEN | Map / categories / filters / geocoding audit pending | Pending assigned milestone | Pending | — |
| 105 | OPEN | Map / categories / filters / geocoding audit pending | Pending assigned milestone | Pending | — |
| 106 | OPEN | Map / categories / filters / geocoding audit pending | Pending assigned milestone | Pending | — |
| 107 | OPEN | Map / categories / filters / geocoding audit pending | Pending assigned milestone | Pending | — |
| 108 | OPEN | Map / categories / filters / geocoding audit pending | Pending assigned milestone | Pending | — |
| 109 | OPEN | Map / categories / filters / geocoding audit pending | Pending assigned milestone | Pending | — |
| 110 | OPEN | Map / categories / filters / geocoding audit pending | Pending assigned milestone | Pending | — |
| 111 | OPEN | Map / categories / filters / geocoding audit pending | Pending assigned milestone | Pending | — |
| 112 | OPEN | Map / categories / filters / geocoding audit pending | Pending assigned milestone | Pending | — |
| 113 | OPEN | Map / categories / filters / geocoding audit pending | Pending assigned milestone | Pending | — |
| 114 | OPEN | Map / categories / filters / geocoding audit pending | Pending assigned milestone | Pending | — |
| 115 | OPEN | Map / categories / filters / geocoding audit pending | Pending assigned milestone | Pending | — |
| 116 | OPEN | Map / categories / filters / geocoding audit pending | Pending assigned milestone | Pending | — |
| 117 | OPEN | Map / categories / filters / geocoding audit pending | Pending assigned milestone | Pending | — |
| 118 | OPEN | Map / categories / filters / geocoding audit pending | Pending assigned milestone | Pending | — |
| 119 | OPEN | Map / categories / filters / geocoding audit pending | Pending assigned milestone | Pending | — |
| 120 | OPEN | Map / categories / filters / geocoding audit pending | Pending assigned milestone | Pending | — |
| 121 | OPEN | Map / categories / filters / geocoding audit pending | Pending assigned milestone | Pending | — |
| 122 | OPEN | Map / categories / filters / geocoding audit pending | Pending assigned milestone | Pending | — |
| 123 | OPEN | Map / categories / filters / geocoding audit pending | Pending assigned milestone | Pending | — |
| 124 | OPEN | Map / categories / filters / geocoding audit pending | Pending assigned milestone | Pending | — |
| 125 | OPEN | CRM intelligence / Account Detail / timeline audit pending | Pending assigned milestone | Pending | — |
| 126 | OPEN | CRM intelligence / Account Detail / timeline audit pending | Pending assigned milestone | Pending | — |
| 127 | OPEN | CRM intelligence / Account Detail / timeline audit pending | Pending assigned milestone | Pending | — |
| 128 | OPEN | CRM intelligence / Account Detail / timeline audit pending | Pending assigned milestone | Pending | — |
| 129 | OPEN | CRM intelligence / Account Detail / timeline audit pending | Pending assigned milestone | Pending | — |
| 130 | OPEN | CRM intelligence / Account Detail / timeline audit pending | Pending assigned milestone | Pending | — |
| 131 | OPEN | CRM intelligence / Account Detail / timeline audit pending | Pending assigned milestone | Pending | — |
| 132 | OPEN | CRM intelligence / Account Detail / timeline audit pending | Pending assigned milestone | Pending | — |
| 133 | OPEN | CRM intelligence / Account Detail / timeline audit pending | Pending assigned milestone | Pending | — |
| 134 | OPEN | CRM intelligence / Account Detail / timeline audit pending | Pending assigned milestone | Pending | — |
| 135 | OPEN | CRM intelligence / Account Detail / timeline audit pending | Pending assigned milestone | Pending | — |
| 136 | OPEN | navigation / updates / PWA / offline audit pending | Pending assigned milestone | Pending | — |
| 137 | OPEN | navigation / updates / PWA / offline audit pending | Pending assigned milestone | Pending | — |
| 138 | OPEN | navigation / updates / PWA / offline audit pending | Pending assigned milestone | Pending | — |
| 139 | OPEN | navigation / updates / PWA / offline audit pending | Pending assigned milestone | Pending | — |
| 140 | OPEN | navigation / updates / PWA / offline audit pending | Pending assigned milestone | Pending | — |
| 141 | OPEN | navigation / updates / PWA / offline audit pending | Pending assigned milestone | Pending | — |
| 142 | OPEN | navigation / updates / PWA / offline audit pending | Pending assigned milestone | Pending | — |
| 143 | OPEN | navigation / updates / PWA / offline audit pending | Pending assigned milestone | Pending | — |
| 144 | OPEN | navigation / updates / PWA / offline audit pending | Pending assigned milestone | Pending | — |
| 145 | OPEN | navigation / updates / PWA / offline audit pending | Pending assigned milestone | Pending | — |
| 146 | OPEN | navigation / updates / PWA / offline audit pending | Pending assigned milestone | Pending | — |
| 147 | OPEN | navigation / updates / PWA / offline audit pending | Pending assigned milestone | Pending | — |
| 148 | OPEN | navigation / updates / PWA / offline audit pending | Pending assigned milestone | Pending | — |
| 149 | OPEN | navigation / updates / PWA / offline audit pending | Pending assigned milestone | Pending | — |
| 150 | OPEN | navigation / updates / PWA / offline audit pending | Pending assigned milestone | Pending | — |
| 151 | OPEN | navigation / updates / PWA / offline audit pending | Pending assigned milestone | Pending | — |
| 152 | OPEN | navigation / updates / PWA / offline audit pending | Pending assigned milestone | Pending | — |
| 153 | OPEN | navigation / updates / PWA / offline audit pending | Pending assigned milestone | Pending | — |
| 154 | OPEN | navigation / updates / PWA / offline audit pending | Pending assigned milestone | Pending | — |
| 155 | OPEN | mobile UX / accessibility / theme / HPO Emery audit pending | Pending assigned milestone | Pending | — |
| 156 | OPEN | mobile UX / accessibility / theme / HPO Emery audit pending | Pending assigned milestone | Pending | — |
| 157 | OPEN | mobile UX / accessibility / theme / HPO Emery audit pending | Pending assigned milestone | Pending | — |
| 158 | OPEN | mobile UX / accessibility / theme / HPO Emery audit pending | Pending assigned milestone | Pending | — |
| 159 | OPEN | mobile UX / accessibility / theme / HPO Emery audit pending | Pending assigned milestone | Pending | — |
| 160 | OPEN | mobile UX / accessibility / theme / HPO Emery audit pending | Pending assigned milestone | Pending | — |
| 161 | OPEN | mobile UX / accessibility / theme / HPO Emery audit pending | Pending assigned milestone | Pending | — |
| 162 | OPEN | mobile UX / accessibility / theme / HPO Emery audit pending | Pending assigned milestone | Pending | — |
| 163 | OPEN | mobile UX / accessibility / theme / HPO Emery audit pending | Pending assigned milestone | Pending | — |
| 164 | OPEN | mobile UX / accessibility / theme / HPO Emery audit pending | Pending assigned milestone | Pending | — |
| 165 | OPEN | mobile UX / accessibility / theme / HPO Emery audit pending | Pending assigned milestone | Pending | — |
| 166 | OPEN | mobile UX / accessibility / theme / HPO Emery audit pending | Pending assigned milestone | Pending | — |
| 167 | OPEN | mobile UX / accessibility / theme / HPO Emery audit pending | Pending assigned milestone | Pending | — |
| 168 | OPEN | mobile UX / accessibility / theme / HPO Emery audit pending | Pending assigned milestone | Pending | — |
| 169 | OPEN | mobile UX / accessibility / theme / HPO Emery audit pending | Pending assigned milestone | Pending | — |
| 170 | OPEN | mobile UX / accessibility / theme / HPO Emery audit pending | Pending assigned milestone | Pending | — |
| 171 | OPEN | mobile UX / accessibility / theme / HPO Emery audit pending | Pending assigned milestone | Pending | — |
| 172 | OPEN | mobile UX / accessibility / theme / HPO Emery audit pending | Pending assigned milestone | Pending | — |
| 173 | OPEN | mobile UX / accessibility / theme / HPO Emery audit pending | Pending assigned milestone | Pending | — |
| 174 | OPEN | mobile UX / accessibility / theme / HPO Emery audit pending | Pending assigned milestone | Pending | — |
| 175 | OPEN | mobile UX / accessibility / theme / HPO Emery audit pending | Pending assigned milestone | Pending | — |
| 176 | OPEN | mobile UX / accessibility / theme / HPO Emery audit pending | Pending assigned milestone | Pending | — |
| 177 | OPEN | mobile UX / accessibility / theme / HPO Emery audit pending | Pending assigned milestone | Pending | — |
| 178 | OPEN | mobile UX / accessibility / theme / HPO Emery audit pending | Pending assigned milestone | Pending | — |
| 179 | OPEN | mobile UX / accessibility / theme / HPO Emery audit pending | Pending assigned milestone | Pending | — |
| 180 | OPEN | mobile UX / accessibility / theme / HPO Emery audit pending | Pending assigned milestone | Pending | — |
| 181 | OPEN | mobile UX / accessibility / theme / HPO Emery audit pending | Pending assigned milestone | Pending | — |
| 182 | OPEN | mobile UX / accessibility / theme / HPO Emery audit pending | Pending assigned milestone | Pending | — |
| 183 | OPEN | mobile UX / accessibility / theme / HPO Emery audit pending | Pending assigned milestone | Pending | — |
| 184 | OPEN | Calendar / integrations / performance / Chat latency audit pending | Pending assigned milestone | Pending | — |
| 185 | OPEN | Calendar / integrations / performance / Chat latency audit pending | Pending assigned milestone | Pending | — |
| 186 | OPEN | Calendar / integrations / performance / Chat latency audit pending | Pending assigned milestone | Pending | — |
| 187 | OPEN | Calendar / integrations / performance / Chat latency audit pending | Pending assigned milestone | Pending | — |
| 188 | OPEN | Calendar / integrations / performance / Chat latency audit pending | Pending assigned milestone | Pending | — |
| 189 | OPEN | Calendar / integrations / performance / Chat latency audit pending | Pending assigned milestone | Pending | — |
| 190 | OPEN | Calendar / integrations / performance / Chat latency audit pending | Pending assigned milestone | Pending | — |
| 191 | OPEN | Calendar / integrations / performance / Chat latency audit pending | Pending assigned milestone | Pending | — |
| 192 | OPEN | Calendar / integrations / performance / Chat latency audit pending | Pending assigned milestone | Pending | — |
| 193 | OPEN | Calendar / integrations / performance / Chat latency audit pending | Pending assigned milestone | Pending | — |
| 194 | OPEN | Calendar / integrations / performance / Chat latency audit pending | Pending assigned milestone | Pending | — |
| 195 | OPEN | Calendar / integrations / performance / Chat latency audit pending | Pending assigned milestone | Pending | — |
| 196 | OPEN | Calendar / integrations / performance / Chat latency audit pending | Pending assigned milestone | Pending | — |
| 197 | OPEN | Calendar / integrations / performance / Chat latency audit pending | Pending assigned milestone | Pending | — |
| 198 | OPEN | Calendar / integrations / performance / Chat latency audit pending | Pending assigned milestone | Pending | — |
| 199 | OPEN | Calendar / integrations / performance / Chat latency audit pending | Pending assigned milestone | Pending | — |
| 200 | OPEN | Calendar / integrations / performance / Chat latency audit pending | Pending assigned milestone | Pending | — |
| 201 | OPEN | Calendar / integrations / performance / Chat latency audit pending | Pending assigned milestone | Pending | — |
| 202 | OPEN | Calendar / integrations / performance / Chat latency audit pending | Pending assigned milestone | Pending | — |
| 203 | OPEN | Calendar / integrations / performance / Chat latency audit pending | Pending assigned milestone | Pending | — |
| 204 | FIXED + VERIFIED | Chat and Voice lacked one typed deterministic request context contract | Added `RequestContext` with entry, surface, HPO selection, session, location, receipts and health | TypeScript passes | `orchestration.types.ts` |
| 205 | FIXED + VERIFIED | A recognized domain was used as an execution gate instead of a multi-intent plan | Added typed `ActionPlan` / `PlannedIntent` with reads, writes, dependencies, risk and expected receipts | Exact multi-intent fixture passes | `planner.ts`; `validate:orchestration` |
| 206 | FIXED + VERIFIED | Capability descriptions were prompt text rather than typed operational definitions | Added typed registry with mode, risk, idempotency, confirmation and health keys | TypeScript + focused ESLint pass | `capability-registry.ts` |
| 207 | FIXED + VERIFIED | Confirmation decisions were scattered and not risk-based | Added centralized low/medium/high risk policy and confirmation rules | Unit assertions and TypeScript pass | `risk-policy.ts` |
| 208 | FIXED + VERIFIED | Multi-operation results had no shared partial-success aggregation | Added structured receipts and deterministic aggregate outcome | Partial-success regression passes | `receipt-aggregator.ts`; `validate:orchestration` |
| 209 | FIXED + VERIFIED | Executable dependency graph was incomplete | Implemented Executable dependency graph | Orchestration/HPO/TypeScript focused gates pass | `executor.ts` |
| 210 | FIXED + VERIFIED | Resolver participates in graph was incomplete | Implemented Resolver participates in graph | Orchestration/HPO/TypeScript focused gates pass | `multi-intent-executor.ts` |
| 211 | FIXED + VERIFIED | Shared handler contract was incomplete | Implemented Shared handler contract | Orchestration/HPO/TypeScript focused gates pass | `executor.ts` |
| 212 | FIXED + VERIFIED | Missing dependency safe-noop was incomplete | Implemented Missing dependency safe-noop | Orchestration/HPO/TypeScript focused gates pass | `executor.ts` |
| 213 | FIXED + VERIFIED | Source conflicts require review was incomplete | Implemented Source conflicts require review | Orchestration/HPO/TypeScript focused gates pass | `source-hierarchy.ts` |
| 214 | FIXED + VERIFIED | Single Today plan loader was incomplete | Implemented Single Today plan loader | Orchestration/HPO/TypeScript focused gates pass | `today-plan.ts` |
| 215 | FIXED + VERIFIED | Typed durable Field Session was incomplete | Implemented Typed durable Field Session | Orchestration/HPO/TypeScript focused gates pass | `orchestration.types.ts` |
| 216 | FIXED + VERIFIED | Context carries expected target was incomplete | Implemented Context carries expected target | Orchestration/HPO/TypeScript focused gates pass | `multi-intent-executor.ts` |
| 217 | FIXED + VERIFIED | Set-stops stores before-state was incomplete | Implemented Set-stops stores before-state | Orchestration/HPO/TypeScript focused gates pass | `hpo-route-command-controller.ts` |
| 218 | FIXED + VERIFIED | Latest eligible undo was incomplete | Implemented Latest eligible undo | Orchestration/HPO/TypeScript focused gates pass | `undo.ts` |
| 219 | FIXED + VERIFIED | Divergent-state undo rejection was incomplete | Implemented Divergent-state undo rejection | Orchestration/HPO/TypeScript focused gates pass | `migration 20260929152000` |
| 220 | FIXED + VERIFIED | Shared Chat/Voice executor was incomplete | Implemented Shared Chat/Voice executor | Orchestration/HPO/TypeScript focused gates pass | `emery.functions.ts; voice.functions.ts` |
| 221 | FIXED + VERIFIED | Registry covers resolver/undo was incomplete | Implemented Registry covers resolver/undo | Orchestration/HPO/TypeScript focused gates pass | `capability-registry.ts` |
| 222 | FIXED + VERIFIED | Executable orchestration coverage was incomplete | Implemented Executable orchestration coverage | Orchestration/HPO/TypeScript focused gates pass | `validate-emery-orchestration.mjs` |
| 223 | FIXED + VERIFIED | Scoped integration gate was incomplete | Implemented Scoped integration gate | Orchestration/HPO/TypeScript focused gates pass | `scope checkpoint` |
| 224 | OPEN | telemetry / self-awareness / system health audit pending | Pending assigned milestone | Pending | — |
| 225 | OPEN | telemetry / self-awareness / system health audit pending | Pending assigned milestone | Pending | — |
| 226 | OPEN | telemetry / self-awareness / system health audit pending | Pending assigned milestone | Pending | — |
| 227 | OPEN | telemetry / self-awareness / system health audit pending | Pending assigned milestone | Pending | — |
| 228 | OPEN | telemetry / self-awareness / system health audit pending | Pending assigned milestone | Pending | — |
| 229 | OPEN | telemetry / self-awareness / system health audit pending | Pending assigned milestone | Pending | — |
| 230 | FIXED + VERIFIED | The binding Jason regression existed only in prose | Added executable exact sentence plus three realistic phrasing variants | `npm run validate:orchestration` passes | `scripts/validate-emery-orchestration.mjs` |
| 231 | OPEN | executable QA audit pending | Pending assigned milestone | Pending | — |
| 232 | OPEN | executable QA audit pending | Pending assigned milestone | Pending | — |
| 233 | OPEN | executable QA audit pending | Pending assigned milestone | Pending | — |
| 234 | OPEN | executable QA audit pending | Pending assigned milestone | Pending | — |
| 235 | OPEN | executable QA audit pending | Pending assigned milestone | Pending | — |
| 236 | OPEN | executable QA audit pending | Pending assigned milestone | Pending | — |
| 237 | OPEN | executable QA audit pending | Pending assigned milestone | Pending | — |
| 238 | OPEN | executable QA audit pending | Pending assigned milestone | Pending | — |
| 239 | OPEN | executable QA audit pending | Pending assigned milestone | Pending | — |
| 240 | OPEN | executable QA audit pending | Pending assigned milestone | Pending | — |
| 241 | OPEN | executable QA audit pending | Pending assigned milestone | Pending | — |
| 242 | OPEN | executable QA audit pending | Pending assigned milestone | Pending | — |
| 243 | OPEN | executable QA audit pending | Pending assigned milestone | Pending | — |
| 244 | OPEN | executable QA audit pending | Pending assigned milestone | Pending | — |
| 245 | OPEN | executable QA audit pending | Pending assigned milestone | Pending | — |
| 246 | OPEN | executable QA audit pending | Pending assigned milestone | Pending | — |
| 247 | OPEN | executable QA audit pending | Pending assigned milestone | Pending | — |
| 248 | OPEN | executable QA audit pending | Pending assigned milestone | Pending | — |
| 249 | OPEN | executable QA audit pending | Pending assigned milestone | Pending | — |
| 250 | OPEN | executable QA audit pending | Pending assigned milestone | Pending | — |
| 251 | OPEN | executable QA audit pending | Pending assigned milestone | Pending | — |
| 252 | OPEN | executable QA audit pending | Pending assigned milestone | Pending | — |
| 253 | OPEN | executable QA audit pending | Pending assigned milestone | Pending | — |
| 254 | OPEN | executable QA audit pending | Pending assigned milestone | Pending | — |
| 255 | OPEN | executable QA audit pending | Pending assigned milestone | Pending | — |
| 256 | OPEN | professional-product acceptance standard audit pending | Pending assigned milestone | Pending | — |
| 257 | OPEN | professional-product acceptance standard audit pending | Pending assigned milestone | Pending | — |
| 258 | OPEN | professional-product acceptance standard audit pending | Pending assigned milestone | Pending | — |
| 259 | OPEN | professional-product acceptance standard audit pending | Pending assigned milestone | Pending | — |
| 260 | OPEN | professional-product acceptance standard audit pending | Pending assigned milestone | Pending | — |
| 261 | OPEN | professional-product acceptance standard audit pending | Pending assigned milestone | Pending | — |
| 262 | OPEN | professional-product acceptance standard audit pending | Pending assigned milestone | Pending | — |
| 263 | OPEN | professional-product acceptance standard audit pending | Pending assigned milestone | Pending | — |
| 264 | OPEN | professional-product acceptance standard audit pending | Pending assigned milestone | Pending | — |
| 265 | OPEN | professional-product acceptance standard audit pending | Pending assigned milestone | Pending | — |
| 266 | OPEN | professional-product acceptance standard audit pending | Pending assigned milestone | Pending | — |
| 267 | OPEN | professional-product acceptance standard audit pending | Pending assigned milestone | Pending | — |
| 268 | OPEN | professional-product acceptance standard audit pending | Pending assigned milestone | Pending | — |
| 269 | OPEN | professional-product acceptance standard audit pending | Pending assigned milestone | Pending | — |
| 270 | OPEN | professional-product acceptance standard audit pending | Pending assigned milestone | Pending | — |

