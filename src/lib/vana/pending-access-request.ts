import {
  toResumableAccessRequest,
  type AccessRequest,
  type AccessRequestStatus,
  type ResumableAccessRequest,
} from "@opendatalabs/vana-sdk/react";
import type { LorebookMode } from "./constants";

export const PENDING_ACCESS_REQUEST_KEY = "lorebook.pending-access-request.v1";

const VERSION = 1;
const MAX_STORED_LENGTH = 4_096;
const MAX_REQUEST_ID_LENGTH = 256;
const MAX_APPROVAL_URL_LENGTH = 2_048;
const MAX_APP_ADDRESS_LENGTH = 128;
const MAX_EXPIRY_LENGTH = 64;

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export type PendingAccessRequest = {
  mode: LorebookMode;
  request: ResumableAccessRequest;
};
type PersistedPendingAccessRequest = PendingAccessRequest & {
  version: typeof VERSION;
};

export function savePendingAccessRequest(
  storage: StorageLike,
  pending: { mode: LorebookMode; request: AccessRequest },
  now = Date.now(),
): boolean {
  const safePending: PendingAccessRequest = {
    mode: pending.mode,
    request: toResumableAccessRequest(pending.request),
  };
  if (!isPendingAccessRequest({ version: VERSION, ...safePending }, now)) return false;
  try {
    const value = JSON.stringify({ version: VERSION, ...safePending });
    if (value.length > MAX_STORED_LENGTH) return false;
    storage.setItem(PENDING_ACCESS_REQUEST_KEY, value);
    return true;
  } catch { return false; }
}

export function loadPendingAccessRequest(storage: StorageLike, now = Date.now()): PendingAccessRequest | null {
  let value: string | null;
  try { value = storage.getItem(PENDING_ACCESS_REQUEST_KEY); } catch { return null; }
  if (!value) return null;
  if (value.length > MAX_STORED_LENGTH) return clearAndReturnNull(storage);
  try {
    const parsed: unknown = JSON.parse(value);
    if (!isPendingAccessRequest(parsed, now)) return clearAndReturnNull(storage);
    return { mode: parsed.mode, request: parsed.request };
  } catch { return clearAndReturnNull(storage); }
}

export function clearPendingAccessRequest(storage: StorageLike): void {
  try { storage.removeItem(PENDING_ACCESS_REQUEST_KEY); } catch { /* Storage may be unavailable. */ }
}

/** Clear only when Vana's typed lifecycle says the request cannot be resumed. */
export function clearPendingAccessRequestForTerminalStatus(
  storage: StorageLike,
  status: AccessRequestStatus,
): boolean {
  if (status.status !== "completed" && status.status !== "denied" && status.status !== "expired") return false;
  clearPendingAccessRequest(storage);
  return true;
}

function clearAndReturnNull(storage: StorageLike): null {
  clearPendingAccessRequest(storage);
  return null;
}

function isPendingAccessRequest(value: unknown, now: number): value is PersistedPendingAccessRequest {
  if (!isRecord(value) || !hasExactKeys(value, ["version", "mode", "request"])) return false;
  if (value.version !== VERSION || (value.mode !== "quick" && value.mode !== "deep")) return false;
  return isAccessRequest(value.request, now);
}

function isAccessRequest(value: unknown, now: number): value is ResumableAccessRequest {
  if (!isRecord(value)) return false;
  const keys = Object.keys(value);
  if (!keys.every((key) => ["requestId", "approvalUrl", "appAddress", "network", "expiresAt"].includes(key))) return false;
  if (!hasRequiredKeys(value, ["requestId", "approvalUrl", "appAddress", "expiresAt"])) return false;
  if (typeof value.requestId !== "string" || value.requestId.length === 0 || value.requestId.length > MAX_REQUEST_ID_LENGTH || typeof value.approvalUrl !== "string" || value.approvalUrl.length === 0 || value.approvalUrl.length > MAX_APPROVAL_URL_LENGTH || typeof value.appAddress !== "string" || value.appAddress.length === 0 || value.appAddress.length > MAX_APP_ADDRESS_LENGTH || typeof value.expiresAt !== "string" || value.expiresAt.length === 0 || value.expiresAt.length > MAX_EXPIRY_LENGTH) return false;
  if (value.network !== undefined && value.network !== "mainnet" && value.network !== "moksha") return false;
  try {
    const approvalUrl = new URL(value.approvalUrl);
    if (approvalUrl.protocol !== "https:" && approvalUrl.protocol !== "http:") return false;
  } catch { return false; }
  const expiresAt = Date.parse(value.expiresAt);
  return Number.isFinite(expiresAt) && expiresAt > now;
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(value);
  return keys.length === expected.length && keys.every((key) => expected.includes(key));
}
function hasRequiredKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  return expected.every((key) => Object.hasOwn(value, key));
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
