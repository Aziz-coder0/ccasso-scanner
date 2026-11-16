const assert = require("node:assert/strict");
const { test } = require("node:test");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");

const storage = `
  const cache = new Map();
  const AsyncStorage = {
    getItem: async (key) => cache.get(key) || null,
    setItem: async (key, value) => cache.set(key, value),
  };
`;
const source = readFileSync(resolve(__dirname, "../src/db/queue.js"), "utf8")
  .replace('import AsyncStorage from "@react-native-async-storage/async-storage";', storage);
const queue = import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);

test("sync updates a pending history entry while preserving its student and session", async () => {
  const { getHistory, pushHistory, recordUploadedScans } = await queue;
  const scan = { client_uid: "q1", session_id: 124, student_code: "2026-00124", scanned_at: "2026-10-08T09:38:00Z" };
  await pushHistory({ ...scan, name: "Alex Reyes", status: "QUEUED", at: scan.scanned_at });
  await Promise.all([
    recordUploadedScans([{ scan, result: { success: true, status: "LATE" } }]),
    pushHistory({ ...scan, name: "Alex Reyes", status: "QUEUED", at: scan.scanned_at }),
  ]);
  assert.deepEqual(await getHistory(), [{ ...scan, name: "Alex Reyes", status: "LATE", at: scan.scanned_at }]);
});

test("manual and camera sync cannot acquire the shared queue lock at the same time", async () => {
  const { acquireQueueSync } = await queue;
  const release = acquireQueueSync();
  assert.equal(typeof release, "function");
  assert.equal(acquireQueueSync(), null);
  release();
  const next = acquireQueueSync();
  assert.equal(typeof next, "function");
  next();
});
