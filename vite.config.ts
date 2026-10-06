// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - TanStack devtools (dev-only, first), tanstackStart, viteReact, tailwindcss, tsConfigPaths,
//     nitro (build-only using cloudflare as a default target), VITE_* env injection, @ path alias,
//     React/TanStack dedupe, error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { execSync } from "node:child_process";
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

// Stamp the bundle with the commit it was built from so Emery/JARVIS can report
// the version that is actually running. Falls back to "" (reported as unknown).
function buildCommit() {
  const fromEnv =
    process.env["VITE_EMERY_COMMIT_SHA"] ||
    process.env["GITHUB_SHA"] ||
    process.env["COMMIT_REF"] ||
    process.env["CF_PAGES_COMMIT_SHA"];
  if (fromEnv) return fromEnv;
  try {
    return execSync("git rev-parse HEAD", { stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim();
  } catch {
    return "";
  }
}
process.env["VITE_EMERY_COMMIT_SHA"] = buildCommit();
process.env["VITE_EMERY_BUILT_AT"] ||= new Date().toISOString();

export default defineConfig({
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
});
