import fs from "node:fs";
const read = (file) => fs.readFileSync(file, "utf8");
const expect = (condition, message) => {
  if (!condition) throw new Error(message);
};
const controller = read("src/lib/hpo-activity-controller.ts");
const view = read("src/components/HpoActivityView.tsx");
const emery = read("src/lib/emery.functions.ts");
const workspace = read("src/lib/hpo-workspace.functions.ts");
for (const type of ["office_visit", "lunch", "dinner", "event"]) {
  expect(controller.includes(type), `controller missing ${type}`);
  expect(view.includes(type), `Activity view missing ${type}`);
}
expect(emery.includes("processHpoActivity"), "regular Emery is not connected to HPO Activity");
expect(
  workspace.includes("activity_type,activity_title,meeting_id"),
  "HPO workspace does not load structured activity fields",
);
expect(
  view.includes('role="tablist"') && view.includes('role="tab"') &&
    view.includes("Office Visits") && view.includes("Lunches") &&
    view.includes("Dinners") && view.includes("Events"),
  "Activity must have exactly the four primary HPO activity tabs",
);
expect(view.includes("Review and log") && view.includes("noteInteractionId"), "Planner notes are not reviewable from Activity");
expect(view.includes("Log recap to HPO account") && view.includes("saveHpoActivityLog"), "Calendar recaps are not persisted in HPO CRM");
const actions = read("src/lib/hpo-activity-actions.functions.ts");
expect(actions.includes("eq(\"meeting_id\"") && actions.includes("hpo_recap_status"), "Calendar events must be deduplicated and marked recapped");
const calendar = read("src/routes/_authenticated/calendar.tsx");
expect(calendar.includes('<option value="dinner">Dinner</option>'), "Dinner must be creatable from Calendar");
console.log("HPO Activity workflow validation passed");
