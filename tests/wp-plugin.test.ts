import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const restApiPath = new URL(
  "../wordpress-plugin/figmapress-connector/includes/rest-api.php",
  import.meta.url,
);
const pluginPath = new URL(
  "../wordpress-plugin/figmapress-connector/figmapress-connector.php",
  import.meta.url,
);
const contactPath = new URL(
  "../wordpress-plugin/figmapress-connector/includes/contact-form.php",
  import.meta.url,
);
const updatePath = new URL(
  "../wordpress-plugin/figmapress-connector/includes/update-checker.php",
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
  const firstRead = source.indexOf("figmapress_connector_read_elementor_data( $post_id )");
  const directWrite = source.indexOf(
    "update_metadata(\n            'post',\n            $post_id,\n            '_elementor_data'",
    firstRead,
  );
  const secondRead = source.indexOf(
    "figmapress_connector_read_elementor_data( $post_id )",
    firstRead + 1,
  );

  assert.ok(firstRead > 0, "Document API output must be read back");
  assert.ok(directWrite > firstRead, "incomplete Document API output must fall back to direct metadata");
  assert.ok(secondRead > directWrite, "direct metadata output must be read back again");
  assert.match(source, /is_array\( \$stored_value \)/);
  assert.match(source, /\$stored_elements !== \$expected_elements/);
  assert.match(source, /figmapress_elementor_save_failed/);
  assert.match(source, /wp_delete_post\( \$post_id, true \)/);
});

test("Connector ensures Elementor Containers are available before creating a page", async () => {
  const source = await readFile(restApiPath, "utf8");
  const ensureContainers = source.indexOf("figmapress_connector_ensure_elementor_containers()");
  const insertPost = source.indexOf("$post_id = wp_insert_post(");

  assert.ok(ensureContainers > 0, "Container compatibility check must exist");
  assert.ok(insertPost > ensureContainers, "Container compatibility must be checked before creating the draft");
  assert.match(source, /get_element_types\( 'container' \)/);
  assert.match(source, /current_user_can\( 'manage_options' \)/);
  assert.match(source, /get_feature_option_key\( 'container' \)/);
  assert.match(source, /update_option\( \$option_key, 'active' \)/);
});

test("Connector accepts and registers functional Elementor widgets", async () => {
  const [plugin, rest] = await Promise.all([
    readFile(pluginPath, "utf8"),
    readFile(restApiPath, "utf8"),
  ]);
  assert.match(plugin, /Version:\s+0\.5\.0/);
  assert.match(plugin, /elementor\/widgets\/register/);
  for (const widget of ["figmapress-nav", "figmapress-contact-form", "figmapress-accordion"]) {
    assert.match(rest, new RegExp(`'${widget}'`));
  }
});

test("public contact form verifies origin, token, rate limit, and stored widget", async () => {
  const source = await readFile(contactPath, "utf8");
  assert.match(source, /figmapress_connector_contact_same_origin/);
  assert.match(source, /hash_equals\( \$expected, \$token \)/);
  assert.match(source, /figmapress_connector_contact_rate_limit/);
  assert.match(source, /figmapress_connector_find_elementor_widget/);
  assert.match(source, /wp_mail\( \$recipient/);
  assert.match(source, /'permission_callback' => '__return_true'/);
});

test("Connector checks the pinned HTTPS manifest for native WordPress updates", async () => {
  const source = await readFile(updatePath, "utf8");
  assert.match(source, /pre_set_site_transient_update_plugins/);
  assert.match(source, /figmapress-builder\.vercel\.app/);
  assert.match(source, /version_compare/);
  assert.match(source, /'plugins_api'/);
});
