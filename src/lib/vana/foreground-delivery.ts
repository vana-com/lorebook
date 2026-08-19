import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { LorebookSnapshot } from "@/lib/combined-snapshot";
import type { RequestBinding } from "./binding";
import {
  getDeliveryStore,
  type DeliveryStore,
  type StoredRegistration,
} from "./delivery-store";

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const RESULT_TTL_MS = 5 * 60 * 1000;

/**
 * Why a delivery callback was refused. The phone only ever sees an opaque
 * `{ delivered: false }`, but the server logs the reason: roughly ten distinct
 * causes otherwise collapse into one 403 and one on-screen string, which is
 * what made an earlier mobile failure take a full investigation to explain.
 */
export type DeliveryRejection =
  | "unknown_request"
  | "malformed_token"
  | "token_mismatch"
  | "builder_mismatch"
  | "scope_mismatch"
  | "already_consumed";

export type ConsumedDelivery =
  | { ok: true; binding: RequestBinding }
  | { ok: false; reason: DeliveryRejection };

export function createForegroundDelivery(returnOrigin: string): {
  url: string;
  token: string;
} {
  return {
    url: `${returnOrigin}/api/vana/delivery`,
    token: randomBytes(32).toString("base64url"),
  };
}

export async function registerForegroundDelivery(
  input: {
    binding: RequestBinding;
    token: string;
    builderAddress: string;
  },
  store: DeliveryStore = getDeliveryStore(),
): Promise<void> {
  if (!TOKEN_PATTERN.test(input.token)) {
    throw new Error(
      "Foreground delivery token must be 32 random bytes encoded as base64url.",
    );
  }
  await store.putRegistration(input.binding.requestId, {
    binding: input.binding,
    tokenHash: tokenHash(input.token),
    builderAddress: input.builderAddress.toLowerCase(),
    expiresAt: input.binding.expiresAt,
  });
}

/**
 * Validate and consume a one-time bearer registration.
 *
 * Validation runs before the delete on purpose: a mismatched callback leaves the
 * registration intact, so a wrong or hostile POST cannot burn the capability the
 * real phone is about to use. The delete is what enforces single use, and only
 * the caller that actually removed the key proceeds.
 */
export async function consumeForegroundDelivery(
  input: {
    requestId: string;
    token: string;
    scopes: string[];
    builderAddress: string;
    now?: number;
  },
  store: DeliveryStore = getDeliveryStore(),
): Promise<ConsumedDelivery> {
  const now = input.now ?? Date.now();
  const registration = await store.readRegistration(input.requestId, now);
  if (!registration) return reject("unknown_request");
  if (!TOKEN_PATTERN.test(input.token)) return reject("malformed_token");
  if (!safeEqual(tokenHash(input.token), registration.tokenHash)) {
    return reject("token_mismatch");
  }
  if (input.builderAddress.toLowerCase() !== registration.builderAddress) {
    return reject("builder_mismatch");
  }
  if (!isExactScopeSet(input.scopes, registration.binding.scopes)) {
    return reject("scope_mismatch");
  }
  if (!(await store.deleteRegistration(input.requestId))) {
    return reject("already_consumed");
  }
  return { ok: true, binding: registration.binding };
}

export async function storeDeliveredResult(
  input: {
    binding: RequestBinding;
    scope: string;
    data: LorebookSnapshot;
    now?: number;
  },
  store: DeliveryStore = getDeliveryStore(),
): Promise<void> {
  const now = input.now ?? Date.now();
  await store.putResult(input.binding.requestId, {
    bindingKey: bindingKey(input.binding),
    scope: input.scope,
    data: input.data,
    expiresAt: now + RESULT_TTL_MS,
  });
}

export async function getDeliveredResult(
  binding: RequestBinding,
  now = Date.now(),
  store: DeliveryStore = getDeliveryStore(),
): Promise<{ scope: string; data: LorebookSnapshot } | null> {
  const result = await store.readResult(binding.requestId, now);
  if (!result || result.bindingKey !== bindingKey(binding)) return null;
  return { scope: result.scope, data: result.data };
}

function reject(reason: DeliveryRejection): ConsumedDelivery {
  return { ok: false, reason };
}

function tokenHash(token: string): StoredRegistration["tokenHash"] {
  return createHash("sha256").update(token).digest("hex");
}

function safeEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return (
    leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes)
  );
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
