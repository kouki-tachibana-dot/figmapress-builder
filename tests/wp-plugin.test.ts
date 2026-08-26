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
const pairingPath = new URL(
  "../wordpress-plugin/figmapress-connector/includes/pairing.php",
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

test("Connector persists each resumable image batch after localization", async () => {
  const source = await readFile(restApiPath, "utf8");
  const mediaHandler = source.indexOf(
    "function figmapress_connector_rest_localize_elementor_media",
  );
  const localize = source.indexOf(
    "figmapress_connector_localize_elementor_images(",
    mediaHandler,
  );
  const store = source.indexOf(
    "figmapress_connector_store_elementor_document( $post_id",
    localize,
  );

  assert.ok(mediaHandler > 0, "resumable media handler must exist");
  assert.ok(localize > mediaHandler, "media handler must localize images");
  assert.ok(store > localize, "localized image data must be saved after each batch");
});

test("Connector bounds synchronous media localization", async () => {
  const source = await readFile(restApiPath, "utf8");
  assert.equal(
    source.match(/\$media_deadline\s*=\s*microtime\( true \) \+ 24;/g)?.length,
    1,
    "only the resumable media batch may spend the bounded slow-host budget",
  );
  assert.match(source, /min\( 15, \$remaining \)/);
  assert.match(source, /download_url\( \$url, max\( 1, \(int\) \$download_timeout \) \)/);
  assert.match(source, /isset\( \$localized_images\[ \$url \] \)/);
  assert.match(source, /\$localized_images\[ \$url \]\s*=\s*\$localized_entry/);
  assert.match(source, /'figmapress-carousel'/);
  assert.match(source, /'previous_icon', 'next_icon'/);
});

test("Connector checkpoints large documents before optional Elementor bookkeeping", async () => {
  const source = await readFile(restApiPath, "utf8");
  assert.match(source, /\\Elementor\\Plugin::\$instance->documents->get\( \$post_id \)/);
  assert.match(source, /\$document->save\(/);
  const storeFunction = source.indexOf(
    "function figmapress_connector_store_elementor_document",
  );
  const directWrite = source.indexOf(
    "update_metadata(\n        'post',\n        $post_id,\n        '_elementor_data'",
    storeFunction,
  );
  const documentSave = source.indexOf("$document->save(", directWrite);
  const finalRead = source.indexOf(
    "figmapress_connector_read_elementor_data( $post_id )",
    documentSave,
  );

  assert.ok(directWrite > storeFunction, "editable data must be checkpointed first");
  assert.ok(documentSave > directWrite, "Elementor bookkeeping must run only after the checkpoint");
  assert.ok(finalRead > documentSave, "the final persisted data must be verified");
  assert.match(source, /\$expected_elements > 350 \|\| \$encoded_bytes > 600000/);
  assert.match(source, /! \$document_api_skipped/);
  assert.match(source, /'documentApiSkipped'\s*=>\s*\$document_api_skipped/);
  assert.match(source, /is_array\( \$stored_value \)/);
  assert.match(source, /\$stored_elements !== \$expected_elements/);
  assert.match(source, /figmapress_elementor_save_failed/);
  assert.match(source, /wp_delete_post\( \$post_id, true \)/);
});

test("Connector ensures Elementor Containers are available before creating a page", async () => {
  const source = await readFile(restApiPath, "utf8");
  const elementorHandler = source.indexOf(
    "function figmapress_connector_rest_create_elementor_page",
  );
  const ensureContainers = source.indexOf(
    "figmapress_connector_ensure_elementor_containers()",
    elementorHandler,
  );
  const insertPost = source.indexOf("$post_id = wp_insert_post(", elementorHandler);

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
  assert.match(plugin, /function figmapress_connector_load_elementor_widget_classes/);
  assert.match(rest, /figmapress_connector_load_elementor_widget_classes\(\);/);
  for (const widget of [
    "figmapress-nav",
    "figmapress-link",
    "figmapress-carousel",
    "figmapress-contact-form",
    "figmapress-accordion",
    "nested-accordion",
    "form",
    "nav-menu",
    "image-carousel",
  ]) {
    assert.match(rest, new RegExp(`'${widget}'`));
  }
  assert.match(rest, /function figmapress_connector_registered_elementor_widget/);
  assert.match(rest, /'elementorPro'\s*=>\s*array/);
  assert.match(rest, /'nativeWidgets'\s*=>\s*array/);
  assert.match(rest, /get_widget_types\(\)/);
});

test("Connector accepts only native Elementor documents with real text", async () => {
  const rest = await readFile(restApiPath, "utf8");
  assert.match(rest, /function figmapress_connector_validate_native_elementor_template/);
  assert.match(rest, /figmapress_native_layout/);
  assert.match(rest, /figmapress_exact_visual/);
  assert.match(rest, /figmapress-exact-/);
  assert.match(rest, /figmapress_real_text_required/);
  assert.match(rest, /wp_strip_all_tags/);
  assert.match(rest, /transparent_color/);
  assert.match(rest, /opacity_size/);
  assert.match(rest, /figmapress_native_elementor_required/);
  assert.match(rest, /'nativeElementor'\s*=>\s*array/);
  assert.match(rest, /'snapshotContent'\s*=>\s*false/);
  assert.match(rest, /AS native_layout/);
  assert.match(rest, /AS exact_visual/);
  assert.match(rest, /AS text_widget_count/);
});

test("Connector keeps the mobile navigation above later Elementor content", async () => {
  const styles = await readFile(interactionStylePath, "utf8");
  assert.match(
    styles,
    /\.elementor-widget-figmapress-nav\s*\{[^}]*z-index:\s*1000\s*!important;/s,
  );
});

test("Connector routes only owned Elementor pages away from the memory-heavy block editor", async () => {
  const plugin = await readFile(pluginPath, "utf8");
  assert.match(plugin, /function figmapress_connector_redirect_owned_elementor_editor/);
  assert.match(plugin, /wp_doing_ajax\(\)/);
  assert.match(plugin, /current_user_can\( 'edit_post', \$post_id \)/);
  assert.match(plugin, /'_elementor_edit_mode'/);
  assert.match(plugin, /'_figmapress_source_key'/);
  assert.match(plugin, /'_figmapress_request_id'/);
  assert.match(plugin, /wp_safe_redirect\( admin_url\( 'post\.php\?post=' \./);
  assert.match(
    plugin,
    /add_action\( 'load-post\.php', 'figmapress_connector_redirect_owned_elementor_editor', 1 \)/,
  );
});

test("Connector renders and localizes the Figma navigation CTA icon", async () => {
  const [widgets, styles, rest] = await Promise.all([
    readFile(elementorWidgetsPath, "utf8"),
    readFile(interactionStylePath, "utf8"),
    readFile(restApiPath, "utf8"),
  ]);

  assert.match(widgets, /'cta_icon'/);
  assert.match(widgets, /figmapress-nav__cta-icon/);
  assert.match(widgets, /\$geometry\['ctaIcon'\]/);
  assert.match(styles, /\.figmapress-nav--fidelity \.figmapress-nav__cta-icon/);
  assert.match(rest, /'logo', 'cta_icon'/);
});

test("public contact form verifies origin, token, rate limit, and stored widget", async () => {
  const [source, widgets, styles] = await Promise.all([
    readFile(contactPath, "utf8"),
    readFile(elementorWidgetsPath, "utf8"),
    readFile(interactionStylePath, "utf8"),
  ]);
  assert.match(source, /figmapress_connector_contact_same_origin/);
  assert.match(source, /hash_equals\( \$expected, \$token \)/);
  assert.match(source, /figmapress_connector_contact_rate_limit/);
  assert.match(source, /figmapress_connector_find_elementor_widget/);
  assert.match(source, /wp_mail\( \$recipient/);
  assert.match(source, /'permission_callback' => '__return_true'/);
  assert.doesNotMatch(source, /2 \* DAY_IN_SECONDS/);
  assert.match(source, /Full-page\s+\*\s+\/\/ caches|Full-page/);
  assert.match(source, /\$dynamic_fields/);
  assert.match(source, /array_slice\( \$settings\['fields'\], 0, 24 \)/);
  assert.match(source, /'checkbox' === \$field_type/);
  assert.match(source, /in_array\( \$value, \$options, true \)/);
  assert.match(widgets, /'fields'/);
  assert.match(widgets, /figmapress-contact__field--checkbox/);
  assert.match(widgets, /figmapress-contact__options/);
  assert.match(styles, /\.figmapress-contact__options/);
  assert.match(styles, /input\[type="tel"\]/);
});

test("Connector reuses an existing Elementor draft for the same request identifier", async () => {
  const source = await readFile(restApiPath, "utf8");
  const elementorHandler = source.indexOf(
    "function figmapress_connector_rest_create_elementor_page",
  );
  const lookup = source.indexOf(
    "figmapress_connector_find_page_by_meta( '_figmapress_request_id'",
    elementorHandler,
  );
  const insert = source.indexOf("$post_id = wp_insert_post(", elementorHandler);
  const record = source.indexOf(
    "update_post_meta( $post_id, '_figmapress_request_id'",
    elementorHandler,
  );

  assert.ok(lookup > 0, "request identifier lookup must exist");
  assert.ok(lookup < insert, "existing drafts must be checked before inserting a page");
  assert.ok(record > insert, "request identifier must be recorded immediately after insertion");
  assert.match(source, /add_option\( \$request_lock_key, \$lock_value, '', false \)/);
  assert.match(source, /figmapress_request_in_progress/);
  assert.match(source, /2 \* MINUTE_IN_SECONDS/);
  assert.match(source, /register_shutdown_function/);
  assert.match(source, /'token'\s*=>\s*\$lock_token/);
  assert.match(source, /hash_equals\( \$lock_token, \$current\['token'\] \)/);
  assert.match(source, /'idempotent'\s*=>\s*true/);
  assert.match(source, /重複ページは作成していません/);
});

test("Connector resumes media localization and preserves it across visual updates", async () => {
  const source = await readFile(restApiPath, "utf8");
  assert.match(source, /elementor\/pages\/\(\?P<id>\\d\+\)\/media/);
  assert.match(source, /figmapress_connector_rest_localize_elementor_media/);
  assert.match(source, /'_figmapress_media_map'/);
  assert.match(source, /'_figmapress_media_failures'/);
  assert.match(source, /'remainingMedia'/);
  assert.match(source, /'mediaComplete'/);
  assert.match(source, /\$imported_media >= 10/);
  assert.match(source, /figmapress_connector_apply_elementor_image_map\( \$content, \$localized_images \)/);
  const updateHandler = source.indexOf(
    "function figmapress_connector_rest_update_elementor_document",
  );
  const applyMap = source.indexOf(
    "figmapress_connector_apply_elementor_image_map( $content, $localized_images )",
    updateHandler,
  );
  const updateStore = source.indexOf(
    "figmapress_connector_store_elementor_document( $post_id, $content",
    updateHandler,
  );
  assert.ok(applyMap > updateHandler && applyMap < updateStore);
});

test("Connector returns the durable draft before starting remote image work", async () => {
  const source = await readFile(restApiPath, "utf8");
  const createHandler = source.indexOf(
    "function figmapress_connector_rest_create_elementor_page",
  );
  const nextHandler = source.indexOf(
    "function figmapress_connector_validate_owned_elementor_draft",
    createHandler,
  );
  const createSource = source.slice(createHandler, nextHandler);
  assert.match(createSource, /figmapress_connector_store_elementor_document/);
  assert.match(createSource, /figmapress_connector_clear_elementor_cache/);
  assert.doesNotMatch(createSource, /figmapress_connector_localize_elementor_images/);
});

test("Connector reconstructs bounded user-scoped Elementor uploads", async () => {
  const source = await readFile(restApiPath, "utf8");
  const pairing = await readFile(pairingPath, "utf8");
  assert.match(source, /elementor\/uploads\/\(\?P<upload>/);
  assert.match(source, /figmapress_connector_rest_upload_elementor_page/);
  assert.match(source, /get_current_user_id\(\)/);
  assert.match(source, /set_transient\( \$upload_key, \$state, 15 \* MINUTE_IN_SECONDS \)/);
  assert.match(source, /base64_decode\( \$chunk, true \)/);
  assert.match(source, /\$request->get_body_params\(\)/);
  assert.match(pairing, /\$_POST\['figmapress_token'\]/);
  assert.match(pairing, /\$_POST\['figmapress_token_hex'\]/);
  assert.match(pairing, /hex2bin/);
  assert.match(pairing, /wp_ajax_nopriv_figmapress_site_prepare/);
  assert.match(pairing, /wp_ajax_figmapress_site_prepare/);
  assert.match(source, /\$total > 128/);
  assert.match(source, /strlen\( \$chunk \) > 128000/);
  assert.match(source, /strlen\( \$decoded \) > 72000/);
  assert.match(source, /figmapress_connector_rest_create_elementor_page\( \$forward \)/);
});

test("Connector streams trusted Elementor uploads without hydrating the full page", async () => {
  const source = await readFile(restApiPath, "utf8");
  const handlerStart = source.indexOf(
    "function figmapress_connector_stream_elementor_upload",
  );
  const handlerEnd = source.indexOf(
    "function figmapress_connector_rest_upload_elementor_page",
    handlerStart,
  );
  const handler = source.slice(handlerStart, handlerEnd);
  const uploadStart = handlerEnd;
  const uploadEnd = source.indexOf(
    "function figmapress_connector_rest_create_elementor_page",
    uploadStart,
  );
  const uploadHandler = source.slice(uploadStart, uploadEnd);

  assert.ok(handlerStart > 0 && handlerEnd > handlerStart);
  assert.match(handler, /autoload'\s*=>\s*'no'/);
  assert.match(handler, /SET option_value = CONCAT\(option_value, %s\)/);
  assert.match(handler, /JSON_VALID\(option_value\)/);
  assert.match(handler, /JSON_EXTRACT\(option_value, '\$\.template\.content'\)/);
  assert.match(handler, /current_user_can\( 'unfiltered_html' \)/);
  assert.match(handler, /current_user_can\( 'edit_post', \$post_id \)/);
  assert.match(handler, /get_post_status\( \$post_id \)/);
  assert.match(handler, /'_elementor_data'/);
  assert.match(handler, /'_figmapress_stored_hash'/);
  assert.match(handler, /figmapress_connector_deferred_media_progress\( \$media_total \)/);
  assert.doesNotMatch(handler, /'remainingMedia'\s*=>\s*0/);
  assert.doesNotMatch(handler, /'mediaComplete'\s*=>\s*true/);
  assert.doesNotMatch(handler, /json_decode\([^;]*option_value/);
  assert.doesNotMatch(handler, /implode\( '', \$state\['chunks'\] \)/);
  assert.match(
    uploadHandler,
    /if \( current_user_can\( 'unfiltered_html' \) \) \{\s+return figmapress_connector_stream_elementor_upload/,
  );
  assert.doesNotMatch(uploadHandler, /\$total > 32/);
});

test("Connector always scans streamed and confirmed drafts before declaring media complete", async () => {
  const source = await readFile(restApiPath, "utf8");
  const helperStart = source.indexOf(
    "function figmapress_connector_deferred_media_progress",
  );
  const helperEnd = source.indexOf(
    "function figmapress_connector_localize_elementor_images",
    helperStart,
  );
  const helper = source.slice(helperStart, helperEnd);
  const confirmStart = source.indexOf(
    "function figmapress_connector_rest_confirm_elementor_page",
  );
  const confirmEnd = source.indexOf(
    "function figmapress_connector_validate_owned_elementor_draft",
    confirmStart,
  );
  const confirm = source.slice(confirmStart, confirmEnd);

  assert.ok(helperStart > 0 && helperEnd > helperStart);
  assert.match(helper, /\$needs_scan\s*=\s*\$total_media > 0/);
  assert.match(helper, /'remainingMedia'\s*=>\s*\$needs_scan \? 1 : 0/);
  assert.match(helper, /'mediaComplete'\s*=>\s*! \$needs_scan/);
  assert.match(confirm, /figmapress_connector_deferred_media_progress/);
});

test("shared-host site preparation keeps the paired user explicit", async () => {
  const [pairing, rest] = await Promise.all([
    readFile(pairingPath, "utf8"),
    readFile(restApiPath, "utf8"),
  ]);
  const handlerStart = pairing.indexOf(
    "function figmapress_connector_admin_post_prepare_site",
  );
  const handlerEnd = pairing.indexOf("add_action(", handlerStart);
  const handler = pairing.slice(handlerStart, handlerEnd);

  assert.ok(handlerStart > 0 && handlerEnd > handlerStart);
  assert.match(handler, /user_can\( \$paired_user_id, 'edit_pages' \)/);
  assert.match(handler, /user_can\( \$paired_user_id, 'edit_theme_options' \)/);
  assert.match(handler, /figmapress_connector_rest_prepare_site\([\s\S]*?\$paired_user_id/);
  assert.doesNotMatch(handler, /wp_set_current_user/);
  assert.match(pairing, /\/paired\/site-prepare/);
  assert.match(pairing, /figmapress_connector_is_manual_pairing_request/);
  assert.match(pairing, /'permission_callback' => '__return_true'/);
  assert.match(pairing, /function figmapress_connector_rest_prepare_site_paired/);
  assert.match(rest, /function figmapress_connector_rest_prepare_site\( WP_REST_Request \$request, \$actor_user_id = 0 \)/);
  assert.match(rest, /user_can\( \$actor_user_id, 'edit_post', \$page_id \)/);
  assert.match(rest, /user_can\( \$actor_user_id, 'edit_theme_options' \)/);
  assert.match(rest, /\$post_data\['post_author'\] = absint\( \$actor_user_id \)/);
});

test("Connector browser bridge is origin pinned and token scoped", async () => {
  const [pairing, rest] = await Promise.all([
    readFile(pairingPath, "utf8"),
    readFile(restApiPath, "utf8"),
  ]);
  assert.match(pairing, /figmapress_connector_render_browser_bridge/);
  assert.match(pairing, /template_redirect/);
  assert.match(pairing, /figmapress_connector_builder_url\(\)/);
  assert.match(pairing, /event\.origin !== allowedOrigin/);
  assert.match(pairing, /const peer = embedded \? window\.parent : window\.opener/);
  assert.match(pairing, /event\.source !== peer/);
  assert.match(pairing, /tokenPattern = \/\^fp1/);
  assert.match(pairing, /figmapress_token_hex/);
  assert.match(pairing, /credentials: 'same-origin'/);
  assert.match(pairing, /figmapress:save-elementor/);
  assert.match(pairing, /figmapress:elementor-saved/);
  assert.match(pairing, /figmapress:confirm-elementor/);
  assert.match(pairing, /figmapress:elementor-confirmed/);
  assert.match(pairing, /window\.setTimeout\(\(\) => post\(\{ type: 'figmapress:bridge-ready' \}\), 0\)/);
  assert.doesNotMatch(pairing, /clearInterval\(readyTimer\)/);
  assert.match(pairing, /figmapress:localize-media/);
  assert.match(pairing, /figmapress:elementor-media/);
  assert.match(pairing, /elementor\/uploads\//);
  assert.match(pairing, /elementor\/pages\//);
  assert.match(pairing, /chunkBytes = 8000/);
  assert.match(pairing, /const splitUtf8Bytes = \(bytes, maxBytes\)/);
  assert.match(pairing, /\(bytes\[end\] & 0xc0\) === 0x80/);
  assert.match(pairing, /chunk: base64Bytes\(chunks\[index\]\)/);
  assert.match(pairing, /const postForm = async \(url, connectorToken, fields, timeoutMs = 45000\)/);
  assert.match(pairing, /const retryDelays = \[1000, 2500, 5000, 10000, 20000\]/);
  assert.match(pairing, /index === total - 1 \? 150000 : 45000/);
  assert.match(pairing, /isRetryableElementorError/);
  assert.match(pairing, /Elementor編集データの分割送信を安全に再開しています/);
  assert.match(pairing, /frame-ancestors https:\/\/figmapress-builder\.vercel\.app/);
  assert.doesNotMatch(pairing, /X-Frame-Options: DENY/);
  assert.match(pairing, /\/paired\/site-prepare/);
  assert.match(rest, /'bridge'\s*=>\s*true/);
  assert.match(rest, /\$params = \$request->get_body_params\(\)/);
  assert.match(rest, /\/elementor\/pages\/\(\?P<id>\\d\+\)\/stored/);
  assert.match(rest, /function figmapress_connector_rest_confirm_elementor_page/);
  assert.match(rest, /_figmapress_stored_request_id/);
  assert.match(rest, /figmapress_connector_elementor_storage_hash/);
  assert.match(rest, /figmapress_connector_elementor_storage_receipt/);
  assert.match(rest, /\$stored_bytes === \$expected_bytes/);
  assert.match(rest, /hash_equals\( \$expected_hash, \$stored_hash \)/);
  assert.ok(
    rest.indexOf("update_post_meta( $post_id, '_figmapress_stored_hash'")
      < rest.indexOf("$direct_meta_write = update_metadata("),
  );
});

test("Connector updates an editable draft for a stable Figma source", async () => {
  const source = await readFile(restApiPath, "utf8");
  const createStart = source.indexOf("function figmapress_connector_rest_create_elementor_page");
  const createEnd = source.indexOf("function figmapress_connector_rest_confirm_elementor_page", createStart);
  const createSource = source.slice(createStart, createEnd);
  assert.match(source, /\^figma:/);
  assert.match(source, /'_figmapress_source_key'/);
  assert.match(source, /function figmapress_connector_find_editable_draft_by_meta/);
  assert.match(source, /'post_status'\s*=>\s*'draft'/);
  assert.match(source, /'posts_per_page'\s*=>\s*20/);
  assert.match(source, /current_user_can\( 'edit_post', \$page_id \)/);
  assert.match(createSource, /figmapress_connector_find_editable_draft_by_meta\( '_figmapress_source_key'/);
  assert.match(createSource, /\$existing_elementor_bytes > 0 && \$existing_elementor_bytes <= 600000/);
  assert.match(createSource, /get_post_field\( 'post_title', \$existing_id, 'raw' \)/);
  assert.match(createSource, /if \( \$current_title === \$title \) \{[\s\S]{0,300}\$post_id = \$existing_id;/);
  assert.match(createSource, /\} else \{\s+\$post_id = wp_update_post\(/);
  assert.match(source, /'updated'\s*=>\s*\$reuse_existing/);
});

test("Connector streaming creates a safe draft when a single-page run has no prepared draft", async () => {
  const source = await readFile(restApiPath, "utf8");
  const streamStart = source.indexOf("function figmapress_connector_stream_elementor_upload");
  const streamEnd = source.indexOf("function figmapress_connector_rest_upload_elementor_page", streamStart);
  const streamSource = source.slice(streamStart, streamEnd);
  assert.match(streamSource, /JSON_EXTRACT\(option_value, '\$\.title'\)/);
  assert.match(streamSource, /JSON_EXTRACT\(option_value, '\$\.slug'\)/);
  assert.match(streamSource, /figmapress_connector_find_editable_draft_by_meta\( '_figmapress_source_key'/);
  assert.match(streamSource, /if \( ! \$post_id \) \{[\s\S]{0,900}wp_insert_post\(/);
  assert.match(streamSource, /'post_status'\s*=>\s*'draft'/);
  assert.match(streamSource, /'post_author'\s*=>\s*get_current_user_id\(\)/);
  assert.match(streamSource, /update_post_meta\( \$post_id, '_figmapress_source_key', \$source_key \)/);
  assert.doesNotMatch(streamSource, /figmapress_connector_find_page_by_meta\( '_figmapress_source_key'/);
});

test("functional widgets include keyboard, reduced-motion, and timeout safeguards", async () => {
  const [script, style, widgets] = await Promise.all([
    readFile(interactionScriptPath, "utf8"),
    readFile(interactionStylePath, "utf8"),
    readFile(elementorWidgetsPath, "utf8"),
  ]);
  assert.match(script, /event\.key === "Escape"/);
  assert.match(script, /event\.key === "ArrowLeft"/);
  assert.match(script, /pointerdown/);
  assert.match(script, /figmapress-carousel__dot/);
  assert.match(script, /toggle\.focus\(\)/);
  assert.match(script, /target\.closest\("\.figmapress-nav__toggle"\)/);
  assert.match(script, /querySelectorAll\("\.figmapress-nav\.is-open"\)/);
  assert.match(script, /window\.addEventListener\("click",[\s\S]*?\}, true\);/);
  assert.match(script, /event\.stopPropagation\(\)/);
  assert.match(script, /figmapress-nav__state/);
  assert.match(script, /state\.addEventListener\("change"/);
  assert.match(script, /setNavigationOpen\(nav, state\.checked, false\)/);
  assert.match(script, /AbortController/);
  assert.match(script, /controller\.abort\(\)/);
  assert.match(script, /aria-busy/);
  assert.match(style, /prefers-reduced-motion:\s*reduce/);
  assert.match(style, /focus-visible/);
  assert.match(style, /figmapress-nav__state:checked/);
  assert.match(style, /figmapress-nav__state \+ \.figmapress-nav__toggle[\s\S]*?pointer-events:\s*none/);
  assert.match(widgets, /class="figmapress-nav__state"/);
  assert.match(style, /\.figmapress-carousel/);
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
  assert.match(widget, /figmapress_connector_design_geometry/);
  assert.match(widget, /figmapress_connector_has_geometry_box/);
  assert.match(widget, /\! \$fidelity \|\| \$has_cta_geometry/);
  assert.match(widget, /figmapress_connector_inferred_mobile_toggle_geometry/);
  assert.match(widget, /figmapress-nav--toggle-inferred/);
  assert.match(widget, /aria-expanded="false"/);
  assert.match(widget, /figmapress-contact--fidelity/);
  assert.match(widget, /figmapress-accordion--fidelity/);
  assert.match(style, /\.figmapress-nav--mobile/);
  assert.match(style, /\.figmapress-nav--fidelity/);
  assert.match(style, /\.figmapress-nav--mobile\.figmapress-nav--toggle-inferred/);
  assert.match(style, /background:\s*var\(--figmapress-accent, #d10b2c\)/);
  assert.match(style, /\.figmapress-contact--fidelity/);
  assert.match(style, /\.figmapress-accordion--fidelity/);
  assert.match(style, /linear-gradient\(rgba\(255, 255, 255, \.97\)/);
  assert.match(style, /\.elementor-widget-figmapress-nav[^}]*height:\s*auto/s);
  assert.match(style, /\.figmapress-nav[^}]*height:\s*auto/s);
  assert.match(style, /min-height:\s*min\(680px,\s*178\.409vw\)/);
  assert.match(style, /textarea[^}]*min-height:\s*min\(144px,\s*32\.727vw\)/s);
  assert.match(style, /@media \(min-width: 768px\)/);
  assert.match(style, /padding:\s*min\(70px,\s*3\.646vw\) min\(150px,\s*7\.813vw\)/);
  assert.match(style, /textarea[^}]*min-height:\s*min\(144px,\s*7\.5vw\)/s);
  assert.match(style, /#contact-mobile/);
  assert.match(style, /#contact-desktop/);
});

test("high-fidelity navigation never renders an unpositioned CTA over the header", async () => {
  const widgets = await readFile(elementorWidgetsPath, "utf8");
  assert.match(widgets, /'transparent' === strtolower\( \$value \)/);
  assert.match(
    widgets,
    /function figmapress_connector_has_geometry_box\([\s\S]*?'x', 'y', 'width', 'height'[\s\S]*?return \(float\) \$box\['width'\] > 0/,
  );
  assert.match(
    widgets,
    /\! empty\( \$settings\['cta_label'\] \) && \( \! \$fidelity \|\| \$has_cta_geometry \)/,
  );
});

test("accordion keeps empty Figma states closed instead of opening a blank panel", async () => {
  const [widget, script, style] = await Promise.all([
    readFile(elementorWidgetsPath, "utf8"),
    readFile(interactionScriptPath, "utf8"),
    readFile(interactionStylePath, "utf8"),
  ]);

  assert.match(widget, /\$first_open_index\s*=\s*-1/);
  assert.match(widget, /data-has-content=/);
  assert.match(widget, /aria-disabled="true" tabindex="-1"/);
  assert.match(script, /details\.dataset\.hasContent !== "true"/);
  assert.match(script, /event\.preventDefault\(\)/);
  assert.match(script, /if \(details\.open\) details\.open = false/);
  assert.match(style, /details\[data-has-content="false"\] summary/);
});

test("Connector checks the pinned HTTPS manifest for native WordPress updates", async () => {
  const source = await readFile(updatePath, "utf8");
  assert.match(source, /pre_set_site_transient_update_plugins/);
  assert.match(source, /figmapress-builder\.vercel\.app/);
  assert.match(source, /version_compare/);
  assert.match(source, /'plugins_api'/);
  assert.match(source, /delete_site_transient_update_plugins/);
  assert.match(source, /figmapress_connector_clear_update_manifest_cache/);
  assert.match(source, /add_query_arg/);
  assert.match(source, /'installed'\s*=>\s*FIGMAPRESS_CONNECTOR_VERSION/);
  assert.match(source, /unset\( \$transient->response\[ \$plugin \] \)/);
});

test("Connector pairing is revocable, hashed, expiring, and namespace scoped", async () => {
  const [plugin, pairing, rest] = await Promise.all([
    readFile(pluginPath, "utf8"),
    readFile(pairingPath, "utf8"),
    readFile(restApiPath, "utf8"),
  ]);
  assert.match(plugin, /includes\/pairing\.php/);
  assert.match(pairing, /90 \* DAY_IN_SECONDS/);
  assert.match(pairing, /hash_hmac\( 'sha256'/);
  assert.match(pairing, /hash_equals\(/);
  assert.match(pairing, /HTTP_X_FIGMAPRESS_TOKEN/);
  assert.match(pairing, /query_vars\['rest_route'\]/);
  assert.match(pairing, /wp_parse_url\( \$request_uri, PHP_URL_PATH \)/);
  assert.match(pairing, /#\^\/\?figmapress\/v1/);
  assert.doesNotMatch(pairing, /strpos\( \$request_uri/);
  assert.match(pairing, /#figmapress-connect=/);
  assert.match(pairing, /admin_post_nopriv_figmapress_site_prepare/);
  assert.match(pairing, /figmapress_connector_admin_post_prepare_site/);
  assert.match(pairing, /figmapress_connector_verify_pairing_token/);
  assert.match(pairing, /figmapress_connector_rest_prepare_site/);
  assert.match(pairing, /delete_user_meta\( \$user_id, '_figmapress_pairing_token_hash'/);
  assert.match(rest, /'\/gutenberg\/pages'/);
  assert.match(rest, /'post_status'\s*=>\s*'draft'/);
});

test("Connector exposes authenticated Elementor snapshots with stable Figma node identities", async () => {
  const [plugin, rest, interactionStyle] = await Promise.all([
    readFile(pluginPath, "utf8"),
    readFile(restApiPath, "utf8"),
    readFile(interactionStylePath, "utf8"),
  ]);
  assert.match(rest, /elementor\/pages\/\(\?P<id>\\d\+\)\/snapshot/);
  assert.match(rest, /get_builder_content_for_display\( \$post_id, true \)/);
  assert.match(rest, /wp_print_styles\(\)/);
  assert.match(rest, /attachment_url_to_postid/);
  assert.match(rest, /24 \* MB_IN_BYTES/);
  assert.match(rest, /wp_get_attachment_image_src\( \$attachment_id, 'medium_large' \)/);
  assert.match(rest, /array_key_exists\( \$clean_url, \$asset_cache \)/);
  assert.match(rest, /'omittedAssetsCount'/);
  assert.match(rest, /data:' \. \$type \. ';base64,/);
  assert.match(rest, /post-' \. \$post_id \. '\.css/);
  assert.match(rest, /figmapress_connector_snapshot_elementor_frontend_css/);
  assert.match(rest, /data-figmapress-elementor-frontend-css/);
  assert.match(rest, /figmapress_connector_snapshot_interactions_css/);
  assert.match(rest, /figmapress_connector_snapshot_css_compatibility/);
  assert.match(rest, /data-figmapress-interactions-css/);
  assert.match(rest, /figmapress_connector_register_elementor_assets\(\)/);
  assert.match(interactionStyle, /rgba\(209, 11, 44, \.38\)/);
  assert.match(rest, /ELEMENTOR_PATH/);
  assert.match(rest, /figmapress_connector_validate_owned_elementor_draft/);
  assert.match(rest, /hash_equals\( \$stored_request_id, \$request_id \)/);
  assert.match(plugin, /data-figmapress-node-id/);
  assert.match(plugin, /data-figmapress-section/);
  assert.match(plugin, /figmapress-figma-preview/);
});

test("Connector loads only allowlisted Figma webfonts for the owned page and snapshot", async () => {
  const [plugin, rest] = await Promise.all([
    readFile(pluginPath, "utf8"),
    readFile(restApiPath, "utf8"),
  ]);
  assert.match(plugin, /figmapress_connector_supported_webfont_families/);
  assert.match(plugin, /'Inter'/);
  assert.match(plugin, /'Noto Sans JP'/);
  assert.match(plugin, /array_slice\( \$manifest, 0, 4 \)/);
  assert.match(plugin, /array_slice\( \$font\['weights'\], 0, 6 \)/);
  assert.match(plugin, /in_array\( \$family, \$supported, true \)/);
  assert.match(plugin, /https:\/\/fonts\.googleapis\.com\/css2\?/);
  assert.match(plugin, /get_post_meta\( \$post_id, '_figmapress_request_id', true \)/);
  assert.match(plugin, /add_action\( 'wp_enqueue_scripts', 'figmapress_connector_enqueue_page_webfonts', 20 \)/);
  assert.match(rest, /figmapress_connector_enqueue_page_webfonts\( \$post_id \)/);
  assert.match(rest, /'webfonts'\s*=>\s*array_keys\( figmapress_connector_page_webfonts\( \$post_id \) \)/);
  assert.match(rest, /'webfonts'\s*=>\s*true/);
});

test("Connector renders only structured and bounded Figma gradients", async () => {
  const [plugin, rest] = await Promise.all([
    readFile(pluginPath, "utf8"),
    readFile(restApiPath, "utf8"),
  ]);
  assert.match(plugin, /figmapress_connector_gradient_css/);
  assert.match(plugin, /in_array\( \$type, array\( 'linear', 'radial' \), true \)/);
  assert.match(plugin, /array_slice\( \$gradient\['stops'\], 0, 8 \)/);
  assert.match(plugin, /figmapress_connector_gradient_color_css/);
  assert.match(plugin, /linear-gradient\(/);
  assert.match(plugin, /radial-gradient\(ellipse/);
  assert.match(plugin, /'background-image:' \. \$gradient_css/);
  assert.match(rest, /'gradients'\s*=>\s*true/);
});

test("Connector renders only structured and bounded Figma effects", async () => {
  const [plugin, rest] = await Promise.all([
    readFile(pluginPath, "utf8"),
    readFile(restApiPath, "utf8"),
  ]);
  assert.match(plugin, /figmapress_connector_effects_css/);
  assert.match(plugin, /array_slice\( \$effects\['shadows'\], 0, 8 \)/);
  assert.match(plugin, /in_array\( \$type, array\( 'drop', 'inner' \), true \)/);
  assert.match(plugin, /'box-shadow:' \. implode/);
  assert.match(plugin, /'opacity:' \. \$opacity/);
  assert.match(plugin, /'filter:blur\(' \. \$blur/);
  assert.match(plugin, /'backdrop-filter:blur\(' \. \$background_blur/);
  assert.match(plugin, /isset\( \$settings\['figmapress_effects'\] \)/);
  assert.match(rest, /'effects'\s*=>\s*true/);
});

test("Connector renders only structured and bounded Figma image transforms", async () => {
  const [plugin, rest, style] = await Promise.all([
    readFile(pluginPath, "utf8"),
    readFile(restApiPath, "utf8"),
    readFile(interactionStylePath, "utf8"),
  ]);
  assert.match(plugin, /figmapress_connector_image_css/);
  assert.match(plugin, /in_array\( \$mode, array\( 'fill', 'fit', 'stretch', 'tile' \), true \)/);
  assert.match(plugin, /--figmapress-image-transform:translate\(/);
  assert.match(plugin, /matrix\(' \. \$a \. ',' \. \$c \. ',' \. \$b \. ',' \. \$d/);
  assert.match(plugin, /pow\( 2, \(float\) \$exposure \)/);
  assert.match(plugin, /--figmapress-image-tile-url:url\("/);
  assert.match(plugin, /isset\( \$settings\['figmapress_image'\] \)/);
  assert.match(plugin, /data-figmapress-image-mode/);
  assert.match(style, /\.elementor-widget-image\.figmapress-image-adjusted/);
  assert.match(style, /transform: var\(--figmapress-image-transform, none\)/);
  assert.match(style, /translate: var\(--figmapress-image-translate, 0 0\)/);
  assert.match(style, /background-repeat: repeat/);
  assert.match(rest, /'imageTransforms'\s*=>\s*true/);
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

test("Connector prepares idempotent draft pages and a plugin-owned unassigned menu", async () => {
  const rest = await readFile(restApiPath, "utf8");
  const prepareStart = rest.indexOf("function figmapress_connector_rest_prepare_site");
  const prepareEnd = rest.indexOf("function figmapress_connector_rest_create_gutenberg_page", prepareStart);
  const prepareSite = rest.slice(prepareStart, prepareEnd);
  assert.match(rest, /'\/sites\/prepare'/);
  assert.match(rest, /'\/elementor\/site-prepare'/);
  assert.match(rest, /'permission_callback'\s*=>\s*'figmapress_connector_rest_can_build_site'/);
  assert.match(rest, /current_user_can\( 'edit_pages' \) && current_user_can\( 'edit_theme_options' \)/);
  assert.match(rest, /function figmapress_connector_rest_prepare_site/);
  assert.match(rest, /\$request->get_param\( 'payload' \)/);
  assert.match(rest, /json_decode\( wp_unslash\( \$payload \), true \)/);
  assert.match(rest, /'post_status'\s*=>\s*'draft'/);
  assert.match(prepareSite, /figmapress_connector_find_editable_draft_by_meta\(/);
  assert.match(rest, /'_figmapress_site_key'/);
  assert.match(rest, /'_figmapress_page_key'/);
  assert.match(rest, /'_figmapress_prepared'/);
  assert.match(rest, /wp_create_nav_menu\( \$menu_name \)/);
  assert.match(rest, /wp_update_nav_menu_item\(/);
  assert.match(rest, /require_once ABSPATH \. 'wp-admin\/includes\/nav-menu\.php'/);
  assert.match(rest, /'menu-item-object'\s*=>\s*'page'/);
  assert.match(rest, /get_nav_menu_locations\(\)/);
  assert.match(rest, /'assigned'\s*=>\s*! empty\( \$assigned \)/);
  assert.doesNotMatch(rest, /set_theme_mod\(\s*'nav_menu_locations'/);
  assert.match(rest, /if \( empty\( \$seen\['home'\] \) \)/);
  assert.match(prepareSite, /count\( \$requested_pages \) > 20/);
  assert.match(prepareSite, /\[a-z0-9\]\[a-z0-9-\]\{0,79\}/);
  assert.match(rest, /foreach \( \$validated_pages as \$requested \)/);
  assert.match(rest, /\$validated_pages\[ \$index \]\['existingId'\] = \$existing_id/);
  assert.match(prepareSite, /Published pages with the same source identity are deliberately/);
  assert.doesNotMatch(prepareSite, /figmapress_site_page_not_editable/);
  assert.match(prepareSite, /get_post_field\( 'post_title', \$existing_id, 'raw' \)/);
  assert.match(prepareSite, /if \( \$current_title === \$page_title \) \{\s+\/\/ Replays should not fire save_post hooks/);
  assert.match(prepareSite, /\$post_id = \$existing_id;\s+\} else \{\s+\$post_id = wp_update_post/);
  assert.doesNotMatch(prepareSite, /figmapress_connector_read_elementor_data/);
  assert.match(rest, /A stable Figma source always updates the same draft/);
  assert.match(rest, /the validated incoming document will replace it below/);
  assert.match(rest, /figmapress_connector_elementor_storage_bytes\( \$existing_id \)/);
  assert.match(rest, /if \( \$existing_elementor_bytes > 0 && \$existing_elementor_bytes <= 600000 \) \{\s+wp_save_post_revision\( \$existing_id \)/);
  assert.match(rest, /function figmapress_connector_elementor_storage_bytes/);
  assert.match(rest, /OCTET_LENGTH\(meta_value\)/);
  assert.match(rest, /if \( \$document_api_skipped \) \{/);
  assert.match(rest, /\$stored_bytes === \$encoded_bytes \? \$expected_elements : 0/);
  assert.doesNotMatch(rest, /strlen\( \$body \) > 4000000 \|\| ! is_array\( json_decode\( \$body, true \) \)/);
  assert.match(rest, /strlen\( \$body \) > 4000000/);
  assert.match(
    rest,
    /function figmapress_connector_count_elementor_elements\( \$elements \) \{\s+if \( ! is_array\( \$elements \) \) \{\s+return 0;/,
  );
});
