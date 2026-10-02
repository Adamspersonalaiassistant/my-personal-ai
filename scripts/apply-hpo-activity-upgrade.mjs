import fs from "node:fs";

const read = (file) => fs.readFileSync(file, "utf8");
const write = (file, text) => fs.writeFileSync(file, text);
function replaceOne(file, before, after) {
  const source = read(file);
  if (!source.includes(before)) throw new Error(`Missing snippet in ${file}: ${before.slice(0, 100)}`);
  write(file, source.replace(before, after));
}
function replaceRegex(file, pattern, after) {
  const source = read(file);
  if (!pattern.test(source)) throw new Error(`Missing pattern in ${file}: ${pattern}`);
  write(file, source.replace(pattern, after));
}

replaceOne(
  "src/lib/emery-domain.ts",
  'const HPO = /\\b(hpo|hudson pro|patient management|pcc|pip|workers? comp|referral source|attorney office|provider office|marketing route|office visit|lunch meeting|referrals?|account visit)\\b/i;',
  'const HPO = /\\b(hpo|hudson pro|patient management|pcc|pip|workers? comp|referral source|attorney(?: office)?|law firm|lawyer|provider(?: office)?|doctor|medical office|mri|radiology|orthopedic|referral partner|marketing route|office visit|lunch meeting|business lunch|business dinner|networking event|industry event|referrals?|account visit)\\b/i;',
);

replaceOne(
  "src/lib/hpo-workspace.functions.ts",
  '"id,account_id,contact_id,interaction_type,occurred_at,summary,outcome,relationship_signal,next_action,next_action_due_at,metadata",',
  '"id,account_id,contact_id,interaction_type,activity_type,activity_title,meeting_id,occurred_at,summary,outcome,relationship_signal,next_action,next_action_due_at,metadata",',
);
replaceOne(
  "src/lib/hpo-workspace.functions.ts",
  '.select("id,title,meeting_at,metadata")\n        .eq("user_id", context.userId)\n        .gte("meeting_at", new Date().toISOString())\n        .order("meeting_at")\n        .limit(40),',
  '.select("id,title,meeting_at,end_at,participants,metadata")\n        .eq("user_id", context.userId)\n        .gte("meeting_at", new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString())\n        .lte("meeting_at", new Date(Date.now() + 120 * 24 * 60 * 60 * 1000).toISOString())\n        .order("meeting_at")\n        .limit(120),',
);
replaceOne(
  "src/lib/hpo-workspace.functions.ts",
  'meta["hpo"] === true ||\n            typeof meta["hpo_account_id"] === "string")',
  'meta["hpo"] === true ||\n            typeof meta["hpo_account_id"] === "string" ||\n            typeof meta["account_id"] === "string" ||\n            typeof meta["hpo_activity_type"] === "string")',
);

replaceOne(
  "src/lib/calendar-agent.ts",
  '- Events/meetings/lunches are Calendar commitments and need a start time.',
  '- Events/meetings/lunches/dinners are Calendar commitments and need a start time.',
);
replaceOne(
  "src/lib/calendar-agent.ts",
  '- For lunch events, event_type=lunch.',
  '- For lunch events, event_type=lunch. For dinner events, event_type=dinner.',
);
replaceOne(
  "src/lib/calendar-agent.ts",
  'enum: ["lunch", "meeting", "appointment", "event", "task", null],',
  'enum: ["lunch", "dinner", "meeting", "appointment", "event", "task", null],',
);

replaceOne(
  "src/lib/emery.functions.ts",
  'import { processHpoAction } from "@/lib/hpo-action-controller";\n',
  'import { processHpoAction } from "@/lib/hpo-action-controller";\nimport { processHpoActivity } from "@/lib/hpo-activity-controller";\n',
);
replaceOne(
  "src/lib/emery.functions.ts",
  '}\nfunction hpoRouteStopConfirmation(result: any) {',
  '}\nfunction hpoActivityConfirmation(result: any) {\n  if (result?.needsClarification && result?.question) return String(result.question);\n  if (!result?.recognized) return null;\n  if (!result?.performed) {\n    if (result?.error) return "I understood the HPO Activity update, but I couldn’t save it. I’m not going to claim it was logged.";\n    return null;\n  }\n  const labels = { office_visit: "Office visit", lunch: "Lunch", dinner: "Dinner", event: "Event" };\n  const activityLabel = labels[String(result.activityType)] || "Activity";\n  const title = result.activityTitle || activityLabel;\n  if (result.action === "schedule_activity") return "Added " + title + " to HPO Activity → " + activityLabel + ". I’ll ask you for a recap the next morning.";\n  if (result.alreadySaved) return "That " + activityLabel.toLowerCase() + " recap is already saved in HPO Activity.";\n  return result.nextAction\n    ? "Saved " + title + " under HPO Activity → " + activityLabel + ". Next: " + result.nextAction + "."\n    : "Saved " + title + " under HPO Activity → " + activityLabel + ".";\n}\nfunction hpoRouteStopConfirmation(result: any) {',
);
replaceOne(
  "src/lib/emery.functions.ts",
  '    const hpoAction =\n      hpoEligible &&\n      !hpoFieldRead.recognized &&\n      !hpoRouteCommand.recognized &&\n      !routeStopAction.recognized\n        ? await processHpoAction({',
  '    const hpoActivity =\n      hpoEligible &&\n      !hpoFieldRead.recognized &&\n      !hpoRouteCommand.recognized &&\n      !routeStopAction.recognized\n        ? await processHpoActivity({\n            db,\n            userId,\n            apiKey,\n            message: data.message,\n            recent: turnRecent.filter((x: any) => x.id !== userMessage.id),\n            timezone: profile?.timezone ?? "America/New_York",\n            sourceMessageId: userMessage.id,\n            selectedAccountId: data.source.selectedAccountId ?? null,\n            calendarAction,\n          }).catch((error: any) => {\n            console.error("HPO Activity controller failed", error);\n            return { recognized: false, performed: false, needsClarification: false, question: null, action: "none", activityType: null, activityTitle: null, meetingId: null, accountId: null, accountName: null, recordId: null, nextAction: null, dueAt: null, error: "hpo_activity_failed" };\n          })\n        : { recognized: false, performed: false, needsClarification: false, question: null, action: "none", activityType: null, activityTitle: null, meetingId: null, accountId: null, accountName: null, recordId: null, nextAction: null, dueAt: null };\n    const hpoAction =\n      hpoEligible &&\n      !hpoFieldRead.recognized &&\n      !hpoRouteCommand.recognized &&\n      !routeStopAction.recognized &&\n      !hpoActivity.recognized\n        ? await processHpoAction({',
);
replaceOne(
  "src/lib/emery.functions.ts",
  '    const routeStopReply = hpoRouteStopConfirmation(routeStopAction);\n    const hpoReply = hpoConfirmation(hpoAction);',
  '    const routeStopReply = hpoRouteStopConfirmation(routeStopAction);\n    const hpoActivityReply = hpoActivityConfirmation(hpoActivity);\n    const hpoReply = hpoConfirmation(hpoAction);',
);
replaceOne(
  "src/lib/emery.functions.ts",
  '    const primaryHpoReply = hpoRouteCommandReply ?? routeStopReply ?? hpoReply ?? hpoFieldReadReply;',
  '    const primaryHpoReply = hpoRouteCommandReply ?? routeStopReply ?? hpoActivityReply ?? hpoReply ?? hpoFieldReadReply;',
);
replaceOne(
  "src/lib/emery.functions.ts",
  '            hpo_route_stop_action: routeStopAction,\n            hpo_action: hpoAction,',
  '            hpo_route_stop_action: routeStopAction,\n            hpo_activity: hpoActivity,\n            hpo_action: hpoAction,',
);
replaceOne(
  "src/lib/emery.functions.ts",
  '            : routeStopAction.action !== "none"\n              ? routeStopAction.action\n              : hpoAction.action !== "none"',
  '            : routeStopAction.action !== "none"\n              ? routeStopAction.action\n              : hpoActivity.action !== "none"\n                ? hpoActivity.action\n                : hpoAction.action !== "none"',
);
replaceOne(
  "src/lib/emery.functions.ts",
  '          routeStopAction.needsClarification ||\n          hpoAction.needsClarification',
  '          routeStopAction.needsClarification ||\n          hpoActivity.needsClarification ||\n          hpoAction.needsClarification',
);
replaceOne(
  "src/lib/emery.functions.ts",
  '("error" in routeStopAction && routeStopAction.error) ||\n                ("error" in hpoAction && hpoAction.error)',
  '("error" in routeStopAction && routeStopAction.error) ||\n                ("error" in hpoActivity && hpoActivity.error) ||\n                ("error" in hpoAction && hpoAction.error)',
);
replaceOne(
  "src/lib/emery.functions.ts",
  '        routeStopAction,\n        hpoAction,',
  '        routeStopAction,\n        hpoActivity,\n        hpoAction,',
);

replaceOne(
  "src/routes/_authenticated/hpo.tsx",
  '  CalendarDays,\n',
  '',
);
replaceOne(
  "src/routes/_authenticated/hpo.tsx",
  'import { HpoEmerySheet, openHpoEmery } from "@/components/HpoEmerySheet";\n',
  'import { HpoEmerySheet, openHpoEmery } from "@/components/HpoEmerySheet";\nimport { HpoActivityView } from "@/components/HpoActivityView";\n',
);
replaceOne("src/routes/_authenticated/hpo.tsx", 'type Touch = Workspace["interactions"][number];\n', '');
replaceRegex(
  "src/routes/_authenticated/hpo.tsx",
  /const dateTime = \(value: string \| null \| undefined\) =>[\s\S]*?    : "—";\n/,
  '',
);
replaceRegex(
  "src/routes/_authenticated/hpo.tsx",
  /            \{view === "activity" && data \? \([\s\S]*?            \) : null\}\n            \{selected && \(/,
  '            {view === "activity" && data ? (\n              <HpoActivityView\n                data={data}\n                onOpenAccount={setSelected}\n                onAskEmery={(prompt, title) => openHpoEmery(prompt, title)}\n                onMore={() => void loadMore()}\n                loading={moreLoading}\n              />\n            ) : null}\n            {selected && (',
);
replaceRegex(
  "src/routes/_authenticated/hpo.tsx",
  /function ActivityView\(\{[\s\S]*?\n}\n\nfunction Sheet\(/,
  'function Sheet(',
);

replaceOne(
  "package.json",
  '    "validate:hpo-account": "node scripts/validate-hpo-account-experience.mjs"',
  '    "validate:hpo-account": "node scripts/validate-hpo-account-experience.mjs",\n    "validate:hpo-activity": "node scripts/validate-hpo-activity-workflow.mjs"',
);

console.log("HPO Activity integration patch applied.");
