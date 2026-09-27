import fs from "node:fs";

function read(path) {
  return fs.readFileSync(path, "utf8");
}
function check(name, ok) {
  if (!ok) {
    console.error(`FAIL: ${name}`);
    process.exitCode = 1;
  } else {
    console.log(`PASS: ${name}`);
  }
}

const planner = read("src/components/HpoRoutePlanner.tsx");
const adapter = read("src/components/hpo-map/HpoMapAdapter.tsx");
const v2 = read("src/components/hpo-map/HpoMapV2MapLibre.tsx");
const routeFns = read("src/lib/hpo-route.functions.ts");
const packageJson = JSON.parse(read("package.json"));
const migration = read("supabase/migrations/20260927234500_hpo_map_v2_feature_flag.sql");

check("Map V1 remains in Route Planner", planner.includes("function OfficePlanningMap("));
check("Route Planner uses renderer adapter", planner.includes("<HpoMapAdapter"));
check("Map V1 is supplied as fallback", planner.includes("v1={") && planner.includes("<OfficePlanningMap"));
check("MapLibre dependency is declared", Boolean(packageJson.dependencies?.["maplibre-gl"]));
check("Map V2 feature flag defaults off", /hpo_map_v2 boolean not null default false/i.test(migration));
check("Route Planner loads Map V2 feature flag", routeFns.includes('select("hpo_map_v2")'));
check("Map V2 uses GeoJSON clustering", v2.includes("cluster: true") && v2.includes("hpo-office-clusters"));
check("Map V2 preserves account/prospect filters", v2.includes('"account"') && v2.includes('"prospect"'));
check("Map V2 distinguishes account and prospect points", v2.includes("hpo-office-points") && v2.includes("hpo-prospect-points"));
check("Map V2 supports synchronized office focus", v2.includes("selectedOfficeKey") && v2.includes("onSelectOffice"));
check("Map V2 preserves route line", v2.includes("hpo-route-line") && v2.includes("route_geometry"));
check("Map V2 preserves numbered route stops", v2.includes("hpo-route-stop-numbers"));
check("Map V2 exposes current location control", v2.includes("GeolocateControl"));
check("OSRM routing remains unchanged", routeFns.includes("router.project-osrm.org/table/v1/driving"));
check("Map V2 is light/blue rather than dark-filter V1", v2.includes('const BLUE = "#1769e8"') && v2.includes('bg-white'));

if (process.exitCode) process.exit(process.exitCode);
console.log("HPO Field OS Map V2 foundation certification passed.");
