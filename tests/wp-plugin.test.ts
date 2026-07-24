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
const packagePath = new URL("../packages/wp-connector/package.json", import.meta.url);
const contactPath = new URL(
  "../wordpress-plugin/figmapress-connector/includes/contact-form.php",
  import.meta.url,
);
const updatePath = new URL(
  "../wordpress-plugin/figmapress-connector/includes/update-checker.php",
  import.meta.url,
);
const interactionScriptPath = new URL(
  "../wordpress-plugin/figmapress-connector/assets/elementor-interactions.js",
  import.meta.url,
);
const interactionStylePath = new URL(
  "../wordpress-plugin/figmapress-connector/assets/elementor-interactions.css",
  import.meta.url,
);
const elementorWidgetsPath = new URL(
  "../wordpress-plugin/figmapress-connector/includes/elementor-widgets.php",
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
  assert.match(source, /isset\( \$localized_images\[ \$url \] \)/);
  assert.match(source, /\$localized_images\[ \$url \]\s*=\s*array\(/);
});

test("Connector saves through Elementor and verifies persisted elements", async () => {
  const source = await readFile(restApiPath, "utf8");
  assert.match(source, /\\Elementor\\Plugin::\$instance->documents->get\( \$post_id \)/);
  assert.match(source, /\$document->save\(/);
  const storeFunction = source.indexOf(
    "function figmapress_connector_store_elementor_document",
  );
  const firstRead = source.indexOf(
    "figmapress_connector_read_elementor_data( $post_id )",
    storeFunction,
  );
  const directWrite = source.indexOf(
    "update_metadata(\n        'post',\n        $post_id,\n        '_elementor_data'",
    firstRead,
  );
  const secondRead = source.indexOf(
    "figmapress_connector_read_elementor_data( $post_id )",
    firstRead + 1,
  );

  assert.ok(firstRead > 0, "Document API output must be read back");
  assert.ok(directWrite > firstRead, "sanitized metadata must be preserved after Document API save");
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
  const [plugin, rest, packageSource] = await Promise.all([
    readFile(pluginPath, "utf8"),
    readFile(restApiPath, "utf8"),
    readFile(packagePath, "utf8"),
  ]);
  const packageVersion = (JSON.parse(packageSource) as { version: string }).version;
  const escapedVersion = packageVersion.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  assert.match(plugin, new RegExp(`Version:\\s+${escapedVersion}`));
  assert.match(plugin, new RegExp(`FIGMAPRESS_CONNECTOR_VERSION', '${escapedVersion}'`));
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
  assert.doesNotMatch(source, /2 \* DAY_IN_SECONDS/);
  assert.match(source, /Full-page\s+\*\s+\/\/ caches|Full-page/);
});

test("Connector reuses an existing Elementor draft for the same request identifier", async () => {
  const source = await readFile(restApiPath, "utf8");
  const lookup = source.indexOf("'meta_key'               => '_figmapress_request_id'");
  const insert = source.indexOf("$post_id = wp_insert_post(");
  const record = source.indexOf("add_post_meta( $post_id, '_figmapress_request_id'");

  assert.ok(lookup > 0, "request identifier lookup must exist");
  assert.ok(lookup < insert, "existing drafts must be checked before inserting a page");
  assert.ok(record > insert, "request identifier must be recorded immediately after insertion");
  assert.match(source, /add_option\( \$request_lock_key, \$lock_value, '', false \)/);
  assert.match(source, /figmapress_request_in_progress/);
  assert.match(source, /10 \* MINUTE_IN_SECONDS/);
  assert.match(source, /'idempotent'\s*=>\s*true/);
  assert.match(source, /重複ページは作成していません/);
});

test("functional widgets include keyboard, reduced-motion, and timeout safeguards", async () => {
  const [script, style] = await Promise.all([
    readFile(interactionScriptPath, "utf8"),
    readFile(interactionStylePath, "utf8"),
  ]);
  assert.match(script, /event\.key === "Escape"/);
  assert.match(script, /toggle\.focus\(\)/);
  assert.match(script, /AbortController/);
  assert.match(script, /controller\.abort\(\)/);
  assert.match(script, /aria-busy/);
  assert.match(style, /prefers-reduced-motion:\s*reduce/);
  assert.match(style, /focus-visible/);
});

test("mobile navigation keeps its CTA and device-specific anchor targets", async () => {
  const [widget, style] = await Promise.all([
    readFile(elementorWidgetsPath, "utf8"),
    readFile(interactionStylePath, "utf8"),
  ]);
  assert.match(widget, /'home_url'/);
  assert.match(widget, /'layout_variant'/);
  assert.match(widget, /figmapress-nav--mobile/);
  assert.match(widget, /figmapress-nav__mobile-cta/);
  assert.match(style, /\.figmapress-nav--mobile/);
  assert.match(style, /#contact-mobile/);
  assert.match(style, /#contact-desktop/);
});

test("Connector checks the pinned HTTPS manifest for native WordPress updates", async () => {
  const source = await readFile(updatePath, "utf8");
  assert.match(source, /pre_set_site_transient_update_plugins/);
  assert.match(source, /figmapress-builder\.vercel\.app/);
  assert.match(source, /version_compare/);
  assert.match(source, /'plugins_api'/);
});

test("Connector exposes authenticated Elementor snapshots with stable Figma node identities", async () => {
  const [plugin, rest] = await Promise.all([
    readFile(pluginPath, "utf8"),
    readFile(restApiPath, "utf8"),
  ]);
  assert.match(rest, /elementor\/pages\/\(\?P<id>\\d\+\)\/snapshot/);
  assert.match(rest, /get_builder_content_for_display\( \$post_id, true \)/);
  assert.match(rest, /wp_print_styles\(\)/);
  assert.match(rest, /attachment_url_to_postid/);
  assert.match(rest, /8 \* MB_IN_BYTES/);
  assert.match(rest, /data:' \. \$type \. ';base64,/);
  assert.match(rest, /post-' \. \$post_id \. '\.css/);
  assert.match(rest, /figmapress_connector_validate_owned_elementor_draft/);
  assert.match(rest, /hash_equals\( \$stored_request_id, \$request_id \)/);
  assert.match(plugin, /data-figmapress-node-id/);
  assert.match(plugin, /data-figmapress-section/);
  assert.match(plugin, /figmapress-figma-preview/);
});

test("Connector revisions and verifies a matching draft before visual QA updates", async () => {
  const [plugin, rest] = await Promise.all([
    readFile(pluginPath, "utf8"),
    readFile(restApiPath, "utf8"),
  ]);
  assert.match(rest, /elementor\/pages\/\(\?P<id>\\d\+\)\/document/);
  assert.match(rest, /'draft' !== get_post_status\( \$post_id \)/);
  assert.match(rest, /\$revision_id = wp_save_post_revision\( \$post_id \)/);
  assert.match(
    rest,
    /figmapress_connector_store_elementor_document\( \$post_id, \$content, \$page_settings, \$page_template \)/,
  );
  assert.match(rest, /figmapress_connector_clear_elementor_cache\( \$post_id \)/);
  assert.match(plugin, /wp_post_revision_meta_keys/);
  assert.match(plugin, /'_elementor_data'/);
});
