const assert = require("node:assert/strict");
const { test } = require("node:test");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");

const loadSource = (file) => import(`data:text/javascript;base64,${Buffer.from(readFileSync(resolve(__dirname, "..", file), "utf8")).toString("base64")}`);
const domain = loadSource("src/utils/verification.js");
const year = "2026-2027";
const membership = { success: true, valid: true, status: "VALID", membership_id: "m-1", academic_year: year, valid_until: "2027-06-30", student: { full_name: "Test Student" } };
const enrollment = { success: true, valid: true, status: "VALID", academic_year_matches: true, can_confirm_enrollment_fee: true, fee_status: "PAID_IN_FULL", current_remaining_balance: 0, receipt: { receipt_number: "receipt-1", academic_year: year, amount_paid: 450, remaining_after_payment: 100 }, current_paid_total: 550 };

test("QR classifier separates every credential mode and supported legacy student cards", async () => {
  const { classifyQr } = await domain;
  for (const value of ["UM1:signed", "  UM1:signed  ", "um1:signed"]) assert.equal(classifyQr(value), "membership");
  for (const value of ["UE1:signed", "ue1:signed"]) assert.equal(classifyQr(value), "enrollment");
  for (const value of ["UQ1:signed", "uq1:signed", "CCASSO-00000001", "2026-12345", "SID:student1", '{"student_number":"2026-12345"}', "https://example.org/card?student_id=student1"]) {
    assert.equal(classifyQr(value), "attendance", value);
  }
  for (const value of [null, {}, "", "https://example.org/", "UP2:other", "UE2:future", "UM1:bad\nqr", "UM1:" + "x".repeat(2048)]) assert.equal(classifyQr(value), "unknown");
});

test("wrong modes are rejected without changing signed payloads", async () => {
  const { validateVerificationQr } = await domain;
  assert.equal(validateVerificationQr("UM1:Ab.c-D_E", "membership").payload, "UM1:Ab.c-D_E");
  assert.equal(validateVerificationQr("  UE1:Ab.c-D_E  ", "enrollment").payload, "UE1:Ab.c-D_E");
  for (const [payload, mode] of [["UQ1:student", "membership"], ["UE1:receipt", "membership"], ["UM1:member", "enrollment"], ["CCASSO-1", "enrollment"]]) {
    assert.equal(validateVerificationQr(payload, mode).code, "WRONG_QR_TYPE");
  }
  for (const payload of [null, {}, "", "UM1:", "um1:wrong-case", "UM1:" + "x".repeat(1021), "UM1:bad\nqr"]) {
    assert.equal(validateVerificationQr(payload, "membership").valid, false);
  }
  assert.equal(validateVerificationQr("UM1:member", "attendance").code, "INVALID_MODE");
});

test("academic years require exact consecutive YYYY-YYYY years", async () => {
  const { isValidAcademicYear } = await domain;
  assert.equal(isValidAcademicYear(year), true);
  for (const value of [null, 2026, "2026", "2026-2028", "2026-2026", " 2026-2027 ", "2026–2027", "26-27"]) assert.equal(isValidAcademicYear(value), false);
});

test("membership requires every explicit success flag before green", async () => {
  const { presentVerificationResult } = await domain;
  assert.equal(presentVerificationResult("membership", membership).verified, true);
  assert.equal(presentVerificationResult("membership", membership).tone, "success");
  for (const patch of [{ success: false }, { success: "true" }, { success: undefined }, { valid: false }, { valid: "true" }, { valid: undefined }, { status: "valid" }, { status: undefined }]) {
    const result = presentVerificationResult("membership", { ...membership, ...patch });
    assert.equal(result.verified, false, JSON.stringify(patch));
    assert.notEqual(result.tone, "success");
  }
});

test("expired, revoked and invalid memberships always produce a red result", async () => {
  const { presentVerificationResult } = await domain;
  for (const status of ["EXPIRED", "REVOKED", "INVALID_QR", "NOT_FOUND"]) {
    const view = presentVerificationResult("membership", { ...membership, status });
    assert.equal(view.tone, "danger");
    assert.equal(view.verified, false);
  }
});

test("enrollment confirms only full current payment for the selected academic year", async () => {
  const { presentVerificationResult } = await domain;
  const view = presentVerificationResult("enrollment", enrollment, year);
  assert.equal(view.verified, true);
  assert.equal(view.tone, "success");
  assert.deepEqual(view.details.find((row) => row.label === "Current balance"), { label: "Current balance", value: "PHP 0.00" });
  assert.deepEqual(view.details.find((row) => row.label === "Balance after this receipt"), { label: "Balance after this receipt", value: "PHP 100.00" });
  for (const patch of [{ success: false }, { success: "true" }, { valid: false }, { valid: "true" }, { status: "valid" }, { academic_year_matches: "true" }, { academic_year_matches: undefined }, { can_confirm_enrollment_fee: "true" }, { can_confirm_enrollment_fee: undefined }, { fee_status: undefined }, { receipt: undefined }]) {
    const result = presentVerificationResult("enrollment", { ...enrollment, ...patch }, year);
    assert.equal(result.verified, false, JSON.stringify(patch));
    assert.notEqual(result.tone, "success");
  }
});

test("partial, unpaid, contradictory balance and old academic year receipts warn without confirming fees", async () => {
  const { presentVerificationResult } = await domain;
  for (const patch of [{ fee_status: "PARTIAL", can_confirm_enrollment_fee: false, current_remaining_balance: 50 }, { fee_status: "UNPAID", current_remaining_balance: 450 }, { current_remaining_balance: 1 }, { academic_year_matches: false }, { receipt: { ...enrollment.receipt, academic_year: "2025-2026" } }, { can_confirm_enrollment_fee: false }]) {
    const view = presentVerificationResult("enrollment", { ...enrollment, ...patch }, year);
    assert.equal(view.tone, "warning");
    assert.equal(view.verified, false);
  }
  assert.equal(presentVerificationResult("enrollment", enrollment).verified, false);
  assert.equal(presentVerificationResult("enrollment", enrollment, "2026-2028").tone, "warning");
});

test("voided receipts remain red even when the current fee balance is zero", async () => {
  const { presentVerificationResult } = await domain;
  const view = presentVerificationResult("enrollment", { ...enrollment, status: "VOIDED", valid: false }, year);
  assert.equal(view.tone, "danger");
  assert.equal(view.verified, false);
});

test("missing, transport and unknown responses can never appear valid", async () => {
  const { presentVerificationResult } = await domain;
  for (const value of [undefined, null, [], {}, { success: true }, { success: false, valid: true, status: "VALID" }, { success: true, valid: true, status: "NEW_UNKNOWN_STATUS" }]) {
    for (const mode of ["membership", "enrollment"]) {
      const view = presentVerificationResult(mode, value, year);
      assert.equal(view.verified, false);
      assert.equal(view.tone, "unknown");
    }
  }
  assert.equal(presentVerificationResult("attendance", membership).verified, false);
});
