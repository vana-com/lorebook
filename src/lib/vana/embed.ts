// Vana's in-page connect sheet: the one setting Lorebook owns. The sheet, its
// request signature and the flow come from the SDK (`presentation: "sheet"`).

import { VANA_ACCOUNT_ORIGINS } from "@opendatalabs/vana-sdk/connect/protocol";
import type { VanaRuntime } from "./runtime";

/** Registered with Vana Account as an embed client for this origin. */
export const VANA_EMBED_CLIENT_ID = "lorebook";
export const VANA_ACCOUNT_OVERRIDE_PARAM = "vana_account";

// Branch previews of Vana Account, for testing an unreleased sheet.
const ACCOUNT_PREVIEW_HOST = /^vana-account-[a-z0-9-]+-opendatalabs\.vercel\.app$/;
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1"]);

/**
 * Which Vana Account serves the sheet: the runtime's Account unless
 * `?vana_account=` names an Account branch preview or a local Account.
 */
export function resolveVanaAccountOrigin(env: VanaRuntime["env"], search: string): string {
  const fallback = VANA_ACCOUNT_ORIGINS[env];
  const override = new URLSearchParams(search).get(VANA_ACCOUNT_OVERRIDE_PARAM);
  if (!override) return fallback;
  try {
    const url = new URL(override);
    const preview = url.protocol === "https:" && ACCOUNT_PREVIEW_HOST.test(url.hostname);
    const local = url.protocol === "http:" && LOCAL_HOSTS.has(url.hostname);
    return preview || local ? url.origin : fallback;
  } catch {
    return fallback;
  }
}
