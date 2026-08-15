import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  clearUserAvatar,
  getUserAvatar,
  isSupportedAvatarDataUrl,
  setUserAvatar,
  userAvatarStorageKey,
} from "../lib/user-avatar.ts";

const read = (relativePath) =>
  readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");

function memoryStorage() {
  const values = new Map();
  return {
    getItem(key) {
      return values.get(key) ?? null;
    },
    setItem(key, value) {
      values.set(key, value);
    },
    removeItem(key) {
      values.delete(key);
    },
  };
}

test("custom avatars are isolated by account and can be restored to default", () => {
  const storage = memoryStorage();
  const avatar = "data:image/png;base64,aGVsbG8=";

  assert.notEqual(userAvatarStorageKey("student-a"), userAvatarStorageKey("student-b"));
  setUserAvatar("student-a", avatar, storage);
  assert.equal(getUserAvatar("student-a", storage), avatar);
  assert.equal(getUserAvatar("student-b", storage), "");

  clearUserAvatar("student-a", storage);
  assert.equal(getUserAvatar("student-a", storage), "");
});

test("avatar storage rejects unsupported or malformed data", () => {
  const storage = memoryStorage();

  assert.equal(isSupportedAvatarDataUrl("data:image/webp;base64,aGVsbG8="), true);
  assert.equal(isSupportedAvatarDataUrl("data:image/svg+xml;base64,PHN2Zz4="), false);
  assert.throws(
    () => setUserAvatar("student-a", "https://example.com/avatar.png", storage),
    /头像数据格式无效/,
  );
});

test("personal profile owns avatar editing and the shell shares its avatar", () => {
  const settings = read("app/settings/page.tsx");
  const profile = read("app/desktop/profile/page.tsx");
  const shell = read("components/layout/desktop-shell.tsx");
  const market = read("components/desktop/desktop-market.tsx");

  assert.doesNotMatch(settings, /AvatarPicker/);
  assert.match(profile, /<AvatarPicker[\s\S]*userId=\{user\?\.id\}/);
  assert.match(shell, /<UserAvatar[\s\S]*userId=\{user\?\.id\}/);
  assert.doesNotMatch(market, /UserAvatar/);
});
