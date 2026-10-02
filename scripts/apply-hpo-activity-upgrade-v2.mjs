import "./apply-hpo-activity-upgrade.mjs";
import fs from "node:fs";

const read = (file) => fs.readFileSync(file, "utf8");
const write = (file, text) => fs.writeFileSync(file, text);
function replaceOne(file, before, after) {
  const source = read(file);
  if (!source.includes(before)) throw new Error(`Missing snippet in ${file}: ${before.slice(0, 100)}`);
  write(file, source.replace(before, after));
}

replaceOne(
  "src/lib/emery.functions.ts",
  '  const labels = { office_visit: "Office visit", lunch: "Lunch", dinner: "Dinner", event: "Event" };',
  '  const labels: Record<string, string> = { office_visit: "Office visit", lunch: "Lunch", dinner: "Dinner", event: "Event" };',
);

replaceOne(
  "src/routes/_authenticated/hpo.tsx",
  '  const [view, setView] = useState<View>("planner");',
  '  const [view, setView] = useState<View>("planner");\n  useEffect(() => {\n    if (typeof window === "undefined") return;\n    const params = new URLSearchParams(window.location.search);\n    if (params.get("activity") === "1") setView("activity");\n  }, []);',
);

replaceOne(
  "src/routes/_authenticated/hpo.tsx",
  '              <HpoActivityView\n                data={data}',
  '              <HpoActivityView\n                data={data as any}',
);

console.log("HPO Activity v2 compile fixes applied.");
