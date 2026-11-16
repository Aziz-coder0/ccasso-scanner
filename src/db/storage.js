import * as SecureStore from "expo-secure-store";
import AsyncStorage from "@react-native-async-storage/async-storage";

const KEYS = {
  baseUrl: "ccas_base_url",
  token: "ccas_kiosk_token",
  deviceId: "ccas_device_id",
  gateLabel: "ccas_gate_label",
  operatorName: "ccas_operator_name",
  session: "ccas_active_session",
  lastSync: "ccas_last_sync",
  quietMode: "ccas_quiet_mode",
  fastMode: "ccas_fast_mode",
  continuousMode: "ccas_continuous_mode",
  forceOffline: "ccas_force_offline",
  sessionPin: "ccas_session_pin",
  qrPattern: "ccas_qr_pattern",
  cooldownMs: "ccas_cooldown_ms",
  autoSyncSec: "ccas_auto_sync_sec",
  verificationAcademicYear: "ccas_verification_academic_year",
};

async function setItem(key, value, secure = false) {
  const v = value == null ? "" : String(value);
  try {
    if (secure) {
      await SecureStore.setItemAsync(key, v);
      return;
    }
  } catch (_) {}
  await AsyncStorage.setItem(key, v);
}

async function getItem(key, secure = false) {
  try {
    if (secure) {
      const s = await SecureStore.getItemAsync(key);
      if (s != null) return s;
    }
  } catch (_) {}
  return AsyncStorage.getItem(key);
}

export async function saveConfig({ baseUrl, token, deviceId, gateLabel, operatorName }) {
  if (baseUrl != null) await setItem(KEYS.baseUrl, baseUrl.trim().replace(/\/+$/, ""));
  if (token != null) await setItem(KEYS.token, token.trim(), true);
  if (deviceId != null) await setItem(KEYS.deviceId, deviceId.trim());
  if (gateLabel != null) await setItem(KEYS.gateLabel, gateLabel.trim());
  if (operatorName != null) await setItem(KEYS.operatorName, operatorName.trim());
}

export async function loadConfig() {
  const [baseUrl, token, deviceId, gateLabel, operatorName] = await Promise.all([
    getItem(KEYS.baseUrl),
    getItem(KEYS.token, true),
    getItem(KEYS.deviceId),
    getItem(KEYS.gateLabel),
    getItem(KEYS.operatorName),
  ]);
  return {
    baseUrl: baseUrl || "",
    token: token || "",
    deviceId: deviceId || "rn-kiosk-1",
    gateLabel: gateLabel || "Gate A",
    operatorName: operatorName || "",
  };
}

export async function saveLastSync(iso) {
  await setItem(KEYS.lastSync, iso || new Date().toISOString());
}

export async function loadLastSync() {
  return (await getItem(KEYS.lastSync)) || "";
}

export async function saveQuietMode(on) {
  await setItem(KEYS.quietMode, on ? "1" : "0");
}

export async function loadQuietMode() {
  return (await getItem(KEYS.quietMode)) === "1";
}

export async function saveFastMode(on) {
  await setItem(KEYS.fastMode, on ? "1" : "0");
}
export async function loadFastMode() {
  return (await getItem(KEYS.fastMode)) === "1";
}
export async function saveContinuousMode(on) {
  await setItem(KEYS.continuousMode, on ? "1" : "0");
}
export async function loadContinuousMode() {
  return (await getItem(KEYS.continuousMode)) === "1";
}

export async function saveForceOffline(on) {
  await setItem(KEYS.forceOffline, on ? "1" : "0");
}
export async function loadForceOffline() {
  return (await getItem(KEYS.forceOffline)) === "1";
}

export async function saveActiveSession(session) {
  await AsyncStorage.setItem(KEYS.session, JSON.stringify(session || null));
}

export async function loadActiveSession() {
  const raw = await AsyncStorage.getItem(KEYS.session);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export async function clearConfig() {
  await AsyncStorage.multiRemove([
    KEYS.baseUrl, KEYS.session, KEYS.deviceId, KEYS.gateLabel, KEYS.operatorName, KEYS.lastSync, KEYS.verificationAcademicYear,
  ]);
  try {
    await SecureStore.deleteItemAsync(KEYS.token);
  } catch (_) {}
}


export async function saveSessionPin(pin) {
  await setItem(KEYS.sessionPin, pin == null ? "" : String(pin).trim(), true);
}
export async function loadSessionPin() {
  return (await getItem(KEYS.sessionPin, true)) || "";
}

export async function saveQrPattern(pat) {
  await setItem(KEYS.qrPattern, pat == null ? "" : String(pat));
}
export async function loadQrPattern() {
  return (await getItem(KEYS.qrPattern)) || "";
}

export async function saveCooldownMs(ms) {
  await setItem(KEYS.cooldownMs, String(ms == null ? 3000 : ms));
}
export async function loadCooldownMs() {
  const v = await getItem(KEYS.cooldownMs);
  const n = parseInt(v || "3000", 10);
  return Number.isFinite(n) ? Math.max(0, n) : 3000;
}

export async function saveAutoSyncSec(sec) {
  await setItem(KEYS.autoSyncSec, String(sec == null ? 60 : sec));
}
export async function loadAutoSyncSec() {
  const v = await getItem(KEYS.autoSyncSec);
  const n = parseInt(v || "60", 10);
  return Number.isFinite(n) ? Math.max(15, n) : 60;
}

// Only the selected A.Y. is retained. Verification results remain in memory.
export async function saveVerificationAcademicYear(value) {
  const year = typeof value === "string" ? value.trim() : "";
  const match = /^(\d{4})-(\d{4})$/.exec(year);
  if (year && (!match || Number(match[2]) !== Number(match[1]) + 1)) {
    throw new Error("Academic year must use consecutive YYYY-YYYY years.");
  }
  await setItem(KEYS.verificationAcademicYear, year);
}

export async function loadVerificationAcademicYear() {
  const year = (await getItem(KEYS.verificationAcademicYear)) || "";
  const match = /^(\d{4})-(\d{4})$/.exec(year);
  return match && Number(match[2]) === Number(match[1]) + 1 ? year : "";
}
