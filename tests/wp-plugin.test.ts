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
  ]) {
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
  assert.match(source, /10 \* MINUTE_IN_SECONDS/);
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
  assert.match(source, /elementor\/uploads\/\(\?P<upload>/);
  assert.match(source, /figmapress_connector_rest_upload_elementor_page/);
  assert.match(source, /get_current_user_id\(\)/);
  assert.match(source, /set_transient\( \$upload_key, \$state, 15 \* MINUTE_IN_SECONDS \)/);
  assert.match(source, /base64_decode\( \$chunk, true \)/);
  assert.match(source, /strlen\( \$decoded \) > 72000/);
  assert.match(source, /figmapress_connector_rest_create_elementor_page\( \$forward \)/);
});

test("Connector updates one draft for a stable Figma source", async () => {
  const source = await readFile(restApiPath, "utf8");
  assert.match(source, /\^figma:/);
  assert.match(source, /'_figmapress_source_key'/);
  assert.match(source, /figmapress_connector_find_page_by_meta\( '_figmapress_source_key'/);
  assert.match(source, /wp_update_post\(/);
  assert.match(source, /'updated'\s*=>\s*\$reuse_existing/);
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
  assert.match(widget, /figmapress-contact--fidelity/);
  assert.match(widget, /figmapress-accordion--fidelity/);
  assert.match(style, /\.figmapress-nav--mobile/);
  assert.match(style, /\.figmapress-nav--fidelity/);
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

test("Connector checks the pinned HTTPS manifest for native WordPress updates", async () => {
  const source = await readFile(updatePath, "utf8");
  assert.match(source, /pre_set_site_transient_update_plugins/);
  assert.match(source, /figmapress-builder\.vercel\.app/);
  assert.match(source, /version_compare/);
  assert.match(source, /'plugins_api'/);
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
