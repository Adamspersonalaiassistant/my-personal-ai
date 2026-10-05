// Build stamp injected at build time by vite.config.ts (VITE_EMERY_COMMIT_SHA /
// VITE_EMERY_BUILT_AT). This is what the *running* bundle reports about itself.
// If the build environment had no git metadata the values are null, and every
// caller must report that honestly instead of guessing.

type MetaEnv = Record<string, string | undefined>;

function metaEnv(): MetaEnv {
  try {
    return ((import.meta as unknown as { env?: MetaEnv }).env ?? {}) as MetaEnv;
  } catch {
    return {};
  }
}

const env = metaEnv();

export const EMERY_BUILD = {
  commit: env["VITE_EMERY_COMMIT_SHA"] || null,
  builtAt: env["VITE_EMERY_BUILT_AT"] || null,
} as const;

export const EMERY_PUBLISHED_URL = "https://emery-personal-ai.lovable.app";
export const EMERY_PREVIEW_URL = "https://id-preview--9d966392-55bb-436a-bf8b-bf2dee556f11.lovable.app";
export const LOVABLE_PROJECT_ID = "9d966392-55bb-436a-bf8b-bf2dee556f11";
