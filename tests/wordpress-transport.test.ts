import assert from "node:assert/strict";
import test from "node:test";
import {
  LARGE_ELEMENTOR_PAYLOAD_BYTES,
  runWordPressWriteWithNetworkFallback,
  shouldProxyWordPressDraft,
} from "../apps/web/src/lib/wordpress-transport.ts";

test("large Elementor drafts use the resilient server transport", () => {
  assert.equal(
    shouldProxyWordPressDraft(
      "direct",
      "elementor",
      LARGE_ELEMENTOR_PAYLOAD_BYTES,
    ),
    true,
  );
  assert.equal(
    shouldProxyWordPressDraft(
      "direct",
      "elementor",
      LARGE_ELEMENTOR_PAYLOAD_BYTES - 1,
    ),
    false,
  );
  assert.equal(
    shouldProxyWordPressDraft(
      "direct",
      "elementor",
      LARGE_ELEMENTOR_PAYLOAD_BYTES,
      true,
    ),
    false,
  );
});

test("proxy selection and Gutenberg direct transport keep their intent", () => {
  assert.equal(shouldProxyWordPressDraft("proxy", "gutenberg", 1), true);
  assert.equal(shouldProxyWordPressDraft(null, "elementor", 1), true);
  assert.equal(
    shouldProxyWordPressDraft("direct", "gutenberg", LARGE_ELEMENTOR_PAYLOAD_BYTES),
    false,
  );
});

test("site writes retry through the server only after a direct network failure", async () => {
  const calls: string[] = [];
  const result = await runWordPressWriteWithNetworkFallback(
    "direct",
    async () => {
      calls.push("direct");
      throw new Error("network");
    },
    async () => {
      calls.push("proxy");
      return "prepared";
    },
    (error) => error instanceof Error && error.message === "network",
  );

  assert.equal(result, "prepared");
  assert.deepEqual(calls, ["direct", "proxy"]);
});

test("site writes never hide authentication or validation failures", async () => {
  const calls: string[] = [];
  await assert.rejects(
    runWordPressWriteWithNetworkFallback(
      "direct",
      async () => {
        calls.push("direct");
        throw new Error("auth");
      },
      async () => {
        calls.push("proxy");
        return "unexpected";
      },
      (error) => error instanceof Error && error.message === "network",
    ),
    /auth/,
  );
  assert.deepEqual(calls, ["direct"]);
});

test("known proxy transport skips the browser-direct write", async () => {
  const calls: string[] = [];
  const result = await runWordPressWriteWithNetworkFallback(
    "proxy",
    async () => {
      calls.push("direct");
      return "unexpected";
    },
    async () => {
      calls.push("proxy");
      return "prepared";
    },
    () => true,
  );
  assert.equal(result, "prepared");
  assert.deepEqual(calls, ["proxy"]);
});
