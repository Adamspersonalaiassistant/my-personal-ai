# Emery 270 Acceptance Requirements — IDs 1–100

These are binding acceptance requirements. Each ID must be reconciled in `docs/EMERY-PROFESSIONALIZATION-COVERAGE.md`.

1. Calendar must not hijack HPO requests.
2. Fix the Jason failure where Calendar recognition with zero operation blocked HPO.
3. Replace first-controller-wins with multi-intent planning.
4. Decompose multi-intent requests.
5. Reduce regex-only domain detection.
6. Use current app/surface context in intent.
7. Add a real action-plan object.
8. Add unified cross-domain execution receipts.
9. Handle cross-domain partial success explicitly.
10. Make failure language natural and specific.
11. Recover intelligently before asking Adam to retry.
12. Support “make this my only stop today.”
13. Add safe set-stops/only-remaining-stop route operation.
14. Never erase completed visits when replacing remaining stops.
15. Add first-class Today’s Plan.
16. Add persistent Field Session.
17. “Get ready to take my notes” must arm a durable expected-note target.
18. Resolve person→meeting→HPO account.
19. Resolve people through HPO contacts.
20. Resolve firm aliases/contact names to canonical account.
21. Ask one narrow clarification when resolution genuinely fails.
22. Shared entity layer across Calendar/contacts/HPO/prospects/people.
23. Meetings can durably link to HPO accounts.
24. Today becomes Emery-centric field command center.
25. Today understands scheduled appointments without a formal route.
26. Today represents scheduled stop + optional prospecting.
27. Automatic pre-visit brief.
28. End-of-day field summary.
29. Reconcile unfinished stops at end of day.
30. Tomorrow planning uses today’s outcomes.
31. Current base voice is Coral.
32. Existing feminine/warm prompt still sounds masculine to Adam.
33. Do not assume more adjectives can fix acoustic timbre.
34. Add true voice audition/change workflow.
35. Reduce overconstrained voice-style prompting.
36. Dominican/Caribbean character stays subtle and natural.
37. HPO microphone access must not be needlessly hidden/frictionful.
38. Today needs prominent Talk to Emery.
39. HPO voice launch passes active route ID.
40. Known route context is passed explicitly rather than inferred.
41. Pass current stop ID explicitly.
42. Pass selected account context explicitly.
43. Durable expected-next-note target.
44. “I’m here” binds subsequent notes to that stop.
45. Add field-specific “Just left…” structured parser.
46. Voice confirms saves naturally, not with DB jargon.
47. Improve Siri Shortcut beyond one-way dictation where platform allows.
48. Respect web/PWA custom wake-word limitations; implement realistic entry points.
49. Shortcut→Emery→spoken response as seamless as platform permits.
50. Base-voice changes gracefully reconnect realtime voice.
51. Fix repeated production route-reorder failures.
52. Fix route-optimization verification failure.
53. Never log route errors as “[object Object]”.
54. Preserve underlying diagnostic error detail.
55. Structured route error codes/details.
56. Collision-safe/transactional reorder.
57. Optimization failure preserves manual route.
58. Optimization failure UX offers safe retry/manual recovery.
59. First-class single-stop/scheduled-meeting route workflow.
60. Route scheduling and Calendar scheduling become one field-day concept.
61. Replace obsolete prospect fit “accepted” with live statuses.
62. No-last-touch must not be treated as 120 stale days.
63. Unknown history differs from stale relationship.
64. Remove blanket account advantage over stronger prospects.
65. Relationship health materially affects nearby scoring.
66. Relationship stage materially affects scoring.
67. Historical engagement materially affects scoring.
68. Verification confidence materially affects scoring.
69. Do not discard good candidates solely by straight-line prefilter before road-time analysis.
70. Distinguish “best relationship opportunity” from “closest office.”
71. Explain recommendations with visible reasons.
72. Normalize accounts imported from prospect dataset.
73. Audit/classify the large set of accounts staged Prospect.
74. Separate HPO prospect-import origin from real relationship state.
75. Make priority meaningful rather than default-heavy.
76. UI intelligence must not overstate weak classification data.
77. Separate warm/established attorneys from cold researched offices.
78. Classify historical doctor relationships correctly.
79. Normalize stage vocabulary/casing.
80. Canonical relationship-stage enum + safe migration.
81. Improve account-type coverage beyond mostly Primary Care/Attorney.
82. Populate Chiro/Chiro-PT only from supported data.
83. Map categories must be backed by normalized DB classification.
84. Safely consolidate known duplicates.
85. Established relationships must not compete with duplicate cold prospects.
86. Make exclusions structured routing rules.
87. Newer explicit exclusions override stale historical state.
88. Partially verified offices have visible confidence state.
89. Partially verified and twice-verified offices look different.
90. Provenance is visible enough to trust.
91. Show verification source/date when useful.
92. Automated research changes have review history.
93. Add polished duplicate merge-review.
94. Safe prospect-write layer must be callable through trusted research bridge.
95. Existing server functions alone do not equal external Work access.
96. Add controlled Emery research→verify→write bridge.
97. Add safe existing-account research updates.
98. Add safe contact create/update.
99. Add safe interaction-history import.
100. Stage/priority corrections use conflict checking.
