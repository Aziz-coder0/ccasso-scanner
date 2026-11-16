const MODE_NAMES = {
  attendance: "Attendance",
  membership: "Membership",
  enrollment: "Enrollment Fee",
};

/** Classify the credential only. Its signature and live status require the API. */
export function classifyQr(value) {
  if (typeof value !== "string") return "unknown";
  const payload = value.trim();
  if (!payload || payload.length > 2048 || /[\u0000-\u001f\u007f]/.test(payload)) return "unknown";
  if (/^UM1:/i.test(payload)) return "membership";
  if (/^UE1:/i.test(payload)) return "enrollment";
  if (/^UQ1:/i.test(payload)) return "attendance";
  // Versioned credentials from other systems must not become legacy IDs.
  if (/^[A-Z]{1,8}\d+:/i.test(payload)) return "unknown";
  if (/^(?:STUDENT|CCAS|SID|ID|STU|SN):\S+/i.test(payload)) return "attendance";
  if (/^[A-Za-z0-9][A-Za-z0-9_.-]{2,99}$/.test(payload)) return "attendance";
  if (payload.startsWith("{")) {
    try {
      const data = JSON.parse(payload);
      if (data && typeof data === "object" && !Array.isArray(data) &&
          [data.student_number, data.student_id].some((v) => typeof v === "string" && v.trim())) return "attendance";
    } catch (_) {}
  }
  if (/^https?:\/\//i.test(payload)) {
    try {
      const url = new URL(payload);
      for (const key of ["student_id", "student_number", "student_no", "sid", "code"]) {
        if (url.searchParams.get(key)?.trim()) return "attendance";
      }
    } catch (_) {}
  }
  return "unknown";
}

export function isValidAcademicYear(value) {
  if (typeof value !== "string") return false;
  const match = /^(\d{4})-(\d{4})$/.exec(value);
  return Boolean(match && Number(match[2]) === Number(match[1]) + 1);
}

/** Reject another scanner mode before making any network request. */
export function validateVerificationQr(value, mode) {
  const payload = typeof value === "string" ? value.trim() : "";
  const detectedMode = classifyQr(payload);
  const failure = (code, message) => ({ valid: false, code, message, payload, detectedMode });
  if (mode !== "membership" && mode !== "enrollment") {
    return failure("INVALID_MODE", "Choose Membership or Enrollment Fee verification.");
  }
  if (!payload) return failure("EMPTY_QR", "Scan a QR code first.");
  if (detectedMode !== "unknown" && detectedMode !== mode) {
    return failure("WRONG_QR_TYPE", `This is an ${MODE_NAMES[detectedMode]} QR. Open the ${MODE_NAMES[detectedMode]} scanner to use it.`);
  }
  const prefix = mode === "membership" ? "UM1:" : "UE1:";
  const maxLength = mode === "membership" ? 1024 : 2048;
  if (!payload.startsWith(prefix) || payload.length <= prefix.length || payload.length > maxLength || /[\u0000-\u001f\u007f]/.test(payload)) {
    return failure("INVALID_QR", `Use the original ${MODE_NAMES[mode]} QR issued by UniOrg.`);
  }
  return { valid: true, code: "", message: "", payload, detectedMode: mode };
}

function record(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function text(value) {
  return typeof value === "string" || typeof value === "number" ? String(value) : "";
}

function money(value) {
  if (value == null || value === "" || typeof value === "boolean") return "";
  const amount = Number(value);
  return Number.isFinite(amount) ? `PHP ${amount.toFixed(2)}` : "";
}

/**
 * Display only a live explicit verification as green. A real receipt may still
 * be partial, for a different A.Y., or voided; none confirms Enrollment Fees.
 */
export function presentVerificationResult(mode, value, requestedAcademicYear = "") {
  const result = record(value);
  const student = record(result?.student);
  const receipt = record(result?.receipt);
  const status = typeof result?.status === "string" ? result.status : "UNKNOWN";
  const view = {
    tone: "unknown", verified: false, title: "Verification unavailable",
    message: "A valid online response is required. Please check your connection and scan again.",
    status, student, receipt,
    membership: mode === "membership" && result ? {
      membership_id: result.membership_id,
      academic_year: result.academic_year,
      valid_until: result.valid_until,
    } : null,
    checkedAt: typeof result?.checked_at === "string" ? result.checked_at : null,
    details: [],
  };
  const detail = (label, detailValue) => {
    const display = text(detailValue);
    if (display) view.details.push({ label, value: display });
  };
  if (mode === "membership") {
    detail("Membership ID", result?.membership_id);
    detail("Academic year", result?.academic_year);
    detail("Valid until", result?.valid_until);
  } else if (mode === "enrollment") {
    detail("Receipt number", receipt?.receipt_number);
    detail("Official receipt", receipt?.or_number);
    detail("Receipt academic year", receipt?.academic_year);
    detail("Checking academic year", requestedAcademicYear);
    detail("Semester", receipt?.semester);
    detail("Collection", receipt?.collection_name);
    detail("Receipt payment", money(receipt?.amount_paid));
    detail("Current paid total", money(result?.current_paid_total));
    detail("Current balance", money(result?.current_remaining_balance));
    detail("Balance after this receipt", money(receipt?.remaining_after_payment));
    detail("Receipt date", receipt?.date);
  }
  if ((mode !== "membership" && mode !== "enrollment") || result?.success !== true) return view;

  const invalidTitles = {
    EXPIRED: "Membership expired", REVOKED: "Membership revoked",
    VOID: "Receipt voided", VOIDED: "Receipt voided", INVALID_QR: "Invalid QR code",
    INVALID: "Invalid credential", NOT_FOUND: "Credential not found",
  };
  if (invalidTitles[status]) {
    return { ...view, tone: "danger", title: invalidTitles[status],
      message: status === "EXPIRED" ? "This membership has expired. Renewal is required."
        : status === "REVOKED" ? "This membership is no longer valid. Refer the student to the CCASSO office."
        : status === "VOID" || status === "VOIDED" ? "This receipt has been voided and cannot confirm Enrollment Fees."
        : "UniOrg could not validate this credential. Use the original QR issued to the student." };
  }
  if (result.valid === false) {
    return { ...view, tone: "danger", title: "Credential not valid", message: "UniOrg did not validate this credential. Refer the student to the CCASSO office." };
  }
  if (result.valid !== true || status !== "VALID") return view;
  if (mode === "membership") {
    return { ...view, tone: "success", verified: true, title: "Valid membership", message: "UniOrg confirms this membership is currently active." };
  }

  if (!isValidAcademicYear(requestedAcademicYear)) {
    return { ...view, tone: "warning", title: "Academic year required", message: "Select the academic year to check before confirming Enrollment Fees." };
  }
  const receiptYear = receipt?.academic_year;
  if (result.academic_year_matches === false || (typeof receiptYear === "string" && receiptYear !== requestedAcademicYear)) {
    return { ...view, tone: "warning", title: "Different academic year", message: `This receipt does not confirm Enrollment Fees for A.Y. ${requestedAcademicYear}.` };
  }
  const remaining = result.current_remaining_balance;
  const hasRemaining = remaining != null && remaining !== "" && typeof remaining !== "boolean" && Number.isFinite(Number(remaining)) && Number(remaining) > 0;
  if (["PARTIAL", "UNPAID"].includes(result.fee_status) || hasRemaining) {
    return { ...view, tone: "warning", title: result.fee_status === "UNPAID" ? "Enrollment Fees unpaid" : "Enrollment Fees partially paid",
      message: "The receipt is authentic, but the current Enrollment Fee balance is not fully paid." };
  }
  if (result.can_confirm_enrollment_fee === true && result.fee_status === "PAID_IN_FULL" &&
      result.academic_year_matches === true && receiptYear === requestedAcademicYear) {
    return { ...view, tone: "success", verified: true, title: "Enrollment Fees paid in full",
      message: `UniOrg confirms full Enrollment Fee payment for A.Y. ${requestedAcademicYear}.` };
  }
  if (result.can_confirm_enrollment_fee === false) {
    return { ...view, tone: "warning", title: "Enrollment Fees not confirmed", message: "This receipt does not confirm full Enrollment Fee payment. Refer the student to the CCASSO office." };
  }
  return view;
}
