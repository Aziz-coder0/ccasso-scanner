const assert = require("node:assert/strict");
const { test } = require("node:test");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");

test("only the selected academic year is persisted; reset removes it", async () => {
  const plain = new Map();
  const secure = new Map();
  const mock = {
    AsyncStorage: {
      setItem: async (key, value) => plain.set(key, value),
      getItem: async (key) => plain.get(key) ?? null,
      multiRemove: async (keys) => keys.forEach((key) => plain.delete(key)),
    },
    SecureStore: {
      setItemAsync: async (key, value) => secure.set(key, value),
      getItemAsync: async (key) => secure.get(key) ?? null,
      deleteItemAsync: async (key) => secure.delete(key),
    },
  };
  global.__verificationStorageMock = mock;
  const source = readFileSync(resolve(__dirname, "../src/db/storage.js"), "utf8")
    .replace(/^import \* as SecureStore from "expo-secure-store";/m, "const SecureStore = globalThis.__verificationStorageMock.SecureStore;")
    .replace(/^import AsyncStorage from "@react-native-async-storage\/async-storage";/m, "const AsyncStorage = globalThis.__verificationStorageMock.AsyncStorage;");
  try {
    const { saveVerificationAcademicYear, loadVerificationAcademicYear, clearConfig } = await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
    assert.equal(await loadVerificationAcademicYear(), "");
    await saveVerificationAcademicYear(" 2026-2027 ");
    assert.equal(await loadVerificationAcademicYear(), "2026-2027");
    assert.deepEqual([...plain.entries()], [["ccas_verification_academic_year", "2026-2027"]]);
    assert.equal(secure.size, 0);
    await assert.rejects(saveVerificationAcademicYear("2026-2028"));
    assert.equal(await loadVerificationAcademicYear(), "2026-2027");
    await saveVerificationAcademicYear("");
    assert.equal(await loadVerificationAcademicYear(), "");
    plain.set("ccas_verification_academic_year", '{"student":"personal data"}');
    assert.equal(await loadVerificationAcademicYear(), "");
    await saveVerificationAcademicYear("2026-2027");
    await clearConfig();
    assert.equal(await loadVerificationAcademicYear(), "");
    assert.equal(plain.has("ccas_verification_academic_year"), false);
  } finally {
    delete global.__verificationStorageMock;
  }
});
