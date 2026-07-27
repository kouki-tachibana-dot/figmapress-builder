import assert from "node:assert/strict";
import test from "node:test";
import {
  WORDPRESS_PROFILES_KEY,
  decodeWordPressPairingFragment,
  pruneWordPressProfiles,
  readWordPressProfiles,
  removeWordPressProfile,
  saveWordPressProfile,
  type WordPressConnectionProfile,
} from "../apps/web/src/lib/wordpress-profile.ts";

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear() {
      values.clear();
    },
    getItem(key) {
      return values.get(key) ?? null;
    },
    key(index) {
      return [...values.keys()][index] ?? null;
    },
    removeItem(key) {
      values.delete(key);
    },
    setItem(key, value) {
      values.set(key, value);
    },
  };
}

function pairingFragment(
  input: Partial<WordPressConnectionProfile> & { version?: number },
): string {
  return `#figmapress-connect=${Buffer.from(
    JSON.stringify({ version: 1, ...input }),
    "utf8",
  ).toString("base64url")}`;
}

const now = Date.UTC(2026, 6, 27);
const token = `fp1.7.${"a".repeat(43)}`;

test("WordPress pairing fragment accepts only HTTPS, valid, unexpired profiles", () => {
  assert.deepEqual(
    decodeWordPressPairingFragment(pairingFragment({
      baseUrl: "https://wordpress.example/",
      username: "editor",
      connectorToken: token,
      expiresAt: now + 90 * 24 * 60 * 60 * 1_000,
    }), now),
    {
      baseUrl: "https://wordpress.example",
      username: "editor",
      connectorToken: token,
      expiresAt: now + 90 * 24 * 60 * 60 * 1_000,
      updatedAt: now,
    },
  );
  assert.equal(decodeWordPressPairingFragment(pairingFragment({
    baseUrl: "http://wordpress.example",
    username: "editor",
    connectorToken: token,
    expiresAt: now + 1_000,
  }), now), null);
  assert.equal(decodeWordPressPairingFragment(pairingFragment({
    baseUrl: "https://wordpress.example",
    username: "editor",
    connectorToken: token,
    expiresAt: now - 1,
  }), now), null);
  assert.equal(decodeWordPressPairingFragment("#figmapress-connect=invalid", now), null);
});

test("WordPress profiles replace a site, cap storage, and remove cleanly", () => {
  const storage = memoryStorage();
  for (let index = 0; index < 10; index += 1) {
    saveWordPressProfile(storage, {
      baseUrl: `https://site-${index}.example`,
      username: `editor-${index}`,
      updatedAt: now + index,
    }, now + index);
  }
  const profiles = readWordPressProfiles(storage, now);
  assert.equal(profiles.length, 8);
  assert.equal(profiles[0]?.baseUrl, "https://site-9.example");

  saveWordPressProfile(storage, {
    baseUrl: "https://site-9.example",
    username: "new-editor",
    updatedAt: now + 100,
  }, now + 100);
  assert.equal(readWordPressProfiles(storage, now)[0]?.username, "new-editor");

  const remaining = removeWordPressProfile(
    storage,
    "https://site-9.example",
    now,
  );
  assert.equal(remaining.some((profile) =>
    profile.baseUrl === "https://site-9.example"
  ), false);
  assert.ok(storage.getItem(WORDPRESS_PROFILES_KEY));
});

test("expired Connector profiles are pruned from browser storage", () => {
  const storage = memoryStorage();
  storage.setItem(WORDPRESS_PROFILES_KEY, JSON.stringify([{
    baseUrl: "https://wordpress.example",
    username: "editor",
    connectorToken: token,
    expiresAt: now - 1,
    updatedAt: now - 100,
  }]));
  assert.deepEqual(pruneWordPressProfiles(storage, now), []);
  assert.equal(storage.getItem(WORDPRESS_PROFILES_KEY), "[]");
});
