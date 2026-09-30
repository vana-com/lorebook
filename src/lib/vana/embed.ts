// Vana's in-page connect sheet (embed) — the pieces Lorebook owns.
//
//   Lorebook page ──<script src=<account>/embed/connect.js>──▶ VanaConnect.open(...)
//   sheet asks for the request ──▶ POST /api/vana/request            (existing: creates the DCR)
//                              ──▶ POST /api/vana/request/authorization
//                                   a 5-minute Direct SDK read signature for that request,
//                                   so Vana can show its real scopes. Lorebook's key never
//                                   leaves the server; only requests bound to this browser
//                                   get signed.
// Completion is observed exactly as the redirect flow does: status poll, then read.

import type { VanaRuntime } from "./runtime";

/** Registered with Vana Account as an embed client for this origin. */
export const VANA_EMBED_CLIENT_ID = "lorebook";
export const VANA_EMBED_SCRIPT_PATH = "/embed/connect.js";
export const VANA_ACCOUNT_OVERRIDE_PARAM = "vana_account";

const DEFAULT_ACCOUNT_ORIGIN: Record<VanaRuntime["env"], string> = {
  dev: "https://account-dev.vana.org",
  production: "https://account.vana.org",
};

// Branch previews of Vana Account, for testing an unreleased sheet.
const ACCOUNT_PREVIEW_HOST = /^vana-account-[a-z0-9-]+-opendatalabs\.vercel\.app$/;
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1"]);

const DIRECT_READ_HEADER = "Vana Direct Access Request v1";

/**
 * Which Vana Account serves the sheet: the runtime's Account unless
 * `?vana_account=` names an Account branch preview or a local Account.
 */
export function resolveVanaAccountOrigin(
  env: VanaRuntime["env"],
  search: string,
): string {
  const override = new URLSearchParams(search).get(VANA_ACCOUNT_OVERRIDE_PARAM);
  if (!override) return DEFAULT_ACCOUNT_ORIGIN[env];
  try {
    const url = new URL(override);
    const preview = url.protocol === "https:" && ACCOUNT_PREVIEW_HOST.test(url.hostname);
    const local = url.protocol === "http:" && LOCAL_HOSTS.has(url.hostname);
    return preview || local ? url.origin : DEFAULT_ACCOUNT_ORIGIN[env];
  } catch {
    return DEFAULT_ACCOUNT_ORIGIN[env];
  }
}

/** The Direct SDK message for `GET /api/data-connection-requests/<id>`. */
export function directReadMessage(requestId: string, timestamp: string): string {
  return [
    DIRECT_READ_HEADER,
    "method:GET",
    `path:/api/data-connection-requests/${requestId}`,
    `timestamp:${timestamp}`,
    "body:",
  ].join("\n");
}
