// Focused runtime checks of the actual Planner UI, selection validation and optimizer.
// Run: node scripts/validate-hpo-planner-workflow.mjs (requires temporary jsdom for UI checks).
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const ts = require("typescript");
const { JSDOM } = require("jsdom");
const dom = new JSDOM(
  '<!doctype html><html><body><div id="root"></div></body></html>',
  { url: "http://localhost/" },
);
for (const key of [
  "window",
  "document",
  "HTMLElement",
  "Element",
  "SVGElement",
  "SVGSVGElement",
  "Event",
  "CustomEvent",
  "MouseEvent",
])
  globalThis[key] = dom.window[key];
Object.defineProperty(globalThis, "navigator", {
  value: dom.window.navigator,
  configurable: true,
});
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
globalThis.requestAnimationFrame = (fn) => setTimeout(fn, 0);
globalThis.cancelAnimationFrame = clearTimeout;
dom.window.SVGSVGElement.prototype.createSVGRect = () => ({});
dom.window.HTMLElement.prototype.scrollIntoView = () => {};
dom.window.HTMLElement.prototype.scrollTo = () => {};
Object.defineProperty(dom.window.HTMLElement.prototype, "clientWidth", {
  get: () => 390,
});
Object.defineProperty(dom.window.HTMLElement.prototype, "clientHeight", {
  get: () => 360,
});
const React = require("react");
const { act } = React;
const { createRoot } = require("react-dom/client");
const cache = new Map();
const stubs = new Map();
const repo = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "..",
);
function load(relative) {
  const file = path.resolve(repo, relative);
  if (cache.has(file)) return cache.get(file);
  const module = { exports: {} };
  cache.set(file, module.exports);
  const source = ts.transpileModule(fs.readFileSync(file, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
    },
  }).outputText;
  function req(id) {
    if (stubs.has(id)) return stubs.get(id);
    if (id.endsWith(".css")) return {};
    if (id.endsWith(".png")) return { default: "/fixture-brain.png" };
    if (id.startsWith("@/")) {
      const base = "src/" + id.slice(2);
      return load(
        fs.existsSync(path.join(repo, base + ".tsx"))
          ? base + ".tsx"
          : base + ".ts",
      );
    }
    return require(id);
  }
  new Function("require", "module", "exports", source)(
    req,
    module,
    module.exports,
  );
  cache.set(file, module.exports);
  return module.exports;
}
const pure = load("src/lib/hpo-planner-selection.ts");
const ids = [
  "11111111-1111-4111-8111-111111111111",
  "22222222-2222-4222-8222-222222222222",
  "33333333-3333-4333-8333-333333333333",
  "44444444-4444-4444-8444-444444444444",
];
const offices = ids.map((id, i) => ({
  accountId: id,
  prospectId: null,
  officeName: ["Alpha Medical", "Bravo Law", "Charlie Medical", "Delta Office"][
    i
  ],
  accountType: ["medical", "attorney", "medical", "other"][i],
  city: "Newark",
  address: `${i + 1} Test Street`,
  latitude: 40.7 + i * 0.01,
  longitude: -74.2 + i * 0.01,
  tags:
    i === 0
      ? ["vein_prospect", "lunch_target", "warm_relationship"]
      : ["need_to_visit"],
  latestNote: i === 0 ? "Prior lunch with the office manager." : null,
}));
for (const input of [
  { routeDate: "2026-02-30", selected: [offices[0]] },
  { routeDate: "2026-10-01", selected: [] },
  { routeDate: "2026-10-01", selected: [offices[0], offices[0]] },
  {
    routeDate: "2026-10-01",
    selected: [{ accountId: ids[0], prospectId: ids[1] }],
  },
])
  assert.throws(() => pure.validatePlannerSelection(input));
assert.equal(
  pure.validatePlannerSelection({
    routeDate: "2026-10-01",
    selected: [offices[0]],
  }).selected[0].visitType,
  "office_visit",
);
assert.equal(
  pure.eligiblePlannerAccount({
    status: "active",
    address: "1 St",
    owner_name: "Bilal",
  }),
  false,
);
assert.equal(
  pure.eligiblePlannerAccount({
    status: "active",
    address: "1 St",
    tags: ["exclude_from_adam_route"],
  }),
  false,
);
assert.equal(
  pure.eligiblePlannerProspect({ address: "1 St", fit_status: "closed" }),
  false,
);
assert.match(pure.plannerGamePlan({}).priorNote, /No prior note/);
assert.doesNotMatch(pure.plannerGamePlan({}).approach, /Jenni|Amanda/);
const routeDate = "2026-10-01";
let savedRoutes = [];
let normalCalls = 0;
let chatCalls = 0;
let buildCalls = 0;
let failFinalize = true;
const sessions = {
  getHpoPlannerOffices: async () => ({
    candidates: [],
    allCandidates: offices,
    eligibleCount: 4,
  }),
  prepareHpoPlannerGamePlan: async ({ data }) =>
    data.selected.map((c) => ({
      ...offices.find((o) => o.accountId === c.accountId),
      gamePlan: pure.plannerGamePlan(
        {
          notes:
            c.accountId === ids[0]
              ? "Prior lunch with the office manager."
              : null,
          next_action: "Confirm follow-up",
        },
        [],
        c.accountId === ids[0]
          ? [{ name: "Saved Contact", role_title: "Office manager" }]
          : [],
      ),
    })),
  chatHpoPlannerGamePlan: async ({ data }) => {
    chatCalls++;
    assert.deepEqual(
      new Set(data.selected.map((c) => c.accountId)),
      new Set(ids.slice(0, 3)),
    );
    return {
      reply: "Follow through on the saved next step with Alpha Medical.",
    };
  },
  buildHpoRouteFromSelection: async ({ data }) => {
    buildCalls++;
    pure.validatePlannerSelection(data);
    assert.equal(data.routeDate, routeDate);
    assert.equal(data.selected.length, 3);
    assert.equal(
      data.selected.find((c) => c.accountId === ids[1]).visitType,
      "lunch",
    );
    assert.equal(
      data.selected.find((c) => c.accountId === ids[0]).visitType,
      "office_visit",
    );
    assert(
      data.planningMessages.some((m) => m.text.includes("saved next step")),
    );
    if (failFinalize)
      throw new Error(
        "Road geometry is temporarily unavailable. Retry Finalize Route.",
      );
    const plans = await sessions.prepareHpoPlannerGamePlan({ data });
    const stops = [...plans]
      .reverse()
      .map((c, i) => ({
        id: `stop-${i}`,
        route_id: "saved-route",
        account_id: c.accountId,
        stop_order: i + 1,
        status: "planned",
        visited_at: null,
        office_name: c.officeName,
        address: c.address,
        city: c.city,
        latitude: c.latitude,
        longitude: c.longitude,
        notes: null,
        visit_summary: null,
        metadata: {
          visit_type: data.selected.find((s) => s.accountId === c.accountId)
            .visitType,
          game_plan: c.gamePlan,
        },
      }));
    savedRoutes = [
      {
        id: "saved-route",
        route_date: routeDate,
        status: "planned",
        area: "Test",
        optimized_at: new Date().toISOString(),
        optimized_duration_seconds: 600,
        optimized_distance_meters: 3200,
        metadata: {
          route_geometry: stops.map((s) => [s.longitude, s.latitude]),
        },
        start_latitude: null,
        start_longitude: null,
        end_latitude: null,
        end_longitude: null,
        notes: null,
        stops,
      },
    ];
    return {
      routeId: "saved-route",
      routeDate,
      stopCount: 3,
      driveMinutes: 10,
      distanceMiles: 2,
    };
  },
};
stubs.set("@tanstack/react-start", { useServerFn: (fn) => fn });
stubs.set("@/lib/hpo-route-session.functions", sessions);
stubs.set("@/lib/hpo-weekly-planner.functions", {
  getHpoWeeklyPlanner: async () => ({
    today: "2026-09-29",
    timezone: "America/New_York",
    weekStart: "2026-09-28",
    weekEnd: "2026-10-04",
    routes: savedRoutes,
  }),
});
stubs.set("@/lib/emery.functions", {
  sendEmeryMessage: async () => {
    normalCalls++;
    throw new Error("Normal chat must not be used");
  },
});
stubs.set("@/components/EmeryVoiceControl", { EmeryVoiceControl: () => null });
stubs.set("@/components/ui/button", {
  Button: ({ children, variant, ...props }) =>
    React.createElement("button", props, children),
});
const sheet = load("src/components/HpoEmerySheet.tsx");
stubs.set("@/components/HpoEmerySheet", sheet);
const { HpoWeeklyPlanner } = load("src/components/HpoWeeklyPlanner.tsx");
function App() {
  const [revision, setRevision] = React.useState(0);
  return React.createElement(
    React.Fragment,
    null,
    React.createElement(HpoWeeklyPlanner, {
      key: revision,
      focusDate: routeDate,
      focusRouteId: revision ? "saved-route" : null,
      onOpenMap: () => {
        throw new Error("Planner Build must open selection, not old builder");
      },
    }),
    React.createElement(sheet.HpoEmerySheet, {
      onRouteBuilt: (id, date) => {
        assert.equal(id, "saved-route");
        assert.equal(date, routeDate);
        setRevision((r) => r + 1);
      },
    }),
  );
}
const root = createRoot(document.getElementById("root"));
async function settle() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 20));
  });
}
async function click(el) {
  assert(el, "Expected UI control");
  await act(async () =>
    el.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })),
  );
  await settle();
}
function button(label) {
  return [...document.querySelectorAll("button")].find(
    (b) => b.textContent.trim() === label,
  );
}
await act(async () => root.render(React.createElement(App)));
await settle();
assert.equal(
  [...document.querySelectorAll("button")].filter(
    (b) => b.textContent.trim() === "Build Route",
  ).length,
  1,
);
assert(!document.body.textContent.includes("Build with Emery"));
await click(button("Build Route"));
assert(document.querySelector('[role="dialog"]'));
assert.equal(
  document.querySelectorAll('[role="button"][aria-pressed="true"]').length,
  0,
);
assert(!document.querySelector('[role="button"]'));
assert(!document.body.textContent.includes("Select top"));
assert.equal(button("Done").disabled, true);
await click(
  [...document.querySelectorAll("button")].find((b) =>
    b.textContent.includes("Doctors / Medical"),
  ),
);
assert(document.body.textContent.includes("VEIN PROSPECT"));
assert(document.body.textContent.includes("LUNCH TARGET"));
await click(
  [...document.querySelectorAll('[role="button"]')].find((b) =>
    b.textContent.includes("Alpha Medical"),
  ),
);
await click(
  [...document.querySelectorAll('[role="button"]')].find((b) =>
    b.textContent.includes("Charlie Medical"),
  ),
);
await click(
  [...document.querySelectorAll("button")].find((b) =>
    b.textContent.includes("Attorneys"),
  ),
);
await click(
  [...document.querySelectorAll('[role="button"]')].find((b) =>
    b.textContent.includes("Bravo Law"),
  ),
);
await click(button("Done"));
assert(document.querySelector('[aria-label="Emery Game Plan"]'));
assert(!document.body.textContent.includes("Delta Office"));
assert.equal(
  document.querySelectorAll('[role="group"] button[aria-pressed="true"]')
    .length,
  3,
);
assert(document.body.textContent.includes("Saved Contact"));
const group = document.querySelector('[aria-label="Visit type for Bravo Law"]');
await click(
  [...group.querySelectorAll("button")].find((b) => b.textContent === "Lunch"),
);
const textarea = document.querySelector("textarea");
await act(async () => {
  const setter = Object.getOwnPropertyDescriptor(
    dom.window.HTMLTextAreaElement.prototype,
    "value",
  ).set;
  setter.call(textarea, "Review the selected offices");
  textarea.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
});
await click(document.querySelector('[aria-label="Send to Emery"]'));
assert.equal(chatCalls, 1);
assert.equal(normalCalls, 0);
await click(button("Finalize Route"));
assert(document.querySelector('[role="dialog"]'));
assert(
  document.body.textContent.includes(
    "Road geometry is temporarily unavailable",
  ),
);
failFinalize = false;
await click(button("Finalize Route"));
await act(async () => {
  await new Promise((r) => setTimeout(r, 500));
});
await settle();
assert.equal(buildCalls, 2);
assert(!document.querySelector('[role="dialog"]'));
assert(document.querySelector('[aria-label="Optimized Planner route map"]'));
assert(
  document.querySelector(".leaflet-overlay-pane path.leaflet-interactive"),
  "Road line must render in real Leaflet",
);
assert.equal(document.querySelectorAll(".hpo-route-number-tooltip").length, 3);
assert(document.body.textContent.includes("10 min"));
assert(document.body.textContent.includes("2.0 mi"));
assert(document.body.textContent.includes("Emery Game Plan"));
assert(document.body.textContent.includes("Lunch"));
assert.deepEqual(
  savedRoutes[0].stops.map((s) => s.office_name),
  ["Charlie Medical", "Bravo Law", "Alpha Medical"],
);
await act(async () => root.unmount());
console.log(
  "PASS: selection, exact date, tags, grouped choices, read-only chat, failed finalize/retry, saved classifications/game plan, optimized order, real Leaflet line and numbered stops.",
);

// Exercise the actual optimizer with road service responses and transaction faults.
const chain = () => ({
  middleware() {
    return this;
  },
  inputValidator() {
    return this;
  },
  handler() {
    return () => {};
  },
});
stubs.set("@tanstack/react-start", {
  useServerFn: (fn) => fn,
  createServerFn: chain,
});
stubs.set("@/integrations/supabase/auth-middleware", {
  requireSupabaseAuth: {},
});
stubs.set("@/lib/model-policy", { MODEL_POLICY: { primary: "test" } });
stubs.set("@/lib/emery/error-serializer", {
  serializeError: (e) => ({ message: e.message ?? String(e) }),
});
stubs.set("@/lib/execution-ledger", {
  beginExecution: async () => ({
    id: "test-run",
    status: "running",
    reused: false,
  }),
  completeExecution: async () => {},
  failExecution: async () => {},
  clarifyExecution: async () => {},
});
stubs.set("@/lib/execution-kernel", {
  executeCanonicalTaskCreate: async () => {},
});
stubs.set("@/lib/hpo-geocode", {
  geocodeHpoOfficeAddress: async () => {
    throw new Error("Unexpected geocode");
  },
});
const { executeHpoRouteOptimizeCore } = load("src/lib/hpo-route.functions.ts");
let matrix = [
  [0, 100, 10],
  [100, 0, 20],
  [10, 20, 0],
];
let geometry = true;
let requests = 0;
let applied = [];
let rpcFailure = false;
const realFetch = globalThis.fetch;
globalThis.fetch = async (url) => {
  requests++;
  return {
    ok: true,
    json: async () =>
      String(url).includes("/table/")
        ? { durations: matrix, distances: matrix }
        : {
            routes: [
              {
                geometry: {
                  coordinates: geometry
                    ? [
                        [-74.2, 40.7],
                        [-74.18, 40.72],
                        [-74.19, 40.71],
                      ]
                    : [],
                },
              },
            ],
          },
  };
};
function dbFor(count = 3, status = "planned") {
  const route = {
    id: "optimizer-route",
    status,
    metadata: { source_channel: "hpo_planner:runtime-test" },
    start_address: null,
    end_address: null,
  };
  const stops = offices
    .slice(0, count)
    .map((o, i) => ({
      id: `s${i}`,
      stop_order: i + 1,
      office_name: o.officeName,
      latitude: o.latitude,
      longitude: o.longitude,
      status: "planned",
    }));
  return {
    from(table) {
      const result = {
        data: table === "hpo_route_plans" ? route : stops,
        error: null,
      };
      const q = {
        select() {
          return this;
        },
        eq() {
          return this;
        },
        order() {
          return this;
        },
        single() {
          return Promise.resolve(result);
        },
        then(resolve, reject) {
          return Promise.resolve(result).then(resolve, reject);
        },
      };
      return q;
    },
    async rpc(name, args) {
      assert.equal(name, "emery_hpo_finalize_planner_order");
      if (rpcFailure)
        return { data: null, error: new Error("Route became active") };
      applied.push(args);
      return { data: { id: route.id, ...args.p_patch }, error: null };
    },
  };
}
async function optimizeTest(db) {
  return executeHpoRouteOptimizeCore({
    db,
    userId: "test-user",
    routeId: "optimizer-route",
    idempotencyKey: "test-key",
    sourceChannel: "hpo_planner:runtime-test",
    plannerSessionId: "runtime-test",
  });
}
await optimizeTest(dbFor());
assert.deepEqual(applied[0].p_stop_ids, ["s0", "s2", "s1"]);
assert.equal(
  applied[0].p_patch.metadata.optimization_engine,
  "open_road_matrix",
);
assert.equal(applied[0].p_patch.metadata.route_geometry.length, 3);
const before = applied.length;
geometry = false;
await assert.rejects(() => optimizeTest(dbFor()), /Road geometry/);
assert.equal(
  applied.length,
  before,
  "Missing geometry must never commit order",
);
geometry = true;
matrix = [
  [0, null, null],
  [null, 0, null],
  [null, null, 0],
];
await assert.rejects(
  () => optimizeTest(dbFor()),
  /connect every selected stop/,
);
assert.equal(applied.length, before);
const callsBefore = requests;
const single = await optimizeTest(dbFor(1));
assert.equal(single.driveMinutes, 0);
assert.equal(single.distanceMiles, 0);
assert.equal(requests, callsBefore, "One stop needs no road service call");
await assert.rejects(() => optimizeTest(dbFor(3, "active")), /active/);
matrix = [
  [0, 100, 10],
  [100, 0, 20],
  [10, 20, 0],
];
rpcFailure = true;
await assert.rejects(() => optimizeTest(dbFor()), /became active/);
globalThis.fetch = realFetch;
console.log(
  "PASS: real optimizer preserves all selected stops, changes order using road times, requires geometry, rejects disconnected roads, handles one stop, and refuses a route that becomes active.",
);

// Test the actual Planner server handlers: owner scoping, saved history and isolated chat.
stubs.set('@tanstack/react-start', {
 createServerFn:()=>({ middleware(){return this;},inputValidator(fn){this.validate=fn;return this;},handler(fn){const validate=this.validate;return async(args={})=>fn({data:validate?validate(args.data):args.data,context:args.context});} }),
});
let savedPayload=null;
stubs.set('@/lib/hpo-route.functions',{executeHpoRouteOptimizeCore:async(args)=>{assert.equal(args.plannerSessionId,'server-test');return {driveMinutes:4,distanceMiles:1,optimizedAt:'2026-09-30T00:00:00Z'};}});
const actualSessions=load('src/lib/hpo-route-session.functions.ts');
const records={
 hpo_accounts:offices.map((o)=>({...o,id:o.accountId,user_id:'test-user',name:o.officeName,account_type:o.accountType,status:'active',owner_name:'Adam',notes:o.latestNote,next_action:'Follow up',metadata:{}})).concat([{id:'excluded',user_id:'test-user',name:'Excluded',address:'1 Test',status:'active',tags:['exclude_from_adam_route']}]),
 hpo_prospects:[],
 hpo_interactions:[{account_id:ids[0],user_id:'test-user',occurred_at:'2026-09-20',summary:'Saved visit summary',next_action:'Confirm the next meeting',outcome:'receptive'}],
 hpo_contacts:[{account_id:ids[0],user_id:'test-user',name:'Verified Manager',role_title:'Office manager'}],
};
const serverDB={from(table){assert(table in records,`Unexpected table: ${table}`);let conditions=[];let included=null;let range=null;let limit=null;
 const q={select(){return this;},eq(field,value){conditions.push([field,value]);return this;},in(field,values){included=[field,values];return this;},order(){return this;},range(from,to){range=[from,to];return this;},limit(count){limit=count;return this;},then(resolve,reject){let data=records[table].filter(r=>conditions.every(([f,v])=>r[f]===v));if(included)data=data.filter(r=>included[1].includes(r[included[0]]));if(range)data=data.slice(range[0],range[1]+1);if(limit)data=data.slice(0,limit);return Promise.resolve({data,error:null}).then(resolve,reject);}};return q;},async rpc(name,args){assert.equal(name,'emery_hpo_create_planner_selection');savedPayload=args;return {data:{route_id:'server-route'},error:null};}};
const serverContext={supabase:serverDB,userId:'test-user'};
const pool=await actualSessions.getHpoPlannerOffices({context:serverContext});assert.equal(pool.allCandidates.length,4);assert.equal(pool.candidates.length,0);
const selected=[{accountId:ids[0],visitType:'lunch'}];
const plans=await actualSessions.prepareHpoPlannerGamePlan({data:{routeDate,selected},context:serverContext});
assert.equal(plans.length,1);assert.match(plans[0].gamePlan.priorNote,/Saved visit summary/);assert.match(plans[0].gamePlan.approach,/Verified Manager/);
await assert.rejects(()=>actualSessions.prepareHpoPlannerGamePlan({data:{routeDate,selected:[{accountId:'55555555-5555-4555-8555-555555555555'}]},context:serverContext}),/unavailable or excluded/);
const originalKey=process.env.OPENAI_API_KEY;process.env.OPENAI_API_KEY='test-only-placeholder';
globalThis.fetch=async(url,args)=>{assert.equal(url,'https://api.openai.com/v1/responses');const body=JSON.parse(args.body);assert(!body.tools,'Planner must have no web/write tools');const context=body.input[0].content;assert(context.includes('Alpha Medical'));assert(context.includes('Verified Manager'));assert(!context.includes('Bravo Law'));assert(!context.includes('Delta Office'));return {ok:true,json:async()=>({output:[{content:[{type:'output_text',text:'Ask the saved office manager about the recorded next step.'}]}]})};};
const answer=await actualSessions.chatHpoPlannerGamePlan({data:{routeDate,selected,message:'What should I ask?'},context:serverContext});assert.match(answer.reply,/saved office manager/);
const serverResult=await actualSessions.buildHpoRouteFromSelection({data:{routeDate,selected,sessionId:'server-test',planningMessages:[{role:'assistant',text:answer.reply}]},context:serverContext});
assert.equal(serverResult.routeId,'server-route');assert.equal(savedPayload.p_route_date,routeDate);assert.equal(savedPayload.p_stops.length,1);assert.equal(savedPayload.p_stops[0].visit_type,'lunch');assert.match(savedPayload.p_stops[0].game_plan.priorNote,/Saved visit summary/);assert.equal(savedPayload.p_game_plan.discussion[0].text,answer.reply);
if(originalKey===undefined)delete process.env.OPENAI_API_KEY;else process.env.OPENAI_API_KEY=originalKey;
globalThis.fetch=realFetch;
console.log('PASS: actual server handlers scope saved offices, preserve verified notes/contacts, reject missing offices, isolate selected-office chat, and save exact Planner date/classifications/context.');
