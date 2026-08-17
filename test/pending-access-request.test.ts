import assert from "node:assert/strict";
import test from "node:test";
import type { AccessRequest } from "@opendatalabs/vana-sdk/react";
import {
  clearPendingAccessRequest,
  clearPendingAccessRequestForTerminalStatus,
  loadPendingAccessRequest,
  PENDING_ACCESS_REQUEST_KEY,
  savePendingAccessRequest,
} from "../src/lib/vana/pending-access-request";

const NOW = Date.parse("2026-08-17T12:00:00.000Z");
const PENDING = {
  mode: "deep" as const,
  request: {
    requestId: "dcr_resume_once",
    approvalUrl: "https://app.vana.org/approve/dcr_resume_once",
    appAddress: "0xapp",
    network: "mainnet" as const,
    expiresAt: "2026-08-17T12:05:00.000Z",
  },
};

function storage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
    removeItem: (key: string) => void values.delete(key),
  };
}

test("persists and restores the same non-secret pending request and chapter", () => {
  const localStorage = storage();
  assert.equal(savePendingAccessRequest(localStorage, PENDING, NOW), true);
  assert.deepEqual(loadPendingAccessRequest(localStorage, NOW), PENDING);
  assert.deepEqual(JSON.parse(localStorage.getItem(PENDING_ACCESS_REQUEST_KEY) ?? "{}"), {
    version: 1,
    ...PENDING,
  });
});

test("strips the installed-app capability before persisting a pending request", () => {
  const localStorage = storage();
  const withCapability = {
    ...PENDING,
    request: {
      ...PENDING.request,
      installedAppUrl: "vana-dev://continue?id=dcrcont_secret",
      installedAppExpiresAt: "2026-08-17T12:04:00.000Z",
    },
  };

  assert.equal(savePendingAccessRequest(localStorage, withCapability, NOW), true);
  const raw = localStorage.getItem(PENDING_ACCESS_REQUEST_KEY) ?? "";
  assert.equal(raw.includes("dcrcont_secret"), false);
  assert.deepEqual(loadPendingAccessRequest(localStorage, NOW), PENDING);
});

test("rejects malformed, overbroad, and non-HTTP(S) pending request records", () => {
  const localStorage = storage();
  for (const value of [
    "{",
    JSON.stringify({ version: 1, ...PENDING, extra: true }),
    JSON.stringify({ version: 1, mode: "deep", request: { ...PENDING.request, approvalUrl: "javascript:alert(1)" } }),
    JSON.stringify({ version: 1, mode: "other", request: PENDING.request }),
  ]) {
    localStorage.setItem(PENDING_ACCESS_REQUEST_KEY, value);
    assert.equal(loadPendingAccessRequest(localStorage, NOW), null);
    assert.equal(localStorage.getItem(PENDING_ACCESS_REQUEST_KEY), null);
  }
});

test("clears expired and explicitly reset pending requests", () => {
  const localStorage = storage();
  assert.equal(savePendingAccessRequest(localStorage, PENDING, NOW), true);
  assert.equal(loadPendingAccessRequest(localStorage, Date.parse(PENDING.request.expiresAt)), null);
  assert.equal(localStorage.getItem(PENDING_ACCESS_REQUEST_KEY), null);

  assert.equal(savePendingAccessRequest(localStorage, PENDING, NOW), true);
  clearPendingAccessRequest(localStorage);
  assert.equal(localStorage.getItem(PENDING_ACCESS_REQUEST_KEY), null);
});

test("clears terminal typed statuses but retains pending requests", () => {
  const localStorage = storage();
  for (const status of ["completed", "denied", "expired"] as const) {
    savePendingAccessRequest(localStorage, PENDING, NOW);
    assert.equal(clearPendingAccessRequestForTerminalStatus(localStorage, { status }), true);
    assert.equal(localStorage.getItem(PENDING_ACCESS_REQUEST_KEY), null);
  }

  savePendingAccessRequest(localStorage, PENDING, NOW);
  assert.equal(clearPendingAccessRequestForTerminalStatus(localStorage, { status: "pending" }), false);
  assert.notEqual(localStorage.getItem(PENDING_ACCESS_REQUEST_KEY), null);
});

test("a restored request is handed to resume without creating another request", () => {
  const localStorage = storage();
  savePendingAccessRequest(localStorage, PENDING, NOW);
  const restored = loadPendingAccessRequest(localStorage, NOW);
  let creates = 0;
  let resumes = 0;
  const connect = {
    start() { creates++; },
    resume(request: AccessRequest) {
      resumes++;
      assert.deepEqual(request, PENDING.request);
    },
  };

  if (restored) connect.resume(restored.request);
  assert.equal(resumes, 1);
  assert.equal(creates, 0);
});
