<?php
/** Real review callbacks; all writes to original posts/menus throw. */
define( 'ABSPATH', __DIR__ ); define( 'ARRAY_A', 'ARRAY_A' );
class WP_REST_Server { const CREATABLE = 'POST'; }
class WP_Error { public $data; public $message; function __construct( $code, $message, $data ) { $this->data = $data; $this->message = $message; } }
class WP_REST_Request {
    public $json; public $params = array();
    function __construct( ...$args ) {}
    function get_json_params() { return $this->json; }
    function get_param( $k ) { return $this->params[$k] ?? null; }
    function set_param( $k, $v ) { $this->params[$k] = $v; }
    function set_body( $v ) { $this->json = json_decode( $v, true ); }
    function set_header( ...$args ) {}
}
class ResponseDouble { public $data; function __construct( $v ) { $this->data = $v; } function get_data() { return $this->data; } function header( ...$args ) {} }
function check( $ok, $label ) { if ( ! $ok ) throw new Exception( $label ); }
function add_action( ...$args ) {}
function register_rest_route( $ns, $path, $args ) { $GLOBALS['routes'][$path] = $args; }
function is_wp_error( $v ) { return $v instanceof WP_Error; }
function rest_ensure_response( $v ) { return new ResponseDouble( $v ); }
function absint( $v ) { return abs( (int) $v ); }
function get_current_user_id() { return $GLOBALS['actor']; }
function user_can( $actor, $cap, $id = 0 ) { return $actor === 7 && ! isset( $GLOBALS['denied'][$cap] ) && ! isset( $GLOBALS['denied'][$id] ); }
function sanitize_text_field( $v ) { return strip_tags( trim( $v ) ); }
function wp_html_excerpt( $v, $count, $more ) {
    $chars = preg_split( '//u', strip_tags( $v ), -1, PREG_SPLIT_NO_EMPTY );
    return implode( '', array_slice( $chars, 0, $count ) ) . ( count( $chars ) > $count ? $more : '' );
}
function sanitize_title( $v ) { return trim( strtolower( preg_replace( '/[^a-z0-9-]/i', '-', $v ) ), '-' ); }
function wp_slash( $v ) { return addslashes( $v ); }
function wp_json_encode( $v ) { return json_encode( $v ); }
function wp_generate_uuid4() { return 'test-lock-' . ++$GLOBALS['nonce']; }
function figmapress_connector_register_request_lock_cleanup( ...$args ) {}
function figmapress_connector_site_base_key_pattern() { return '/^figma:[A-Za-z0-9_-]{6,160}:(?:root|[0-9]+:[0-9]+)$/'; }
function get_option( $key ) { return $GLOBALS['options'][$key] ?? false; }
function add_option( $key, $value, ...$args ) { if ( isset( $GLOBALS['options'][$key] ) ) return false; $GLOBALS['options'][$key] = $value; return true; }
function update_option( $key, $value, ...$args ) { $GLOBALS['options'][$key] = $value; return true; }
function delete_option( $key ) { unset( $GLOBALS['options'][$key] ); }
function get_post_stati() { return array( 'draft', 'publish', 'pending', 'trash', 'auto-draft', 'inherit', 'custom-live' ); }
function get_posts( $args ) {
    return array_slice( array_keys( array_filter( $GLOBALS['posts'], static function( $p ) use ( $args ) {
        return ( $p['meta'][$args['meta_key']] ?? '' ) === $args['meta_value'] && in_array( $p['post_status'], $args['post_status'], true );
    } ) ), 0, $args['posts_per_page'] );
}
function get_post_status( $id ) { return $GLOBALS['posts'][$id]['post_status'] ?? false; }
function get_post_field( $field, $id, $context = '' ) { return $GLOBALS['posts'][$id][$field] ?? ''; }
function get_post_meta( $id, $key, $single ) { return (string) ( $GLOBALS['posts'][$id]['meta'][$key] ?? '' ); }
function add_post_meta( $id, $key, $value, $unique = false ) {
    check( $id >= 100, 'original metadata write' );
    if ( $unique && isset( $GLOBALS['posts'][$id]['meta'][$key] ) ) return false;
    $GLOBALS['posts'][$id]['meta'][$key] = $value; $GLOBALS['writes']++; return true;
}
function wp_insert_post( $p, $error ) {
    check( ! isset( $p['ID'] ) && $p['post_status'] === 'draft' && $p['post_author'] === 7, 'draft insert only' );
    if ( $GLOBALS['failAfter'] !== null && $GLOBALS['inserted'] === $GLOBALS['failAfter'] ) return new WP_Error( 'fail', 'injected interruption', array( 'status' => 500 ) );
    $id = ++$GLOBALS['nextId']; $GLOBALS['inserted']++; $GLOBALS['writes']++;
    $p['post_title'] = stripslashes( $p['post_title'] ); $p['meta'] = $p['meta_input']; unset( $p['meta_input'] );
    $GLOBALS['posts'][$id] = $p; return $id;
}
function wp_update_post( ...$args ) { throw new Exception( 'forbidden post update' ); }
function update_post_meta( ...$args ) { throw new Exception( 'forbidden metadata update' ); }
function wp_delete_post( ...$args ) { throw new Exception( 'forbidden deletion' ); }
function figmapress_connector_sync_site_menu( ...$args ) { throw new Exception( 'forbidden normal menu sync' ); }
function admin_url( $path ) { return 'https://wp.example/subdir/wp-admin/' . $path; }
function get_preview_post_link( $id ) { return 'https://wp.example/subdir/?page_id=' . $id . '&preview=true'; }
function get_permalink( $id ) { return 'https://wp.example/subdir/?page_id=' . $id; }
function wp_create_nav_menu( $name ) { $id = ++$GLOBALS['nextId']; $GLOBALS['menus'][$id] = (object) array( 'name' => $name ); $GLOBALS['writes']++; return $id; }
function wp_get_nav_menu_object( $id ) { return $GLOBALS['menus'][$id] ?? false; }
function get_term_meta( $id, $key, $single ) { return $GLOBALS['termmeta'][$id][$key] ?? ''; }
function add_term_meta( $id, $key, $v, $unique ) { check( $id >= 100, 'original menu meta' ); $GLOBALS['termmeta'][$id][$key] = $v; $GLOBALS['writes']++; return true; }
function get_nav_menu_locations() { return $GLOBALS['locations']; }
function wp_get_nav_menu_items( $id, $args ) { return array_values( $GLOBALS['items'][$id] ?? array() ); }
function wp_update_nav_menu_item( $menu, $item, $args ) {
    check( $menu >= 100 && $item === 0 && $args['menu-item-type'] === 'custom', 'new custom item only' );
    check( str_contains( $args['menu-item-url'], 'preview=true' ), 'draft URL only' );
    $id = ++$GLOBALS['nextId']; $GLOBALS['writes']++;
    $GLOBALS['items'][$menu][$id] = (object) array( 'ID' => $id, 'type' => 'custom', 'title' => stripslashes( $args['menu-item-title'] ),
        'url' => $args['menu-item-url'], 'menu_order' => $args['menu-item-position'], 'menu_item_parent' => 0, 'post_status' => 'publish' );
    $GLOBALS['posts'][$id] = array( 'post_status' => 'publish', 'post_title' => '', 'meta' => array() ); return $id;
}
class DatabaseDouble {
    public $postmeta = 'wp_postmeta';
    function prepare( $query, $id ) { return array( $query, $id ); }
    function get_results( $q, $format ) {
        preg_match_all( "/'(_[a-z_]+)'/", $q[0], $matches ); $rows = array();
        foreach ( $GLOBALS['posts'][$q[1]]['meta'] as $k => $v ) if ( in_array( $k, $matches[1], true ) ) $rows[] = array( 'meta_key' => $k, 'meta_value' => (string) $v );
        return $rows;
    }
}
function figmapress_connector_elementor_storage_bytes( $id ) { return strlen( $GLOBALS['posts'][$id]['elementor'] ?? '' ); }
function figmapress_connector_elementor_storage_hash( $id ) { return hash( 'sha256', $GLOBALS['posts'][$id]['elementor'] ?? '' ); }
function figmapress_connector_elementor_storage_receipt( $id ) { return $GLOBALS['posts'][$id]['receipt'] ?? array(); }
function figmapress_connector_deferred_media_progress( $total ) { return array( 'remainingMedia' => $total, 'mediaComplete' => $total === 0 ); }
function figmapress_connector_verify_pairing_token( $token, $usage ) { check( $usage === false, 'no pairing usage writes' ); return $token === 'valid' ? 7 : 0; }
function figmapress_connector_pairing_token_from_request() { return $GLOBALS['token']; }
$wpdb = new DatabaseDouble();
require __DIR__ . '/../../wordpress-plugin/figmapress-connector/includes/site-map.php';
require __DIR__ . '/../../wordpress-plugin/figmapress-connector/includes/review-site.php';
$site = 'figma:Example123:root'; $actor = 7; $nonce = 0; $options = array(); $denied = array();
$posts = array(); $menus = array( 5 => (object) array( 'name' => 'public original' ) ); $termmeta = array(); $items = array(); $locations = array( 'primary' => 5 );
$nextId = 100; $inserted = 0; $writes = 0; $failAfter = null;
$input = array( 'siteKey' => $site, 'reviewId' => str_repeat( 'a', 32 ), 'title' => 'Review', 'pages' => array() );
foreach ( array( 'home', 'company', 'reasons', 'services', 'works', 'demolition', 'news', 'contact', 'officers' ) as $i => $key ) {
    $source = $key === 'home' ? $site : $site . ':page:' . $key;
    $input['pages'][] = array( 'key' => $key, 'title' => $key, 'slug' => $key, 'originalId' => 41 + $i );
    $posts[41 + $i] = array( 'post_status' => 'draft', 'post_title' => "hand edited $key", 'post_name' => $key, 'post_content' => 'manual text',
        'meta' => array( '_figmapress_source_key' => $source, '_figmapress_site_key' => $site, '_figmapress_page_key' => $key ) );
}
$originals = $posts;
check( figmapress_connector_review_page_title( $input['reviewId'], str_repeat( '設', 200 ) ) === '[検証 aaaaaaaa] ' . str_repeat( '設', 80 ) . '…', 'long multibyte title bounded' );
check( figmapress_connector_review_page_title( $input['reviewId'], str_repeat( '🏠', 100 ) ) === '[検証 aaaaaaaa] ' . str_repeat( '🏠', 80 ) . '…', 'surrogate-pair title fits API limit' );
function request_for( $input ) { $r = new WP_REST_Request(); $r->json = $input; return $r; }
function expect_conflict( $input, $code = 409 ) {
    $writes = $GLOBALS['writes']; $r = figmapress_connector_rest_prepare_review_site( request_for( $input ) );
    check( is_wp_error( $r ) && $r->data['status'] === $code, 'expected conflict: ' . json_encode( $r ) );
    check( $writes === $GLOBALS['writes'], 'conflict must not mutate pages or menus' );
}
// Invalid/unauthorized inputs are rejected before any target writes.
foreach ( array( 0, 8 ) as $actor ) expect_conflict( $input, $actor ? 403 : 401 );
$actor = 7;
foreach ( array( 'edit_pages', 'edit_theme_options', 'unfiltered_html' ) as $cap ) { $denied[$cap] = true; expect_conflict( $input, 403 ); unset( $denied[$cap] ); }
foreach ( array( 'extra', 'foreign', 'duplicate', 'nohome', 'type' ) as $case ) {
    $bad = $input;
    if ( $case === 'extra' ) $bad['status'] = 'publish';
    if ( $case === 'foreign' ) $bad['siteKey'] = 'figma:review-' . str_repeat( 'b', 40 ) . ':root';
    if ( $case === 'duplicate' ) $bad['pages'][1]['originalId'] = 41;
    if ( $case === 'nohome' ) $bad['pages'][0]['key'] = 'other';
    if ( $case === 'type' ) $bad['pages'][0]['originalId'] = '41';
    expect_conflict( $bad, 422 );
}
$bad = $input; $bad['pages'][0]['originalId'] = 99; expect_conflict( $bad );
$posts[41]['post_status'] = 'publish'; expect_conflict( $input ); $posts = $originals;
// Interrupted preparation resumes ONLY missing copies; it never overwrites.
$failAfter = 4;
$partial = figmapress_connector_rest_prepare_review_site( request_for( $input ) );
check( is_wp_error( $partial ) && $inserted === 4, 'injected partial creation' );
$failAfter = null;
$result = figmapress_connector_rest_prepare_review_site( request_for( $input ) )->get_data();
check( count( $result['pages'] ) === 9 && $inserted === 9, 'resume must not duplicate' );
check( $result['siteKey'] !== $site && $result['review'] && ! $result['menu']['assigned'], 'isolated review' );
check( count( $result['menu']['items'] ) === 9 && $locations === array( 'primary' => 5 ), 'isolated menu' );
foreach ( $originals as $id => $original ) check( $posts[$id] === $original, 'original unchanged' );
$before = $writes;
$replay = figmapress_connector_rest_prepare_review_site( request_for( $input ) )->get_data();
check( $writes === $before && $replay['pages'][0]['id'] === $result['pages'][0]['id'], 'replay is non-mutating' );
$copy = $result['pages'][0]; $copyId = $copy['id'];
$posts[$copyId]['post_title'] = 'manual review title';
figmapress_connector_rest_prepare_review_site( request_for( $input ) );
check( $posts[$copyId]['post_title'] === 'manual review title' && $writes === $before, 'review title retained' );
check( is_wp_error( figmapress_connector_review_save_guard( $copy['sourceKey'], $copy['requestId'], $copyId ) ), 'manual prepared title blocks save' );
$posts[$copyId]['post_title'] = $copy['title'];
check( true === figmapress_connector_review_save_guard( $copy['sourceKey'], $copy['requestId'], $copyId ), 'empty owned copy accepts first save' );
check( is_wp_error( figmapress_connector_review_save_guard( $copy['sourceKey'], str_repeat( 'b', 32 ), $copyId ) ), 'wrong save request rejected' );
check( is_wp_error( figmapress_connector_review_save_guard( $copy['sourceKey'], $copy['requestId'], 41 ) ), 'original save rejected' );
// A completed review is write-once; metadata hash mismatch means hand edits.
$posts[$copyId]['elementor'] = str_repeat( 'x', 200 );
$posts[$copyId]['receipt'] = array( '_figmapress_stored_request_id' => $copy['requestId'], '_figmapress_stored_source_key' => $copy['sourceKey'],
    '_figmapress_stored_bytes' => 200, '_figmapress_stored_hash' => hash( 'sha256', str_repeat( 'x', 200 ) ) );
$posts[$copyId]['meta']['_figmapress_media_total'] = 3;
$saved = figmapress_connector_review_save_guard( $copy['sourceKey'], $copy['requestId'], $copyId );
check( $saved->get_data()['updated'] === false && $saved->get_data()['remainingMedia'] === 3 && $writes === $before, 'confirm without resave; media remains pending' );
$posts[$copyId]['elementor'] = str_repeat( 'y', 200 );
check( is_wp_error( figmapress_connector_review_save_guard( $copy['sourceKey'], $copy['requestId'], $copyId ) ), 'same-length hand edit blocks overwrite' );
foreach ( array( 'publish', 'trash', 'custom-live' ) as $status ) { $posts[$copyId]['post_status'] = $status; expect_conflict( $input ); }
$posts[$copyId]['post_status'] = 'draft';
$posts[999] = $posts[$copyId]; expect_conflict( $input ); unset( $posts[999] );
$old = $posts[$copyId]; unset( $posts[$copyId] ); expect_conflict( $input ); $posts[$copyId] = $old;
$locations['footer'] = $result['menu']['id']; expect_conflict( $input ); unset( $locations['footer'] );
// A partial registry must not cause new inserts before noticing a live menu assignment.
$stateKey = 'figmapress_review_' . substr( $result['siteKey'], 13, 40 );
$savedState = $options[$stateKey]; $old = $posts[$copyId];
unset( $options[$stateKey]['pages']['home'], $posts[$copyId] ); $options[$stateKey]['ready'] = false;
$locations['footer'] = $result['menu']['id']; expect_conflict( $input );
unset( $locations['footer'] ); $options[$stateKey] = $savedState; $posts[$copyId] = $old;
$firstItem = $result['menu']['items'][0]['id'];
$items[$result['menu']['id']][$firstItem]->url = 'https://other.example/'; expect_conflict( $input );
$items[$result['menu']['id']][$firstItem]->url = $copy['previewLink'];
unset( $items[$result['menu']['id']][$firstItem] ); expect_conflict( $input );
$changed = $input; $changed['title'] = 'different run content'; expect_conflict( $changed );
$token = 'invalid'; $actor = 0;
check( is_wp_error( figmapress_connector_rest_prepare_review_site_paired( request_for( $input ) ) ), 'paired auth first' );
figmapress_connector_register_review_site_routes();
check( $routes['/sites/review-prepare']['permission_callback'] === 'figmapress_connector_rest_can_build_site', 'protected REST' );
echo json_encode( array( 'pass' => true, 'result' => $result, 'input' => $input, 'cases' => 'nine isolated drafts; interrupted resume; no original writes; immutable retry; conflict gates; write-once saves' ) );
