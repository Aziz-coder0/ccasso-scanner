import AsyncStorage from "@react-native-async-storage/async-storage";

const VERSION = 3;
const CHUNK_SIZE = 250;
const INDEX_BUCKETS = 64;
const META_KEY = "ccas_roster_meta_v3";
const LIST_PREFIX = "ccas_roster_list_v3_";
const INDEX_PREFIX = "ccas_roster_index_v3_";
const LEGACY_MAP_KEY = "ccas_roster_map_v2";
const LEGACY_META_KEY = "ccas_roster_meta_v2";
const LEGACY_LIST_KEY = "ccas_roster_list_v2";

const listKey = (generation, index) => `${LIST_PREFIX}${generation}_${index}`;
const indexKey = (generation, bucket) => `${INDEX_PREFIX}${generation}_${bucket}`;

/** Normalize student codes for matching. Signed QR payloads are otherwise left intact. */
export function normalizeStudentCode(raw) {
  let c = String(raw || "").trim();
  if (!c) return "";
  for (const p of ["STUDENT:", "CCAS:", "SID:", "ID:", "STU:", "SN:"]) {
    if (c.toUpperCase().startsWith(p)) c = c.slice(p.length).trim();
  }
  if (c.includes("://") || c.includes("?")) {
    try {
      const q = c.includes("?") ? c.split("?").pop() : c;
      const parts = q.split(/[&/]/);
      for (const part of parts) {
        const m = part.match(/(?:student[_-]?(?:id|number|no)|sid|code)=([^&]+)/i);
        if (m) {
          c = decodeURIComponent(m[1]).trim();
          break;
        }
      }
    } catch (_) {}
  }
  if (c.startsWith("{") && c.includes("student")) {
    try {
      const j = JSON.parse(c);
      c = String(j.student_number || j.student_id || j.code || j.id || c).trim();
    } catch (_) {}
  }
  return c.replace(/[\u2010-\u2015]/g, "-").replace(/\s+/g, "").trim();
}

function compactEntry(s) {
  const entry = {
    full_name: String(s.full_name || "").trim(),
    student_id: String(s.student_id || "").trim(),
    student_number: String(s.student_number || "").trim(),
    qr_payload: String(s.qr_payload || s.qr_token || "").trim(),
    program: String(s.program || "").trim(),
    year_level: String(s.year_level || "").trim(),
    section: String(s.section || "").trim(),
  };
  if (!entry.full_name) {
    entry.full_name = [s.first_name, s.last_name].filter(Boolean).join(" ").trim();
  }
  return entry;
}

function lookupVariants(raw) {
  const exact = String(raw || "").trim();
  const normalized = normalizeStudentCode(exact);
  const values = new Set([exact, normalized]);
  for (const value of [exact, normalized]) {
    if (!value) continue;
    values.add(value.toUpperCase());
    values.add(value.toLowerCase());
    values.add(value.replace(/[-\s]/g, ""));
    values.add(value.replace(/[-\s]/g, "").toUpperCase());
  }
  values.delete("");
  return [...values];
}

function hashBucket(key) {
  let hash = 2166136261;
  for (let i = 0; i < key.length; i += 1) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) % INDEX_BUCKETS;
}

function addIndex(buckets, key, index, { variants = true } = {}) {
  const keys = variants ? lookupVariants(key) : [String(key || "").trim()];
  for (const candidate of keys) {
    if (!candidate) continue;
    buckets[hashBucket(candidate)][candidate] = index;
  }
}

async function multiSetBatched(entries, size = 20) {
  for (let i = 0; i < entries.length; i += size) {
    await AsyncStorage.multiSet(entries.slice(i, i + size));
  }
}

/** Save one roster copy plus tiny lookup indexes, split into safe storage rows. */
export async function saveRoster(students) {
  const list = (students || []).map(compactEntry);
  const buckets = Array.from({ length: INDEX_BUCKETS }, () => ({}));

  list.forEach((entry, index) => {
    addIndex(buckets, entry.student_id, index);
    addIndex(buckets, entry.student_number, index);
    // Signed payloads are case-sensitive. Never mutate them when building the index.
    addIndex(buckets, entry.qr_payload, index, { variants: false });
  });

  let previous = null;
  try {
    previous = JSON.parse((await AsyncStorage.getItem(META_KEY)) || "null");
  } catch (_) {}

  const listChunks = Math.ceil(list.length / CHUNK_SIZE);
  const generation = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const writes = [];
  for (let i = 0; i < listChunks; i += 1) {
    writes.push([listKey(generation, i), JSON.stringify(list.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE))]);
  }
  buckets.forEach((bucket, i) => {
    writes.push([indexKey(generation, i), JSON.stringify(bucket)]);
  });

  // Write data first and metadata last, so an interrupted download never points
  // at a half-written roster.
  await multiSetBatched(writes);
  const meta = {
    version: VERSION,
    generation,
    count: list.length,
    at: new Date().toISOString(),
    listChunks,
    chunkSize: CHUNK_SIZE,
    indexBuckets: INDEX_BUCKETS,
  };
  await AsyncStorage.setItem(META_KEY, JSON.stringify(meta));

  const cleanup = [LEGACY_MAP_KEY, LEGACY_META_KEY, LEGACY_LIST_KEY];
  const oldChunks = Number(previous?.listChunks || 0);
  if (previous?.generation && previous.generation !== generation) {
    for (let i = 0; i < oldChunks; i += 1) cleanup.push(listKey(previous.generation, i));
    for (let i = 0; i < Number(previous.indexBuckets || INDEX_BUCKETS); i += 1) {
      cleanup.push(indexKey(previous.generation, i));
    }
  }
  try { await AsyncStorage.multiRemove(cleanup); } catch (_) {}
  return meta.count;
}

async function loadMetaV3() {
  try {
    const raw = await AsyncStorage.getItem(META_KEY);
    const meta = raw ? JSON.parse(raw) : null;
    return meta?.version === VERSION ? meta : null;
  } catch {
    return null;
  }
}

async function loadRosterList(meta) {
  if (!meta?.listChunks || !meta?.generation) return [];
  const keys = Array.from({ length: meta.listChunks }, (_, i) => listKey(meta.generation, i));
  const rows = await AsyncStorage.multiGet(keys);
  const out = [];
  for (const [, raw] of rows) {
    if (!raw) continue;
    const chunk = JSON.parse(raw);
    if (Array.isArray(chunk)) out.push(...chunk);
  }
  return out;
}

async function legacyLookup(code) {
  try {
    const raw = await AsyncStorage.getItem(LEGACY_MAP_KEY);
    const map = raw ? JSON.parse(raw) : {};
    for (const key of lookupVariants(code)) {
      if (map[key]) return map[key];
    }
  } catch (_) {}
  return null;
}

export async function lookupRoster(code) {
  const candidates = lookupVariants(code);
  if (!candidates.length) return null;
  try {
    const meta = await loadMetaV3();
    if (!meta) return legacyLookup(code);
    const bucketIds = [...new Set(candidates.map(hashBucket))];
    const rows = await AsyncStorage.multiGet(bucketIds.map((id) => indexKey(meta.generation, id)));
    const maps = new Map();
    rows.forEach(([key, raw]) => {
      const bucket = Number(key.slice(key.lastIndexOf("_") + 1));
      maps.set(bucket, raw ? JSON.parse(raw) : {});
    });
    let index = null;
    for (const candidate of candidates) {
      const value = maps.get(hashBucket(candidate))?.[candidate];
      if (Number.isInteger(value)) {
        index = value;
        break;
      }
    }
    if (index === null) return null;
    const chunkSize = Number(meta.chunkSize || CHUNK_SIZE);
    const chunkNumber = Math.floor(index / chunkSize);
    const rawChunk = await AsyncStorage.getItem(listKey(meta.generation, chunkNumber));
    const chunk = rawChunk ? JSON.parse(rawChunk) : [];
    return chunk[index % chunkSize] || null;
  } catch {
    return null;
  }
}

/** Filter local roster by name/program/section/code (for search UI). */
export async function searchRoster(query, limit = 30) {
  const q = String(query || "").trim().toLowerCase();
  if (!q) return [];
  try {
    const meta = await loadMetaV3();
    let list;
    if (meta) {
      list = await loadRosterList(meta);
    } else {
      const raw = await AsyncStorage.getItem(LEGACY_LIST_KEY);
      list = raw ? JSON.parse(raw) : [];
    }
    const out = [];
    for (const s of list) {
      const hay = [s.full_name, s.student_id, s.student_number, s.program, s.section, s.year_level]
        .join(" ")
        .toLowerCase();
      if (hay.includes(q)) {
        out.push(s);
        if (out.length >= limit) break;
      }
    }
    return out;
  } catch {
    return [];
  }
}

export async function rosterMeta() {
  const meta = await loadMetaV3();
  if (meta) return meta;
  try {
    const raw = await AsyncStorage.getItem(LEGACY_META_KEY);
    return raw ? JSON.parse(raw) : { count: 0, at: null };
  } catch {
    return { count: 0, at: null };
  }
}
