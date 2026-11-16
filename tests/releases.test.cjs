const assert = require("node:assert/strict");
const { test } = require("node:test");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");

const source = readFileSync(resolve(__dirname, "../src/api/releases.js"), "utf8");
const api = import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
const repository = "Aziz-coder0/ccasso-scanner";

function release(tag = "v2.10.0", names = ["CCASSO-Scanner-2.10.0.apk"]) {
  return {
    tag_name: tag,
    draft: false,
    prerelease: false,
    assets: names.map((name) => ({
      name,
      size: 100,
      state: "uploaded",
      browser_download_url: `https://github.com/${repository}/releases/download/${tag}/${name}`,
    })),
  };
}

test("requires a newer stable APK by comparing version components numerically", async () => {
  const { requiredAndroidUpdate } = await api;
  const update = release();
  assert.deepEqual(requiredAndroidUpdate(update, "2.9.9", repository), {
    version: "2.10.0",
    url: update.assets[0].browser_download_url,
  });
  assert.equal(requiredAndroidUpdate(update, "2.10.0", repository), null);
  assert.equal(requiredAndroidUpdate(update, "3.0.0", repository), null);
  assert.equal(requiredAndroidUpdate(update, "invalid", repository), null);
});

test("ignores drafts, prereleases, malformed versions and missing or untrusted APKs", async () => {
  const { requiredAndroidUpdate } = await api;
  const candidate = release();
  const bad = [
    null,
    { ...candidate, draft: true },
    { ...candidate, prerelease: true },
    release("v2.10.0-beta.1"),
    release("v2.10.0", ["app.aab", "CCASSO-Scanner-2.10.0-local-test.apk"]),
    { ...candidate, assets: [{ ...candidate.assets[0], state: "new" }] },
    { ...candidate, assets: [{ ...candidate.assets[0], browser_download_url: "https://example.com/update.apk" }] },
  ];
  for (const entry of bad) assert.equal(requiredAndroidUpdate(entry, "2.3.0", repository), null);
});

test("accepts a single APK and prefers the versioned APK when multiple are available", async () => {
  const { requiredAndroidUpdate } = await api;
  const single = release("2.10.0", ["app-release.apk", "app-debug.apk"]);
  assert.equal(requiredAndroidUpdate(single, "2.3.0", repository).url, single.assets[0].browser_download_url);
  const mixed = release("v2.10.0", ["app-release.apk", "CCASSO-Scanner-2.10.0.apk"]);
  assert.equal(requiredAndroidUpdate(mixed, "2.3.0", repository).url, mixed.assets[1].browser_download_url);
  assert.equal(requiredAndroidUpdate(release("v2.10.0", ["app-release.apk", "variant.apk"]), "2.3.0", repository), null);
});

test("no public release yields no update and rate limits remain retryable check failures", async (t) => {
  const { fetchLatestRelease } = await api;
  const fetch = t.mock.method(global, "fetch", async (url, options) => {
    assert.equal(url, `https://api.github.com/repos/${repository}/releases/latest`);
    assert.ok(options.signal instanceof AbortSignal);
    assert.equal(options.headers.Authorization, undefined);
    return { status: 404, ok: false };
  });
  assert.equal(await fetchLatestRelease(repository), null);
  fetch.mock.mockImplementation(async () => ({ status: 429, ok: false }));
  await assert.rejects(fetchLatestRelease(repository), /release check failed/);
});
