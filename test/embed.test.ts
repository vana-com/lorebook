import assert from "node:assert/strict";
import { test } from "node:test";
import { isVanaSheetEnabled, resolveVanaAccountOrigin, type VanaEmbedConfig } from "../src/lib/vana/embed";

const PREVIEW = "https://vana-account-git-branch-opendatalabs.vercel.app";
const config = (over: Partial<VanaEmbedConfig> = {}): VanaEmbedConfig => ({
  deployEnv: "preview",
  previewOrigins: PREVIEW,
  sheetEnabled: "1",
  ...over,
});
const viaParam = (value: string) => `?vana_account=${encodeURIComponent(value)}`;

test("the sheet loads from the runtime's Vana Account by default", () => {
  assert.equal(resolveVanaAccountOrigin("dev", "", config()), "https://account-dev.vana.org");
  assert.equal(resolveVanaAccountOrigin("production", "", config()), "https://account.vana.org");
});

test("production ignores the override, even for allowlisted and local origins", () => {
  for (const deployEnv of ["production", "", "unknown"]) {
    const c = config({ deployEnv: deployEnv || "production" });
    for (const origin of [PREVIEW, "http://localhost:3084", "https://evil.example"]) {
      assert.equal(resolveVanaAccountOrigin("dev", viaParam(origin), c), "https://account-dev.vana.org");
    }
  }
});

test("a preview deploy accepts only origins on its explicit allowlist", () => {
  assert.equal(resolveVanaAccountOrigin("dev", viaParam(PREVIEW), config()), PREVIEW);
  for (const hostile of [
    "https://evil.example",
    // Matches the old regex shape but is not on the list: anyone can claim such a project.
    "https://vana-account-git-attacker-opendatalabs.vercel.app",
    "http://vana-account-git-branch-opendatalabs.vercel.app",
    `${PREVIEW}.evil.example`,
    "https://evil.example@vana-account-git-branch-opendatalabs.vercel.app.evil.example",
    "javascript:alert(1)",
    "http://localhost:3084",
  ]) {
    assert.equal(resolveVanaAccountOrigin("dev", viaParam(hostile), config()), "https://account-dev.vana.org");
  }
  assert.equal(
    resolveVanaAccountOrigin("dev", viaParam(PREVIEW), config({ previewOrigins: "" })),
    "https://account-dev.vana.org",
  );
});

test("the allowlist is exact origins; malformed entries are ignored", () => {
  const second = "https://vana-account-git-other-opendatalabs.vercel.app";
  const c = config({ previewOrigins: ` not-a-url, ${PREVIEW}/path ,${second}/ ` });
  assert.equal(resolveVanaAccountOrigin("dev", viaParam(PREVIEW), c), "https://account-dev.vana.org");
  assert.equal(resolveVanaAccountOrigin("dev", viaParam(second), c), second);
});

test("only a local development build trusts a local Account", () => {
  const local = "http://localhost:3084";
  assert.equal(resolveVanaAccountOrigin("dev", viaParam(local), config({ deployEnv: "development" })), local);
  assert.equal(resolveVanaAccountOrigin("dev", viaParam(local), config({ deployEnv: "preview" })), "https://account-dev.vana.org");
});

test("the sheet button is off unless explicitly enabled", () => {
  assert.equal(isVanaSheetEnabled(config({ sheetEnabled: "" })), false);
  assert.equal(isVanaSheetEnabled(config({ sheetEnabled: "true" })), false);
  assert.equal(isVanaSheetEnabled(config({ sheetEnabled: "1" })), true);
});
