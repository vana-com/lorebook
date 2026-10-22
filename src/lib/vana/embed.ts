// Vana's in-page connect sheet: the one setting Lorebook owns. The sheet, its
// request signature and the flow come from the SDK (`presentation: "sheet"`).

import { VANA_ACCOUNT_ORIGINS } from "@opendatalabs/vana-sdk/connect/protocol";
import type { VanaRuntime } from "./runtime";

/** Registered with Vana Account as an embed client for this origin. */
export const VANA_EMBED_CLIENT_ID = "lorebook";
export const VANA_ACCOUNT_OVERRIDE_PARAM = "vana_account";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1"]);

/**
 * Build-time facts that decide whether the sheet exists and whether a URL may
 * redirect it. Nothing here comes from the request.
 */
export type VanaEmbedConfig = {
  /** `production`, `preview` or `development`; anything unknown counts as production. */
  deployEnv: string;
  /** Exact Account origins (comma separated) a non-production deploy may be pointed at. */
  previewOrigins: string;
  /** Explicit opt-in for the sheet button. */
  sheetEnabled: string;
};

// Next inlines `process.env.NEXT_PUBLIC_*` only as literal property reads.
export const VANA_EMBED_CONFIG: VanaEmbedConfig = {
  deployEnv: process.env.NEXT_PUBLIC_LOREBOOK_DEPLOY_ENV ?? "production",
  previewOrigins: process.env.NEXT_PUBLIC_VANA_ACCOUNT_PREVIEW_ORIGINS ?? "",
  sheetEnabled: process.env.NEXT_PUBLIC_VANA_SHEET_ENABLED ?? "",
};

/** The sheet button shows only where it was switched on. Production defaults to off. */
export function isVanaSheetEnabled(config: VanaEmbedConfig = VANA_EMBED_CONFIG): boolean {
  return config.sheetEnabled.trim() === "1";
}

/** Normalised bare origins from the allowlist; entries that are not https origins are dropped. */
function allowlistedOrigins(raw: string): Set<string> {
  const origins = new Set<string>();
  for (const entry of raw.split(",")) {
    try {
      const url = new URL(entry.trim());
      if (url.protocol === "https:" && url.origin === entry.trim().replace(/\/$/, "")) origins.add(url.origin);
    } catch {
      // Not a URL: ignore it.
    }
  }
  return origins;
}

/**
 * Which Vana Account serves the sheet: the runtime's Account, unless a
 * non-production deploy was told (at build time) to trust the origin named by
 * `?vana_account=`. Production never honours the override, whatever the URL says.
 */
export function resolveVanaAccountOrigin(
  env: VanaRuntime["env"],
  search: string,
  config: VanaEmbedConfig = VANA_EMBED_CONFIG,
): string {
  const fallback = VANA_ACCOUNT_ORIGINS[env];
  // Fail closed: only a known non-production deploy may honour the override.
  if (config.deployEnv !== "preview" && config.deployEnv !== "development") return fallback;
  const override = new URLSearchParams(search).get(VANA_ACCOUNT_OVERRIDE_PARAM);
  if (!override) return fallback;
  try {
    const url = new URL(override);
    if (url.protocol === "https:" && allowlistedOrigins(config.previewOrigins).has(url.origin)) return url.origin;
    const local = config.deployEnv === "development" && url.protocol === "http:" && LOCAL_HOSTS.has(url.hostname);
    return local ? url.origin : fallback;
  } catch {
    return fallback;
  }
}
