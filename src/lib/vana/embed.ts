// Vana's in-page connect sheet: the one setting Lorebook owns. The sheet, its
// request signature and the flow come from the SDK (`presentation: "sheet"`).

import { parseOriginAllowlist, resolveVanaAccountOrigin as resolve } from "@opendatalabs/vana-sdk/connect";
import type { VanaRuntime } from "./runtime";

/** Registered with Vana Account as an embed client for this origin. */
export const VANA_EMBED_CLIENT_ID = "lorebook";
export const VANA_ACCOUNT_OVERRIDE_PARAM = "vana_account";

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
  return resolve({
    env,
    override: new URLSearchParams(search).get(VANA_ACCOUNT_OVERRIDE_PARAM),
    previewOrigins: parseOriginAllowlist(config.previewOrigins),
    // Fail closed: only a known non-production deploy may honour the override.
    allowOverride: config.deployEnv === "preview" || config.deployEnv === "development",
    allowLocal: config.deployEnv === "development",
  });
}
