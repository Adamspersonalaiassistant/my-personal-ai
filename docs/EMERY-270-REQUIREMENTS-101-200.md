# Emery 270 Acceptance Requirements — IDs 101–200

These are binding acceptance requirements. Each ID must be reconciled in `docs/EMERY-PROFESSIONALIZATION-COVERAGE.md`.

101. Map legend category counts reflect active filters.
102. “Mapped offices” count reflects active filters.
103. Add direct Attorney/Doctor/Chiro/Chiro-PT category filters.
104. Make legend tappable as filter.
105. Add relationship-stage map filter.
106. Add priority map filter.
107. Add days-since-last-visit filter.
108. Add follow-up due/overdue filter.
109. Add never-visited filter.
110. Add verified vs partially verified prospect filter.
111. Ownership/exclusion is filterable or clearly represented.
112. Map conveys relationship importance, not only office type.
113. Add subtle secondary visual signal for priority/relationship state.
114. Preserve visual clarity while adding those signals.
115. Fix limited doctor classification logic.
116. Use normalized account-category field rather than growing regex rules.
117. Fix promoted prospect-location query/logic inconsistency.
118. Add canonical multi-location model for established accounts.
119. Do not swallow geocoding failures.
120. Preserve/display useful geocode failure reason.
121. geocoded_at must not imply success when no coordinates were found.
122. Separate geocode attempt/status/error semantics.
123. Prevent work-limit ordering from starving prospect geocoding.
124. Add explicit unmapped-office cleanup queue.
125. Distinguish “never physically visited” from “no relationship activity.”
126. UI labels reflect that distinction.
127. Add clearer relationship lifecycle: cold prospect, visited prospect, warm, active source, key account, dormant, reactivation.
128. Separate next action from broader opportunity.
129. Follow-up and Calendar use one source of truth.
130. Contacts include recency/context/importance.
131. Account Detail immediately answers “who should I ask for?”
132. Account Detail prominently answers “what happened last time?”
133. Unify visit/note/follow-up/lunch/call/route timeline.
134. Research notes visually differ from Adam’s human relationship interactions.
135. Research verification never visually outranks real field history.
136. Remove reloadDocument entering HPO.
137. HPO feels like the same app, not separate mini-app.
138. Avoid full reload loss of transient state.
139. Make HPO Today/Map/Accounts/Activity URL/addressable state.
140. Browser/iPhone Back naturally represents HPO transitions.
141. Durable deep links to specific account detail.
142. Predictable Account Detail back behavior.
143. Selected map office can be restored/addressed.
144. Remove 60-second production-build polling.
145. Remove unnecessary update polling traffic.
146. A new build never hard-refreshes active work.
147. Deploy never unexpectedly reloads active field note/route interaction.
148. Use safe “Update available” UX.
149. Preserve working PWA manifest/standalone behavior.
150. Improve service worker beyond push-only where appropriate.
151. Define real offline-first behavior for critical flows.
152. Define offline read/write/queue/retry/conflict semantics.
153. Add polished global offline state.
154. Add visible pending-sync queue/status.
155. Eliminate excessive 9–10px mobile typography.
156. Improve outdoor/glance readability.
157. Bring interactive touch targets to safe mobile sizes.
158. Remove accessibility zoom restriction.
159. More sheet gets focus trap/restoration.
160. Sheets restore focus to opener.
161. Dialogs support Escape/keyboard reliably.
162. Add automated accessibility checks to CI.
163. Remove global green/emerald/teal→blue theme override.
164. Preserve semantic success/status meaning.
165. Brand blue does not replace semantic success colors.
166. Audit semantic green usage beyond map pins.
167. Replace one-off hardcoded colors with semantic tokens.
168. Centralize tokens for surfaces/elevation/pressed/status/stages/map.
169. Normalize radius system.
170. Normalize press/motion behavior.
171. Consistent loading states.
172. Consistent error/retry states.
173. Empty states provide the best next action.
174. Reduce problematic nested 100dvh/internal scrolling.
175. Fix iPhone keyboard viewport jumps/clipping.
176. Real-device keyboard QA for sheets/inputs.
177. Reassess global overscroll-behavior none.
178. Preserve same Emery backend in HPO sheet.
179. Fix temporary local HPO mini-chat history.
180. Make “one Emery” continuity visible.
181. HPO sheet shows persistent relevant context or clearly behaves as command panel.
182. HPO context handoff is structured, not only prefilled text.
183. Returning from Emery preserves exact HPO view/account/route/scroll state.
184. Preserve internal Emery Calendar.
185. Apple Calendar: implement best feasible adapter/activation path without false claims.
186. Google Calendar: implement best feasible adapter/activation path without false claims.
187. Internal vs external calendar distinction feels natural.
188. Push registration/repair not limited to Calendar screen.
189. Notification health is a global capability.
190. Decompose oversized Calendar component responsibilities.
191. Split Calendar into testable components/hooks.
192. Remove/refactor 60-second Calendar notification polling.
193. Remove/refactor duplicate 60-second AppShell polling.
194. Prefer event-driven/backoff background behavior.
195. Avoid fetching huge HPO datasets unnecessarily on mobile.
196. Make planner scalable.
197. Progressive region/relevant-data loading.
198. Systematic query caching.
199. Reduce sendEmeryMessage pre-response work.
200. Parallelize safe independent operations.
