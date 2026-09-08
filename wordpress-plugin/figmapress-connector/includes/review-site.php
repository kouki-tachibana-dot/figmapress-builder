<?php
/** Isolated review drafts: insert only; retries must never repair/overwrite edits. */
if ( ! defined( 'ABSPATH' ) ) { exit; }

function figmapress_connector_review_error( $message, $status = 409 ) {
    return new WP_Error( 'figmapress_review_conflict', $message, array( 'status' => $status ) );
}

function figmapress_connector_review_params( WP_REST_Request $request ) {
    $params = $request->get_json_params();
    if ( ! is_array( $params ) ) {
        $payload = $request->get_param( 'payload' );
        $params = is_string( $payload ) ? json_decode( $payload, true ) : null;
    }
    if ( ! is_array( $params ) || array_diff( array_keys( $params ), array( 'siteKey', 'reviewId', 'title', 'pages' ) )
        || ! isset( $params['siteKey'], $params['reviewId'], $params['title'], $params['pages'] )
        || ! is_string( $params['siteKey'] ) || ! preg_match( figmapress_connector_site_base_key_pattern(), $params['siteKey'] )
        || strpos( $params['siteKey'], 'figma:review-' ) === 0
        || ! is_string( $params['reviewId'] ) || ! preg_match( '/^[a-f0-9]{32}$/', $params['reviewId'] )
        || ! is_string( $params['title'] ) || '' === trim( $params['title'] ) || strlen( $params['title'] ) > 600
        || ! is_array( $params['pages'] ) || count( $params['pages'] ) < 2 || count( $params['pages'] ) > 20 ) {
        return figmapress_connector_review_error( '検証コピーの入力内容が無効です。', 422 );
    }
    $keys = array(); $ids = array();
    foreach ( $params['pages'] as $page ) {
        if ( ! is_array( $page ) || array_diff( array_keys( $page ), array( 'key', 'title', 'slug', 'originalId' ) )
            || ! isset( $page['key'], $page['title'], $page['slug'], $page['originalId'] )
            || ! is_string( $page['key'] ) || ! preg_match( '/^[a-z0-9][a-z0-9-]{0,79}$/', $page['key'] ) || isset( $keys[$page['key']] )
            || ! is_string( $page['title'] ) || '' === trim( $page['title'] ) || strlen( $page['title'] ) > 600
            || ! is_string( $page['slug'] ) || '' === sanitize_title( $page['slug'] ) || strlen( $page['slug'] ) > 600
            || ! is_int( $page['originalId'] ) || $page['originalId'] < 1 || isset( $ids[$page['originalId']] ) ) {
            return figmapress_connector_review_error( '検証対象ページが無効・重複しています。', 422 );
        }
        $keys[$page['key']] = true; $ids[$page['originalId']] = true;
    }
    if ( ! isset( $keys['home'] ) ) return figmapress_connector_review_error( 'ホームページの指定が必要です。', 422 );
    // Canonicalize JSON property order for stable retries across transports.
    return array( 'siteKey' => $params['siteKey'], 'reviewId' => $params['reviewId'], 'title' => $params['title'],
        'pages' => array_map( static function( $p ) { return array( 'key' => $p['key'], 'title' => $p['title'], 'slug' => $p['slug'], 'originalId' => $p['originalId'] ); }, $params['pages'] ) );
}

/** Read only selected identity metadata, not multi-megabyte Elementor data. */
function figmapress_connector_review_meta( $id ) {
    global $wpdb;
    $rows = $wpdb->get_results( $wpdb->prepare(
        "SELECT meta_key, meta_value FROM {$wpdb->postmeta} WHERE post_id = %d AND meta_key IN ('_figmapress_source_key', '_figmapress_site_key', '_figmapress_page_key', '_figmapress_review_id', '_figmapress_review_original', '_figmapress_review_actor', '_figmapress_prepared', '_figmapress_media_total')", $id ), ARRAY_A );
    $meta = array();
    foreach ( $rows as $row ) {
        if ( isset( $meta[$row['meta_key']] ) ) return array();
        $meta[$row['meta_key']] = (string) $row['meta_value'];
    }
    return $meta;
}

function figmapress_connector_review_store( $key, $state ) {
    update_option( $key, $state, false );
    return get_option( $key ) === $state;
}

function figmapress_connector_review_page_title( $review_id, $title ) {
    // Leave space for the review label even when every character is a UTF-16
    // surrogate pair (the browser/API title limit is 200 code units).
    return '[検証 ' . substr( $review_id, 0, 8 ) . '] ' . wp_html_excerpt( sanitize_text_field( $title ), 80, '…' );
}

function figmapress_connector_review_menu_is_private( $menu_id, $site ) {
    return wp_get_nav_menu_object( $menu_id ) && get_term_meta( $menu_id, '_figmapress_site_key', true ) === $site
        && ! in_array( $menu_id, array_map( 'absint', get_nav_menu_locations() ), true );
}

function figmapress_connector_review_page_matches( $id, $site, $input, $page, $actor ) {
    $m = figmapress_connector_review_meta( $id );
    $source = 'home' === $page['key'] ? $site : $site . ':page:' . $page['key'];
    return 'draft' === get_post_status( $id ) && user_can( $actor, 'edit_post', $id ) && $id !== $page['originalId']
        && ( $m['_figmapress_source_key'] ?? '' ) === $source && ( $m['_figmapress_site_key'] ?? '' ) === $site
        && ( $m['_figmapress_page_key'] ?? '' ) === $page['key'] && ( $m['_figmapress_review_id'] ?? '' ) === $input['reviewId']
        && ( $m['_figmapress_review_original'] ?? '' ) === (string) $page['originalId'] && ( $m['_figmapress_review_actor'] ?? '' ) === (string) $actor;
}

function figmapress_connector_rest_prepare_review_site( WP_REST_Request $request, $actor_user_id = 0 ) {
    $actor = $actor_user_id ? absint( $actor_user_id ) : get_current_user_id();
    if ( ! $actor || ! user_can( $actor, 'edit_pages' ) || ! user_can( $actor, 'edit_theme_options' ) || ! user_can( $actor, 'unfiltered_html' ) ) {
        return figmapress_connector_review_error( '検証コピーとメニューを作成する権限がありません。', $actor ? 403 : 401 );
    }
    $input = figmapress_connector_review_params( $request );
    if ( is_wp_error( $input ) ) return $input;
    $hash = substr( hash( 'sha256', $input['siteKey'] . '|' . $input['reviewId'] ), 0, 40 );
    $site = 'figma:review-' . $hash . ':root';
    $state_key = 'figmapress_review_' . $hash;
    $input_hash = hash( 'sha256', wp_json_encode( $input ) );
    $lock_key = $state_key . '_lock';
    $token = wp_generate_uuid4();
    if ( ! add_option( $lock_key, array( 'token' => $token ), '', false ) ) {
        return figmapress_connector_review_error( '同じ検証コピーを準備中です。終了後に再試行してください。' );
    }
    // No time-based lock stealing: a slow request must not overlap a replay.
    figmapress_connector_register_request_lock_cleanup( $lock_key, $token );
    try {
        $state = get_option( $state_key );
        if ( $state && ( ! is_array( $state ) || ( $state['inputHash'] ?? '' ) !== $input_hash || ( $state['actor'] ?? 0 ) !== $actor ) ) {
            return figmapress_connector_review_error( '同じ検証IDの構成または所有者が異なります。新しい検証を開始してください。' );
        }
        if ( ! empty( $state['menuId'] ) && ! figmapress_connector_review_menu_is_private( $state['menuId'], $site ) ) {
            return figmapress_connector_review_error( '検証メニューが削除・変更・公開割当されています。更新しません。' );
        }
        // Re-resolve originals immediately before writes. The supplied IDs are
        // evidence, never instructions to update those posts.
        $lookup = new WP_REST_Request( 'POST', '/figmapress/v1/sites/lookup' );
        $lookup->set_body( wp_json_encode( array( 'siteKey' => $input['siteKey'], 'pages' => array_map( static function( $p ) use ( $input ) {
            return array( 'key' => $p['key'], 'sourceKey' => 'home' === $p['key'] ? $input['siteKey'] : $input['siteKey'] . ':page:' . $p['key'] );
        }, $input['pages'] ) ) ) );
        $lookup->set_header( 'content-type', 'application/json' );
        $originals = figmapress_connector_rest_lookup_site( $lookup, $actor );
        if ( is_wp_error( $originals ) ) return $originals;
        $originals = $originals->get_data();
        if ( 'ready' !== $originals['status'] ) return figmapress_connector_review_error( '元ページの対応が変わりました。読み取り専用対応表を再取得してください。' );
        foreach ( $input['pages'] as $i => $page ) {
            if ( $originals['pages'][$i]['key'] !== $page['key'] || $originals['pages'][$i]['id'] !== $page['originalId'] ) {
                return figmapress_connector_review_error( '元ページIDが一致しません。元ページは変更していません。' );
            }
        }
        if ( ! $state ) {
            $state = array( 'inputHash' => $input_hash, 'actor' => $actor, 'reviewId' => $input['reviewId'], 'originalSiteKey' => $input['siteKey'],
                'pages' => array(), 'pageInputs' => $input['pages'], 'menuId' => 0, 'ready' => false );
            if ( ! add_option( $state_key, $state, '', false ) ) return figmapress_connector_review_error( '検証記録を作成できませんでした。' );
        }
        // Validate ALL existing copies before creating any missing pages.
        $existing = array();
        foreach ( $input['pages'] as $page ) {
            $source = 'home' === $page['key'] ? $site : $site . ':page:' . $page['key'];
            $ids = get_posts( array( 'post_type' => 'page', 'post_status' => array_values( get_post_stati() ),
                'meta_key' => '_figmapress_source_key', 'meta_value' => $source, 'fields' => 'ids', 'posts_per_page' => 2,
                'update_post_meta_cache' => false, 'update_post_term_cache' => false ) );
            $id = count( $ids ) === 1 ? absint( $ids[0] ) : 0;
            if ( count( $ids ) > 1 || ( isset( $state['pages'][$page['key']] ) && $state['pages'][$page['key']] !== $id ) ) {
                return figmapress_connector_review_error( '検証コピーが削除・重複しています。自動補完は行いません。' );
            }
            if ( $id ) {
                if ( ! figmapress_connector_review_page_matches( $id, $site, $input, $page, $actor ) ) {
                    return figmapress_connector_review_error( '検証コピーの状態・識別子・権限が変わりました。上書きしません。' );
                }
            }
            $existing[$page['key']] = $id;
        }
        $pages = array();
        foreach ( $input['pages'] as $page ) {
            $source = 'home' === $page['key'] ? $site : $site . ':page:' . $page['key'];
            $id = $existing[$page['key']]; $created = false;
            if ( ! $id ) {
                $id = wp_insert_post( array( 'post_type' => 'page', 'post_status' => 'draft', 'post_author' => $actor,
                    'post_title' => wp_slash( figmapress_connector_review_page_title( $input['reviewId'], $page['title'] ) ),
                    'post_name' => sanitize_title( $page['slug'] ) . '-review-' . substr( $input['reviewId'], 0, 8 ), 'post_content' => '',
                    'meta_input' => array( '_figmapress_source_key' => $source, '_figmapress_site_key' => $site, '_figmapress_page_key' => $page['key'],
                        '_figmapress_review_id' => $input['reviewId'], '_figmapress_review_original' => $page['originalId'], '_figmapress_review_actor' => $actor,
                        '_figmapress_prepared' => '1' ) ), true );
                if ( is_wp_error( $id ) ) return $id;
                if ( ! $id ) return figmapress_connector_review_error( '検証コピーを作成できませんでした。' );
                $created = true;
            }
            if ( ! figmapress_connector_review_page_matches( $id, $site, $input, $page, $actor ) ) {
                return figmapress_connector_review_error( '作成後の下書き状態・識別子を確認できませんでした。処理を停止しました。' );
            }
            $state['pages'][$page['key']] = absint( $id );
            if ( ! figmapress_connector_review_store( $state_key, $state ) ) return figmapress_connector_review_error( '検証コピーの記録を保存できませんでした。' );
            $pages[] = array( 'key' => $page['key'], 'id' => absint( $id ), 'originalId' => $page['originalId'], 'sourceKey' => $source,
                'requestId' => substr( hash( 'sha256', $source ), 0, 32 ), 'title' => get_post_field( 'post_title', $id, 'raw' ),
                'slug' => get_post_field( 'post_name', $id, 'raw' ), 'status' => 'draft', 'created' => $created, 'updated' => false,
                'editLink' => admin_url( 'post.php?post=' . $id . '&action=elementor' ), 'previewLink' => get_preview_post_link( $id ), 'rawLink' => get_permalink( $id ) );
        }
        $menu = figmapress_connector_review_menu( $site, $input, $pages, $state_key, $state );
        if ( is_wp_error( $menu ) ) return $menu;
        $state['ready'] = true;
        if ( ! figmapress_connector_review_store( $state_key, $state ) ) return figmapress_connector_review_error( '検証メニューの記録を保存できませんでした。' );
        $response = rest_ensure_response( array( 'review' => true, 'reviewId' => $input['reviewId'], 'originalSiteKey' => $input['siteKey'],
            'siteKey' => $site, 'title' => $input['title'], 'status' => 'draft', 'pages' => $pages, 'menu' => $menu,
            'warnings' => array( '検証コピーの入れ物を準備しました。本文保存・表示・機能の確認は別工程です。元ページは変更していません。' ) ) );
        $response->header( 'Cache-Control', 'no-store, private' );
        return $response;
    } finally {
        $lock = get_option( $lock_key );
        if ( is_array( $lock ) && ( $lock['token'] ?? '' ) === $token ) delete_option( $lock_key );
    }
}

/** New custom links point to authenticated draft previews, never guessed slugs. */
function figmapress_connector_review_menu( $site, $input, $pages, $state_key, &$state ) {
    if ( ! function_exists( 'wp_create_nav_menu' ) ) require_once ABSPATH . 'wp-admin/includes/nav-menu.php';
    $menu_id = $state['menuId'];
    if ( $menu_id ) {
        if ( ! figmapress_connector_review_menu_is_private( $menu_id, $site ) ) {
            return figmapress_connector_review_error( '検証メニューが削除・変更・公開割当されています。更新しません。' );
        }
    } else {
        $menu_id = wp_create_nav_menu( 'FigmaPress review ' . substr( $site, 13, 40 ) );
        if ( is_wp_error( $menu_id ) ) return $menu_id;
        if ( ! add_term_meta( $menu_id, '_figmapress_site_key', $site, true ) ) return figmapress_connector_review_error( '検証メニューの識別子を保存できませんでした。' );
        $state['menuId'] = absint( $menu_id );
        if ( ! figmapress_connector_review_store( $state_key, $state ) ) return figmapress_connector_review_error( '検証メニューを記録できませんでした。' );
    }
    $items = wp_get_nav_menu_items( $menu_id, array( 'post_status' => 'any' ) );
    $by_key = array();
    foreach ( is_array( $items ) ? $items : array() as $item ) {
        $key = (string) get_post_meta( $item->ID, '_figmapress_page_key', true );
        $expected = null;
        foreach ( $pages as $i => $page ) { if ( $page['key'] === $key ) $expected = array( $page, $i ); }
        if ( ! $expected || isset( $by_key[$key] ) || get_post_meta( $item->ID, '_figmapress_site_key', true ) !== $site
            || $item->type !== 'custom' || $item->url !== $expected[0]['previewLink']
            || (string) $item->title !== sanitize_text_field( $input['pages'][$expected[1]]['title'] )
            || (int) $item->menu_order !== $expected[1] + 1 || (int) $item->menu_item_parent !== 0 || $item->post_status !== 'publish' ) {
            return figmapress_connector_review_error( '検証メニューに手修正または不明な項目があります。上書きしません。' );
        }
        $by_key[$key] = absint( $item->ID );
    }
    if ( $state['ready'] && count( $by_key ) !== count( $pages ) ) return figmapress_connector_review_error( '検証メニューの項目が削除されています。補完しません。' );
    $result = array();
    foreach ( $pages as $i => $page ) {
        $key = $page['key']; $title = sanitize_text_field( $input['pages'][$i]['title'] );
        $item_id = $by_key[$key] ?? 0;
        if ( ! $item_id ) {
            $item_id = wp_update_nav_menu_item( $menu_id, 0, array( 'menu-item-title' => wp_slash( $title ),
                'menu-item-url' => $page['previewLink'], 'menu-item-type' => 'custom', 'menu-item-status' => 'publish', 'menu-item-position' => $i + 1 ) );
            if ( is_wp_error( $item_id ) ) return $item_id;
            if ( ! add_post_meta( $item_id, '_figmapress_site_key', $site, true ) || ! add_post_meta( $item_id, '_figmapress_page_key', $key, true ) ) {
                return figmapress_connector_review_error( '検証メニュー項目の識別子を保存できませんでした。' );
            }
        }
        $result[] = array( 'id' => absint( $item_id ), 'pageId' => $page['id'], 'key' => $key, 'title' => $title, 'rawLink' => $page['previewLink'] );
    }
    return array( 'id' => absint( $menu_id ), 'name' => wp_get_nav_menu_object( $menu_id )->name,
        'editLink' => admin_url( 'nav-menus.php?action=edit&menu=' . $menu_id ), 'assigned' => false, 'assignedLocations' => array(), 'items' => $result );
}

/** A review copy is write-once through conversion. Replay confirms, not replaces. */
function figmapress_connector_review_save_guard( $source, $request_id, $id ) {
    if ( strpos( $source, 'figma:review-' ) !== 0 ) return true;
    if ( ! preg_match( '/^figma:review-([a-f0-9]{40}):root(?::page:([a-z0-9-]{1,80}))?$/', $source, $match ) ) {
        return figmapress_connector_review_error( '検証コピーの保存先が無効です。' );
    }
    $state = get_option( 'figmapress_review_' . $match[1] );
    $key = $match[2] ?? 'home';
    $actor = get_current_user_id();
    if ( ! is_array( $state ) || empty( $state['ready'] ) || $state['actor'] !== $actor
        || ! $id || ( $state['pages'][$key] ?? 0 ) !== $id || $request_id !== substr( hash( 'sha256', $source ), 0, 32 ) ) {
        return figmapress_connector_review_error( '登録済みの検証コピー以外には保存できません。' );
    }
    $page = null;
    foreach ( $state['pageInputs'] as $candidate ) { if ( $candidate['key'] === $key ) $page = $candidate; }
    $site = 'figma:review-' . $match[1] . ':root';
    if ( ! $page || ! figmapress_connector_review_page_matches( $id, $site, $state, $page, $actor ) ) {
        return figmapress_connector_review_error( '検証コピーの状態が変わりました。上書きしません。' );
    }
    $bytes = figmapress_connector_elementor_storage_bytes( $id );
    $m = figmapress_connector_review_meta( $id );
    if ( 0 === $bytes && ( $m['_figmapress_prepared'] ?? '' ) === '1'
        && '' === get_post_field( 'post_content', $id, 'raw' )
        && get_post_field( 'post_title', $id, 'raw' ) === figmapress_connector_review_page_title( $state['reviewId'], $page['title'] ) ) return true;
    $receipt = figmapress_connector_elementor_storage_receipt( $id );
    $hash = figmapress_connector_elementor_storage_hash( $id );
    if ( $bytes < 100 || ( $receipt['_figmapress_stored_request_id'] ?? '' ) !== $request_id
        || ( $receipt['_figmapress_stored_source_key'] ?? '' ) !== $source
        || (int) ( $receipt['_figmapress_stored_bytes'] ?? 0 ) !== $bytes
        || '' === $hash || ( $receipt['_figmapress_stored_hash'] ?? '' ) !== $hash ) {
        return figmapress_connector_review_error( '検証コピーに手修正または保存不整合があります。再変換で上書きせず、新しい検証を開始してください。' );
    }
    // This receipt performs no title/content/meta/cache mutation.
    return rest_ensure_response( array_merge( array( 'id' => $id, 'slug' => get_post_field( 'post_name', $id, 'raw' ),
        'status' => 'draft', 'target' => 'elementor', 'storedElements' => 1, 'storedBytes' => $bytes,
        'editLink' => admin_url( 'post.php?post=' . $id . '&action=elementor' ), 'previewLink' => get_preview_post_link( $id ),
        'rawLink' => get_permalink( $id ), 'idempotent' => true, 'updated' => false,
        'warnings' => array( '保存済みの検証コピーを確認しました。本文は再保存していません。' ) ),
        figmapress_connector_deferred_media_progress( absint( $m['_figmapress_media_total'] ?? 0 ) ) ) );
}

function figmapress_connector_rest_prepare_review_site_paired( WP_REST_Request $request ) {
    $actor = figmapress_connector_verify_pairing_token( figmapress_connector_pairing_token_from_request(), false );
    if ( ! $actor ) return figmapress_connector_review_error( '認証が必要です。', 401 );
    return figmapress_connector_rest_prepare_review_site( $request, $actor );
}
function figmapress_connector_register_review_site_routes() {
    register_rest_route( 'figmapress/v1', '/sites/review-prepare', array( 'methods' => WP_REST_Server::CREATABLE,
        'callback' => 'figmapress_connector_rest_prepare_review_site', 'permission_callback' => 'figmapress_connector_rest_can_build_site' ) );
    register_rest_route( 'figmapress/v1', '/paired/review-prepare', array( 'methods' => WP_REST_Server::CREATABLE,
        'callback' => 'figmapress_connector_rest_prepare_review_site_paired', 'permission_callback' => '__return_true' ) );
}
add_action( 'rest_api_init', 'figmapress_connector_register_review_site_routes' );
function figmapress_connector_admin_post_prepare_review_site() {
    $request = new WP_REST_Request( 'POST', '/figmapress/v1/paired/review-prepare' );
    $request->set_param( 'payload', isset( $_POST['payload'] ) ? wp_unslash( $_POST['payload'] ) : '' );
    $result = figmapress_connector_rest_prepare_review_site_paired( $request );
    nocache_headers();
    if ( is_wp_error( $result ) ) {
        $data = $result->get_error_data();
        wp_send_json( array( 'code' => $result->get_error_code(), 'message' => $result->get_error_message(), 'data' => $data ), $data['status'] ?? 500 );
    }
    wp_send_json( $result->get_data() );
}
foreach ( array( 'admin_post_', 'admin_post_nopriv_', 'wp_ajax_', 'wp_ajax_nopriv_' ) as $prefix ) {
    add_action( $prefix . 'figmapress_review_prepare', 'figmapress_connector_admin_post_prepare_review_site' );
}
