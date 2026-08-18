import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { appForId, REQUEST_BINDING_TTL_MS, type VanaAppDefinition } from "./constants";
import type { VanaRuntime } from "./runtime";

const COOKIE_PREFIX = "vana_request_";
const BINDING_VERSION = 2;

export type RequestBinding = {
  version: typeof BINDING_VERSION;
  requestId: string;
  appId: string;
  scopes: string[];
  returnOrigin: string;
  runtime: VanaRuntime;
  expiresAt: number;
};

type RequestBindingInput = {
  requestId: string;
  app: VanaAppDefinition;
  runtime: VanaRuntime;
  returnOrigin: string;
  accessRequestExpiresAt?: string;
  now?: number;
};

type CookieReader = {
  get(name: string): { value: string } | undefined;
};

type CookieWriter = {
  set(
    name: string,
    value: string,
    options: {
      httpOnly: true;
      sameSite: "lax";
      secure: boolean;
      path: "/";
    },
  ): void;
};

export function requestBindingCookieName(requestId: string): string {
  const requestHash = createHash("sha256").update(requestId).digest("base64url");
  return `${COOKIE_PREFIX}${requestHash}`;
}

export function createRequestBinding(
  input: RequestBindingInput,
  secret: string,
): string {
  return createRequestBindingRecord(input, secret).value;
}

export function createRequestBindingRecord(
  input: RequestBindingInput,
  secret: string,
): { payload: RequestBinding; value: string } {
  const now = input.now ?? Date.now();
  const accessRequestExpiresAt = input.accessRequestExpiresAt ? Date.parse(input.accessRequestExpiresAt) : Number.NaN;
  const payload: RequestBinding = {
    version: BINDING_VERSION,
    requestId: input.requestId,
    appId: input.app.id,
    scopes: [...input.app.scopes],
    returnOrigin: input.returnOrigin,
    runtime: input.runtime,
    // The normal one-hour binding is retained unless the authoritative access
    // request expiry lasts longer, in which case the originating tab keeps the
    // binding it needs to authorize status/read for the whole DCR lifetime.
    expiresAt: Number.isFinite(accessRequestExpiresAt)
      ? Math.max(now + REQUEST_BINDING_TTL_MS, accessRequestExpiresAt)
      : now + REQUEST_BINDING_TTL_MS,
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return { payload, value: `${encoded}.${sign(encoded, secret)}` };
}

export function setRequestBindingCookie(
  cookies: CookieWriter,
  requestId: string,
  binding: string,
  secure: boolean,
): void {
  cookies.set(requestBindingCookieName(requestId), binding, {
    httpOnly: true,
    sameSite: "lax",
    secure,
    path: "/",
  });
}

export function readRequestBinding(
  cookies: CookieReader,
  input: {
    requestId: string;
    returnOrigin: string;
    now?: number;
  },
  secret: string,
): RequestBinding | null {
  const value = cookies.get(requestBindingCookieName(input.requestId))?.value;
  if (!value || value.length > 4096) return null;

  const separator = value.lastIndexOf(".");
  if (separator <= 0) return null;

  const encoded = value.slice(0, separator);
  const signature = value.slice(separator + 1);
  if (!safeEqual(signature, sign(encoded, secret))) return null;

  try {
    const parsed: unknown = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
    if (!isRequestBinding(parsed)) return null;
    if (parsed.requestId !== input.requestId) return null;
    if (parsed.returnOrigin !== input.returnOrigin) return null;
    if (parsed.expiresAt <= (input.now ?? Date.now())) return null;
    return parsed;
  } catch {
    return null;
  }
}

function sign(payload: string, secret: string): string {
  const key = createHash("sha256")
    .update("vana-data-app-starter/request-binding/v1\0")
    .update(secret)
    .digest();
  return createHmac("sha256", key).update(payload).digest("base64url");
}

function safeEqual(provided: string, expected: string): boolean {
  const providedBytes = Buffer.from(provided);
  const expectedBytes = Buffer.from(expected);
  return (
    providedBytes.length === expectedBytes.length &&
    timingSafeEqual(providedBytes, expectedBytes)
  );
}

function isRequestBinding(value: unknown): value is RequestBinding {
  if (!isRecord(value) || !isRecord(value.runtime)) return false;
  const app = typeof value.appId === "string" ? appForId(value.appId) : null;
  if (!app || !isExactScopeSet(value.scopes, app.scopes)) return false;
  return (
    value.version === BINDING_VERSION &&
    typeof value.requestId === "string" &&
    value.requestId.length > 0 &&
    typeof value.returnOrigin === "string" &&
    Number.isFinite(value.expiresAt) &&
    (value.runtime.env === "dev" || value.runtime.env === "production") &&
    (value.runtime.network === "moksha" || value.runtime.network === "mainnet")
  );
}

/** True when `value` is exactly the app's scope set (same members, no extras). */
function isExactScopeSet(value: unknown, expected: readonly string[]): value is string[] {
  const expectedScopes = new Set(expected);
  return (
    Array.isArray(value) &&
    value.length === expected.length &&
    value.every((scope) => typeof scope === "string" && expectedScopes.has(scope))
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
