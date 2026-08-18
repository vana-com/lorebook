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
import { jsonNoStore } from "../src/lib/vana/response";
import { buildHomePath, buildRequestPath } from "../src/lib/vana/request-path";
import { resolveFixtureJourney, resolveLaunchRuntime } from "../src/lib/vana/runtime";

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

test("marks JSON responses as non-cacheable", async () => {
  const response = jsonNoStore(
    { error: "Sanitized failure" },
    { status: 503, headers: { "Cache-Control": "public, max-age=60" } },
  );

  assert.equal(response.status, 503);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.deepEqual(await response.json(), { error: "Sanitized failure" });
});
