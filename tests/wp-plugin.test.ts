import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const restApiPath = new URL(
  "../wordpress-plugin/figmapress-connector/includes/rest-api.php",
  import.meta.url,
);

test("Connector stores Elementor content before attempting remote image imports", async () => {
  const source = await readFile(restApiPath, "utf8");
  const firstStore = source.indexOf("figmapress_connector_store_elementor_document( $post_id");
  const localize = source.indexOf("figmapress_connector_localize_elementor_images( $content");
  const secondStore = source.indexOf(
    "figmapress_connector_store_elementor_document( $post_id",
    firstStore + 1,
  );

  assert.ok(firstStore > 0, "initial Elementor document save must exist");
  assert.ok(localize > firstStore, "image localization must run after the initial save");
  assert.ok(secondStore > localize, "localized image data must be saved again");
});

test("Connector bounds synchronous media localization", async () => {
  const source = await readFile(restApiPath, "utf8");
  assert.match(source, /\$media_deadline\s*=\s*microtime\( true \) \+ 12;/);
  assert.match(source, /min\( 6, \$remaining \)/);
  assert.match(source, /download_url\( \$url, max\( 1, \(int\) \$download_timeout \) \)/);
});

test("Connector saves through Elementor and verifies persisted elements", async () => {
  const source = await readFile(restApiPath, "utf8");
  assert.match(source, /\\Elementor\\Plugin::\$instance->documents->get\( \$post_id \)/);
  assert.match(source, /\$document->save\(/);
  assert.match(source, /get_post_meta\( \$post_id, '_elementor_data', true \)/);
  assert.match(source, /figmapress_elementor_save_failed/);
  assert.match(source, /wp_delete_post\( \$post_id, true \)/);
});
