# Emery 270 Acceptance Requirements — IDs 201–270

These are binding acceptance requirements. Each ID must be reconciled in `docs/EMERY-PROFESSIONALIZATION-COVERAGE.md`.

201. Measure time-to-first-response and tool-execution latency.
202. Add true/progressive text response streaming where feasible.
203. Provide progressive feedback for long operations.
204. Shared typed RequestContext across Chat and Voice.
205. Typed ActionPlan/PlannedIntent replaces domain gating.
206. Declarative typed capability registry.
207. Centralized risk/confirmation policy.
208. Shared partial-success receipt aggregation.
209. Central source hierarchy: live CRM/current correction > recent interaction > historical memory > research inference.
210. One centralized resolver applies source hierarchy.
211. Reduce unsafe any in core server code.
212. Remove unjustified no-explicit-any suppressions.
213. Strengthen TypeScript around tool results.
214. Split emery.functions.ts orchestration monolith.
215. Split oversized route controllers.
216. Reduce regression risk through modular boundaries.
217. Complete planner→resolver→executor→receipt pipeline.
218. Shared declarative tool definitions for Chat and Voice.
219. Chat and Voice share the same resolution/action-planning logic.
220. Centralize permissions/confirmation by action risk.
221. Low-risk actions may execute directly; high-impact replacements require stronger confirmation.
222. Add explicit undo framework.
223. “Undo that” operates on execution receipts.
224. Preserve execution/run telemetry.
225. Normalize safe error serialization.
226. Group repeated failures into health issues.
227. Surface repeated production failures automatically.
228. Health metrics include route/controller/Calendar/Voice success and latency.
229. Emery knows when a capability is unhealthy and gives evidence-based health recommendations without pretending sentience.
230. Preserve executable exact Jason regression.
231. CI covers Jason failure class.
232. CI covers route reorder regression.
233. CI covers optimization regression.
234. Expand QA beyond build/TS/lint/static validators.
235. Add real browser E2E.
236. Add conventional unit/integration tests for key workflows.
237. Static validators alone are not accepted as proof.
238. Exact Jason sentence must pass end-to-end.
239. Add broad multi-intent language suite.
240. Add many paraphrase tests for key field actions.
241. Browser test: Today→Talk to Emery→modify route→dictate visit→follow-up.
242. Add visual regression for major mobile screens.
243. Add automated accessibility audit.
244. Add performance budget to CI.
245. Add iPhone Safari/PWA regression strategy; automate what is feasible and document manual remainder.
246. Test keyboard open/close for Chat/Account Detail/Calendar/HPO sheets.
247. Test network loss during route actions.
248. Test retry/idempotency after interruption.
249. Test duplicate-write prevention across Chat/Voice/Shortcut/buttons.
250. Test contact→firm→account→location entity resolution.
251. Test ownership/exclusion so Emery never routes Adam to another owner’s relationship.
252. Test automated research cannot overwrite newer live CRM facts.
253. Test safe duplicate consolidation without losing history.
254. Voice acceptance covers interruption/noise/partial sentence/correction.
255. Natural correction language works across action systems.
256. Professional means more than attractive UI.
257. Navigation never unexpectedly reloads.
258. Normal natural language reliably performs the intended operation.
259. Failures preserve work and clearly explain outcome.
260. Adam always knows whether an action actually saved.
261. Important operations are idempotent.
262. Back behavior is predictable.
263. Keyboard/safe areas/sheets/scroll feel native on iPhone.
264. Data confidence is visible when relevant.
265. Emery asks one intelligent clarification instead of failing the whole request.
266. Edge cases are handled before Adam has to discover them.
267. Emery knows what is truly executable and never falsely promises.
268. Chat/Voice/Shortcut/Calendar/HPO feel like one assistant.
269. Route and CRM state remain trustworthy after retries/offline/crashes/updates.
270. Adam spends time making Emery more capable, not reporting basic polish defects.

## Binding exact regression

Input:
“I have my lunch today with Jason so can you put that as the only stop for today and get ready to take the note because I will let you know how it went afterwards”

Required result:
- plan multiple compatible intents;
- Calendar may contribute but never suppress HPO just because it recognized language;
- resolve today’s meeting/person and use HPO contacts/account/prospect/entity aliases;
- ask only one narrow clarification if the HPO office remains genuinely unresolved;
- preserve completed visits;
- make the resolved office the only remaining stop;
- persist Field Session + expected note target;
- return an execution receipt in natural language;
- retry is idempotent.

## Additional mandatory end-to-end behaviors

- Morning planning in natural speech.
- “I’m here.”
- “Just left…” visit capture.
- Follow-up creation.
- “Undo that.”
- Offline→retry→idempotent sync.
- Duplicate-write prevention across surfaces.
- Selected-account context.
- Ownership/exclusion protection.
- Research conflict protection.
- Voice interruption/correction.
- End-of-day wrap and next-day carry-forward.
