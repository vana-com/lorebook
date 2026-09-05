import { JobRejectedError } from "@opendatalabs/vana-sdk";
import { createJobsClient } from "@opendatalabs/vana-sdk/protocol/jobs-client";
import type {
  JobResult,
  JobState,
  JobStatus,
} from "@opendatalabs/vana-sdk/protocol/jobs";
import { getAddress, isAddress, type Address, type Hex } from "viem";
import {
  getDeliveryStore,
  type DeliveryStore,
} from "./delivery-store";

const GRANT_ID_PATTERN = /^0x[0-9a-fA-F]{64}$/;
const LOOPBACK_GATEWAY_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
export const ENCLAVE_JOB_DEADLINE_SECONDS = 600;
export const ENCLAVE_POLL_TIMEOUT_MS = 20_000;
export const ENCLAVE_POLL_INTERVAL_MS = 2_000;
export const ENCLAVE_READ_WAIT_SECONDS = 25;
export const ENCLAVE_ROUTE_TIMEOUT_MARGIN_MS = 5_000;
export const ENCLAVE_READ_TIMEOUT_MS =
  60_000 - ENCLAVE_READ_WAIT_SECONDS * 1_000 - ENCLAVE_ROUTE_TIMEOUT_MARGIN_MS;
const ENCLAVE_JOB_RETENTION_MS = 5 * 60 * 1_000;
const TERMINAL_FAILURE_STATES = new Set<JobState>([
  "failed",
  "expired",
  "cancelled",
]);

export class EnclaveReadError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "EnclaveReadError";
  }
}

export function isEnclaveReadMode(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return env.VANA_READ_MODE?.trim().toLowerCase() === "enclave";
}

export function shouldUseEnclaveRead(
  status: { delivery?: string },
  env: Record<string, string | undefined> = process.env,
): boolean {
  return isEnclaveReadMode(env) || status.delivery === "enclave";
}

export function approvedEnclaveScopes(
  status: { scopes?: readonly string[]; scope?: string },
  requestedScopes: readonly string[],
): string[] {
  const approved = status.scopes?.length
    ? status.scopes
    : status.scope
      ? [status.scope]
      : requestedScopes;
  const requested = requestedScopes.filter((scope) => approved.includes(scope));
  if (requested.length !== requestedScopes.length) {
    throw new EnclaveReadError(
      "The approved grant does not cover Lorebook's requested data type.",
      403,
    );
  }
  return requested;
}

export function gatewayOrigin(rawGatewayUrl: string | undefined): string {
  if (!rawGatewayUrl?.trim()) {
    throw new EnclaveReadError(
      "Enclave read mode requires VANA_GATEWAY_URL.",
      500,
    );
  }
  try {
    const url = new URL(rawGatewayUrl.trim());
    if (
      (url.protocol !== "https:" &&
        (url.protocol !== "http:" || !LOOPBACK_GATEWAY_HOSTS.has(url.hostname))) ||
      url.pathname !== "/" ||
      url.search ||
      url.hash
    ) {
      throw new Error();
    }
    return url.origin;
  } catch {
    throw new EnclaveReadError(
      "VANA_GATEWAY_URL must be a bare HTTPS origin or a loopback HTTP origin.",
      500,
    );
  }
}

export async function resolveGrantOwner(input: {
  gatewayUrl: string;
  grantId: string;
  status?: unknown;
  fetchFn?: typeof fetch;
}): Promise<Address> {
  const statusOwner = ownerAddressFrom(input.status);
  if (statusOwner) return statusOwner;
  if (!GRANT_ID_PATTERN.test(input.grantId)) {
    throw new EnclaveReadError("The approved grant id is invalid.", 502);
  }

  let response: Response;
  try {
    response = await (input.fetchFn ?? fetch)(
      `${input.gatewayUrl}/v1/grants/${encodeURIComponent(input.grantId)}`,
    );
  } catch (error) {
    throw new EnclaveReadError(
      `The Enclave Gateway grant lookup failed: ${errorMessage(error)}.`,
      503,
    );
  }
  if (!response.ok) {
    throw new EnclaveReadError(
      `The Enclave Gateway could not resolve the grant owner (HTTP ${response.status}).`,
      response.status === 404 ? 404 : 502,
    );
  }

  const body: unknown = await response.json().catch(() => null);
  const owner = ownerAddressFrom(body);
  if (!owner) {
    throw new EnclaveReadError(
      "The Enclave Gateway returned a grant without a valid owner address.",
      502,
    );
  }
  return owner;
}

export function decodeEnclaveResult(result: {
  contentType: string;
  body: Uint8Array;
}): unknown {
  const mediaType = result.contentType.split(";", 1)[0]?.trim().toLowerCase();
  if (mediaType !== "application/json" && !mediaType?.endsWith("+json")) {
    throw new EnclaveReadError(
      `The enclave returned unsupported content type ${result.contentType || "(missing)"}.`,
      502,
    );
  }
  try {
    return JSON.parse(new TextDecoder().decode(result.body));
  } catch {
    throw new EnclaveReadError(
      "The enclave returned an invalid JSON result.",
      502,
    );
  }
}

export type EnclaveReadOutcome =
  | { state: "running"; jobId: string }
  | { state: "completed"; data: Record<string, unknown> };

export async function readResumableEnclaveScopes(input: {
  requestId: string;
  gatewayUrl: string;
  chainId: number;
  builderPrivateKey: string;
  grantId: string;
  scopes: readonly string[];
  status?: unknown;
  fetchFn?: typeof fetch;
  now?: () => number;
  store?: DeliveryStore;
  jobsClientFactory?: (
    options: Parameters<typeof createJobsClient>[0],
  ) => Pick<
    ReturnType<typeof createJobsClient>,
    "submitRawRead" | "getJob" | "waitForJob" | "openResult"
  >;
}): Promise<EnclaveReadOutcome> {
  const gatewayUrl = gatewayOrigin(input.gatewayUrl);
  if (!GRANT_ID_PATTERN.test(input.grantId)) {
    throw new EnclaveReadError("The approved grant id is invalid.", 502);
  }
  if (input.scopes.length !== 1 || !input.scopes[0]) {
    throw new EnclaveReadError("Lorebook requires exactly one approved data type.", 400);
  }
  const scope = input.scopes[0];
  const now = input.now ?? Date.now;
  const store = input.store ?? getDeliveryStore();
  const client = (input.jobsClientFactory ?? createJobsClient)({
    gatewayUrl,
    chainId: input.chainId,
    builderPrivateKey: input.builderPrivateKey as Hex,
  });

  let stored = await store.readEnclaveJob(input.requestId, now());
  let inlineJob: JobStatus | undefined;
  if (!stored || stored.scope !== scope || TERMINAL_FAILURE_STATES.has(stored.state)) {
    const owner = await resolveGrantOwner({
      gatewayUrl,
      grantId: input.grantId,
      status: input.status,
      fetchFn: input.fetchFn,
    });
    const submittedAt = now();
    const submitted = await client.submitRawRead({
      owner,
      grantId: input.grantId as Hex,
      scope,
      deadlineSeconds: ENCLAVE_JOB_DEADLINE_SECONDS,
      wait: 0,
    });
    stored = {
      jobId: submitted.jobId,
      scope,
      submittedAt,
      deadlineAt: submittedAt + ENCLAVE_JOB_DEADLINE_SECONDS * 1_000,
      state: submitted.state,
      expiresAt:
        submittedAt +
        ENCLAVE_JOB_DEADLINE_SECONDS * 1_000 +
        ENCLAVE_JOB_RETENTION_MS,
    };
    // Persist immediately after submission so the next function invocation
    // resumes this exact job rather than minting another UUID.
    await store.putEnclaveJob(input.requestId, stored);
    inlineJob = submitted.job;
  }

  if (stored.state !== "completed" && now() >= stored.deadlineAt) {
    const expired = { ...stored, state: "expired" as const };
    await store.putEnclaveJob(input.requestId, expired);
    throw terminalJobError(expired.jobId, expired.state);
  }

  let job: JobStatus;
  if (inlineJob && isTerminalJob(inlineJob)) {
    job = inlineJob;
  } else if (stored.state === "completed") {
    job = await client.getJob(stored.jobId);
  } else {
    try {
      job = await client.waitForJob(stored.jobId, {
        timeoutMs: ENCLAVE_POLL_TIMEOUT_MS,
        pollMs: ENCLAVE_POLL_INTERVAL_MS,
      });
    } catch (error) {
      if (isJobTimeout(error)) {
        const timeoutState = jobStateFromError(error);
        if (timeoutState && TERMINAL_FAILURE_STATES.has(timeoutState)) {
          stored = { ...stored, state: timeoutState };
          await store.putEnclaveJob(input.requestId, stored);
          throw terminalJobError(stored.jobId, timeoutState);
        }
        return { state: "running", jobId: stored.jobId };
      }
      throw error;
    }
  }

  stored = { ...stored, state: job.state };
  await store.putEnclaveJob(input.requestId, stored);
  if (!isTerminalJob(job)) {
    return { state: "running", jobId: stored.jobId };
  }
  if (job.state !== "completed") {
    throw terminalJobError(job.jobId, job.state, job.failureReason);
  }
  if (!job.result) {
    throw new JobRejectedError(
      "Completed job status does not include a result handle",
      undefined,
      null,
      { jobId: job.jobId, state: job.state },
    );
  }
  const result: JobResult = await client.openResult(job.result, {
    expect: { jobId: job.jobId, scope },
  });
  return {
    state: "completed",
    data: { [scope]: decodeEnclaveResult(result) },
  };
}

/** Blocking helper retained for the command-line diagnostic script. */
export async function readEnclaveScopes(input: {
  gatewayUrl: string;
  chainId: number;
  builderPrivateKey: string;
  grantId: string;
  scopes: readonly string[];
  status?: unknown;
  fetchFn?: typeof fetch;
  jobsClientFactory?: (
    options: Parameters<typeof createJobsClient>[0],
  ) => Pick<ReturnType<typeof createJobsClient>, "readRaw">;
}): Promise<Record<string, unknown>> {
  const gatewayUrl = gatewayOrigin(input.gatewayUrl);
  if (!GRANT_ID_PATTERN.test(input.grantId)) {
    throw new EnclaveReadError("The approved grant id is invalid.", 502);
  }
  const owner = await resolveGrantOwner({
    gatewayUrl,
    grantId: input.grantId,
    status: input.status,
    fetchFn: input.fetchFn,
  });
  const client = (input.jobsClientFactory ?? createJobsClient)({
    gatewayUrl,
    chainId: input.chainId,
    builderPrivateKey: input.builderPrivateKey as Hex,
  });
  const data: Record<string, unknown> = {};
  for (const scope of input.scopes) {
    const result = await client.readRaw({
      owner,
      grantId: input.grantId as Hex,
      scope,
      wait: ENCLAVE_READ_WAIT_SECONDS,
      timeoutMs: ENCLAVE_READ_TIMEOUT_MS,
    });
    data[scope] = decodeEnclaveResult(result);
  }
  return data;
}

function isTerminalJob(job: JobStatus): boolean {
  return job.state === "completed" || TERMINAL_FAILURE_STATES.has(job.state);
}

function isJobTimeout(error: unknown): boolean {
  return isRecord(error) && error.code === "JOB_TIMEOUT";
}

function jobStateFromError(error: unknown): JobState | null {
  if (!isRecord(error) || !isRecord(error.details)) return null;
  const state = error.details.state;
  return typeof state === "string" && isJobState(state) ? state : null;
}

function isJobState(value: string): value is JobState {
  return (
    value === "queued" ||
    value === "claimed" ||
    value === "running" ||
    value === "completed" ||
    value === "failed" ||
    value === "expired" ||
    value === "cancelled"
  );
}

function terminalJobError(
  jobId: string,
  state: JobState,
  failureReason?: string | null,
): JobRejectedError {
  return new JobRejectedError(
    `Job ${jobId} ended in state ${state}${failureReason ? `: ${failureReason}` : ""}`,
    undefined,
    null,
    {
      jobId,
      state,
      ...(failureReason ? { failureReason } : {}),
    },
  );
}

function ownerAddressFrom(value: unknown): Address | null {
  if (!isRecord(value)) return null;
  const nested = ownerAddressFrom(value.data);
  if (nested) return nested;
  for (const field of [
    "owner",
    "ownerAddress",
    "userAddress",
    "grantorAddress",
  ]) {
    const candidate = value[field];
    if (typeof candidate === "string" && isAddress(candidate)) {
      return getAddress(candidate);
    }
  }
  return null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
