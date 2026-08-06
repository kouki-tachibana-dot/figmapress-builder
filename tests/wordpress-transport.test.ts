import assert from "node:assert/strict";
import test from "node:test";
import {
  LARGE_ELEMENTOR_PAYLOAD_BYTES,
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
