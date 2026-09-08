<?php
/** Read-only source identity lookup. Never prepare pages or synchronize menus. */
if ( ! defined( 'ABSPATH' ) ) {
    exit;
}

function figmapress_connector_register_site_map_routes() {
    register_rest_route( 'figmapress/v1', '/sites/lookup', array(
        'methods' => WP_REST_Server::CREATABLE,
        'callback' => 'figmapress_connector_rest_lookup_site',
        'permission_callback' => 'figmapress_connector_rest_can_edit_pages',
    ) );
    register_rest_route( 'figmapress/v1', '/paired/site-map', array(
        'methods' => WP_REST_Server::CREATABLE,
        'callback' => 'figmapress_connector_rest_lookup_site_paired',
        // Authentication is explicit so shared-host security cannot turn a
        // scoped pairing token into a cookie-less administrator session.
        'permission_callback' => '__return_true',
    ) );
}
add_action( 'rest_api_init', 'figmapress_connector_register_site_map_routes' );

function figmapress_connector_rest_lookup_site_paired( WP_REST_Request $request ) {
    $actor = figmapress_connector_verify_pairing_token( figmapress_connector_pairing_token_from_request(), false );
    if ( ! $actor ) {
        return new WP_Error( 'figmapress_auth_required', '認証が必要です。', array( 'status' => 401 ) );
    }
    return figmapress_connector_rest_lookup_site( $request, $actor );
}

function figmapress_connector_admin_post_lookup_site() {
    $request = new WP_REST_Request( 'POST', '/figmapress/v1/paired/site-map' );
    $request->set_param( 'payload', isset( $_POST['payload'] ) ? wp_unslash( $_POST['payload'] ) : '' );
    $result = figmapress_connector_rest_lookup_site_paired( $request );
    nocache_headers();
    if ( is_wp_error( $result ) ) {
        $data = $result->get_error_data();
        wp_send_json( array( 'code' => $result->get_error_code(), 'message' => $result->get_error_message(), 'data' => $data ), isset( $data['status'] ) ? $data['status'] : 500 );
    }
    wp_send_json( $result->get_data() );
}
foreach ( array( 'admin_post_', 'admin_post_nopriv_', 'wp_ajax_', 'wp_ajax_nopriv_' ) as $prefix ) {
    add_action( $prefix . 'figmapress_site_lookup', 'figmapress_connector_admin_post_lookup_site' );
}

function figmapress_connector_rest_lookup_site( WP_REST_Request $request, $actor_user_id = 0 ) {
    global $wpdb;
    $actor = $actor_user_id ? absint( $actor_user_id ) : get_current_user_id();
    if ( ! $actor || ! user_can( $actor, 'edit_pages' ) ) {
        return new WP_Error( 'figmapress_map_permission_required', 'ページ対応表を確認する権限がありません。', array( 'status' => $actor ? 403 : 401 ) );
    }
    $params = $request->get_json_params();
    if ( ! is_array( $params ) ) {
        $payload = $request->get_param( 'payload' );
        $params = is_string( $payload ) ? json_decode( $payload, true ) : null;
    }
    if ( ! is_array( $params ) || array_diff( array_keys( $params ), array( 'siteKey', 'pages' ) )
        || ! isset( $params['siteKey'], $params['pages'] ) || ! is_string( $params['siteKey'] )
        || ! preg_match( figmapress_connector_site_base_key_pattern(), $params['siteKey'] )
        || ! is_array( $params['pages'] ) || count( $params['pages'] ) < 1 || count( $params['pages'] ) > 20 ) {
        return new WP_Error( 'figmapress_invalid_site_map', 'ページ対応表の入力内容が無効です。', array( 'status' => 422 ) );
    }
    $site_key = $params['siteKey'];
    $seen = array();
    foreach ( $params['pages'] as $page ) {
        if ( ! is_array( $page ) || array_diff( array_keys( $page ), array( 'key', 'sourceKey' ) )
            || ! isset( $page['key'], $page['sourceKey'] ) || ! is_string( $page['key'] ) || ! is_string( $page['sourceKey'] )
            || ! preg_match( '/^[a-z0-9][a-z0-9-]{0,79}$/', $page['key'] ) || isset( $seen[ $page['key'] ] )
            || $page['sourceKey'] !== ( 'home' === $page['key'] ? $site_key : $site_key . ':page:' . $page['key'] ) ) {
            return new WP_Error( 'figmapress_invalid_site_map', 'ページ識別子が一致しないか重複しています。', array( 'status' => 422 ) );
        }
        $seen[ $page['key'] ] = true;
    }
    $pages = array();
    $unresolved = array();
    foreach ( $params['pages'] as $page ) {
        $ids = get_posts( array(
            'post_type' => 'page',
            'post_status' => array_values( array_diff( get_post_stati(), array( 'trash', 'auto-draft', 'inherit' ) ) ),
            'posts_per_page' => 2,
            'fields' => 'ids',
            'meta_key' => '_figmapress_source_key',
            'meta_value' => $page['sourceKey'],
            'orderby' => 'ID', 'order' => 'ASC',
            'update_post_meta_cache' => false, 'update_post_term_cache' => false,
        ) );
        $reason = '';
        $id = count( $ids ) === 1 ? absint( $ids[0] ) : 0;
        if ( ! $ids ) {
            $reason = 'missing';
        } elseif ( count( $ids ) > 1 ) {
            $reason = 'duplicate';
        } elseif ( ! user_can( $actor, 'edit_post', $id ) ) {
            $reason = 'forbidden';
        } elseif ( 'draft' !== get_post_status( $id ) ) {
            $reason = 'not_draft';
        } else {
            // Do not prime all postmeta: existing Elementor data may be MBs.
            $rows = $wpdb->get_results( $wpdb->prepare(
                "SELECT meta_key, meta_value FROM {$wpdb->postmeta} WHERE post_id = %d AND meta_key IN ('_figmapress_source_key', '_figmapress_site_key', '_figmapress_page_key')",
                $id
            ), ARRAY_A );
            $identity = array();
            foreach ( $rows as $row ) {
                if ( isset( $identity[ $row['meta_key'] ] ) ) { $reason = 'identity_mismatch'; }
                $identity[ $row['meta_key'] ] = $row['meta_value'];
            }
            if ( ( $identity['_figmapress_source_key'] ?? '' ) !== $page['sourceKey']
                || ( $identity['_figmapress_site_key'] ?? '' ) !== $site_key
                || ( $identity['_figmapress_page_key'] ?? '' ) !== $page['key'] ) {
                $reason = 'identity_mismatch';
            }
        }
        if ( $reason ) {
            // No IDs, titles or URLs from inaccessible/ambiguous pages leak.
            $unresolved[] = array( 'key' => $page['key'], 'reason' => $reason );
            continue;
        }
        $pages[] = array(
            'key' => $page['key'], 'id' => $id, 'sourceKey' => $page['sourceKey'], 'status' => 'draft',
            'title' => get_post_field( 'post_title', $id, 'raw' ), 'slug' => get_post_field( 'post_name', $id, 'raw' ),
            'created' => false, 'updated' => false,
            'editLink' => admin_url( 'post.php?post=' . $id . '&action=elementor' ),
            'previewLink' => get_preview_post_link( $id ), 'rawLink' => get_permalink( $id ),
        );
    }
    $response = rest_ensure_response( array(
        'siteKey' => $site_key, 'readOnly' => true,
        'status' => $unresolved ? 'unresolved' : 'ready',
        'pages' => $pages, 'unresolved' => $unresolved,
    ) );
    $response->header( 'Cache-Control', 'no-store, private' );
    return $response;
}
