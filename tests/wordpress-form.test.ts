import assert from "node:assert/strict";
import test from "node:test";
import { readWordPressCredentials } from "../apps/web/src/lib/wordpress-form.ts";

test("WordPress actions use the credentials currently displayed by the form", () => {
  const form = new FormData();
  form.set("baseUrl", " https://takeuchikiyoko.com/ ");
  form.set("username", " Takeuchikiyoko ");
  form.set("applicationPassword", "visible application password");

  assert.deepEqual(
    readWordPressCredentials(form, {
      baseUrl: "https://stale.example",
      username: "Figmapress",
      applicationPassword: "stale application password",
    }),
    {
      baseUrl: "https://takeuchikiyoko.com/",
      username: "Takeuchikiyoko",
      applicationPassword: "visible application password",
    },
  );
});

test("WordPress credential reading falls back when no form is available", () => {
  const fallback = {
    baseUrl: "https://wordpress.example",
    username: "editor",
    applicationPassword: "application password",
  };
  assert.equal(readWordPressCredentials(null, fallback), fallback);
});
