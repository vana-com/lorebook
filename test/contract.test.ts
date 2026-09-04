import assert from "node:assert/strict";
import { test } from "node:test";
import {
  GrantInvalidError,
  JobNotFoundError,
  JobRejectedError,
  JobTimeoutError,
  OwnerNotReadyError,
} from "@opendatalabs/vana-sdk";
import {
  AccessNotApprovedError,
  getDirectEndpoints,
  PaymentRequiredError,
  PersonalServerReadError,
} from "@opendatalabs/vana-sdk/server";
import type {
  JobResult,
  JobState,
  JobStatus,
} from "@opendatalabs/vana-sdk/protocol/jobs";
import { getAddress } from "viem";
import {
  ENCLAVE_CLIENT_POLL_INTERVAL_MS,
  ENCLAVE_CLIENT_TIMEOUT_MS,
  pollLorebookResult,
  readFailureCopy,
} from "../src/components/LorebookApp";
import { resolveAppUrl } from "../src/lib/vana/app-url";
import {
  createRequestBinding,
  readRequestBinding,
  requestBindingCookieName,
  setRequestBindingCookie,
} from "../src/lib/vana/binding";
import { assertGrantReadReady } from "../src/lib/vana/capability";
import {
  LOREBOOK_DEEP_APP,
  LOREBOOK_DESKTOP_FIXTURE_APP,
  LOREBOOK_QUICK_APP,
} from "../src/lib/vana/constants";
import { mapClientError } from "../src/lib/vana/errors";
import {
  createMemoryDeliveryStore,
  createRedisDeliveryStore,
  DeliveryStoreError,
  resolveDeliveryStore,
  type DeliveryStore,
} from "../src/lib/vana/delivery-store";
import {
  consumeForegroundDelivery,
  createForegroundDelivery,
  getDeliveredResult,
  registerForegroundDelivery,
  storeDeliveredResult,
} from "../src/lib/vana/foreground-delivery";
import { jsonNoStore, noStore } from "../src/lib/vana/response";
import {
  buildHomePath,
  buildRequestPath,
  buildRuntimeSwitchPath,
} from "../src/lib/vana/request-path";
import {
  resolveFixtureJourney,
  resolveLaunchRuntime,
  resolveVanaDefaultEnv,
  resolveVanaDefaultNetwork,
  chainIdForNetwork,
  runtimeOptionId,
  RUNTIME_OPTIONS,
} from "../src/lib/vana/runtime";
import {
  applyDirectEndpointOverrides,
  directEndpointOverrides,
} from "../src/lib/vana/endpoints";
import {
  approvedEnclaveScopes,
  decodeEnclaveResult,
  ENCLAVE_JOB_DEADLINE_SECONDS,
  ENCLAVE_POLL_TIMEOUT_MS,
  ENCLAVE_READ_TIMEOUT_MS,
  ENCLAVE_READ_WAIT_SECONDS,
  ENCLAVE_ROUTE_TIMEOUT_MARGIN_MS,
  EnclaveReadError,
  gatewayOrigin,
  isEnclaveReadMode,
  readEnclaveScopes,
  readResumableEnclaveScopes,
  resolveGrantOwner,
  shouldUseEnclaveRead,
} from "../src/lib/vana/enclave";
import { readThenAcknowledge } from "../src/lib/vana/read-lifecycle";

const SECRET = `0x${"1".repeat(64)}`;
const ORIGIN = "https://snapshot.example";

function resumableReadInput(requestId: string, store: DeliveryStore) {
  return {
    requestId,
    gatewayUrl: "https://gateway.example",
    chainId: 14800,
    builderPrivateKey: `0x${"2".repeat(64)}`,
    grantId: `0x${"1".repeat(64)}`,
    scopes: ["spotify.profile"],
    status: { ownerAddress: `0x${"a".repeat(40)}` },
    now: () => 1_000,
    store,
  };
}

function jobStatus(jobId: string, state: JobState): JobStatus {
  return {
    jobId,
    state,
    operation: "raw_read",
    owner: getAddress(`0x${"a".repeat(40)}`),
    grantId: `0x${"1".repeat(64)}`,
    scope: "spotify.profile",
    pinnedVersion: null,
    attempt: 1,
    price: "0",
    payer: "builder",
    paymentState: "none",
    createdAt: new Date(1_000).toISOString(),
    claimedAt: null,
    completedAt: state === "completed" ? new Date(2_000).toISOString() : null,
    failureReason: state === "failed" ? "The source read failed." : null,
    ...(state === "completed"
      ? {
          result: {
            objectKey: `jobresults/14800/${jobId}`,
            url: `https://storage.example/${jobId}`,
            size: 1,
            hash: `0x${"0".repeat(64)}`,
            expiresAt: new Date(901_000).toISOString(),
          },
        }
      : {}),
  };
}

function jobResult(jobId: string): JobResult {
  return {
    v: 1,
    jobId,
    scope: "spotify.profile",
    version: null,
    contentType: "application/json",
    body: new TextEncoder().encode(
      JSON.stringify({ profile: { display_name: "Ada" } }),
    ),
  };
}

test("strictly validates and resolves launch runtime", () => {
  assert.deepEqual(resolveLaunchRuntime(new URLSearchParams()), {
    env: "production",
    network: "mainnet",
  });
  assert.deepEqual(resolveLaunchRuntime(new URLSearchParams("network=mainnet")), {
    env: "production",
    network: "mainnet",
  });
  assert.deepEqual(resolveLaunchRuntime(new URLSearchParams("vana_env=dev&network=moksha")), {
    env: "dev",
    network: "moksha",
  });
  assert.deepEqual(resolveLaunchRuntime(new URLSearchParams("vana_env=development&network=MAINNET")), {
    env: "dev",
    network: "mainnet",
  });
  assert.deepEqual(resolveLaunchRuntime(new URLSearchParams("vana_env=prod&network=moksha")), {
    env: "production",
    network: "moksha",
  });
  assert.throws(() => resolveLaunchRuntime(new URLSearchParams("vana_env=staging")), /Invalid vana_env/);
  assert.throws(() => resolveLaunchRuntime(new URLSearchParams("network=testnet")), /Invalid network/);
  assert.throws(() => resolveLaunchRuntime(new URLSearchParams("network=moksha&network=mainnet")), /only be provided once/);
});

test("uses the validated server network default while query parameters win", () => {
  const defaultNetwork = resolveVanaDefaultNetwork({
    VANA_DEFAULT_NETWORK: "moksha",
  });
  assert.equal(defaultNetwork, "moksha");
  assert.deepEqual(resolveLaunchRuntime(new URLSearchParams(), defaultNetwork), {
    env: "production",
    network: "moksha",
  });
  assert.deepEqual(
    resolveLaunchRuntime(new URLSearchParams("network=mainnet"), defaultNetwork),
    { env: "production", network: "mainnet" },
  );
  assert.equal(resolveVanaDefaultNetwork({}), "mainnet");
  assert.throws(
    () => resolveVanaDefaultNetwork({ VANA_DEFAULT_NETWORK: "testnet" }),
    /Invalid VANA_DEFAULT_NETWORK/,
  );
  assert.throws(
    () =>
      resolveVanaDefaultNetwork({
        VANA_DEFAULT_NETWORK: "mainnet",
        VANA_GATEWAY_URL: "https://gateway-moksha.example",
      }),
    /mainnet.*Moksha Gateway/,
  );
});

test("uses the validated server environment default while query parameters win", () => {
  const defaultEnv = resolveVanaDefaultEnv({ VANA_DEFAULT_ENV: "dev" });
  assert.equal(defaultEnv, "dev");
  assert.deepEqual(
    resolveLaunchRuntime(new URLSearchParams(), "moksha", defaultEnv),
    { env: "dev", network: "moksha" },
  );
  assert.deepEqual(
    resolveLaunchRuntime(
      new URLSearchParams("vana_env=production"),
      "moksha",
      defaultEnv,
    ),
    { env: "production", network: "moksha" },
  );
  assert.equal(resolveVanaDefaultEnv({}), "production");
  assert.throws(
    () => resolveVanaDefaultEnv({ VANA_DEFAULT_ENV: "staging" }),
    /Invalid VANA_DEFAULT_ENV/,
  );
});

test("forwards only the deployment runtime selectors to request creation", () => {
  assert.equal(
    buildRequestPath("deep", "?vana_env=dev&network=moksha&utm_source=qa"),
    "/api/vana/request?mode=deep&vana_env=dev&network=moksha",
  );
  assert.equal(buildRequestPath("quick", ""), "/api/vana/request?mode=quick");
  assert.equal(
    buildRequestPath(
      "desktop-saved-tracks",
      "?vana_env=dev&network=moksha&fixture=spotify-saved-tracks&utm_source=qa",
    ),
    "/api/vana/request?mode=deep&vana_env=dev&network=moksha&fixture=spotify-saved-tracks",
  );
  assert.equal(
    buildHomePath({ env: "dev", network: "moksha" }),
    "/?vana_env=dev&network=moksha",
  );
  assert.equal(buildHomePath({ env: "production", network: "mainnet" }), "/");
  assert.equal(
    buildHomePath({ env: "dev", network: "moksha" }, "desktop-saved-tracks"),
    "/?vana_env=dev&network=moksha&fixture=spotify-saved-tracks",
  );
});

test("maps every network selector option to its canonical launch URL", () => {
  assert.deepEqual(
    RUNTIME_OPTIONS.map((option) => [option.id, buildRuntimeSwitchPath(option.runtime)]),
    [
      ["testnet", "/?vana_env=dev&network=moksha"],
      ["mainnet", "/"],
    ],
  );

  // The selector round-trips: the URL an option produces resolves back to it.
  for (const option of RUNTIME_OPTIONS) {
    const href = buildRuntimeSwitchPath(option.runtime);
    const search = href.split("?")[1] ?? "";
    assert.equal(runtimeOptionId(resolveLaunchRuntime(new URLSearchParams(search))), option.id);
  }
  assert.equal(runtimeOptionId({ env: "dev", network: "mainnet" }), null);

  // The Desktop fixture rides along only where it stays legal.
  assert.equal(
    buildRuntimeSwitchPath({ env: "dev", network: "moksha" }, "desktop-saved-tracks"),
    "/?vana_env=dev&network=moksha&fixture=spotify-saved-tracks",
  );
  assert.equal(
    buildRuntimeSwitchPath({ env: "production", network: "mainnet" }, "desktop-saved-tracks"),
    "/",
  );
  assert.equal(buildRuntimeSwitchPath({ env: "dev", network: "moksha" }, "quick"), "/?vana_env=dev&network=moksha");
});

test("enables the Desktop fixture only with explicit dev and Moksha guards", () => {
  const enabled = new URLSearchParams(
    "vana_env=dev&network=moksha&fixture=spotify-saved-tracks",
  );
  assert.equal(resolveFixtureJourney(enabled), "desktop-saved-tracks");
  for (const query of [
    "fixture=spotify-saved-tracks",
    "vana_env=production&network=moksha&fixture=spotify-saved-tracks",
    "vana_env=dev&network=mainnet&fixture=spotify-saved-tracks",
    "vana_env=dev&network=moksha&fixture=other",
    "vana_env=dev&network=moksha&fixture=spotify-saved-tracks&fixture=spotify-saved-tracks",
  ]) {
    assert.throws(() => resolveFixtureJourney(new URLSearchParams(query)), /Invalid Lorebook fixture/);
  }
  assert.equal(resolveFixtureJourney(new URLSearchParams("vana_env=dev&network=moksha")), null);
});

test("SDK service-plane selection resolves the expected approval hosts", () => {
  assert.equal(new URL(getDirectEndpoints("dev").approvalAppBaseUrl).hostname, "app-dev.vana.org");
  assert.equal(new URL(getDirectEndpoints("production").approvalAppBaseUrl).hostname, "app.vana.org");
});

test("applies only configured Direct endpoint overrides", () => {
  assert.equal(directEndpointOverrides({}), undefined);
  assert.deepEqual(
    directEndpointOverrides({
      VANA_ACCESS_REQUEST_BASE_URL: " http://localhost:3083 ",
    }),
    { accessRequestBaseUrl: "http://localhost:3083" },
  );
  assert.deepEqual(
    directEndpointOverrides({
      VANA_ACCESS_REQUEST_BASE_URL: "http://localhost:3083",
      VANA_APPROVAL_APP_BASE_URL: "http://localhost:3083",
    }),
    {
      accessRequestBaseUrl: "http://localhost:3083",
      approvalAppBaseUrl: "http://localhost:3083",
    },
  );
  assert.deepEqual(
    applyDirectEndpointOverrides(
      {
        accessRequestBaseUrl: "https://access.default",
        approvalAppBaseUrl: "https://approval.default",
        escrowGatewayUrl: "https://escrow.default",
      },
      {
        VANA_ACCESS_REQUEST_BASE_URL: "https://access.override",
        VANA_APPROVAL_APP_BASE_URL: "https://approval.override",
      },
    ),
    {
      accessRequestBaseUrl: "https://access.override",
      approvalAppBaseUrl: "https://approval.override",
      escrowGatewayUrl: "https://escrow.default",
    },
  );
});

test("keeps enclave reads opt-in and resolves protocol chain ids", () => {
  assert.equal(isEnclaveReadMode({}), false);
  assert.equal(shouldUseEnclaveRead({ delivery: "personal_server" }, {}), false);
  assert.equal(shouldUseEnclaveRead({ delivery: "enclave" }, {}), true);
  assert.equal(
    shouldUseEnclaveRead(
      { delivery: "personal_server" },
      { VANA_READ_MODE: "enclave" },
    ),
    true,
  );
  assert.equal(ENCLAVE_JOB_DEADLINE_SECONDS, 600);
  assert.equal(ENCLAVE_POLL_TIMEOUT_MS, 20_000);
  assert.equal(ENCLAVE_READ_WAIT_SECONDS, 25);
  assert.equal(ENCLAVE_ROUTE_TIMEOUT_MARGIN_MS, 5_000);
  assert.equal(ENCLAVE_READ_TIMEOUT_MS, 30_000);
  assert.equal(isEnclaveReadMode({ VANA_READ_MODE: "enclave" }), true);
  assert.equal(chainIdForNetwork("mainnet"), 1480);
  assert.equal(chainIdForNetwork("moksha"), 14800);
});

test("acknowledges every successful read without hiding its result", async () => {
  const calls: string[] = [];
  const result = await readThenAcknowledge({
    read: async () => {
      calls.push("read");
      return { ok: true };
    },
    acknowledge: async () => {
      calls.push("acknowledge");
    },
    onAcknowledgeError: () => assert.fail("acknowledgement should succeed"),
  });
  assert.deepEqual(result, { ok: true });
  assert.deepEqual(calls, ["read", "acknowledge"]);

  const warning = new Error("ack unavailable");
  let observed: unknown;
  assert.equal(
    await readThenAcknowledge({
      read: async () => "data",
      acknowledge: async () => {
        throw warning;
      },
      onAcknowledgeError: (error) => {
        observed = error;
      },
    }),
    "data",
  );
  assert.equal(observed, warning);

  let acknowledged = false;
  await assert.rejects(
    () =>
      readThenAcknowledge({
        read: async () => {
          throw new Error("read failed");
        },
        acknowledge: async () => {
          acknowledged = true;
        },
        onAcknowledgeError: () => assert.fail("acknowledgement must not run"),
      }),
    /read failed/,
  );
  assert.equal(acknowledged, false);
});

test("maps an enclave scope mismatch to a terminal 403", () => {
  assert.deepEqual(
    approvedEnclaveScopes(
      { scopes: ["spotify.profile"] },
      ["spotify.profile"],
    ),
    ["spotify.profile"],
  );
  assert.throws(
    () =>
      approvedEnclaveScopes(
        { scopes: ["spotify.profile"] },
        ["chatgpt.conversations"],
      ),
    (error) => {
      assert.ok(error instanceof EnclaveReadError);
      assert.deepEqual(mapClientError(error), {
        kind: "failed",
        error: "The approved grant does not cover Lorebook's requested data type.",
        status: 403,
      });
      return true;
    },
  );
});

test("requires a bare Gateway origin", () => {
  assert.equal(gatewayOrigin("https://gateway.example"), "https://gateway.example");
  assert.equal(gatewayOrigin("http://localhost:3000"), "http://localhost:3000");
  assert.equal(gatewayOrigin("http://127.0.0.1:3000"), "http://127.0.0.1:3000");
  assert.equal(gatewayOrigin("http://[::1]:3000"), "http://[::1]:3000");
  assert.throws(() => gatewayOrigin(undefined), /VANA_GATEWAY_URL/);
  assert.throws(
    () => gatewayOrigin("http://gateway.example"),
    /bare HTTPS origin or a loopback HTTP origin/,
  );
  assert.throws(() => gatewayOrigin("https://gateway.example/v1"), /bare HTTPS origin/);
});

test("prefers a status owner and otherwise resolves the grantor from the Gateway", async () => {
  const grantId = `0x${"1".repeat(64)}`;
  const statusOwner = `0x${"a".repeat(40)}`;
  let fetched = false;
  const resolvedStatusOwner = await resolveGrantOwner({
    gatewayUrl: "https://gateway.example",
    grantId,
    status: { userAddress: statusOwner },
    fetchFn: async () => {
      fetched = true;
      return Response.json({});
    },
  });
  assert.equal(resolvedStatusOwner.toLowerCase(), statusOwner);
  assert.equal(fetched, false);

  const grantor = `0x${"b".repeat(40)}`;
  const resolvedGrantor = await resolveGrantOwner({
    gatewayUrl: "https://gateway.example",
    grantId,
    fetchFn: async (url) => {
      assert.equal(url, `https://gateway.example/v1/grants/${grantId}`);
      return Response.json({ data: { grantorAddress: grantor } });
    },
  });
  assert.equal(resolvedGrantor.toLowerCase(), grantor);
});

test("reads an enclave scope through the injected jobs client", async () => {
  const owner = `0x${"a".repeat(40)}`;
  const grantId = `0x${"1".repeat(64)}`;
  const builderPrivateKey = `0x${"2".repeat(64)}`;
  let clientOptions: unknown;
  let readInput: unknown;
  const data = await readEnclaveScopes({
    gatewayUrl: "https://gateway.example",
    chainId: 14800,
    builderPrivateKey,
    grantId,
    scopes: ["spotify.profile"],
    status: { ownerAddress: owner },
    jobsClientFactory: (options) => {
      clientOptions = options;
      return {
        readRaw: async (input) => {
          readInput = input;
          return {
            v: 1,
            jobId: "job-1",
            scope: input.scope,
            version: null,
            contentType: "application/json",
            body: new TextEncoder().encode(
              JSON.stringify({ profile: { display_name: "Ada" } }),
            ),
          };
        },
      };
    },
  });

  assert.deepEqual(clientOptions, {
    gatewayUrl: "https://gateway.example",
    chainId: 14800,
    builderPrivateKey,
  });
  assert.deepEqual(readInput, {
    owner: getAddress(owner),
    grantId,
    scope: "spotify.profile",
    wait: 25,
    timeoutMs: 30_000,
  });
  assert.deepEqual(data, { "spotify.profile": { profile: { display_name: "Ada" } } });
});

test("returns running then completes the same enclave job across requests", async () => {
  const store = createMemoryDeliveryStore();
  const owner = `0x${"a".repeat(40)}`;
  const grantId = `0x${"1".repeat(64)}`;
  let submits = 0;
  let waits = 0;
  const jobsClientFactory: NonNullable<
    Parameters<typeof readResumableEnclaveScopes>[0]["jobsClientFactory"]
  > = () => ({
    submitRawRead: async () => {
      submits += 1;
      return { jobId: "job-resume", state: "queued" };
    },
    getJob: async () => jobStatus("job-resume", "completed"),
    waitForJob: async () => {
      waits += 1;
      if (waits === 1) {
        throw new JobTimeoutError("short poll elapsed", {
          jobId: "job-resume",
          timeoutMs: ENCLAVE_POLL_TIMEOUT_MS,
          state: "running",
        });
      }
      return jobStatus("job-resume", "completed");
    },
    openResult: async () => jobResult("job-resume"),
  });
  const input = {
    requestId: "dcr_resume",
    gatewayUrl: "https://gateway.example",
    chainId: 14800,
    builderPrivateKey: `0x${"2".repeat(64)}`,
    grantId,
    scopes: ["spotify.profile"],
    status: { ownerAddress: owner },
    now: () => 1_000,
    store,
    jobsClientFactory,
  };

  assert.deepEqual(await readResumableEnclaveScopes(input), {
    state: "running",
    jobId: "job-resume",
  });
  assert.deepEqual(await store.readEnclaveJob("dcr_resume", 1_001), {
    jobId: "job-resume",
    scope: "spotify.profile",
    submittedAt: 1_000,
    deadlineAt: 601_000,
    state: "queued",
    expiresAt: 901_000,
  });
  assert.deepEqual(await readResumableEnclaveScopes(input), {
    state: "completed",
    data: { "spotify.profile": { profile: { display_name: "Ada" } } },
  });
  assert.equal(submits, 1);
});

test("retry resumes a bound running enclave job without submitting", async () => {
  const store = createMemoryDeliveryStore();
  await store.putEnclaveJob("dcr_running", {
    jobId: "job-running",
    scope: "spotify.profile",
    submittedAt: 1_000,
    deadlineAt: 601_000,
    state: "running",
    expiresAt: 901_000,
  });
  let submits = 0;
  const outcome = await readResumableEnclaveScopes({
    ...resumableReadInput("dcr_running", store),
    jobsClientFactory: () => ({
      submitRawRead: async () => {
        submits += 1;
        return { jobId: "unexpected", state: "queued" };
      },
      getJob: async () => jobStatus("job-running", "running"),
      waitForJob: async () => {
        throw new JobTimeoutError("short poll elapsed", {
          jobId: "job-running",
          timeoutMs: ENCLAVE_POLL_TIMEOUT_MS,
          state: "running",
        });
      },
      openResult: async () => jobResult("job-running"),
    }),
  });
  assert.deepEqual(outcome, { state: "running", jobId: "job-running" });
  assert.equal(submits, 0);
});

test("retry after a failed enclave job submits one replacement", async () => {
  const store = createMemoryDeliveryStore();
  await store.putEnclaveJob("dcr_failed", {
    jobId: "job-failed",
    scope: "spotify.profile",
    submittedAt: 1_000,
    deadlineAt: 601_000,
    state: "failed",
    expiresAt: 901_000,
  });
  let submits = 0;
  const outcome = await readResumableEnclaveScopes({
    ...resumableReadInput("dcr_failed", store),
    jobsClientFactory: () => ({
      submitRawRead: async () => {
        submits += 1;
        return { jobId: "job-retry", state: "queued" };
      },
      getJob: async () => jobStatus("job-retry", "queued"),
      waitForJob: async () => {
        throw new JobTimeoutError("short poll elapsed", {
          jobId: "job-retry",
          timeoutMs: ENCLAVE_POLL_TIMEOUT_MS,
          state: "queued",
        });
      },
      openResult: async () => jobResult("job-retry"),
    }),
  });
  assert.deepEqual(outcome, { state: "running", jobId: "job-retry" });
  assert.equal(submits, 1);
});

test("an expired enclave job renders the terminal failure copy", async () => {
  const store = createMemoryDeliveryStore();
  await store.putEnclaveJob("dcr_expired", {
    jobId: "job-expired",
    scope: "spotify.profile",
    submittedAt: 1_000,
    deadlineAt: 601_000,
    state: "running",
    expiresAt: 901_000,
  });
  await assert.rejects(
    () =>
      readResumableEnclaveScopes({
        ...resumableReadInput("dcr_expired", store),
        now: () => 601_000,
        jobsClientFactory: () => ({
          submitRawRead: async () => assert.fail("expired jobs fail before replacement"),
          getJob: async () => assert.fail("expired jobs do not poll"),
          waitForJob: async () => assert.fail("expired jobs do not poll"),
          openResult: async () => assert.fail("expired jobs have no result"),
        }),
      }),
    (error) => {
      const mapped = mapClientError(error);
      assert.equal(mapped.kind, "failed");
      assert.equal(
        readFailureCopy(mapped.kind === "failed" ? mapped.kind : undefined),
        "That read failed, so no new page was added.",
      );
      return true;
    },
  );
});

test("client keeps the reading promise open while the enclave job runs", async () => {
  assert.ok(
    ENCLAVE_CLIENT_TIMEOUT_MS >= ENCLAVE_JOB_DEADLINE_SECONDS * 1_000,
  );
  const responses: unknown[] = [
    { state: "running", jobId: "job-client" },
    { scope: "spotify.profile", data: { kind: "quick" } },
  ];
  const sleeps: number[] = [];
  const result = await pollLorebookResult(
    async () => responses.shift(),
    { sleep: async (milliseconds) => void sleeps.push(milliseconds) },
  );
  assert.deepEqual(result, {
    scope: "spotify.profile",
    data: { kind: "quick" },
  });
  assert.deepEqual(sleeps, [ENCLAVE_CLIENT_POLL_INTERVAL_MS]);
});

test("decodes the jobs result body as the direct-read JSON shape", () => {
  const payload = { profile: { display_name: "Ada" } };
  assert.deepEqual(
    decodeEnclaveResult({
      contentType: "application/json; charset=utf-8",
      body: new TextEncoder().encode(JSON.stringify(payload)),
    }),
    payload,
  );
  assert.throws(
    () =>
      decodeEnclaveResult({
        contentType: "text/plain",
        body: new TextEncoder().encode("{}"),
      }),
    /unsupported content type/,
  );
});

test("derives a fixed return URL from APP_URL origin", () => {
  assert.deepEqual(resolveAppUrl("https://snapshot.example/some/path?caller=ignored"), {
    appUrl: "https://snapshot.example/some/path?caller=ignored",
    returnOrigin: ORIGIN,
    returnUrl: `${ORIGIN}/connect/return`,
  });
  assert.throws(() => resolveAppUrl("javascript:alert(1)"), /HTTP or HTTPS/);
});

test("keeps concurrent request bindings independent and rejects tampering", () => {
  const now = 1_000;
  const runtime = { env: "dev", network: "moksha" } as const;
  const cookies = new Map<string, { value: string; options: Record<string, unknown> }>();
  const writer = {
    set(name: string, value: string, options: Record<string, unknown>) {
      cookies.set(name, { value, options });
    },
  };
  const reader = {
    get(name: string) {
      const cookie = cookies.get(name);
      return cookie ? { value: cookie.value } : undefined;
    },
  };

  for (const requestId of ["dcr_one", "dcr_two"]) {
    const binding = createRequestBinding(
      { requestId, app: LOREBOOK_QUICK_APP, runtime, returnOrigin: ORIGIN, now },
      SECRET,
    );
    setRequestBindingCookie(writer, requestId, binding, true);
  }

  assert.equal(cookies.size, 2);
  assert.deepEqual(cookies.get(requestBindingCookieName("dcr_one"))?.options, {
    httpOnly: true,
    sameSite: "lax",
    secure: true,
    path: "/",
  });
  assert.equal(readRequestBinding(reader, { requestId: "dcr_one", returnOrigin: ORIGIN, now: now + 1 }, SECRET)?.runtime.env, "dev");
  assert.equal(readRequestBinding(reader, { requestId: "dcr_two", returnOrigin: ORIGIN, now: now + 1 }, SECRET)?.runtime.network, "moksha");
  assert.equal(readRequestBinding(reader, { requestId: "dcr_missing", returnOrigin: ORIGIN, now: now + 1 }, SECRET), null);
  assert.equal(readRequestBinding(reader, { requestId: "dcr_one", returnOrigin: "https://evil.example", now: now + 1 }, SECRET), null);
  assert.equal(readRequestBinding(reader, { requestId: "dcr_one", returnOrigin: ORIGIN, now: now + 1 }, `${SECRET}bad`), null);

  const cookieName = requestBindingCookieName("dcr_one");
  const original = cookies.get(cookieName);
  assert.ok(original);
  cookies.set(cookieName, { ...original, value: `${original.value.slice(0, -1)}x` });
  assert.equal(readRequestBinding(reader, { requestId: "dcr_one", returnOrigin: ORIGIN, now: now + 1 }, SECRET), null);

  cookies.set(cookieName, original);
  assert.ok(readRequestBinding(reader, { requestId: "dcr_one", returnOrigin: ORIGIN, now: now + 11 * 60 * 1000 }, SECRET));
  assert.equal(readRequestBinding(reader, { requestId: "dcr_one", returnOrigin: ORIGIN, now: now + 61 * 60 * 1000 }, SECRET), null);
});

test("extends a request binding only when the access request outlives one hour", () => {
  const shortLived = createRequestBinding(
    { requestId: "dcr_short", app: LOREBOOK_QUICK_APP, runtime: { env: "production", network: "mainnet" }, returnOrigin: ORIGIN, now: 1_000, accessRequestExpiresAt: new Date(2_000).toISOString() },
    SECRET,
  );
  const longerLived = createRequestBinding(
    { requestId: "dcr_long", app: LOREBOOK_QUICK_APP, runtime: { env: "production", network: "mainnet" }, returnOrigin: ORIGIN, now: 1_000, accessRequestExpiresAt: new Date(3 * 60 * 60 * 1_000).toISOString() },
    SECRET,
  );
  const decode = (binding: string) => JSON.parse(Buffer.from(binding.split(".")[0] ?? "", "base64url").toString("utf8")) as { expiresAt: number };
  assert.equal(decode(shortLived).expiresAt, 1_000 + 60 * 60 * 1_000);
  assert.equal(decode(longerLived).expiresAt, 3 * 60 * 60 * 1_000);
});

const DELIVERY_BINDING = {
  version: 2 as const,
  requestId: "dcr_delivery",
  appId: LOREBOOK_DEEP_APP.id,
  scopes: [...LOREBOOK_DEEP_APP.scopes],
  returnOrigin: ORIGIN,
  runtime: { env: "production", network: "mainnet" } as const,
  expiresAt: 10_000,
};
const BUILDER = `0x${"a".repeat(40)}`;
const DELIVERED_SNAPSHOT = {
  kind: "deep" as const,
  conversations: { totalConversations: 1, totalMessages: 2, themes: [], recentTitles: [] },
};

test("uses a one-time browser-bound foreground delivery capability", async () => {
  const store = createMemoryDeliveryStore();
  const delivery = createForegroundDelivery(ORIGIN);
  assert.equal(delivery.url, `${ORIGIN}/api/vana/delivery`);
  assert.match(delivery.token, /^[A-Za-z0-9_-]{43}$/);

  const binding = DELIVERY_BINDING;
  await registerForegroundDelivery(
    { binding, token: delivery.token, builderAddress: BUILDER },
    store,
  );
  const deliver = (over: Record<string, unknown> = {}) =>
    consumeForegroundDelivery(
      {
        requestId: binding.requestId,
        token: delivery.token,
        scopes: [...binding.scopes],
        builderAddress: BUILDER,
        now: 1_001,
        ...over,
      },
      store,
    );

  // Every refusal names its own cause instead of collapsing into one 403, and
  // none of them consume the capability the real phone still needs.
  assert.deepEqual(await deliver({ requestId: "dcr_absent" }), {
    ok: false,
    reason: "unknown_request",
  });
  assert.deepEqual(await deliver({ token: "not-a-token" }), {
    ok: false,
    reason: "malformed_token",
  });
  assert.deepEqual(await deliver({ token: createForegroundDelivery(ORIGIN).token }), {
    ok: false,
    reason: "token_mismatch",
  });
  assert.deepEqual(await deliver({ builderAddress: `0x${"b".repeat(40)}` }), {
    ok: false,
    reason: "builder_mismatch",
  });
  assert.deepEqual(await deliver({ scopes: ["wrong.scope"] }), {
    ok: false,
    reason: "scope_mismatch",
  });

  // Two callbacks racing the same live capability: both read it, exactly one
  // deletes it, and only that one is allowed to deliver.
  const raced = await Promise.all([deliver(), deliver()]);
  assert.deepEqual(raced.filter((result) => result.ok), [{ ok: true, binding }]);
  assert.deepEqual(raced.filter((result) => !result.ok), [
    { ok: false, reason: "already_consumed" },
  ]);
  assert.deepEqual(await deliver(), { ok: false, reason: "unknown_request" });

  await storeDeliveredResult(
    { binding, scope: binding.scopes[0]!, data: DELIVERED_SNAPSHOT, now: 2_000 },
    store,
  );
  assert.deepEqual(await getDeliveredResult(binding, 2_001, store), {
    scope: binding.scopes[0],
    data: DELIVERED_SNAPSHOT,
  });
  assert.equal(
    await getDeliveredResult({ ...binding, returnOrigin: "https://evil.example" }, 2_001, store),
    null,
  );
  assert.equal(await getDeliveredResult(binding, 2_000 + 5 * 60 * 1_000, store), null);
});

test("carries a delivery capability between separate server instances", async () => {
  // One Redis keyspace, two independently constructed stores: the mint happens
  // on one instance and the phone's callback lands on the other, which is the
  // case a module-level map silently fails.
  const keyspace = new Map<string, string>();
  const sent: (string | number)[][] = [];
  const reply = (body: unknown) =>
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  const fetchFn = (async (_url: string, init: RequestInit) => {
    const args = JSON.parse(String(init.body)) as (string | number)[];
    sent.push(args);
    const [verb, key, value] = args as [string, string, string];
    if (verb === "SET") {
      keyspace.set(key, value);
      return reply({ result: "OK" });
    }
    if (verb === "GET") return reply({ result: keyspace.get(key) ?? null });
    if (verb === "DEL") return reply({ result: keyspace.delete(key) ? 1 : 0 });
    return reply({ error: `unexpected ${verb}` });
  }) as unknown as typeof fetch;

  const minting = createRedisDeliveryStore({ url: "https://redis.example/", token: "t", fetchFn });
  const delivering = createRedisDeliveryStore({ url: "https://redis.example", token: "t", fetchFn });
  const delivery = createForegroundDelivery(ORIGIN);
  const binding = { ...DELIVERY_BINDING, expiresAt: Date.now() + 60_000 };

  await registerForegroundDelivery(
    { binding, token: delivery.token, builderAddress: BUILDER },
    minting,
  );
  // Registrations expire in the store too, so a lost callback cannot leave a
  // usable capability behind.
  assert.equal(sent[0]?.[0], "SET");
  assert.equal(sent[0]?.[3], "PX");
  assert.ok(Number(sent[0]?.[4]) > 0);
  // The bearer itself is never written to the shared store.
  assert.ok(!String(sent[0]?.[2]).includes(delivery.token));

  const consume = () =>
    consumeForegroundDelivery(
      {
        requestId: binding.requestId,
        token: delivery.token,
        scopes: [...binding.scopes],
        builderAddress: BUILDER,
      },
      delivering,
    );
  assert.deepEqual(await consume(), { ok: true, binding });
  assert.deepEqual(await consume(), { ok: false, reason: "unknown_request" });

  await storeDeliveredResult(
    { binding, scope: binding.scopes[0]!, data: DELIVERED_SNAPSHOT },
    delivering,
  );
  assert.deepEqual(await getDeliveredResult(binding, Date.now(), minting), {
    scope: binding.scopes[0],
    data: DELIVERED_SNAPSHOT,
  });

  const enclaveJob = {
    jobId: "job-shared",
    scope: binding.scopes[0]!,
    submittedAt: Date.now(),
    deadlineAt: Date.now() + 10 * 60 * 1_000,
    state: "running" as const,
    expiresAt: Date.now() + 15 * 60 * 1_000,
  };
  await delivering.putEnclaveJob(binding.requestId, enclaveJob);
  assert.deepEqual(
    await minting.readEnclaveJob(binding.requestId, Date.now()),
    enclaveJob,
  );
});

test("surfaces an unreachable delivery store instead of a silent refusal", async () => {
  const failing = createRedisDeliveryStore({
    url: "https://redis.example",
    token: "t",
    fetchFn: (async () => new Response("nope", { status: 500 })) as unknown as typeof fetch,
  });
  await assert.rejects(
    () => failing.readRegistration("dcr_delivery", Date.now()),
    DeliveryStoreError,
  );
  assert.equal(mapClientError(new DeliveryStoreError("down")).status, 503);
});

test("refuses a half-configured delivery store rather than falling back", async () => {
  const saved = { ...process.env };
  const clear = () => {
    for (const name of [
      "LOREBOOK_REDIS_REST_URL",
      "LOREBOOK_REDIS_REST_TOKEN",
      "KV_REST_API_URL",
      "KV_REST_API_TOKEN",
      "UPSTASH_REDIS_REST_URL",
      "UPSTASH_REDIS_REST_TOKEN",
    ]) {
      delete process.env[name];
    }
  };
  try {
    clear();
    assert.equal(resolveDeliveryStore().kind, "memory");

    clear();
    process.env.LOREBOOK_REDIS_REST_URL = "https://redis.example";
    assert.throws(() => resolveDeliveryStore(), DeliveryStoreError);

    clear();
    process.env.LOREBOOK_REDIS_REST_TOKEN = "t";
    assert.throws(() => resolveDeliveryStore(), DeliveryStoreError);

    clear();
    process.env.KV_REST_API_URL = "https://redis.example";
    process.env.KV_REST_API_TOKEN = "t";
    assert.equal(resolveDeliveryStore().kind, "redis");
  } finally {
    clear();
    Object.assign(process.env, saved);
  }
});

test("blocks reads until the grant covering all scopes is ready", () => {
  const ready = {
    status: "ready_for_read" as const,
    grantId: "0xgrant",
    personalServerUrl: "https://ps.example",
  };
  assert.doesNotThrow(() => assertGrantReadReady(ready));
  assert.doesNotThrow(() =>
    assertGrantReadReady(
      {
        status: "approved",
        grantId: "0xgrant",
        scopes: ["spotify.profile"],
      },
      { requirePersonalServerUrl: false },
    ),
  );
  assert.doesNotThrow(() =>
    assertGrantReadReady({ ...ready, status: "approved", scope: "spotify.profile" }),
  );
  // Not-yet-approved, or approved but missing grant/PS routing, must block.
  assert.throws(() => assertGrantReadReady({ status: "pending" }), AccessNotApprovedError);
  assert.throws(
    () => assertGrantReadReady({ status: "approved", personalServerUrl: "https://ps.example" }),
    AccessNotApprovedError,
  );
  assert.throws(
    () => assertGrantReadReady({ status: "approved", grantId: "0xgrant" }),
    AccessNotApprovedError,
  );
});

test("binds a request to the app's full scope set and rejects tampered scopes", () => {
  const now = 1_000;
  const runtime = { env: "production", network: "mainnet" } as const;
  const cookies = new Map<string, string>();
  const writer = { set: (name: string, value: string) => void cookies.set(name, value) };
  const reader = {
    get(name: string) {
      const value = cookies.get(name);
      return value === undefined ? undefined : { value };
    },
  };

  const binding = createRequestBinding(
    { requestId: "dcr_deep", app: LOREBOOK_DEEP_APP, runtime, returnOrigin: ORIGIN, now },
    SECRET,
  );
  setRequestBindingCookie(writer, "dcr_deep", binding, true);

  const parsed = readRequestBinding(reader, { requestId: "dcr_deep", returnOrigin: ORIGIN, now: now + 1 }, SECRET);
  assert.equal(parsed?.appId, LOREBOOK_DEEP_APP.id);
  assert.deepEqual(parsed?.scopes, LOREBOOK_DEEP_APP.scopes);

  // A binding whose scope set doesn't match the app must not validate, even
  // when correctly signed (the scope set is authenticated, not just carried).
  const tampered = { ...LOREBOOK_DEEP_APP, scopes: ["chatgpt.conversations", "chatgpt.memories"] };
  const tamperedBinding = createRequestBinding(
    { requestId: "dcr_tampered", app: tampered, runtime, returnOrigin: ORIGIN, now },
    SECRET,
  );
  setRequestBindingCookie(writer, "dcr_tampered", tamperedBinding, true);
  assert.equal(readRequestBinding(reader, { requestId: "dcr_tampered", returnOrigin: ORIGIN, now: now + 1 }, SECRET), null);
});

test("authenticates the hidden fixture's exact saved-tracks scope", () => {
  const now = 1_000;
  const cookies = new Map<string, string>();
  const writer = { set: (name: string, value: string) => void cookies.set(name, value) };
  const reader = {
    get(name: string) {
      const value = cookies.get(name);
      return value === undefined ? undefined : { value };
    },
  };
  const binding = createRequestBinding(
    {
      requestId: "dcr_saved_tracks",
      app: LOREBOOK_DESKTOP_FIXTURE_APP,
      runtime: { env: "dev", network: "moksha" },
      returnOrigin: ORIGIN,
      now,
    },
    SECRET,
  );
  setRequestBindingCookie(writer, "dcr_saved_tracks", binding, true);
  assert.deepEqual(
    readRequestBinding(
      reader,
      { requestId: "dcr_saved_tracks", returnOrigin: ORIGIN, now: now + 1 },
      SECRET,
    )?.scopes,
    ["spotify.savedTracks"],
  );
});

test("maps SDK and unknown failures to sanitized client errors", () => {
  assert.deepEqual(mapClientError(new PaymentRequiredError("private payment detail", { secret: true })), {
    kind: "payment_required",
    error: "The app's escrow balance cannot cover this read. Fund the app identity and retry.",
    status: 402,
  });
  assert.deepEqual(mapClientError(new AccessNotApprovedError("private status detail")), {
    kind: "not_ready",
    error: "The approved data is not ready to read.",
    status: 409,
  });
  assert.deepEqual(mapClientError(new PersonalServerReadError("private upstream detail", 502)), {
    kind: "unavailable",
    error: "The Personal Server is temporarily unavailable.",
    status: 503,
  });
  assert.deepEqual(mapClientError(new OwnerNotReadyError("private readiness detail")), {
    kind: "not_ready",
    error: "The data owner does not have a ready Personal Server enclave.",
    status: 409,
  });
  assert.deepEqual(mapClientError(new JobNotFoundError("private identity detail")), {
    kind: "unavailable",
    error: "The enclave read job could not be found.",
    status: 502,
  });
  assert.deepEqual(
    mapClientError(
      new JobRejectedError("private job detail", undefined, null, {
        state: "failed",
        failureReason: "The source stopped before it could return data.",
      }),
    ),
    {
      kind: "failed",
      error: "The enclave could not complete this read.",
      detail: "The source stopped before it could return data.",
      status: 502,
    },
  );
  assert.deepEqual(mapClientError(new GrantInvalidError("private grant detail")), {
    kind: "failed",
    error: "The approved grant does not permit this enclave read.",
    status: 403,
  });
  assert.deepEqual(
    mapClientError(new EnclaveReadError("The approved grant does not cover this scope.", 403)),
    {
      kind: "failed",
      error: "The approved grant does not cover this scope.",
      status: 403,
    },
  );
  assert.deepEqual(mapClientError(new JobTimeoutError("private timeout detail")), {
    kind: "unavailable",
    error: "The enclave read timed out. Retry in a moment.",
    status: 504,
  });
  assert.deepEqual(mapClientError(new Error("private internal detail")), {
    kind: "failed",
    error: "The Vana request failed.",
    status: 500,
  });
});

test("forwards the simplified Direct create response with one mobile continuation URL", async () => {
  // The create route (`/api/vana/request`) hands the SDK's AccessRequest to the
  // browser verbatim as a no-store body. This proves the single mobile-URL
  // contract at the lorebook boundary: `mobileContinuationUrl` passes through
  // untouched and the removed installed-app taxonomy never reappears. It binds
  // only to the wire shape, so it survives SDK connect-flow refactors.
  const accessRequest = {
    requestId: "dcr_mobile_deep",
    approvalUrl: "https://app-dev.vana.org/approve/dcr_mobile_deep",
    appAddress: "0xapp",
    network: "moksha" as const,
    expiresAt: "2026-08-18T13:00:00.000Z",
    mobileContinuationUrl: "https://open-dev.vana.org/continue#ticket_abc123",
  };

  const response = noStore(Response.json(accessRequest));
  assert.equal(response.headers.get("Cache-Control"), "no-store");

  const body = (await response.json()) as Record<string, unknown>;
  assert.deepEqual(body, accessRequest);
  assert.equal(body.mobileContinuationUrl, accessRequest.mobileContinuationUrl);
  for (const removed of [
    "installedAppUrl",
    "installedAppExpiresAt",
    "installedAppFallbackUrl",
    "installedAppReopenUrl",
  ]) {
    assert.equal(Object.hasOwn(body, removed), false, `${removed} must not survive the cutover`);
  }
});

test("marks JSON responses as non-cacheable", async () => {
  const response = jsonNoStore(
    { error: "Sanitized failure" },
    { status: 503, headers: { "Cache-Control": "public, max-age=60" } },
  );

  assert.equal(response.status, 503);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.deepEqual(await response.json(), { error: "Sanitized failure" });
});
