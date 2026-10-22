import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveVanaAccountOrigin } from "../src/lib/vana/embed";

test("the sheet loads from the runtime's Vana Account by default", () => {
  assert.equal(resolveVanaAccountOrigin("dev", ""), "https://account-dev.vana.org");
  assert.equal(resolveVanaAccountOrigin("production", ""), "https://account.vana.org");
});

test("only Vana Account previews or a local Account may replace it", () => {
  const preview = "https://vana-account-git-branch-opendatalabs.vercel.app";
  assert.equal(resolveVanaAccountOrigin("dev", `?vana_account=${preview}`), preview);
  assert.equal(
    resolveVanaAccountOrigin("dev", "?vana_account=http://localhost:3084"),
    "http://localhost:3084",
  );
  for (const hostile of [
    "https://evil.example",
    "http://vana-account-git-branch-opendatalabs.vercel.app",
    "https://vana-account-git-x-opendatalabs.vercel.app.evil.example",
    "javascript:alert(1)",
  ]) {
    assert.equal(
      resolveVanaAccountOrigin("dev", `?vana_account=${encodeURIComponent(hostile)}`),
      "https://account-dev.vana.org",
    );
  }
});
