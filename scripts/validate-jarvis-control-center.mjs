// Runtime contract checks against the actual candidate components and handlers.
// External browser, microphone and database services are deterministic fakes.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { reconcileDeployment, runtimeTelemetry, executionReceipts } from '../src/lib/jarvis/state.ts';
const require = createRequire(import.meta.url);
const ts = require('typescript');
let checks = 0;
async function check(name, fn) { await fn(); console.log(`PASS ${name}`); checks++; }
function load(file, mocks) {
  const source = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', source)((id) => {
    if (id in mocks) return mocks[id];
    return require(id);
  }, module, module.exports);
  return module.exports;
}
const jsx = (type, props) => ({ type, props });
const jsxRuntime = { jsx, jsxs: jsx, Fragment: 'fragment' };
const icons = new Proxy({}, { get: (_, name) => name === '__esModule' ? true : () => null });
function hooks() {
  const slots = []; let index = 0; const cleanup = [];
  const react = {
    useState(initial) { const i = index++; slots[i] ??= { value: initial }; return [slots[i].value, (v) => { slots[i].value = typeof v === 'function' ? v(slots[i].value) : v; }]; },
    useRef(initial) { const i = index++; slots[i] ??= { current: initial }; return slots[i]; },
    useCallback(fn, deps) { const i = index++; const old = slots[i]; if (!old || deps.some((d, j) => d !== old.deps[j])) slots[i] = { fn, deps }; return slots[i].fn; },
    useEffect(fn, deps) { const i = index++; const old = slots[i]; if (!old || deps.some((d, j) => d !== old[j])) { cleanup.push(fn()); slots[i] = deps; } },
  };
  return { react, render(fn, props) { index = 0; return fn(props); }, unmount() { cleanup.forEach((fn) => fn?.()); } };
}
function nodes(tree) {
  if (!tree || typeof tree !== 'object') return [];
  const children = tree.props?.children;
  return [tree, ...(Array.isArray(children) ? children : [children]).flatMap((c) => Array.isArray(c) ? c.flatMap(nodes) : nodes(c))];
}
const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };
const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };

await check('deployment sync requires served evidence and verified matching release', () => {
  const sha = 'a'.repeat(40); const release = { production_commit_sha: sha, deployment_verified: true };
  const input = { servedCommit: sha, runningCommit: null, githubMain: sha, latestRelease: release };
  assert.equal(reconcileDeployment(input).in_sync, true);
  assert.equal(reconcileDeployment({ ...input, servedCommit: null }).in_sync, null);
  assert.equal(reconcileDeployment({ ...input, latestRelease: { ...release, deployment_verified: false } }).in_sync, false);
  assert.equal(reconcileDeployment({ ...input, githubMain: 'b'.repeat(40) }).in_sync, false);
  assert.equal(reconcileDeployment({ ...input, githubMain: null }).in_sync, null);
});

await check('diagnostics handler enforces auth, owner scope, bounds and strips metadata/errors', async () => {
  const queries = [];
  const db = { from(table) {
    const calls = []; queries.push({ table, calls });
    const q = new Proxy({}, { get(_, name) {
      if (name === 'then') return (done) => Promise.resolve({ data: table === 'emery_runtime_events'
        ? [{ created_at: '2026-10-08T00:00:00Z', event_type: 'action', action: 'hpo.visit', domain: 'hpo', status: 'error', metadata: { patient_name: 'PRIVATE', error: 'SECRET' } }]
        : [{ status: 'failed', error_message: 'PRIVATE', error_code: 'SECRET' }], error: null }).then(done);
      return (...args) => { calls.push([name, ...args]); return q; };
    } }); return q;
  } };
  const auth = {};
  const createServerFn = () => {
    const builder = { middleware(m) { this.auth = m; return this; }, inputValidator() { return this; }, handler(fn) { fn.auth = this.auth; return fn; } }; return builder;
  };
  const exports = load('src/lib/jarvis.functions.ts', {
    '@tanstack/react-start': { createServerFn },
    '@/integrations/supabase/auth-middleware': { requireSupabaseAuth: auth },
    '@/lib/jarvis/room': {}, '@/lib/jarvis/request-auth': {}, '@/lib/jarvis/turn-reconcile': {},
    '@/lib/jarvis/voice': {}, '@/lib/model-policy': {},
    '@/lib/jarvis/state': { runtimeTelemetry, executionReceipts },
  });
  assert.deepEqual(exports.getJarvisControlCenterIssues.auth, [auth]);
  const result = await exports.getJarvisControlCenterIssues({ context: { supabase: db, userId: 'owner-fixture' } });
  assert.equal(result.failed_executions, 1); assert.equal(result.recent_problems.length, 1);
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE|SECRET|metadata|error_message/);
  for (const { calls } of queries) {
    assert.ok(calls.some((c) => c[0] === 'eq' && c[1] === 'user_id' && c[2] === 'owner-fixture'));
    assert.ok(calls.some((c) => c[0] === 'gte' && c[1] === 'created_at'));
    assert.ok(calls.some((c) => c[0] === 'limit' && c[1] <= 1000));
  }
  const broken = { from() { return { select() { return this; }, eq() { return this; }, gte() { return this; }, order() { return this; }, limit() { return Promise.resolve({ data: null, error: { message: 'read failed' } }); } }; } };
  await assert.rejects(exports.getJarvisControlCenterIssues({ context: { supabase: broken, userId: 'owner-fixture' } }), /read failed/);
});

await check('authenticated parent rejects unauthenticated access and retains owner route context', async () => {
  let user = null;
  const { Route } = load('src/routes/_authenticated/route.tsx', {
    '@tanstack/react-router': { createFileRoute: () => (opts) => opts, Outlet: () => null, redirect: (opts) => new Error(`redirect:${opts.to}`) },
    '@/lib/supabase': { supabase: { auth: { getUser: async () => ({ data: { user }, error: null }) } } },
    'react/jsx-runtime': jsxRuntime,
  });
  assert.equal(Route.ssr, false);
  await assert.rejects(Route.beforeLoad(), /redirect:\//);
  user = { id: 'owner-fixture' }; assert.deepEqual(await Route.beforeLoad(), { user });
  const tree = fs.readFileSync('src/routeTree.gen.ts', 'utf8');
  assert.match(tree, /id: '\/jarvis'[\s\S]*?getParentRoute: \(\) => AuthenticatedRouteRoute/);
  assert.match(fs.readFileSync('src/routes/_authenticated/settings.tsx', 'utf8'), /to="\/jarvis"/);
});

function voiceFixture() {
  const h = hooks(); const token = deferred(); const microphone = deferred();
  let requests = 0; let returned = 0; let exclusiveStop; const peers = []; const audio = [];
  const getMedia = () => { requests++; return microphone.promise; };
  globalThis.window = {};
  Object.defineProperty(globalThis, 'navigator', { value: { mediaDevices: { getUserMedia: getMedia } }, configurable: true });
  globalThis.document = { createElement() { const a = { setAttribute() {}, style: {}, remove() { a.removed = true; }, play: async () => {} }; audio.push(a); return a; }, body: { appendChild() {} } };
  globalThis.RTCPeerConnection = class {
    constructor() { this.channel = { readyState: 'open', sent: [], send: (s) => this.channel.sent.push(s), close: () => {} }; peers.push(this); }
    addTrack() {} getSenders() { return []; } close() { this.closed = true; }
    createDataChannel() { return this.channel; } createOffer = async () => ({ sdp: 'offer' });
    setLocalDescription = async () => {}; setRemoteDescription = async () => {};
  };
  globalThis.fetch = async () => ({ ok: true, text: async () => 'answer' });
  const turn = deferred();
  const mint = () => token.promise;
  const component = load('src/components/JarvisVoiceControl.tsx', {
    react: h.react, 'react/jsx-runtime': jsxRuntime, 'lucide-react': icons,
    '@tanstack/react-start': { useServerFn: (fn) => fn },
    '@/lib/jarvis.functions': { createJarvisRealtimeSecret: mint, getJarvisRoom: async () => ({ messages: [] }), sendJarvisMessage: async () => ({}) },
    '@/lib/jarvis/turn-reconcile': { newTurnId: () => 'fixture-turn', runJarvisTurn: () => turn.promise },
    '@/lib/assistant-format': { toSpeakable: (s) => s },
    '@/lib/voice-session-guard': { claimExclusiveEmeryVoice: (stop) => { exclusiveStop = stop; }, releaseExclusiveEmeryVoice: () => {} },
  }).JarvisVoiceControl;
  const props = { variant: 'core', onTurn: () => { returned++; } };
  const render = () => h.render(component, props);
  const click = () => nodes(render()).find((n) => n.type === 'button').props.onClick();
  return { h, token, microphone, peers, audio, turn, render, click, requests: () => requests, returned: () => returned, stop: () => exclusiveStop(), replaceCallback: (cb) => { props.onTurn = cb; render(); } };
}
await check('closing Core during secret mint prevents microphone acquisition', async () => {
  const v = voiceFixture(); v.click(); v.h.unmount(); v.token.resolve({ clientSecret: 'fixture', model: 'fixture' }); await flush(); assert.equal(v.requests(), 0); assert.equal(v.peers.length, 0);
});
await check('closing Core during microphone prompt releases late tracks', async () => {
  const v = voiceFixture(); v.click(); v.token.resolve({ clientSecret: 'fixture', model: 'fixture' }); await flush(); assert.equal(v.requests(), 1);
  let stopped = 0; v.stop(); v.microphone.resolve({ getTracks: () => [{ stop() { stopped++; } }] }); await flush(); assert.equal(stopped, 1); assert.equal(v.peers.length, 0);
});
await check('active session cleanup closes peer and audio; stale turn cannot reach next session', async () => {
  const v = voiceFixture(); v.click(); v.token.resolve({ clientSecret: 'fixture', model: 'fixture' }); v.microphone.resolve({ getTracks: () => [] }); await flush();
  assert.equal(v.peers.length, 1); const old = v.peers[0]; old.channel.onopen();
  old.channel.onmessage({ data: JSON.stringify({ type: 'response.function_call_arguments.done', call_id: 'call-1', name: 'jarvis_turn', arguments: '{"request":"status"}' }) });
  v.stop(); assert.equal(old.closed, true); assert.equal(v.audio[0].removed, true);
  v.click(); await flush(); assert.equal(v.peers.length, 2);
  v.turn.resolve({ kind: 'completed', result: { agentMessage: { content: 'old answer' } } }); await flush();
  assert.equal(v.returned(), 0); assert.equal(v.peers[1].channel.sent.length, 0); v.h.unmount();
});
await check('Core uses latest turn callback and deduplicates realtime tool events', async () => {
  const v = voiceFixture(); v.click(); v.token.resolve({ clientSecret: 'fixture', model: 'fixture' }); v.microphone.resolve({ getTracks: () => [] }); await flush();
  let current = 0; v.replaceCallback(() => current++);
  const channel = v.peers[0].channel;
  const event = { data: JSON.stringify({ type: 'response.function_call_arguments.done', call_id: 'call-1', name: 'jarvis_turn', arguments: '{"request":"status"}' }) };
  channel.onmessage(event); channel.onmessage(event);
  v.turn.resolve({ kind: 'completed', result: { agentMessage: { content: 'answer' } } }); await flush();
  assert.equal(current, 1); assert.equal(v.returned(), 0); assert.equal(channel.sent.length, 2); v.h.unmount();
});
console.log(`JARVIS Control Center: ${checks} runtime checks passed.`);

await check('dashboard keeps independent reads available and clears stale status after refresh failure', async () => {
  const h = hooks(); let failPanel = false; let failIssues = true;
  const panel = { production: { commit: 'a'.repeat(40), github_main: 'a'.repeat(40), in_sync: true, discrepancies: ['Verified discrepancy fixture'] }, status: { proposed_tasks: [], release_queue: [], open_tasks: [], accepted_today: 0, capacity: 50, ready_for_more_tasks: { in_flight: 0 }, status_counts: {}, approvals_required: [], self_improvement_research: [] }, configuration: {}, latest_improvements: [] };
  const getPanel = async () => { if (failPanel) throw Error('offline'); return panel; };
  const getIssues = async () => { if (failIssues) throw Error('offline'); return { recent_problems: [], failed_executions: 0, unresolved_executions: 0 }; };
  const voice = () => null; const room = () => null;
  const { Route } = load('src/routes/_authenticated/jarvis.tsx', {
    react: h.react, 'react/jsx-runtime': jsxRuntime, 'lucide-react': icons,
    '@tanstack/react-start': { useServerFn: (fn) => fn },
    '@tanstack/react-router': { createFileRoute: () => (opts) => opts, Link: 'link' },
    '@/components/AppShell': { AppShell: 'shell' },
    '@/components/AssistantText': { AssistantText: 'assistant-text' },
    '@/components/JarvisRoom': { JarvisRoom: room },
    '@/components/JarvisVoiceControl': { JarvisVoiceControl: voice },
    '@/lib/jarvis.functions': { getJarvisStatusPanel: getPanel, getJarvisControlCenterIssues: getIssues },
  });
  const render = () => h.render(Route.component);
  function expand(tree) {
    if (!tree || typeof tree !== 'object') return tree;
    if (typeof tree.type === 'function') return expand(tree.type(tree.props));
    const children = tree.props?.children;
    return { ...tree, props: { ...tree.props, children: Array.isArray(children) ? children.map(expand) : expand(children) } };
  }
  function text(tree) {
    if (tree == null || typeof tree === 'boolean') return '';
    if (typeof tree !== 'object') return String(tree);
    const children = tree.props?.children;
    return (Array.isArray(children) ? children : [children]).map(text).join(' ');
  }
  render(); await flush(); let tree = render();
  assert.match(text(expand(tree)), /In sync/);
  assert.match(text(expand(tree)), /Recent diagnostic events could not be refreshed/);
  assert.ok(nodes(tree).some((n) => n.type === 'link' && n.props.to === '/settings'));
  const core = nodes(tree).find((n) => n.type === voice); assert.equal(core.props.variant, 'core');
  core.props.onTurn({ agentMessage: { content: 'Shared JARVIS answer' } }); await flush();
  assert.match(JSON.stringify(render()), /Shared JARVIS answer/);
  failPanel = true; failIssues = false;
  tree = render(); const refresh = nodes(tree).find((n) => n.type === 'button' && text(n).includes('Refresh live state'));
  refresh.props.onClick(); await flush(); tree = render();
  assert.doesNotMatch(text(expand(tree)), /In sync/);
  assert.match(text(expand(tree)), /Not verified/);
  assert.match(text(expand(tree)), /Production and engineering status could not be refreshed/);
  assert.doesNotMatch(text(expand(tree)), /Recent diagnostic events could not be refreshed/);
  const open = nodes(tree).find((n) => n.type === 'button' && text(n).includes('Open engineering conversation'));
  open.props.onClick(); tree = render(); assert.equal(tree.type, room);
  tree.props.onBack(); await flush(); assert.notEqual(render().type, room);
  h.unmount();
});
console.log(`JARVIS Control Center: ${checks} total runtime checks passed.`);
