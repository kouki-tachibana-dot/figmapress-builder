<?php
/** Execute the real PHP callbacks against a write-trapping WordPress double. */
define( 'ABSPATH', __DIR__ );
define( 'ARRAY_A', 'ARRAY_A' );
define( 'DAY_IN_SECONDS', 86400 );
define( 'HOUR_IN_SECONDS', 3600 );
class WP_REST_Server { const CREATABLE = 'POST'; }
class WP_Error {
    public $code; public $message; public $data;
    function __construct( $code, $message, $data ) { $this->code = $code; $this->message = $message; $this->data = $data; }
}
class WP_REST_Request {
    public $params = array(); public $json;
    function __construct( $method = '', $route = '' ) {}
    function get_json_params() { return $this->json; }
    function get_param( $key ) { return $this->params[$key] ?? null; }
    function set_param( $key, $value ) { $this->params[$key] = $value; }
}
class ResponseDouble {
    public $data; public $headers = array();
    function __construct( $data ) { $this->data = $data; }
    function header( $key, $value ) { $this->headers[$key] = $value; }
}
function add_action( ...$args ) { $GLOBALS['actions'][] = $args; }
function add_filter( ...$args ) {}
function register_rest_route( $namespace, $path, $args ) { $GLOBALS['routes'][$path] = $args; }
function rest_ensure_response( $data ) { return new ResponseDouble( $data ); }
function get_current_user_id() { return $GLOBALS['actor']; }
function absint( $value ) { return abs( (int) $value ); }
function user_can( $actor, $capability, $id = 0 ) { return $actor === 7 && ( $capability === 'edit_pages' || ( $capability === 'edit_post' && empty( $GLOBALS['denied'][$id] ) ) ); }
function get_post_stati() { return array( 'draft', 'pending', 'publish', 'private', 'future', 'trash', 'auto-draft', 'custom-live' ); }
function get_posts( $args ) {
    $GLOBALS['queries'][] = $args;
    return array_slice( array_keys( array_filter( $GLOBALS['posts'], function( $p ) use ( $args ) {
        return $p['source'] === $args['meta_value'] && in_array( $p['status'], $args['post_status'], true );
    } ) ), 0, $args['posts_per_page'] );
}
function get_post_status( $id ) { return $GLOBALS['posts'][$id]['status']; }
function get_post_field( $field, $id, $context ) { return $GLOBALS['posts'][$id][$field]; }
function admin_url( $path ) { return 'https://wp.example/subdir/wp-admin/' . $path; }
function get_preview_post_link( $id ) { return 'https://wp.example/subdir/?page_id=' . $id . '&preview=true'; }
function get_permalink( $id ) { return 'https://wp.example/subdir/?page_id=' . $id; }
function wp_insert_post( ...$args ) { throw new Exception( 'WRITE: insert' ); }
function wp_update_post( ...$args ) { throw new Exception( 'WRITE: update' ); }
function update_post_meta( ...$args ) { throw new Exception( 'WRITE: postmeta' ); }
function update_user_meta( ...$args ) { throw new Exception( 'WRITE: usermeta' ); }
function figmapress_connector_sync_site_menu( ...$args ) { throw new Exception( 'WRITE: menu' ); }
function figmapress_connector_site_base_key_pattern() { return '/^figma:[A-Za-z0-9_-]{6,160}:(?:root|[0-9]+:[0-9]+)$/'; }
function get_user_by( $key, $id ) { return $id === 7; }
function wp_salt( $key ) { return 'test-only-salt'; }
function get_user_meta( $id, $key, $single ) {
    return array( '_figmapress_pairing_token_hash' => hash_hmac( 'sha256', $GLOBALS['token'], 'test-only-salt' ), '_figmapress_pairing_expires_at' => time() + 1000, '_figmapress_pairing_last_used' => 0 )[$key] ?? '';
}
function wp_unslash( $value ) { return stripslashes( $value ); }
class DatabaseDouble {
    public $postmeta = 'wp_postmeta';
    function prepare( $sql, $id ) { return $id; }
    function get_results( $id, $format ) { return $GLOBALS['posts'][$id]['meta']; }
}
$wpdb = new DatabaseDouble();
require __DIR__ . '/../../wordpress-plugin/figmapress-connector/includes/pairing.php';
require __DIR__ . '/../../wordpress-plugin/figmapress-connector/includes/site-map.php';
function check( $condition, $message ) { if ( ! $condition ) throw new Exception( $message ); }
$site = 'figma:Example123:root';
$input = array( 'siteKey' => $site, 'pages' => array() );
foreach ( array( 'home', 'company', 'reasons', 'services', 'works', 'demolition', 'news', 'contact', 'officers' ) as $i => $key ) {
    $source = $key === 'home' ? $site : $site . ':page:' . $key;
    $input['pages'][] = array( 'key' => $key, 'sourceKey' => $source );
    $posts[$i+41] = array( 'source' => $source, 'status' => 'draft', 'post_title' => $key . ' manually edited', 'post_name' => $key,
        'meta' => array( array( 'meta_key' => '_figmapress_source_key', 'meta_value' => $source ), array( 'meta_key' => '_figmapress_site_key', 'meta_value' => $site ), array( 'meta_key' => '_figmapress_page_key', 'meta_value' => $key ) ) );
}
$original = $posts;
$actor = 7; $queries = array(); $denied = array();
$request = new WP_REST_Request(); $request->json = $input;
$response = figmapress_connector_rest_lookup_site( $request );
check( $response->data['status'] === 'ready' && count( $response->data['pages'] ) === 9, 'all nine resolved' );
check( $response->data['readOnly'] && $response->headers['Cache-Control'] === 'no-store, private', 'read-only uncached response' );
check( $posts === $original && $response->data['pages'][0]['updated'] === false, 'no mutations' );
check( $queries[0]['posts_per_page'] === 2 && $queries[0]['update_post_meta_cache'] === false, 'bounded metadata lookup' );
check( in_array( 'custom-live', $queries[0]['post_status'], true ), 'custom statuses must not hide conflicts' );
foreach ( array( 'missing', 'duplicate', 'not_draft', 'forbidden', 'identity_mismatch' ) as $reason ) {
    $posts = $original; $denied = array();
    if ( $reason === 'missing' ) unset( $posts[41] );
    if ( $reason === 'duplicate' ) $posts[100] = $posts[41];
    if ( $reason === 'not_draft' ) $posts[41]['status'] = 'publish';
    if ( $reason === 'forbidden' ) $denied[41] = true;
    if ( $reason === 'identity_mismatch' ) $posts[41]['meta'][1]['meta_value'] = 'figma:Other123:root';
    $result = figmapress_connector_rest_lookup_site( $request )->data;
    check( $result['status'] === 'unresolved' && $result['unresolved'] === array( array( 'key' => 'home', 'reason' => $reason ) ), $reason );
    check( count( $result['pages'] ) === 8, 'omit conflicted page metadata' );
}
$posts = $original; $denied = array();
foreach ( array( 'empty', 'duplicate', 'foreign', 'extra', 'type' ) as $invalid ) {
    $request->json = $input; $queries = array();
    if ( $invalid === 'empty' ) $request->json['pages'] = array();
    if ( $invalid === 'duplicate' ) $request->json['pages'][] = $input['pages'][0];
    if ( $invalid === 'foreign' ) $request->json['pages'][0]['sourceKey'] = 'figma:Other123:root';
    if ( $invalid === 'extra' ) $request->json['status'] = 'publish';
    if ( $invalid === 'type' ) $request->json['pages'][0]['key'] = array();
    $error = figmapress_connector_rest_lookup_site( $request );
    check( $error instanceof WP_Error && $error->data['status'] === 422 && ! $queries, 'validate before lookup: ' . $invalid );
}
$request->json = $input;
foreach ( array( 0, 8 ) as $actor ) {
    $queries = array();
    $error = figmapress_connector_rest_lookup_site( $request );
    check( $error instanceof WP_Error && ! $queries, 'authentication before lookup' );
}
$actor = 0; $token = 'fp1.7.' . str_repeat( 'a', 43 );
$_SERVER['HTTP_X_FIGMAPRESS_TOKEN'] = $token;
$request->json = null; $request->set_param( 'payload', json_encode( $input ) );
$response = figmapress_connector_rest_lookup_site_paired( $request );
check( $response->data['status'] === 'ready' && $actor === 0, 'explicit pairing actor, no session or last-used write' );
$_SERVER['HTTP_X_FIGMAPRESS_TOKEN'] = 'invalid'; $queries = array();
$error = figmapress_connector_rest_lookup_site_paired( $request );
check( $error instanceof WP_Error && $error->data['status'] === 401 && ! $queries, 'reject invalid paired token' );
$_GET['rest_route'] = '/figmapress/v1/paired/site-map';
check( figmapress_connector_is_manual_pairing_request(), 'avoid implicit user session on lookup' );
figmapress_connector_register_site_map_routes();
check( $routes['/sites/lookup']['permission_callback'] === 'figmapress_connector_rest_can_edit_pages', 'REST capability guard' );
check( $routes['/paired/site-map']['callback'] === 'figmapress_connector_rest_lookup_site_paired', 'paired authenticated callback' );
echo "PASS: nine-page lookup; five conflict classes; input validation; authentication; no writes\n";
