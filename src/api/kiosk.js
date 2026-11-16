const CLIENT_VERSION = "2.3.0";
const READ_TIMEOUT_MS = 12000;
const ROSTER_TIMEOUT_MS = 45000;
const WRITE_TIMEOUT_MS = 18000;
const BATCH_TIMEOUT_MS = 30000;

function headers(token) {
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    Accept: "application/json",
    "X-CCASSO-Scanner-Version": CLIENT_VERSION,
  };
}

function normalizeBase(base) {
  return String(base || "").trim().replace(/\/+$/, "");
}

export class KioskApiError extends Error {
  constructor(message, { status = 0, code = "", payload = null, retryable = false } = {}) {
    super(message);
    this.name = "KioskApiError";
    this.status = status;
    this.code = code;
    this.payload = payload;
    this.retryable = retryable;
  }
}

async function parseJson(res) {
  const text = await res.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return { success: false, message: text || `HTTP ${res.status}`, code: "INVALID_RESPONSE" };
  }
}

function statusIsRetryable(status) {
  return !status || status === 408 || status === 425 || status === 429 || status >= 500;
}

async function requestJson(url, options, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    const data = await parseJson(res);
    if (!res.ok) {
      throw new KioskApiError(data?.message || `Request failed (${res.status})`, {
        status: res.status,
        code: data?.code || "HTTP_ERROR",
        payload: data,
        retryable: statusIsRetryable(res.status),
      });
    }
    return data;
  } catch (error) {
    if (error instanceof KioskApiError) throw error;
    const timedOut = error?.name === "AbortError";
    throw new KioskApiError(
      timedOut ? "UniOrg took too long to respond. Local data remains safe; please retry." : "Cannot reach the UniOrg server.",
      { code: timedOut ? "TIMEOUT" : "NETWORK_ERROR", retryable: true }
    );
  } finally {
    clearTimeout(timeout);
  }
}

export async function ping(baseUrl, token) {
  const base = normalizeBase(baseUrl);
  const data = await requestJson(
    `${base}/api/kiosk/ping`,
    { method: "GET", headers: headers(token) },
    READ_TIMEOUT_MS
  );
  if (data.success === false) throw new KioskApiError(data.message || "Kiosk API unavailable", { payload: data });
  return data;
}

export async function fetchOpenSessions(baseUrl, token) {
  const base = normalizeBase(baseUrl);
  const data = await requestJson(
    `${base}/api/kiosk/sessions?status=OPEN`,
    { method: "GET", headers: headers(token) },
    READ_TIMEOUT_MS
  );
  return Array.isArray(data.sessions) ? data.sessions : [];
}

export async function fetchSessionDetail(baseUrl, token, sessionId) {
  const base = normalizeBase(baseUrl);
  return requestJson(
    `${base}/api/kiosk/sessions/${sessionId}`,
    { method: "GET", headers: headers(token) },
    READ_TIMEOUT_MS
  );
}

export async function fetchSessionStats(baseUrl, token, sessionId) {
  const base = normalizeBase(baseUrl);
  return requestJson(
    `${base}/api/kiosk/sessions/${sessionId}/stats`,
    { method: "GET", headers: headers(token) },
    READ_TIMEOUT_MS
  );
}

export async function fetchRoster(baseUrl, token) {
  const base = normalizeBase(baseUrl);
  const students = [];
  const seen = new Set();
  const pageSize = 500;
  let offset = 0;
  let fetchedAt = "";
  let total = 0;

  // New servers return 500-row pages. Older servers return the whole roster
  // once and omit has_more, which stays backward-compatible here.
  for (let page = 0; page < 100; page += 1) {
    const data = await requestJson(
      `${base}/api/kiosk/roster?limit=${pageSize}&offset=${offset}`,
      { method: "GET", headers: headers(token) },
      ROSTER_TIMEOUT_MS
    );
    if (data.success === false) {
      throw new KioskApiError(data.message || "Roster download was rejected by UniOrg.", {
        code: data.code || "ROSTER_REJECTED",
        payload: data,
        retryable: false,
      });
    }
    const pageRows = Array.isArray(data.students) ? data.students : [];
    for (const student of pageRows) {
      const key = String(student.student_id || student.student_number || `${offset}-${students.length}`);
      if (!seen.has(key)) {
        seen.add(key);
        students.push(student);
      }
    }
    fetchedAt = data.fetched_at || fetchedAt;
    total = Number(data.total || data.count || students.length);
    const next = Number(data.next_offset);
    const hasMore = data.has_more === true || (Number.isFinite(next) && next > offset);
    if (!hasMore || pageRows.length === 0) break;
    offset = next > offset ? next : offset + pageRows.length;
    if (offset >= total) break;
  }
  return { success: true, students, count: students.length, total: total || students.length, fetched_at: fetchedAt };
}

export async function scanStudent(baseUrl, token, payload) {
  const base = normalizeBase(baseUrl);
  const data = await requestJson(
    `${base}/api/kiosk/scan`,
    {
      method: "POST",
      headers: headers(token),
      body: JSON.stringify(payload),
    },
    WRITE_TIMEOUT_MS
  );
  // Trust only an explicit success response from UniOrg. Previously, a 409
  // validation response could accidentally be rendered as PRESENT.
  if (data.success !== true) {
    throw new KioskApiError(data.message || "Scan was not accepted by UniOrg.", {
      code: data.code || "SCAN_REJECTED",
      payload: data,
      retryable: false,
    });
  }
  return data;
}

export async function scanBatch(baseUrl, token, scans, deviceId) {
  const base = normalizeBase(baseUrl);
  const data = await requestJson(
    `${base}/api/kiosk/scan/batch`,
    {
      method: "POST",
      headers: headers(token),
      body: JSON.stringify({ device_id: deviceId || "react-native-kiosk", scans }),
    },
    BATCH_TIMEOUT_MS
  );
  if (data.success !== true || !Array.isArray(data.results)) {
    throw new KioskApiError(data.message || "Invalid batch response from UniOrg.", {
      code: data.code || "INVALID_BATCH_RESPONSE",
      payload: data,
      retryable: true,
    });
  }
  return data;
}

function verificationHeaders(token, device = {}) {
  const result = headers(token);
  if (typeof device?.deviceId === "string" && device.deviceId.trim()) result["X-Device-Id"] = device.deviceId.trim();
  // Gate/operator labels belong to attendance records. Only the device header
  // is supported by verification's backend and browser CORS allow-list.
  return result;
}

function verificationError(error) {
  const status = Number(error?.status || 0);
  if (status === 401 || status === 403) {
    return new KioskApiError("The scanner API token is invalid or revoked. Open Setup and use an active Admin-generated API token.", {
      status, code: "VERIFICATION_UNAUTHORIZED", retryable: false,
    });
  }
  if (status === 404) {
    return new KioskApiError("This server does not support Membership and Enrollment Fee verification yet. Deploy the updated UniSystem backend and check the server URL in Setup.", {
      status, code: "VERIFICATION_UNAVAILABLE", retryable: false,
    });
  }
  if (error?.code === "TIMEOUT" || error?.code === "NETWORK_ERROR" || statusIsRetryable(status)) {
    return new KioskApiError("Cannot verify online right now. Check the internet connection and retry; this credential has not been confirmed.", {
      status, code: error?.code || "VERIFICATION_UNAVAILABLE", retryable: true,
    });
  }
  return new KioskApiError("UniOrg could not complete verification. Check the QR and academic year, then retry.", {
    status, code: "VERIFICATION_REJECTED", retryable: false,
  });
}

async function requestVerification(baseUrl, token, path, body, prefix, maxLength, device) {
  const base = normalizeBase(baseUrl);
  if (!base || typeof token !== "string" || !token.trim()) {
    throw new KioskApiError("Complete Setup with the UniOrg server URL and an active scanner API token first.", {
      code: "SETUP_REQUIRED", retryable: false,
    });
  }
  const qrPayload = typeof body.qr_payload === "string" ? body.qr_payload.trim() : "";
  if (!qrPayload.startsWith(prefix) || qrPayload.length <= prefix.length || qrPayload.length > maxLength || /[\u0000-\u001f\u007f]/.test(qrPayload)) {
    throw new KioskApiError(`Use the original ${prefix === "UM1:" ? "Membership" : "Enrollment Fee"} QR in this scanner.`, {
      code: "INVALID_QR", retryable: false,
    });
  }
  let data;
  try {
    data = await requestJson(
      `${base}${path}`,
      { method: "POST", headers: verificationHeaders(token.trim(), device), body: JSON.stringify({ ...body, qr_payload: qrPayload }) },
      READ_TIMEOUT_MS
    );
  } catch (error) {
    throw verificationError(error);
  }
  if (!data || typeof data !== "object" || Array.isArray(data) || data.success !== true) {
    throw new KioskApiError("UniOrg returned an incomplete verification response. This credential has not been confirmed; retry online.", {
      code: "INVALID_VERIFICATION_RESPONSE", retryable: false,
    });
  }
  return data;
}

/** Read-only live checks. These methods never record attendance or queue scans. */
export async function verifyMembership(baseUrl, token, payload, device = {}) {
  return requestVerification(baseUrl, token, "/api/kiosk/memberships/verify", { qr_payload: payload }, "UM1:", 1024, device);
}

export async function verifyEnrollmentReceipt(baseUrl, token, payload, academicYear, device = {}) {
  const year = typeof academicYear === "string" ? academicYear.trim() : "";
  const match = /^(\d{4})-(\d{4})$/.exec(year);
  if (!match || Number(match[2]) !== Number(match[1]) + 1) {
    throw new KioskApiError("Select a valid academic year using YYYY-YYYY, such as 2026-2027, before scanning an Enrollment Fee receipt.", {
      code: "INVALID_ACADEMIC_YEAR", retryable: false,
    });
  }
  return requestVerification(baseUrl, token, "/api/kiosk/enrollment-receipts/verify", {
    qr_payload: payload, academic_year: year,
  }, "UE1:", 2048, device);
}

export function isAcceptedScanResult(result) {
  if (!result) return false;
  const code = String(result.code || "").toUpperCase();
  const message = String(result.message || "");
  return result.success === true || result.already_present === true || code === "ALREADY" || /already marked present/i.test(message);
}

export function isRetryableScanResult(result) {
  if (!result) return true;
  const code = String(result.code || "").toUpperCase();
  return ["SERVER_ERROR", "TIMEOUT", "NETWORK_ERROR", "TEMPORARY_ERROR", "RATE_LIMITED"].includes(code);
}

export function isRetryableApiError(error) {
  if (error instanceof KioskApiError || error?.name === "KioskApiError") {
    return error.retryable === true;
  }
  return statusIsRetryable(Number(error?.status || 0));
}

/** Human label for API / local fail codes */
export function failReasonLabel(code, message) {
  const c = String(code || "").toUpperCase();
  const m = String(message || "");
  if (c === "SESSION_NOT_FOUND") return "Session not found";
  if (c === "STUDENT_NOT_FOUND" || /student.*not found/i.test(m)) return "Student not found — check the QR card";
  if (c === "NOT_ENROLLED_FOR_PERIOD") return "Student is not enrolled in this academic period";
  if (c === "SESSION_CLOSED" || /closed/i.test(m)) return "Session is closed";
  if (c === "ALREADY" || /already marked present/i.test(m)) return "Already marked present";
  if (c === "BAD_REQUEST" || c === "BAD_ITEM") return "Invalid scan data";
  if (c === "INVALID_RESPONSE") return "Unexpected response from server";
  if (["SERVER_ERROR", "TIMEOUT", "NETWORK_ERROR"].includes(c)) return "Temporary server problem — safe to retry";
  return m || c || "Failed";
}
