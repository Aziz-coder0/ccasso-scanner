import AsyncStorage from "@react-native-async-storage/async-storage";

const QUEUE_KEY = "ccas_pending_scans";
const FAILED_KEY = "ccas_failed_scans";
const HISTORY_KEY = "ccas_scan_history";

// Serialize read-modify-write operations. Auto-sync, manual sync, and the
// camera can otherwise update AsyncStorage at the same time and resurrect or
// drop queue rows.
let queueMutation = Promise.resolve();
let failedMutation = Promise.resolve();
let historyMutation = Promise.resolve();
let syncInProgress = false;

export function acquireQueueSync() {
  if (syncInProgress) return null;
  syncInProgress = true;
  return () => { syncInProgress = false; };
}

function serializeQueue(work) {
  const next = queueMutation.then(work, work);
  queueMutation = next.catch(() => {});
  return next;
}

function serializeFailed(work) {
  const next = failedMutation.then(work, work);
  failedMutation = next.catch(() => {});
  return next;
}

function uid() {
  return `q_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

export async function getQueue() {
  try {
    const raw = await AsyncStorage.getItem(QUEUE_KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

async function setQueue(list) {
  await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(list));
}

export async function hasPendingForSession(sessionId, studentCode) {
  const list = await getQueue();
  const code = String(studentCode || "").trim().toUpperCase();
  return list.some(
    (r) => String(r.session_id) === String(sessionId) && String(r.student_code || "").trim().toUpperCase() === code
  );
}

export async function enqueueScan({ sessionId, studentCode, scannedAt }) {
  return serializeQueue(async () => {
    const list = await getQueue();
    const code = String(studentCode || "").trim();
    const codeKey = code.toUpperCase();
    // Reject only an actual pending duplicate for the same session.
    if (list.some((r) => String(r.session_id) === String(sessionId) && String(r.student_code || "").trim().toUpperCase() === codeKey)) {
      return { duplicate: true, client_uid: null };
    }
    const row = {
      client_uid: uid(),
      session_id: sessionId,
      student_code: code,
      scanned_at: scannedAt || new Date().toISOString(),
      created_at: new Date().toISOString(),
      attempts: 0,
    };
    list.unshift(row);
    await setQueue(list.slice(0, 1000));
    return { duplicate: false, ...row };
  });
}

export async function pendingCount() {
  return (await getQueue()).length;
}

export async function removeSynced(clientUids) {
  const set = new Set((clientUids || []).filter(Boolean));
  if (!set.size) return;
  await serializeQueue(async () => {
    const list = await getQueue();
    await setQueue(list.filter((r) => !set.has(r.client_uid)));
  });
}

export async function clearQueue() {
  await serializeQueue(() => AsyncStorage.removeItem(QUEUE_KEY));
}

export async function queueAsBatchPayload() {
  const list = await getQueue();
  return list.map((r) => ({
    client_uid: r.client_uid,
    session_id: r.session_id,
    student_code: r.student_code,
    scanned_at: r.scanned_at,
  }));
}

export async function getFailed() {
  try {
    const raw = await AsyncStorage.getItem(FAILED_KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

async function setFailed(list) {
  await AsyncStorage.setItem(FAILED_KEY, JSON.stringify(list.slice(0, 500)));
}

export async function addFailed(item) {
  await serializeFailed(async () => {
    const list = await getFailed();
    const id = item.client_uid || uid();
    const next = {
      ...item,
      client_uid: id,
      failed_at: new Date().toISOString(),
    };
    const withoutSame = list.filter((row) => row.client_uid !== id);
    withoutSame.unshift(next);
    await setFailed(withoutSame);
  });
}

export async function removeFailed(clientUids) {
  const set = new Set((clientUids || []).filter(Boolean));
  if (!set.size) return;
  await serializeFailed(async () => {
    const list = await getFailed();
    await setFailed(list.filter((r) => !set.has(r.client_uid)));
  });
}

export async function clearFailed() {
  await serializeFailed(() => AsyncStorage.removeItem(FAILED_KEY));
}

export async function failedAsBatchPayload() {
  const list = await getFailed();
  return list.map((r) => ({
    client_uid: r.client_uid,
    session_id: r.session_id,
    student_code: r.student_code,
    scanned_at: r.scanned_at,
  }));
}

export function pushHistory(entry) {
  return storeHistory([entry]);
}

function storeHistory(entries) {
  if (!entries.length) return Promise.resolve();
  const next = historyMutation.then(async () => {
    const list = await getHistory();
    for (const entry of entries) {
      const index = entry.client_uid ? list.findIndex((item) => item.client_uid === entry.client_uid) : -1;
      const previous = index < 0 ? {} : list.splice(index, 1)[0];
      const status = entry.status === "QUEUED" && previous.status ? previous.status : entry.status;
      list.unshift({ ...previous, ...entry, status, at: entry.at || previous.at || new Date().toISOString() });
    }
    list.sort((a, b) => String(b.at || "").localeCompare(String(a.at || "")));
    await AsyncStorage.setItem(HISTORY_KEY, JSON.stringify(list.slice(0, 300)));
  });
  historyMutation = next.catch(() => {});
  return historyMutation;
}

export function recordUploadedScans(accepted) {
  return storeHistory(accepted.map(({ scan, result }) => {
    const status = String(result.status || "").toUpperCase();
    const already = result.already_present === true || String(result.code).toUpperCase() === "ALREADY" ||
      /already marked present/i.test(result.message || "");
    const name = result.student?.full_name;
    return {
      ...scan,
      at: scan.scanned_at,
      ...(name ? { name } : {}),
      status: already ? "ALREADY" : status === "PRESENT" || status === "LATE" ? status : "CONFIRMED",
    };
  }));
}

export async function getHistory() {
  try {
    const raw = await AsyncStorage.getItem(HISTORY_KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}
