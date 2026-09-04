/**
 * Persistence boundary for the foreground mobile delivery handoff.
 *
 * Two unrelated HTTP requests have to meet here: the originating browser tab
 * creates the data connection request (registering a one-time bearer), and the
 * phone later POSTs the approved grant to `/api/vana/delivery`. On one
 * long-lived server process an in-memory map is enough. On a serverless host
 * those two requests routinely land on different instances, so a process-local
 * map means the delivery callback rejects a bearer it never saw and the phone
 * reports "Couldn't import your data" for a request that was approved
 * correctly. Point `LOREBOOK_REDIS_REST_URL`/`_TOKEN` at a Redis REST endpoint
 * and both halves share one store.
 *
 * The in-memory store stays the zero-config default so this repo runs with
 * nothing but `VANA_PRIVATE_KEY` and `APP_URL`.
 */

import type { LorebookSnapshot } from "@/lib/combined-snapshot";
import type { JobState } from "@opendatalabs/vana-sdk";
import type { RequestBinding } from "./binding";

/** A registered one-time delivery capability, awaiting the phone's callback. */
export type StoredRegistration = {
  binding: RequestBinding;
  /** Hex SHA-256 of the bearer. The bearer itself is never stored. */
  tokenHash: string;
  /** Lowercased app address the approval was minted for. */
  builderAddress: string;
  expiresAt: number;
};

/** A delivered, product-safe snapshot awaiting the originating tab's poll. */
export type StoredResult = {
  bindingKey: string;
  scope: string;
  data: LorebookSnapshot;
  expiresAt: number;
};

/** A resumable enclave job associated with one browser-bound request. */
export type StoredEnclaveJob = {
  jobId: string;
  scope: string;
  submittedAt: number;
  deadlineAt: number;
  state: JobState;
  expiresAt: number;
};

/**
 * The two-phase consume is deliberate. `readRegistration` leaves the
 * registration intact so a malformed or mismatched callback cannot burn a
 * capability the real phone still needs, and `deleteRegistration` reports
 * whether *this* caller removed it — that boolean, not the read, is what makes
 * delivery one-time under concurrent callbacks.
 */
export interface DeliveryStore {
  readonly kind: "memory" | "redis";
  putRegistration(requestId: string, registration: StoredRegistration): Promise<void>;
  readRegistration(requestId: string, now: number): Promise<StoredRegistration | null>;
  deleteRegistration(requestId: string): Promise<boolean>;
  putResult(requestId: string, result: StoredResult): Promise<void>;
  readResult(requestId: string, now: number): Promise<StoredResult | null>;
  putEnclaveJob(requestId: string, job: StoredEnclaveJob): Promise<void>;
  readEnclaveJob(requestId: string, now: number): Promise<StoredEnclaveJob | null>;
}

export class DeliveryStoreError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "DeliveryStoreError";
  }
}

const REGISTRATION_LIMIT = 128;
const RESULT_LIMIT = 128;
const ENCLAVE_JOB_LIMIT = 128;

/** Process-local store. Correct only when one process serves every request. */
export function createMemoryDeliveryStore(): DeliveryStore {
  const registrations = new Map<string, StoredRegistration>();
  const results = new Map<string, StoredResult>();
  const enclaveJobs = new Map<string, StoredEnclaveJob>();

  function prune(now: number): void {
    for (const [requestId, registration] of registrations) {
      if (registration.expiresAt <= now) registrations.delete(requestId);
    }
    for (const [requestId, result] of results) {
      if (result.expiresAt <= now) results.delete(requestId);
    }
    for (const [requestId, job] of enclaveJobs) {
      if (job.expiresAt <= now) enclaveJobs.delete(requestId);
    }
  }

  function trimOldest<T>(map: Map<string, T>, limit: number): void {
    while (map.size > limit) {
      const oldest = map.keys().next().value as string | undefined;
      if (!oldest) return;
      map.delete(oldest);
    }
  }

  return {
    kind: "memory",

    async putRegistration(requestId, registration) {
      prune(Date.now());
      registrations.set(requestId, registration);
      trimOldest(registrations, REGISTRATION_LIMIT);
    },

    async readRegistration(requestId, now) {
      prune(now);
      return registrations.get(requestId) ?? null;
    },

    async deleteRegistration(requestId) {
      return registrations.delete(requestId);
    },

    async putResult(requestId, result) {
      prune(Date.now());
      results.set(requestId, result);
      trimOldest(results, RESULT_LIMIT);
    },

    async readResult(requestId, now) {
      prune(now);
      return results.get(requestId) ?? null;
    },

    async putEnclaveJob(requestId, job) {
      prune(Date.now());
      enclaveJobs.set(requestId, job);
      trimOldest(enclaveJobs, ENCLAVE_JOB_LIMIT);
    },

    async readEnclaveJob(requestId, now) {
      prune(now);
      return enclaveJobs.get(requestId) ?? null;
    },
  };
}

const KEY_PREFIX = "lorebook:delivery:v1";

/**
 * Redis-backed store over the Upstash-style REST protocol (a single command per
 * POST, as a JSON array). Deliberately plain `fetch`: one readable transport is
 * worth more to a builder reading this repo than another dependency.
 */
export function createRedisDeliveryStore(config: {
  url: string;
  token: string;
  fetchFn?: typeof fetch;
}): DeliveryStore {
  const fetchFn = config.fetchFn ?? fetch;
  const base = config.url.replace(/\/+$/, "");

  async function command(args: (string | number)[]): Promise<unknown> {
    const verb = String(args[0]);
    let response: Response;
    try {
      response = await fetchFn(base, {
        method: "POST",
        headers: {
          authorization: `Bearer ${config.token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(args),
        cache: "no-store",
      });
    } catch (error) {
      throw new DeliveryStoreError(`Redis ${verb} could not be reached.`, { cause: error });
    }
    if (!response.ok) {
      throw new DeliveryStoreError(`Redis ${verb} failed with ${response.status}.`);
    }
    const body = (await response.json()) as { result?: unknown; error?: string };
    if (body.error) {
      throw new DeliveryStoreError(`Redis ${verb} failed: ${body.error}`);
    }
    return body.result ?? null;
  }

  /**
   * Redis TTL already evicts these, but every read re-checks `expiresAt`: the
   * store is a cache of an authorization decision, so it must never be the only
   * thing standing between an expired capability and a read.
   */
  async function readJson<T extends { expiresAt: number }>(
    key: string,
    now: number,
  ): Promise<T | null> {
    const raw = await command(["GET", key]);
    if (typeof raw !== "string") return null;
    let parsed: T;
    try {
      parsed = JSON.parse(raw) as T;
    } catch (error) {
      throw new DeliveryStoreError(`Redis returned an unreadable ${key}.`, { cause: error });
    }
    return parsed.expiresAt > now ? parsed : null;
  }

  async function writeJson(key: string, value: { expiresAt: number }): Promise<void> {
    const ttlMs = Math.max(1, value.expiresAt - Date.now());
    await command(["SET", key, JSON.stringify(value), "PX", ttlMs]);
  }

  return {
    kind: "redis",

    async putRegistration(requestId, registration) {
      await writeJson(`${KEY_PREFIX}:registration:${requestId}`, registration);
    },

    async readRegistration(requestId, now) {
      return readJson<StoredRegistration>(`${KEY_PREFIX}:registration:${requestId}`, now);
    },

    async deleteRegistration(requestId) {
      // DEL returns the number of keys removed, so exactly one concurrent
      // caller can observe 1 — that is the one-time guarantee.
      return (await command(["DEL", `${KEY_PREFIX}:registration:${requestId}`])) === 1;
    },

    async putResult(requestId, result) {
      await writeJson(`${KEY_PREFIX}:result:${requestId}`, result);
    },

    async readResult(requestId, now) {
      return readJson<StoredResult>(`${KEY_PREFIX}:result:${requestId}`, now);
    },

    async putEnclaveJob(requestId, job) {
      await writeJson(`${KEY_PREFIX}:enclave-job:${requestId}`, job);
    },

    async readEnclaveJob(requestId, now) {
      return readJson<StoredEnclaveJob>(`${KEY_PREFIX}:enclave-job:${requestId}`, now);
    },
  };
}

// Accepted in priority order. The Lorebook-specific pair wins so this repo can
// be pointed at its own store; the rest are what Vercel's Redis integrations
// inject, so a deployed Lorebook usually needs no extra configuration at all.
const REDIS_URL_VARS = [
  "LOREBOOK_REDIS_REST_URL",
  "KV_REST_API_URL",
  "UPSTASH_REDIS_REST_URL",
] as const;
const REDIS_TOKEN_VARS = [
  "LOREBOOK_REDIS_REST_TOKEN",
  "KV_REST_API_TOKEN",
  "UPSTASH_REDIS_REST_TOKEN",
] as const;

function firstConfigured(names: readonly string[]): { name: string; value: string } | null {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) return { name, value };
  }
  return null;
}

/**
 * Choose a store from the environment. A URL without its token (or the reverse)
 * throws rather than silently falling back to memory: a half-configured
 * serverless deployment is exactly the failure this store exists to prevent,
 * and it would otherwise only surface as a rejected delivery on a real phone.
 */
export function resolveDeliveryStore(): DeliveryStore {
  const url = firstConfigured(REDIS_URL_VARS);
  const token = firstConfigured(REDIS_TOKEN_VARS);
  if (url && !token) {
    throw new DeliveryStoreError(
      `${url.name} is set without a matching token. Set one of ${REDIS_TOKEN_VARS.join(", ")}.`,
    );
  }
  if (token && !url) {
    throw new DeliveryStoreError(
      `${token.name} is set without a matching URL. Set one of ${REDIS_URL_VARS.join(", ")}.`,
    );
  }
  if (url && token) {
    return createRedisDeliveryStore({ url: url.value, token: token.value });
  }
  return createMemoryDeliveryStore();
}

let store: DeliveryStore | null = null;

/** The process-wide store, resolved once and announced so runs are diagnosable. */
export function getDeliveryStore(): DeliveryStore {
  if (!store) {
    store = resolveDeliveryStore();
    console.info(
      store.kind === "redis"
        ? "[vana/delivery] store=redis (shared across instances)"
        : "[vana/delivery] store=memory (single process only; mobile delivery will reject callbacks that land on another instance)",
    );
  }
  return store;
}
