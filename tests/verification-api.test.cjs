const assert = require("node:assert/strict");
const { test } = require("node:test");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const { version } = require("../package.json");

const source = readFileSync(resolve(__dirname, "../src/api/kiosk.js"), "utf8");
const api = import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
const response = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body) });
const base = "https://uniorg.example";
const token = "test-private-scanner-token";
const memberQr = "UM1:test-signed-member";
const receiptQr = "UE1:test-signed-receipt";

async function withFetch(mock, fn) {
  const previous = global.fetch;
  global.fetch = mock;
  try { await fn(await api); } finally { global.fetch = previous; }
}

test("membership posts the original QR to its own endpoint with existing Bearer authorization", async () => {
  const calls = [];
  const body = { success: true, valid: true, status: "VALID" };
  await withFetch(async (url, options) => { calls.push({ url, options }); return response(body); }, async ({ verifyMembership }) => {
    assert.deepEqual(await verifyMembership(`${base}///`, ` ${token} `, ` ${memberQr} `, { deviceId: "scanner-1", gateLabel: "Gate A", operatorName: "Tester" }), body);
  });
  assert.equal(calls.length, 1);
  const { url, options } = calls[0];
  assert.equal(url, `${base}/api/kiosk/memberships/verify`);
  assert.equal(options.method, "POST");
  assert.equal(options.headers.Authorization, `Bearer ${token}`);
  assert.equal(options.headers["X-CCASSO-Scanner-Version"], version);
  assert.equal(options.headers["X-Device-Id"], "scanner-1");
  assert.equal(options.headers["X-Gate-Label"], undefined);
  assert.equal(options.headers["X-Operator-Name"], undefined);
  assert.deepEqual(JSON.parse(options.body), { qr_payload: memberQr });
  assert.ok(options.signal instanceof AbortSignal);
  assert.ok(!url.includes(token) && !url.includes(memberQr));
});

test("enrollment posts selected A.Y. with the receipt QR and never records attendance", async () => {
  const calls = [];
  await withFetch(async (url, options) => { calls.push({ url, options }); return response({ success: true, valid: true, status: "VALID", fee_status: "PARTIAL", can_confirm_enrollment_fee: false }); }, async ({ verifyEnrollmentReceipt }) => {
    const result = await verifyEnrollmentReceipt(base, token, receiptQr, "2026-2027");
    assert.equal(result.fee_status, "PARTIAL");
    assert.equal(result.can_confirm_enrollment_fee, false);
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `${base}/api/kiosk/enrollment-receipts/verify`);
  assert.deepEqual(JSON.parse(calls[0].options.body), { qr_payload: receiptQr, academic_year: "2026-2027" });
  assert.equal(calls[0].options.headers.Authorization, `Bearer ${token}`);
  assert.ok(!/\/scan(?:\/|$)|queue/.test(calls[0].url));
});

test("invalid live credentials are returned as verification results rather than transport failures", async () => {
  await withFetch(async () => response({ success: true, valid: false, status: "INVALID_QR" }), async ({ verifyMembership }) => {
    assert.equal((await verifyMembership(base, token, memberQr)).valid, false);
  });
});

test("setup, wrong modes, oversized QRs and invalid A.Y. are rejected before fetch", async () => {
  let calls = 0;
  await withFetch(async () => { calls += 1; throw new Error("must not call"); }, async ({ verifyMembership, verifyEnrollmentReceipt }) => {
    await assert.rejects(verifyMembership(base, "", memberQr), { code: "SETUP_REQUIRED" });
    await assert.rejects(verifyMembership("", token, memberQr), { code: "SETUP_REQUIRED" });
    for (const value of [receiptQr, "UQ1:student", "CCASSO-1", {}, "UM1:", "UM1:" + "x".repeat(1021)]) await assert.rejects(verifyMembership(base, token, value), { code: "INVALID_QR" });
    await assert.rejects(verifyEnrollmentReceipt(base, token, memberQr, "2026-2027"), { code: "INVALID_QR" });
    for (const value of [undefined, "", "2026-2028", "26-27", 2026]) await assert.rejects(verifyEnrollmentReceipt(base, token, receiptQr, value), { code: "INVALID_ACADEMIC_YEAR" });
  });
  assert.equal(calls, 0);
});

test("401/403 explain the invalid scanner token without echoing server content or credentials", async () => {
  for (const status of [401, 403]) {
    await withFetch(async () => response({ message: `${token} ${memberQr}`, success: false }, status), async ({ verifyMembership }) => {
      await assert.rejects(verifyMembership(base, token, memberQr), (error) => {
        assert.equal(error.status, status);
        assert.equal(error.code, "VERIFICATION_UNAUTHORIZED");
        assert.match(error.message, /token.*invalid or revoked/i);
        assert.ok(!error.message.includes(token) && !error.message.includes(memberQr));
        assert.equal(error.payload, null);
        assert.equal(error.retryable, false);
        return true;
      });
    });
  }
});

test("404 identifies an older backend rather than approving a credential", async () => {
  await withFetch(async () => response({ success: false }, 404), async ({ verifyEnrollmentReceipt }) => {
    await assert.rejects(verifyEnrollmentReceipt(base, token, receiptQr, "2026-2027"), (error) => {
      assert.equal(error.code, "VERIFICATION_UNAVAILABLE");
      assert.equal(error.status, 404);
      assert.match(error.message, /updated UniSystem backend/);
      return true;
    });
  });
});

test("HTTP auth status is preserved even if an upstream server returns a null JSON body", async () => {
  await withFetch(async () => response(null, 401), async ({ verifyMembership }) => {
    await assert.rejects(verifyMembership(base, token, memberQr), { status: 401, code: "VERIFICATION_UNAUTHORIZED" });
  });
});

test("offline, timeout and server failure remain unconfirmed and do not retry or queue", async () => {
  for (const failure of [new Error("network lost"), Object.assign(new Error("aborted"), { name: "AbortError" }), response({ success: false }, 503)]) {
    let calls = 0;
    await withFetch(async (url) => {
      calls += 1;
      assert.equal(url, `${base}/api/kiosk/memberships/verify`);
      if (failure instanceof Error) throw failure;
      return failure;
    }, async ({ verifyMembership }) => {
      await assert.rejects(verifyMembership(base, token, memberQr), (error) => {
        assert.match(error.message, /has not been confirmed/);
        assert.equal(error.retryable, true);
        assert.equal(error.payload, null);
        return true;
      });
    });
    assert.equal(calls, 1);
  }
});

test("non-success and malformed responses are never accepted as successful verification", async () => {
  for (const body of [null, [], {}, { success: false }, { success: "true", valid: true, status: "VALID" }]) {
    await withFetch(async () => response(body), async ({ verifyMembership }) => {
      await assert.rejects(verifyMembership(base, token, memberQr), { code: "INVALID_VERIFICATION_RESPONSE" });
    });
  }
  await withFetch(async () => ({ ok: true, status: 200, text: async () => "<html>deployment error</html>" }), async ({ verifyMembership }) => {
    await assert.rejects(verifyMembership(base, token, memberQr), { code: "INVALID_VERIFICATION_RESPONSE" });
  });
});
