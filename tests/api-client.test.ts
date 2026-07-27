import assert from "node:assert/strict";
import test from "node:test";
import { readApi } from "../apps/web/src/lib/api-client.ts";

test("API client preserves structured application errors", async () => {
  await assert.rejects(
    readApi(new Response(
      JSON.stringify({ ok: false, error: "入力内容を確認してください。" }),
      {
        status: 422,
        headers: { "Content-Type": "application/json" },
      },
    )),
    /入力内容を確認してください。/,
  );
});

test("API client turns a plain-text runtime timeout into an actionable message", async () => {
  await assert.rejects(
    readApi(new Response("An error occurred with your deployment", {
      status: 504,
      headers: { "Content-Type": "text/plain" },
    })),
    /対象フレームのURL/,
  );
});

test("API client accepts a successful JSON response", async () => {
  const result = await readApi<{ ok: true; value: string }>(
    Response.json({ ok: true, value: "ready" }),
  );
  assert.equal(result.value, "ready");
});
