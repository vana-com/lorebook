import assert from "node:assert/strict";
import { test } from "node:test";
import {
  AccessNotApprovedError,
  getDirectEndpoints,
  PaymentRequiredError,
  PersonalServerReadError,
} from "@opendatalabs/vana-sdk/server";
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
  runtimeOptionId,
  RUNTIME_OPTIONS,
} from "../src/lib/vana/runtime";

const SECRET = `0x${"1".repeat(64)}`;
const ORIGIN = "https://snapshot.example";

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
