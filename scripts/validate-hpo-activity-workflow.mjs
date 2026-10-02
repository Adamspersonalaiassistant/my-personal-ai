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
  view.includes("Office visits") &&
    view.includes("Lunches") &&
    view.includes("Dinners") &&
    view.includes("Events"),
  "Activity dropdown is incomplete",
);
console.log("HPO Activity workflow validation passed");
