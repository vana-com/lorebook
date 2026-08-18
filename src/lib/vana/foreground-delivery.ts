import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { LorebookSnapshot } from "@/lib/combined-snapshot";
import type { RequestBinding } from "./binding";

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const REGISTRATION_LIMIT = 128;
const RESULT_LIMIT = 128;
const RESULT_TTL_MS = 5 * 60 * 1000;

type Registration = {
  binding: RequestBinding;
  tokenHash: Buffer;
  builderAddress: string;
  expiresAt: number;
};

type DeliveredResult = {
  bindingKey: string;
  scope: string;
  data: LorebookSnapshot;
  expiresAt: number;
};

const registrations = new Map<string, Registration>();
const results = new Map<string, DeliveredResult>();

export function createForegroundDelivery(returnOrigin: string): {
  url: string;
  token: string;
} {
  return {
    url: `${returnOrigin}/api/vana/delivery`,
    token: randomBytes(32).toString("base64url"),
  };
}

export function registerForegroundDelivery(input: {
  binding: RequestBinding;
  token: string;
  builderAddress: string;
  now?: number;
}): void {
  if (!TOKEN_PATTERN.test(input.token)) {
    throw new Error(
      "Foreground delivery token must be 32 random bytes encoded as base64url.",
    );
  }
  const now = input.now ?? Date.now();
  prune(now);
  registrations.set(input.binding.requestId, {
    binding: input.binding,
    tokenHash: tokenHash(input.token),
    builderAddress: input.builderAddress.toLowerCase(),
    expiresAt: input.binding.expiresAt,
  });
  trimOldest(registrations, REGISTRATION_LIMIT);
}

/** Atomically consumes a one-time bearer registration. */
export function consumeForegroundDelivery(input: {
  requestId: string;
  token: string;
  scopes: string[];
  builderAddress: string;
  now?: number;
}): RequestBinding | null {
  const now = input.now ?? Date.now();
  prune(now);
  const registration = registrations.get(input.requestId);
  if (!registration || !TOKEN_PATTERN.test(input.token)) return null;
  if (!safeEqual(tokenHash(input.token), registration.tokenHash)) return null;
  if (input.builderAddress.toLowerCase() !== registration.builderAddress) {
    return null;
  }
  if (!isExactScopeSet(input.scopes, registration.binding.scopes)) return null;
  registrations.delete(input.requestId);
  return registration.binding;
}

export function storeDeliveredResult(input: {
  binding: RequestBinding;
  scope: string;
  data: LorebookSnapshot;
  now?: number;
}): void {
  const now = input.now ?? Date.now();
  prune(now);
  results.set(input.binding.requestId, {
    bindingKey: bindingKey(input.binding),
    scope: input.scope,
    data: input.data,
    expiresAt: now + RESULT_TTL_MS,
  });
  trimOldest(results, RESULT_LIMIT);
}

export function getDeliveredResult(
  binding: RequestBinding,
  now = Date.now(),
): { scope: string; data: LorebookSnapshot } | null {
  prune(now);
  const result = results.get(binding.requestId);
  if (!result || result.bindingKey !== bindingKey(binding)) return null;
  return { scope: result.scope, data: result.data };
}

function tokenHash(token: string): Buffer {
  return createHash("sha256").update(token).digest();
}

function safeEqual(left: Buffer, right: Buffer): boolean {
  return left.length === right.length && timingSafeEqual(left, right);
}

function bindingKey(binding: RequestBinding): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        requestId: binding.requestId,
        appId: binding.appId,
        scopes: binding.scopes,
        returnOrigin: binding.returnOrigin,
        runtime: binding.runtime,
        expiresAt: binding.expiresAt,
      }),
    )
    .digest("base64url");
}

function isExactScopeSet(actual: string[], expected: string[]): boolean {
  const expectedSet = new Set(expected);
  return actual.length === expected.length &&
    new Set(actual).size === actual.length &&
    actual.every((scope) => expectedSet.has(scope));
}

function prune(now: number): void {
  for (const [requestId, registration] of registrations) {
    if (registration.expiresAt <= now) registrations.delete(requestId);
  }
  for (const [requestId, result] of results) {
    if (result.expiresAt <= now) results.delete(requestId);
  }
}

function trimOldest<T>(map: Map<string, T>, limit: number): void {
  while (map.size > limit) {
    const oldest = map.keys().next().value as string | undefined;
    if (!oldest) return;
    map.delete(oldest);
  }
}
