<?php
/** Authenticated REST endpoints used by FigmaPress Builder. */

if ( ! defined( 'ABSPATH' ) ) {
    exit;
}

/**
 * Restore Application Password authentication on hosts that strip the
 * standard Authorization header before PHP. FigmaPress retries with this
 * connector-specific header only after normal HTTP Basic auth returns 401.
 */
function figmapress_connector_restore_application_password_header( $user_id ) {
    if ( $user_id || ! empty( $_SERVER['PHP_AUTH_USER'] ) || ! empty( $_SERVER['PHP_AUTH_PW'] ) ) {
        return $user_id;
    }

    $authorization = isset( $_SERVER['HTTP_X_FIGMAPRESS_AUTHORIZATION'] )
        ? trim( wp_unslash( $_SERVER['HTTP_X_FIGMAPRESS_AUTHORIZATION'] ) )
        : '';
    if ( 0 !== stripos( $authorization, 'Basic ' ) ) {
        return $user_id;
    }

    $decoded = base64_decode( substr( $authorization, 6 ), true );
    if ( false === $decoded || false === strpos( $decoded, ':' ) ) {
        return $user_id;
    }

    list( $username, $password ) = explode( ':', $decoded, 2 );
    if ( '' === $username || '' === $password ) {
        return $user_id;
    }

    $_SERVER['PHP_AUTH_USER'] = $username;
    $_SERVER['PHP_AUTH_PW']   = $password;
    return $user_id;
}
add_filter( 'determine_current_user', 'figmapress_connector_restore_application_password_header', 19 );

function figmapress_connector_allow_auth_fallback_cors_header( $headers ) {
    $headers[] = 'X-FigmaPress-Authorization';
    return array_values( array_unique( $headers ) );
}
add_filter( 'rest_allowed_cors_headers', 'figmapress_connector_allow_auth_fallback_cors_header' );

function figmapress_connector_register_rest_routes() {
    register_rest_route(
        'figmapress/v1',
        '/status',
        array(
            'methods'             => WP_REST_Server::READABLE,
            'callback'            => 'figmapress_connector_rest_status',
            'permission_callback' => 'figmapress_connector_rest_is_authenticated',
        )
    );
    register_rest_route(
        'figmapress/v1',
        '/auth-diagnostics',
        array(
            'methods'             => WP_REST_Server::READABLE,
            'callback'            => 'figmapress_connector_rest_auth_diagnostics',
            'permission_callback' => '__return_true',
        )
    );
    register_rest_route(
        'figmapress/v1',
        '/gutenberg/pages',
        array(
            'methods'             => WP_REST_Server::CREATABLE,
            'callback'            => 'figmapress_connector_rest_create_gutenberg_page',
            'permission_callback' => 'figmapress_connector_rest_can_edit_pages',
        )
    );
    register_rest_route(
        'figmapress/v1',
        '/sites/prepare',
        array(
            'methods'             => WP_REST_Server::CREATABLE,
            'callback'            => 'figmapress_connector_rest_prepare_site',
            'permission_callback' => 'figmapress_connector_rest_can_build_site',
        )
    );
    register_rest_route(
        'figmapress/v1',
        '/elementor/site-prepare',
        array(
            'methods'             => WP_REST_Server::CREATABLE,
            'callback'            => 'figmapress_connector_rest_prepare_site',
            'permission_callback' => 'figmapress_connector_rest_can_build_site',
        )
    );
    register_rest_route(
        'figmapress/v1',
        '/elementor/pages',
        array(
            'methods'             => WP_REST_Server::CREATABLE,
            'callback'            => 'figmapress_connector_rest_create_elementor_page',
            'permission_callback' => 'figmapress_connector_rest_can_edit_pages',
        )
    );
    register_rest_route(
        'figmapress/v1',
        '/elementor/uploads/(?P<upload>[a-f0-9-]{16,64})',
        array(
            'methods'             => WP_REST_Server::CREATABLE,
            'callback'            => 'figmapress_connector_rest_upload_elementor_page',
            'permission_callback' => 'figmapress_connector_rest_can_edit_pages',
        )
    );
    register_rest_route(
        'figmapress/v1',
        '/elementor/pages/(?P<id>\d+)/stored',
        array(
            'methods'             => WP_REST_Server::CREATABLE,
            'callback'            => 'figmapress_connector_rest_confirm_elementor_page',
            'permission_callback' => 'figmapress_connector_rest_can_edit_requested_page',
        )
    );
    register_rest_route(
        'figmapress/v1',
        '/elementor/pages/(?P<id>\d+)/snapshot',
        array(
            'methods'             => WP_REST_Server::CREATABLE,
            'callback'            => 'figmapress_connector_rest_elementor_snapshot',
            'permission_callback' => 'figmapress_connector_rest_can_edit_requested_page',
        )
    );
    register_rest_route(
        'figmapress/v1',
        '/elementor/pages/(?P<id>\d+)/document',
        array(
            'methods'             => WP_REST_Server::EDITABLE,
            'callback'            => 'figmapress_connector_rest_update_elementor_document',
            'permission_callback' => 'figmapress_connector_rest_can_edit_requested_page',
        )
    );
    register_rest_route(
        'figmapress/v1',
        '/elementor/pages/(?P<id>\d+)/media',
        array(
            'methods'             => WP_REST_Server::CREATABLE,
            'callback'            => 'figmapress_connector_rest_localize_elementor_media',
            'permission_callback' => 'figmapress_connector_rest_can_edit_requested_page',
        )
    );
}
add_action( 'rest_api_init', 'figmapress_connector_register_rest_routes' );

/**
 * Remember whether WordPress attempted Application Password authentication.
 * Only booleans are exposed by the diagnostic route; credentials and errors
 * are never returned or persisted.
 */
function figmapress_connector_record_application_password_failure() {
    $GLOBALS['figmapress_application_password_failed'] = true;
}
add_action( 'application_password_failed_authentication', 'figmapress_connector_record_application_password_failure' );

function figmapress_connector_record_application_password_success() {
    $GLOBALS['figmapress_application_password_succeeded'] = true;
}
add_action( 'application_password_did_authenticate', 'figmapress_connector_record_application_password_success' );

/**
 * The diagnostic endpoint is public and intentionally returns booleans only.
 * Let it run even when WordPress has already recorded a failed Application
 * Password attempt, otherwise core short-circuits the request with HTTP 401
 * before the route callback can report whether the header reached PHP.
 */
function figmapress_connector_allow_auth_diagnostics( $result ) {
    $request_uri = isset( $_SERVER['REQUEST_URI'] ) ? wp_unslash( $_SERVER['REQUEST_URI'] ) : '';
    $rest_route  = isset( $_GET['rest_route'] ) ? wp_unslash( $_GET['rest_route'] ) : '';

    if (
        false !== strpos( $request_uri, '/wp-json/figmapress/v1/auth-diagnostics' ) ||
        '/figmapress/v1/auth-diagnostics' === $rest_route
    ) {
        return null;
    }

    return $result;
}
add_filter( 'rest_authentication_errors', 'figmapress_connector_allow_auth_diagnostics', PHP_INT_MAX );

function figmapress_connector_rest_auth_diagnostics( WP_REST_Request $request ) {
    $authorization = $request->get_header( 'authorization' );
    $fallback_authorization = $request->get_header( 'x_figmapress_authorization' );

    return rest_ensure_response(
        array(
            'connectorVersion'             => FIGMAPRESS_CONNECTOR_VERSION,
            'authorizationHeaderSeen'      => is_string( $authorization ) && '' !== trim( $authorization ),
            'basicAuthorizationSeen'       => is_string( $authorization ) && 0 === stripos( trim( $authorization ), 'Basic ' ),
            'httpAuthorizationServerVar'   => ! empty( $_SERVER['HTTP_AUTHORIZATION'] ),
            'redirectAuthorizationServerVar' => ! empty( $_SERVER['REDIRECT_HTTP_AUTHORIZATION'] ),
            'fallbackAuthorizationHeaderSeen' => is_string( $fallback_authorization ) && '' !== trim( $fallback_authorization ),
            'phpAuthUserSeen'              => ! empty( $_SERVER['PHP_AUTH_USER'] ),
            'phpAuthPasswordSeen'          => ! empty( $_SERVER['PHP_AUTH_PW'] ),
            'applicationPasswordFailed'    => ! empty( $GLOBALS['figmapress_application_password_failed'] ),
            'applicationPasswordSucceeded' => ! empty( $GLOBALS['figmapress_application_password_succeeded'] ),
        )
    );
}

function figmapress_connector_rest_can_edit_pages() {
    return current_user_can( 'edit_pages' );
}

function figmapress_connector_rest_can_build_site() {
    return current_user_can( 'edit_pages' ) && current_user_can( 'edit_theme_options' );
}

function figmapress_connector_rest_can_edit_requested_page( WP_REST_Request $request ) {
    $post_id = absint( $request->get_param( 'id' ) );
    return $post_id > 0 && current_user_can( 'edit_post', $post_id );
}

function figmapress_connector_rest_is_authenticated() {
    if ( is_user_logged_in() ) {
        return true;
    }
    return new WP_Error( 'figmapress_auth_required', 'Authentication is required.', array( 'status' => 401 ) );
}

function figmapress_connector_rest_status() {
    global $wp_version;
    $current_user = wp_get_current_user();
    figmapress_connector_load_elementor_widget_classes();
    return rest_ensure_response(
        array(
            'connectorVersion' => FIGMAPRESS_CONNECTOR_VERSION,
            'wordpressVersion' => $wp_version,
            'canEditPages'      => current_user_can( 'edit_pages' ),
            'user'              => array(
                'id'   => absint( $current_user->ID ),
                'name' => $current_user->display_name
                    ? $current_user->display_name
                    : $current_user->user_login,
            ),
            'pairing'           => array(
                'supported' => true,
                'active'    => ! empty( $GLOBALS['figmapress_pairing_authenticated'] ),
            ),
            'elementor'         => array(
                'active'  => did_action( 'elementor/loaded' ) > 0 || defined( 'ELEMENTOR_VERSION' ),
                'version' => defined( 'ELEMENTOR_VERSION' ) ? ELEMENTOR_VERSION : null,
            ),
            'functionalWidgets' => array(
                'navigation'  => class_exists( 'FigmaPress_Nav_Widget' ),
                'links'       => class_exists( 'FigmaPress_Link_Widget' ),
                'carousel'    => class_exists( 'FigmaPress_Carousel_Widget' ),
                'contactForm' => class_exists( 'FigmaPress_Contact_Form_Widget' ),
                'accordion'   => class_exists( 'FigmaPress_Accordion_Widget' ),
            ),
            'visualQa'          => array(
                'snapshot'       => true,
                'documentUpdate' => true,
                'revisions'      => true,
                'webfonts'       => true,
                'gradients'      => true,
                'effects'        => true,
                'imageTransforms' => true,
                'mediaPersistence' => true,
            ),
            'siteBuild'         => array(
                'pages'  => true,
                'menus'  => current_user_can( 'edit_theme_options' ),
                'bridge' => true,
            ),
        )
    );
}

function figmapress_connector_site_source_key_pattern() {
    return '/^figma:[A-Za-z0-9_-]{6,160}:(?:root|[0-9]+:[0-9]+)(?::page:[a-z0-9-]{1,80})?$/';
}

function figmapress_connector_site_base_key_pattern() {
    return '/^figma:[A-Za-z0-9_-]{6,160}:(?:root|[0-9]+:[0-9]+)$/';
}

function figmapress_connector_find_site_menu( $site_key ) {
    $menus = get_terms(
        array(
            'taxonomy'   => 'nav_menu',
            'hide_empty' => false,
            'number'     => 1,
            'meta_key'   => '_figmapress_site_key',
            'meta_value' => $site_key,
        )
    );
    if ( is_wp_error( $menus ) || empty( $menus ) ) {
        return 0;
    }
    return absint( $menus[0]->term_id );
}

function figmapress_connector_sync_site_menu( $site_key, $menu_name, $pages, $actor_user_id = 0 ) {
    $can_edit_theme_options = $actor_user_id
        ? user_can( $actor_user_id, 'edit_theme_options' )
        : current_user_can( 'edit_theme_options' );
    if ( ! $can_edit_theme_options ) {
        return new WP_Error(
            'figmapress_menu_permission_required',
            'ページは下書き保存しましたが、メニューを管理する権限がありません。',
            array( 'status' => 403 )
        );
    }

    if ( ! function_exists( 'wp_create_nav_menu' ) || ! function_exists( 'wp_update_nav_menu_item' ) ) {
        require_once ABSPATH . 'wp-admin/includes/nav-menu.php';
    }

    $menu_id = figmapress_connector_find_site_menu( $site_key );
    if ( $menu_id ) {
        $updated = wp_update_nav_menu_object(
            $menu_id,
            array( 'menu-name' => $menu_name )
        );
        if ( is_wp_error( $updated ) ) {
            return $updated;
        }
    } else {
        $menu_id = wp_create_nav_menu( $menu_name );
        if ( is_wp_error( $menu_id ) ) {
            return $menu_id;
        }
        update_term_meta( $menu_id, '_figmapress_site_key', $site_key );
    }

    $existing_items = wp_get_nav_menu_items(
        $menu_id,
        array( 'post_status' => array( 'publish', 'draft' ) )
    );
    if ( ! is_array( $existing_items ) ) {
        $existing_items = array();
    }
    $managed = array();
    foreach ( $existing_items as $existing_item ) {
        if ( $site_key !== (string) get_post_meta( $existing_item->ID, '_figmapress_site_key', true ) ) {
            continue;
        }
        $page_key = (string) get_post_meta( $existing_item->ID, '_figmapress_page_key', true );
        if ( '' !== $page_key ) {
            $managed[ $page_key ] = absint( $existing_item->ID );
        }
    }

    $kept = array();
    $result_items = array();
    foreach ( $pages as $position => $page ) {
        $page_key = $page['key'];
        $item_id = isset( $managed[ $page_key ] ) ? $managed[ $page_key ] : 0;
        $saved = wp_update_nav_menu_item(
            $menu_id,
            $item_id,
            array(
                'menu-item-title'     => wp_slash( $page['title'] ),
                'menu-item-object-id' => $page['id'],
                'menu-item-object'    => 'page',
                'menu-item-status'    => 'publish',
                'menu-item-type'      => 'post_type',
                'menu-item-position'  => $position + 1,
            )
        );
        if ( is_wp_error( $saved ) ) {
            return $saved;
        }
        update_post_meta( $saved, '_figmapress_site_key', $site_key );
        update_post_meta( $saved, '_figmapress_page_key', $page_key );
        $kept[] = absint( $saved );
        $result_items[] = array(
            'id'      => absint( $saved ),
            'pageId'  => $page['id'],
            'key'     => $page_key,
            'title'   => $page['title'],
            'rawLink' => $page['rawLink'],
        );
    }
    foreach ( $managed as $managed_id ) {
        if ( ! in_array( $managed_id, $kept, true ) ) {
            wp_delete_post( $managed_id, true );
        }
    }

    $assigned = array();
    foreach ( get_nav_menu_locations() as $location => $location_menu_id ) {
        if ( absint( $location_menu_id ) === absint( $menu_id ) ) {
            $assigned[] = sanitize_key( $location );
        }
    }
    return array(
        'id'                => absint( $menu_id ),
        'name'              => $menu_name,
        'editLink'          => admin_url( 'nav-menus.php?action=edit&menu=' . absint( $menu_id ) ),
        'assigned'          => ! empty( $assigned ),
        'assignedLocations' => $assigned,
        'items'             => $result_items,
    );
}

function figmapress_connector_rest_prepare_site( WP_REST_Request $request, $actor_user_id = 0 ) {
    $params = $request->get_json_params();
    if ( ! is_array( $params ) ) {
        $payload = $request->get_param( 'payload' );
        if ( is_string( $payload ) && '' !== $payload ) {
            $params = json_decode( wp_unslash( $payload ), true );
        }
    }
    if ( ! is_array( $params ) ) {
        return new WP_Error( 'figmapress_invalid_site', '複数ページの入力内容が無効です。', array( 'status' => 422 ) );
    }
    $site_key = isset( $params['siteKey'] ) ? sanitize_text_field( $params['siteKey'] ) : '';
    $title = isset( $params['title'] ) ? sanitize_text_field( $params['title'] ) : '';
    $menu_name = isset( $params['menuName'] ) ? sanitize_text_field( $params['menuName'] ) : '';
    $requested_pages = isset( $params['pages'] ) && is_array( $params['pages'] ) ? $params['pages'] : array();
    if (
        ! preg_match( figmapress_connector_site_base_key_pattern(), $site_key ) ||
        '' === $title || '' === $menu_name ||
        count( $requested_pages ) < 2 || count( $requested_pages ) > 8
    ) {
        return new WP_Error( 'figmapress_invalid_site', '複数ページの入力内容が無効です。', array( 'status' => 422 ) );
    }

    $seen = array();
    $validated_pages = array();
    foreach ( $requested_pages as $requested ) {
        if ( ! is_array( $requested ) ) {
            return new WP_Error( 'figmapress_invalid_site_page', 'ページ情報が無効です。', array( 'status' => 422 ) );
        }
        $key = isset( $requested['key'] ) ? sanitize_key( $requested['key'] ) : '';
        $page_title = isset( $requested['title'] ) ? sanitize_text_field( $requested['title'] ) : '';
        $slug = isset( $requested['slug'] ) ? sanitize_title( $requested['slug'] ) : '';
        $source_key = isset( $requested['sourceKey'] ) ? sanitize_text_field( $requested['sourceKey'] ) : '';
        $expected_source = 'home' === $key ? $site_key : $site_key . ':page:' . $key;
        if (
            ! preg_match( '/^(?:home|thoughts|policies|activities|profile|contact)$/', $key ) ||
            isset( $seen[ $key ] ) || '' === $page_title || '' === $slug ||
            ! preg_match( figmapress_connector_site_source_key_pattern(), $source_key ) ||
            $source_key !== $expected_source
        ) {
            return new WP_Error( 'figmapress_invalid_site_page', 'ページ情報が無効です。', array( 'status' => 422 ) );
        }
        $seen[ $key ] = true;
        $validated_pages[] = array(
            'key'       => $key,
            'title'     => $page_title,
            'slug'      => $slug,
            'sourceKey' => $source_key,
        );
    }
    if ( empty( $seen['home'] ) ) {
        return new WP_Error( 'figmapress_home_required', 'ホームページの指定が必要です。', array( 'status' => 422 ) );
    }

    foreach ( $validated_pages as $index => $requested ) {
        $existing_id = figmapress_connector_find_page_by_meta( '_figmapress_source_key', $requested['sourceKey'] );
        // map_meta_cap() expects a real post for edit_post. Passing ID 0 for a
        // page that has not been prepared yet can trigger a fatal error on
        // newer WordPress versions before wp_insert_post() is reached.
        if ( $existing_id ) {
            $can_edit_existing = $actor_user_id
                ? user_can( $actor_user_id, 'edit_post', $existing_id )
                : current_user_can( 'edit_post', $existing_id );
            if ( ! $can_edit_existing || 'draft' !== get_post_status( $existing_id ) ) {
                return new WP_Error(
                    'figmapress_site_page_not_editable',
                    'FigmaPress管理ページが下書き以外の状態です。公開済みページは自動更新しません。',
                    array( 'status' => 409, 'postId' => $existing_id )
                );
            }
        }
        $validated_pages[ $index ]['existingId'] = $existing_id;
    }

    $pages = array();
    foreach ( $validated_pages as $requested ) {
        $key = $requested['key'];
        $page_title = $requested['title'];
        $slug = $requested['slug'];
        $source_key = $requested['sourceKey'];
        $existing_id = absint( $requested['existingId'] );
        $created = false;
        if ( $existing_id ) {
            $current_title = (string) get_post_field( 'post_title', $existing_id, 'raw' );
            if ( $current_title === $page_title ) {
                // Replays should not fire save_post hooks for an identical draft.
                // Large Elementor documents can exhaust shared-host memory even
                // when wp_update_post() would not change any stored field.
                $post_id = $existing_id;
            } else {
                $post_id = wp_update_post(
                    array(
                        'ID'         => $existing_id,
                        'post_title' => $page_title,
                    ),
                    true
                );
            }
        } else {
            $post_data = array(
                'post_type'    => 'page',
                'post_status'  => 'draft',
                'post_title'   => $page_title,
                'post_name'    => $slug,
                'post_content' => '',
            );
            if ( $actor_user_id ) {
                $post_data['post_author'] = absint( $actor_user_id );
            }
            $post_id = wp_insert_post( $post_data, true );
            $created = ! is_wp_error( $post_id );
        }
        if ( is_wp_error( $post_id ) ) {
            return $post_id;
        }
        update_post_meta( $post_id, '_figmapress_source_key', $source_key );
        update_post_meta( $post_id, '_figmapress_site_key', $site_key );
        update_post_meta( $post_id, '_figmapress_page_key', $key );
        // Newly prepared placeholders have no Elementor document yet. Existing
        // drafts may contain multi-megabyte image data, so do not decode the
        // previous document during this lightweight page/menu preparation.
        if ( ! $existing_id ) {
            update_post_meta( $post_id, '_figmapress_prepared', '1' );
        }
        $pages[] = array(
            'id'          => absint( $post_id ),
            'key'         => $key,
            'title'       => $page_title,
            'slug'        => get_post_field( 'post_name', $post_id ),
            'status'      => 'draft',
            'sourceKey'   => $source_key,
            'created'     => $created,
            'updated'     => ! $created,
            'editLink'    => admin_url( 'post.php?post=' . absint( $post_id ) . '&action=elementor' ),
            'previewLink' => get_preview_post_link( $post_id ),
            'rawLink'     => get_permalink( $post_id ),
        );
    }
    $warnings = array();
    $menu = figmapress_connector_sync_site_menu(
        $site_key,
        $menu_name,
        $pages,
        $actor_user_id
    );
    if ( is_wp_error( $menu ) ) {
        $warnings[] = $menu->get_error_message();
        $menu = null;
    }
    return rest_ensure_response(
        array(
            'siteKey'  => $site_key,
            'title'    => $title,
            'status'   => 'draft',
            'pages'    => $pages,
            'menu'     => $menu,
            'warnings' => $warnings,
        )
    );
}

function figmapress_connector_rest_create_gutenberg_page( WP_REST_Request $request ) {
    $params  = $request->get_json_params();
    $title   = isset( $params['title'] )
        ? sanitize_text_field( $params['title'] )
        : '';
    $slug    = isset( $params['slug'] )
        ? sanitize_title( $params['slug'] )
        : '';
    $content = isset( $params['content'] ) && is_string( $params['content'] )
        ? wp_kses_post( $params['content'] )
        : '';
    if ( '' === $title || '' === $content ) {
        return new WP_Error(
            'figmapress_invalid_gutenberg_page',
            'The Gutenberg page payload is invalid.',
            array( 'status' => 422 )
        );
    }

    $post_id = wp_insert_post(
        array(
            'post_type'    => 'page',
            'post_status'  => 'draft',
            'post_title'   => $title,
            'post_name'    => $slug,
            'post_content' => $content,
        ),
        true
    );
    if ( is_wp_error( $post_id ) ) {
        return $post_id;
    }
    return rest_ensure_response(
        array(
            'id'          => $post_id,
            'slug'        => get_post_field( 'post_name', $post_id ),
            'status'      => 'draft',
            'target'      => 'gutenberg',
            'editLink'    => admin_url( 'post.php?post=' . $post_id . '&action=edit' ),
            'previewLink' => get_preview_post_link( $post_id ),
            'rawLink'     => get_permalink( $post_id ),
        )
    );
}

function figmapress_connector_find_page_by_meta( $meta_key, $meta_value ) {
    if ( '' === $meta_value ) {
        return 0;
    }
    $pages = get_posts(
        array(
            'post_type'              => 'page',
            'post_status'            => array( 'draft', 'pending', 'private', 'publish', 'future' ),
            'posts_per_page'         => 1,
            'fields'                 => 'ids',
            'meta_key'               => $meta_key,
            'meta_value'             => $meta_value,
            'no_found_rows'          => true,
            'orderby'                => 'ID',
            'order'                  => 'DESC',
            'suppress_filters'       => false,
            'update_post_meta_cache' => false,
            'update_post_term_cache' => false,
        )
    );
    return isset( $pages[0] ) ? absint( $pages[0] ) : 0;
}

/**
 * Release only the lock created by the current request, including when PHP is
 * terminated by a host timeout while Elementor is storing a large document.
 */
function figmapress_connector_register_request_lock_cleanup( $lock_key, $lock_token ) {
    register_shutdown_function(
        static function () use ( $lock_key, $lock_token ) {
            $current = get_option( $lock_key );
            if (
                is_array( $current ) && isset( $current['token'] ) &&
                is_string( $current['token'] ) && hash_equals( $lock_token, $current['token'] )
            ) {
                delete_option( $lock_key );
            }
        }
    );
}

function figmapress_connector_request_lock_is_stale( $started ) {
    // Normal document persistence completes in seconds. A two-minute lock is
    // enough to serialize writes while allowing a disconnected browser to
    // recover without waiting for the previous ten-minute safety window.
    return $started && $started < time() - ( 2 * MINUTE_IN_SECONDS );
}

/**
 * Store one metadata value without asking WordPress to hydrate every post-meta
 * row into PHP memory. Large Elementor documents can make the normal metadata
 * cache path exceed a shared host's limit even when the new value is small.
 */
function figmapress_connector_direct_set_post_meta( $post_id, $meta_key, $value ) {
    global $wpdb;
    $post_id    = absint( $post_id );
    $meta_key   = (string) $meta_key;
    $meta_value = maybe_serialize( $value );
    $meta_id    = $wpdb->get_var(
        $wpdb->prepare(
            "SELECT meta_id FROM {$wpdb->postmeta} WHERE post_id = %d AND meta_key = %s ORDER BY meta_id ASC LIMIT 1",
            $post_id,
            $meta_key
        )
    );
    if ( $meta_id ) {
        $saved = $wpdb->update(
            $wpdb->postmeta,
            array( 'meta_value' => $meta_value ),
            array( 'meta_id' => absint( $meta_id ) ),
            array( '%s' ),
            array( '%d' )
        );
    } else {
        $saved = $wpdb->insert(
            $wpdb->postmeta,
            array(
                'post_id'    => $post_id,
                'meta_key'   => $meta_key,
                'meta_value' => $meta_value,
            ),
            array( '%d', '%s', '%s' )
        );
    }
    wp_cache_delete( $post_id, 'post_meta' );
    return false !== $saved;
}

/** Delete one metadata key without loading the large Elementor value. */
function figmapress_connector_direct_delete_post_meta( $post_id, $meta_key ) {
    global $wpdb;
    $deleted = $wpdb->delete(
        $wpdb->postmeta,
        array(
            'post_id'  => absint( $post_id ),
            'meta_key' => (string) $meta_key,
        ),
        array( '%d', '%s' )
    );
    wp_cache_delete( absint( $post_id ), 'post_meta' );
    return false !== $deleted;
}

/**
 * Append a large upload to a non-autoloaded DB row, then move only the
 * template.content JSON into _elementor_data inside MySQL. The complete page
 * never exists as a second PHP string or decoded PHP tree.
 */
function figmapress_connector_stream_elementor_upload( $upload_id, $index, $total, $decoded ) {
    global $wpdb;
    $user_id   = get_current_user_id();
    $suffix    = substr( hash_hmac( 'sha256', $upload_id, wp_salt( 'nonce' ) ), 0, 24 );
    $data_key  = 'figmapress_stream_' . $user_id . '_' . $suffix;
    $state_key = 'figmapress_stream_state_' . $user_id . '_' . $suffix;
    $state     = get_option( $state_key, array() );

    if ( 0 === $index ) {
        $wpdb->delete( $wpdb->options, array( 'option_name' => $data_key ), array( '%s' ) );
        $inserted = $wpdb->insert(
            $wpdb->options,
            array(
                'option_name'  => $data_key,
                'option_value' => $decoded,
                'autoload'     => 'no',
            ),
            array( '%s', '%s', '%s' )
        );
        if ( false === $inserted ) {
            return new WP_Error( 'figmapress_stream_start_failed', 'Elementor分割データの保存を開始できませんでした。', array( 'status' => 500 ) );
        }
        $state = array( 'total' => $total, 'next' => 1, 'started' => time() );
        update_option( $state_key, $state, false );
    } else {
        $expected = is_array( $state ) && isset( $state['next'] ) ? absint( $state['next'] ) : 0;
        if ( ! is_array( $state ) || absint( $state['total'] ?? 0 ) !== $total || $expected < 1 ) {
            return new WP_Error( 'figmapress_stream_missing', 'Elementor分割データの先頭から再送してください。', array( 'status' => 409 ) );
        }
        if ( $index < $expected ) {
            return new WP_Error( 'figmapress_stream_restarted', 'Elementor分割データの先頭から再送してください。', array( 'status' => 409 ) );
        }
        if ( $index !== $expected ) {
            return new WP_Error( 'figmapress_stream_out_of_order', 'Elementor分割データの順序が一致しません。', array( 'status' => 409 ) );
        }
        $appended = $wpdb->query(
            $wpdb->prepare(
                "UPDATE {$wpdb->options} SET option_value = CONCAT(option_value, %s) WHERE option_name = %s",
                $decoded,
                $data_key
            )
        );
        if ( 1 !== $appended ) {
            return new WP_Error( 'figmapress_stream_append_failed', 'Elementor分割データを追記できませんでした。', array( 'status' => 500 ) );
        }
        $state['next'] = $expected + 1;
        update_option( $state_key, $state, false );
    }

    $received = absint( $state['next'] ?? 0 );
    if ( $received < $total ) {
        return rest_ensure_response( array( 'complete' => false, 'received' => $received, 'total' => $total ) );
    }

    $valid = $wpdb->get_row(
        $wpdb->prepare(
            "SELECT JSON_VALID(option_value) AS valid_json,
                JSON_UNQUOTE(JSON_EXTRACT(option_value, '$.requestId')) AS request_id,
                JSON_UNQUOTE(JSON_EXTRACT(option_value, '$.sourceKey')) AS source_key,
                JSON_UNQUOTE(JSON_EXTRACT(option_value, '$.status')) AS post_status,
                JSON_UNQUOTE(JSON_EXTRACT(option_value, '$.pageTemplate')) AS page_template,
                JSON_UNQUOTE(JSON_EXTRACT(option_value, '$.template.version')) AS template_version,
                JSON_TYPE(JSON_EXTRACT(option_value, '$.template.content')) AS content_type,
                JSON_LENGTH(JSON_EXTRACT(option_value, '$.template.content')) AS root_elements,
                JSON_EXTRACT(option_value, '$.template.page_settings') AS page_settings
             FROM {$wpdb->options} WHERE option_name = %s LIMIT 1",
            $data_key
        ),
        ARRAY_A
    );
    if (
        ! is_array( $valid ) || '1' !== (string) $valid['valid_json'] ||
        ! hash_equals( $upload_id, (string) $valid['request_id'] ) ||
        ! preg_match( figmapress_connector_site_source_key_pattern(), (string) $valid['source_key'] ) ||
        'draft' !== (string) $valid['post_status'] || '0.4' !== (string) $valid['template_version'] ||
        'ARRAY' !== (string) $valid['content_type'] || absint( $valid['root_elements'] ) < 1
    ) {
        $wpdb->delete( $wpdb->options, array( 'option_name' => $data_key ), array( '%s' ) );
        delete_option( $state_key );
        return new WP_Error( 'figmapress_invalid_streamed_template', 'Elementorデータを安全に再構成できませんでした。', array( 'status' => 422 ) );
    }
    $unsafe = $wpdb->get_var(
        $wpdb->prepare(
            "SELECT (LOWER(option_value) LIKE %s OR LOWER(option_value) LIKE %s OR LOWER(option_value) LIKE %s OR LOWER(option_value) LIKE %s)
             FROM {$wpdb->options} WHERE option_name = %s LIMIT 1",
            '%<script%',
            '%javascript:%',
            '%data:text/html%',
            '%\"widgettype\":\"html\"%',
            $data_key
        )
    );
    if ( $unsafe ) {
        $wpdb->delete( $wpdb->options, array( 'option_name' => $data_key ), array( '%s' ) );
        delete_option( $state_key );
        return new WP_Error( 'figmapress_unsafe_streamed_template', 'Elementorデータに許可されていない内容があります。', array( 'status' => 422 ) );
    }
    // JSON.stringify() emits these structural keys without whitespace. Count
    // every structural marker and require it to be one of the same widget and
    // container types as the normal recursive sanitizer. The fast path is
    // additionally limited to users who may already save unfiltered HTML.
    $structure = $wpdb->get_row(
        $wpdb->prepare(
            "SELECT
                (LENGTH(option_value) - LENGTH(REPLACE(option_value, '\"elType\":', ''))) / 9 AS element_count,
                ((LENGTH(option_value) - LENGTH(REPLACE(option_value, '\"elType\":\"container\"', ''))) / 20) +
                ((LENGTH(option_value) - LENGTH(REPLACE(option_value, '\"elType\":\"widget\"', ''))) / 17) AS allowed_elements,
                (LENGTH(option_value) - LENGTH(REPLACE(option_value, '\"widgetType\":', ''))) / 13 AS widget_count,
                ((LENGTH(option_value) - LENGTH(REPLACE(option_value, '\"widgetType\":\"heading\"', ''))) / 22) +
                ((LENGTH(option_value) - LENGTH(REPLACE(option_value, '\"widgetType\":\"text-editor\"', ''))) / 26) +
                ((LENGTH(option_value) - LENGTH(REPLACE(option_value, '\"widgetType\":\"button\"', ''))) / 21) +
                ((LENGTH(option_value) - LENGTH(REPLACE(option_value, '\"widgetType\":\"image\"', ''))) / 20) +
                ((LENGTH(option_value) - LENGTH(REPLACE(option_value, '\"widgetType\":\"figmapress-nav\"', ''))) / 29) +
                ((LENGTH(option_value) - LENGTH(REPLACE(option_value, '\"widgetType\":\"figmapress-link\"', ''))) / 30) +
                ((LENGTH(option_value) - LENGTH(REPLACE(option_value, '\"widgetType\":\"figmapress-carousel\"', ''))) / 34) +
                ((LENGTH(option_value) - LENGTH(REPLACE(option_value, '\"widgetType\":\"figmapress-contact-form\"', ''))) / 38) +
                ((LENGTH(option_value) - LENGTH(REPLACE(option_value, '\"widgetType\":\"figmapress-accordion\"', ''))) / 35) AS allowed_widgets
             FROM {$wpdb->options} WHERE option_name = %s LIMIT 1",
            $data_key
        ),
        ARRAY_A
    );
    if (
        ! current_user_can( 'unfiltered_html' ) || ! is_array( $structure ) ||
        absint( $structure['element_count'] ) !== absint( $structure['allowed_elements'] ) ||
        absint( $structure['widget_count'] ) !== absint( $structure['allowed_widgets'] ) ||
        absint( $structure['element_count'] ) > 1200
    ) {
        $wpdb->delete( $wpdb->options, array( 'option_name' => $data_key ), array( '%s' ) );
        delete_option( $state_key );
        return new WP_Error( 'figmapress_invalid_streamed_element', 'Elementorデータに未対応の要素があります。', array( 'status' => 422 ) );
    }

    $source_key = (string) $valid['source_key'];
    $post_id    = figmapress_connector_find_page_by_meta( '_figmapress_source_key', $source_key );
    if ( ! $post_id || 'draft' !== get_post_status( $post_id ) || ! current_user_can( 'edit_post', $post_id ) ) {
        return new WP_Error( 'figmapress_streamed_draft_not_editable', '対象のElementor下書きを更新できません。', array( 'status' => 409 ) );
    }

    // Reuse Media Library URLs imported by an earlier run without hydrating
    // the complete document. This also keeps expiring Figma image URLs out of
    // the durable page whenever a known replacement exists.
    foreach ( figmapress_connector_load_media_map( $post_id ) as $remote_url => $localized ) {
        $local_url = is_array( $localized ) && isset( $localized['url'] ) ? (string) $localized['url'] : '';
        if ( '' !== $remote_url && '' !== $local_url ) {
            $wpdb->query(
                $wpdb->prepare(
                    "UPDATE {$wpdb->options} SET option_value = REPLACE(option_value, %s, %s) WHERE option_name = %s",
                    $remote_url,
                    $local_url,
                    $data_key
                )
            );
        }
    }

    // Insert the complete new value first. If PHP is terminated immediately
    // afterwards, WordPress's newest-meta read still sees the complete page.
    $stored = $wpdb->query(
        $wpdb->prepare(
            "INSERT INTO {$wpdb->postmeta} (post_id, meta_key, meta_value)
             SELECT %d, %s, JSON_EXTRACT(option_value, '$.template.content') FROM {$wpdb->options} WHERE option_name = %s",
            $post_id,
            '_elementor_data',
            $data_key
        )
    );
    $new_meta_id = 1 === $stored ? absint( $wpdb->insert_id ) : 0;
    $stored      = $new_meta_id > 0;
    if ( ! $stored ) {
        return new WP_Error( 'figmapress_streamed_store_failed', 'Elementor data could not be stored on this server.', array( 'status' => 500 ) );
    }
    $wpdb->query(
        $wpdb->prepare(
            "DELETE FROM {$wpdb->postmeta} WHERE post_id = %d AND meta_key = %s AND meta_id <> %d",
            $post_id,
            '_elementor_data',
            $new_meta_id
        )
    );

    $page_settings = json_decode( (string) $valid['page_settings'], true );
    if ( ! is_array( $page_settings ) ) {
        $page_settings = array();
    }
    $page_template = in_array( $valid['page_template'], array( 'elementor_canvas', 'elementor_header_footer', 'default' ), true )
        ? $valid['page_template']
        : 'elementor_canvas';
    $stored_bytes = figmapress_connector_elementor_storage_bytes( $post_id );
    $stored_hash  = figmapress_connector_elementor_storage_hash( $post_id );
    // Media references are counted in MySQL so the final chunk never has to
    // decode the document only to decide whether localization can be skipped.
    // Known library URLs were already substituted above; remaining https URLs
    // stay usable in the draft and can be localized by a later bounded flow.
    $media_total = $wpdb->get_var(
        $wpdb->prepare(
            "SELECT
                ((LENGTH(meta_value) - LENGTH(REPLACE(meta_value, '\"figmapress_key\":', ''))) / 17) +
                ((LENGTH(meta_value) - LENGTH(REPLACE(meta_value, '\"source\":\"figma-render\"', ''))) / 25)
             FROM {$wpdb->postmeta} WHERE meta_id = %d LIMIT 1",
            $new_meta_id
        )
    );
    $media_total = min( 300, absint( $media_total ) );
    figmapress_connector_direct_set_post_meta( $post_id, '_figmapress_request_id', $upload_id );
    figmapress_connector_direct_set_post_meta( $post_id, '_figmapress_stored_request_id', $upload_id );
    figmapress_connector_direct_set_post_meta( $post_id, '_figmapress_stored_source_key', $source_key );
    figmapress_connector_direct_set_post_meta( $post_id, '_figmapress_stored_bytes', $stored_bytes );
    figmapress_connector_direct_set_post_meta( $post_id, '_figmapress_stored_hash', $stored_hash );
    figmapress_connector_direct_set_post_meta( $post_id, '_elementor_edit_mode', 'builder' );
    figmapress_connector_direct_set_post_meta( $post_id, '_elementor_template_type', 'wp-page' );
    figmapress_connector_direct_set_post_meta( $post_id, '_elementor_version', defined( 'ELEMENTOR_VERSION' ) ? ELEMENTOR_VERSION : '' );
    figmapress_connector_direct_set_post_meta( $post_id, '_elementor_page_settings', $page_settings );
    figmapress_connector_direct_set_post_meta( $post_id, '_wp_page_template', $page_template );
    figmapress_connector_direct_set_post_meta( $post_id, '_figmapress_media_total', $media_total );
    figmapress_connector_direct_delete_post_meta( $post_id, '_figmapress_prepared' );
    figmapress_connector_direct_delete_post_meta( $post_id, '_elementor_css' );
    $wpdb->delete( $wpdb->options, array( 'option_name' => $data_key ), array( '%s' ) );
    delete_option( $state_key );
    wp_cache_delete( $post_id, 'post_meta' );

    $total_media = $media_total;
    $saved_media = count( figmapress_connector_load_media_map( $post_id ) );
    return rest_ensure_response(
        array(
            'id'             => $post_id,
            'slug'           => get_post_field( 'post_name', $post_id ),
            'status'         => 'draft',
            'target'         => 'elementor',
            'editLink'       => admin_url( 'post.php?post=' . $post_id . '&action=elementor' ),
            'previewLink'    => get_preview_post_link( $post_id ),
            'rawLink'        => get_permalink( $post_id ),
            'storedElements' => absint( $valid['root_elements'] ),
            'storedBytes'    => $stored_bytes,
            'idempotent'     => true,
            'updated'        => true,
            'savedMedia'     => min( $saved_media, $total_media ),
            'totalMedia'     => $total_media,
            'remainingMedia' => 0,
            'failedMedia'    => 0,
            'mediaComplete'  => true,
            'warnings'       => array( '共有サーバー向け低メモリ保存で同じ下書きを更新しました。既存の保存済み画像は再利用し、その他は元のHTTPS画像を保持します。' ),
        )
    );
}

/**
 * Receive a large Elementor page in bounded browser requests, then forward the
 * reconstructed JSON to the normal creation handler. Upload state is scoped to
 * the authenticated user and expires automatically.
 */
function figmapress_connector_rest_upload_elementor_page( WP_REST_Request $request ) {
    $upload_id = sanitize_text_field( $request->get_param( 'upload' ) );
    $params    = $request->get_json_params();
    if ( ! is_array( $params ) ) {
        $params = $request->get_body_params();
    }
    $index     = isset( $params['index'] ) ? absint( $params['index'] ) : -1;
    $total     = isset( $params['total'] ) ? absint( $params['total'] ) : 0;
    $chunk     = isset( $params['chunk'] ) && is_string( $params['chunk'] ) ? $params['chunk'] : '';
    if (
        ! preg_match( '/^[a-f0-9-]{16,64}$/i', $upload_id ) ||
        $total < 1 || $total > 128 || $index < 0 || $index >= $total ||
        '' === $chunk || strlen( $chunk ) > 128000 ||
        ! preg_match( '/^[A-Za-z0-9+\/=]+$/', $chunk )
    ) {
        return new WP_Error( 'figmapress_invalid_upload_chunk', 'Elementor分割データが無効です。', array( 'status' => 422 ) );
    }

    $decoded = base64_decode( $chunk, true );
    if ( false === $decoded || strlen( $decoded ) > 72000 ) {
        return new WP_Error( 'figmapress_invalid_upload_chunk', 'Elementor分割データが無効です。', array( 'status' => 422 ) );
    }

    // Keep every trusted Builder upload in the database from the first chunk
    // onward. Even a smaller page can trigger expensive Elementor/save_post
    // hooks on shared hosts; the streamed path validates the complete JSON,
    // allowed structure, widget allowlist, target draft, and request identity
    // before replacing _elementor_data without firing those hooks. Editors
    // without unfiltered_html retain the stricter recursive fallback below.
    if ( current_user_can( 'unfiltered_html' ) ) {
        return figmapress_connector_stream_elementor_upload( $upload_id, $index, $total, $decoded );
    }

    $upload_key = 'figmapress_upload_' . get_current_user_id() . '_' . substr(
        hash_hmac( 'sha256', $upload_id, wp_salt( 'nonce' ) ),
        0,
        24
    );
    $state = get_transient( $upload_key );
    if ( ! is_array( $state ) || ! isset( $state['total'], $state['chunks'] ) || absint( $state['total'] ) !== $total ) {
        $state = array( 'total' => $total, 'chunks' => array() );
    }
    $state['chunks'][ $index ] = $decoded;
    set_transient( $upload_key, $state, 15 * MINUTE_IN_SECONDS );

    if ( count( $state['chunks'] ) < $total ) {
        return rest_ensure_response(
            array(
                'complete' => false,
                'received' => count( $state['chunks'] ),
                'total'    => $total,
            )
        );
    }

    ksort( $state['chunks'], SORT_NUMERIC );
    for ( $expected = 0; $expected < $total; $expected++ ) {
        if ( ! array_key_exists( $expected, $state['chunks'] ) ) {
            return new WP_Error( 'figmapress_incomplete_upload', 'Elementor分割データが不足しています。', array( 'status' => 409 ) );
        }
    }
    $body = implode( '', $state['chunks'] );
    delete_transient( $upload_key );
    // Do not decode the full multi-megabyte JSON here and again inside the
    // forwarded WP_REST_Request. That duplicate tree survives until request
    // shutdown on PHP and can exhaust shared-host memory after the document
    // has already been stored successfully.
    if ( strlen( $body ) > 4000000 ) {
        return new WP_Error( 'figmapress_invalid_upload', 'Elementorデータを再構成できませんでした。', array( 'status' => 422 ) );
    }

    $forward = new WP_REST_Request( 'POST', '/figmapress/v1/elementor/pages' );
    $forward->set_header( 'content-type', 'application/json' );
    $forward->set_body( $body );
    return figmapress_connector_rest_create_elementor_page( $forward );
}

function figmapress_connector_rest_create_elementor_page( WP_REST_Request $request ) {
    if ( ! did_action( 'elementor/loaded' ) && ! defined( 'ELEMENTOR_VERSION' ) ) {
        return new WP_Error( 'figmapress_elementor_missing', 'Elementor is not active on this site.', array( 'status' => 409 ) );
    }

    $container_activated = figmapress_connector_ensure_elementor_containers();
    if ( is_wp_error( $container_activated ) ) {
        return $container_activated;
    }

    $warnings = array();
    if ( $container_activated ) {
        $warnings[] = 'Elementorの安定機能「コンテナ」を有効化しました。既存ページの内容は変更していません。';
    }

    $params     = $request->get_json_params();
    $title      = isset( $params['title'] ) ? sanitize_text_field( $params['title'] ) : '';
    $slug       = isset( $params['slug'] ) ? sanitize_title( $params['slug'] ) : '';
    $request_id = isset( $params['requestId'] ) ? sanitize_text_field( $params['requestId'] ) : '';
    $source_key = isset( $params['sourceKey'] ) ? sanitize_text_field( $params['sourceKey'] ) : '';
    $template   = isset( $params['template'] ) && is_array( $params['template'] ) ? $params['template'] : null;
    if ( '' === $title || ! $template || '0.4' !== ( isset( $template['version'] ) ? (string) $template['version'] : '' ) ) {
        return new WP_Error( 'figmapress_invalid_template', 'The Elementor template payload is invalid.', array( 'status' => 422 ) );
    }
    if ( '' !== $request_id && ! preg_match( '/^[a-f0-9-]{16,64}$/i', $request_id ) ) {
        return new WP_Error( 'figmapress_invalid_request_id', '作成リクエストの識別情報が無効です。', array( 'status' => 422 ) );
    }
    if ( '' !== $source_key && ! preg_match( figmapress_connector_site_source_key_pattern(), $source_key ) ) {
        return new WP_Error( 'figmapress_invalid_source_key', 'Figma変換元の識別情報が無効です。', array( 'status' => 422 ) );
    }

    $identity         = '' !== $source_key ? $source_key : $request_id;
    $request_lock_key = '' !== $identity
        ? 'figmapress_request_' . substr( hash_hmac( 'sha256', $identity, wp_salt( 'nonce' ) ), 0, 32 )
        : '';
    $existing_id      = '' !== $source_key
        ? figmapress_connector_find_page_by_meta( '_figmapress_source_key', $source_key )
        : 0;
    if ( ! $existing_id && '' !== $request_id ) {
        $existing_id = figmapress_connector_find_page_by_meta( '_figmapress_request_id', $request_id );
    }
    $reuse_existing = false;
    if ( $existing_id ) {
        if ( $existing_id && current_user_can( 'edit_post', $existing_id ) ) {
            $existing_lock   = get_option( $request_lock_key );
            $lock_started    = is_array( $existing_lock ) && isset( $existing_lock['started'] )
                ? absint( $existing_lock['started'] )
                : 0;
            if ( $lock_started && ! figmapress_connector_request_lock_is_stale( $lock_started ) ) {
                return new WP_Error(
                    'figmapress_request_in_progress',
                    '同じElementor下書きを作成中です。少し待ってから同じボタンを再度押してください。',
                    array( 'status' => 409, 'postId' => $existing_id )
                );
            }
            $existing_status = get_post_status( $existing_id );
            if ( 'draft' !== $existing_status ) {
                return new WP_Error(
                    'figmapress_request_already_completed',
                    'この処理で作成したページは、すでに下書き以外の状態になっています。',
                    array( 'status' => 409, 'postId' => $existing_id )
                );
            }
            if ( '' !== $source_key ) {
                // A stable Figma source always updates the same draft. Avoid
                // decoding its previous multi-megabyte Elementor document;
                // the validated incoming document will replace it below.
                $reuse_existing = true;
            } else {
                $stored_elements = figmapress_connector_count_elementor_elements(
                    figmapress_connector_read_elementor_data( $existing_id )
                );
                if ( 0 === $stored_elements ) {
                    wp_delete_post( $existing_id, true );
                    delete_option( $request_lock_key );
                    $existing_id = 0;
                } else {
                    return rest_ensure_response(
                        array(
                            'id'             => $existing_id,
                            'slug'           => get_post_field( 'post_name', $existing_id ),
                            'status'         => $existing_status,
                            'target'         => 'elementor',
                            'editLink'       => admin_url( 'post.php?post=' . $existing_id . '&action=elementor' ),
                            'previewLink'    => get_preview_post_link( $existing_id ),
                            'rawLink'        => get_permalink( $existing_id ),
                            'storedElements' => $stored_elements,
                            'idempotent'     => true,
                            'updated'        => false,
                            'warnings'       => array( '前回の処理で作成済みの下書きを再利用しました。重複ページは作成していません。' ),
                        )
                    );
                }
            }
        }
    }

    $element_count = 0;
    $content       = figmapress_connector_sanitize_elementor_elements(
        isset( $template['content'] ) ? $template['content'] : array(),
        $element_count
    );
    if ( is_wp_error( $content ) ) {
        return $content;
    }
    if ( 0 === $element_count ) {
        return new WP_Error( 'figmapress_empty_template', 'The Elementor template contains no supported elements.', array( 'status' => 422 ) );
    }

    if ( '' !== $request_lock_key ) {
        $lock_token       = wp_generate_uuid4();
        $lock_value       = array(
            'started' => time(),
            'user'    => get_current_user_id(),
            'token'   => $lock_token,
        );
        $locked           = add_option( $request_lock_key, $lock_value, '', false );
        if ( ! $locked ) {
            $existing_lock = get_option( $request_lock_key );
            $started       = is_array( $existing_lock ) && isset( $existing_lock['started'] )
                ? absint( $existing_lock['started'] )
                : 0;
            if ( figmapress_connector_request_lock_is_stale( $started ) ) {
                delete_option( $request_lock_key );
                $locked = add_option( $request_lock_key, $lock_value, '', false );
            }
        }
        if ( ! $locked ) {
            return new WP_Error(
                'figmapress_request_in_progress',
                '同じElementor下書きを作成中です。少し待ってから同じボタンを再度押してください。',
                array( 'status' => 409 )
            );
        }
        figmapress_connector_register_request_lock_cleanup( $request_lock_key, $lock_token );
    }

    $page_template = isset( $params['pageTemplate'] ) ? $params['pageTemplate'] : 'elementor_canvas';
    if ( ! in_array( $page_template, array( 'elementor_canvas', 'elementor_header_footer', 'default' ), true ) ) {
        $page_template = 'elementor_canvas';
    }

    $created = ! $reuse_existing;
    if ( $reuse_existing ) {
        // Revisions copy registered Elementor meta. A legacy absolute-positioned
        // document can already be several megabytes, and copying it while the
        // replacement JSON is in memory can exceed a shared host's PHP limit.
        // Small documents retain the normal revision safety net; large ones are
        // replaced atomically by the metadata write below.
        $existing_elementor_bytes = figmapress_connector_elementor_storage_bytes( $existing_id );
        if ( $existing_elementor_bytes > 0 && $existing_elementor_bytes <= 600000 ) {
            wp_save_post_revision( $existing_id );
        } else {
            if ( $existing_elementor_bytes > 600000 ) {
                $warnings[] = '共有サーバーのメモリ保護のため、旧Elementor文書の自動リビジョン複製を省略しました。';
            }
        }
        $current_title = (string) get_post_field( 'post_title', $existing_id, 'raw' );
        if ( $current_title === $title ) {
            // Replacing Elementor data does not require a post update when the
            // title is unchanged. Avoid firing save_post hooks before the
            // bounded document write on shared hosts.
            $post_id = $existing_id;
        } else {
            $post_id = wp_update_post(
                array(
                    'ID'         => $existing_id,
                    'post_title' => $title,
                ),
                true
            );
        }
        $warnings[] = '同じFigmaファイル・ノードの既存下書きを更新しました。重複ページは作成していません。';
    } else {
        $post_id = wp_insert_post(
            array(
                'post_type'    => 'page',
                'post_status'  => 'draft',
                'post_title'   => $title,
                'post_name'    => $slug,
                'post_content' => '',
            ),
            true
        );
    }
    if ( is_wp_error( $post_id ) ) {
        if ( $request_lock_key ) {
            delete_option( $request_lock_key );
        }
        return $post_id;
    }
    if ( '' !== $request_id ) {
        update_post_meta( $post_id, '_figmapress_request_id', $request_id );
    }
    if ( '' !== $source_key ) {
        update_post_meta( $post_id, '_figmapress_source_key', $source_key );
    }
    $page_settings = isset( $template['page_settings'] ) && is_array( $template['page_settings'] )
        ? figmapress_connector_sanitize_elementor_value( $template['page_settings'] )
        : array();

    $media_total = figmapress_connector_count_unique_elementor_images( $content );
    update_post_meta( $post_id, '_figmapress_media_total', $media_total );
    delete_post_meta( $post_id, '_figmapress_media_failures' );
    $localized_images = figmapress_connector_load_media_map( $post_id );
    figmapress_connector_apply_elementor_image_map( $content, $localized_images );

    // Remove the previous completion receipt before replacing the document.
    // A confirmation request must only succeed for this exact save attempt.
    delete_post_meta( $post_id, '_figmapress_stored_request_id' );
    delete_post_meta( $post_id, '_figmapress_stored_source_key' );
    delete_post_meta( $post_id, '_figmapress_stored_bytes' );
    delete_post_meta( $post_id, '_figmapress_stored_hash' );

    // Persist the complete editable document before any remote image work.
    // Hosts can terminate slow downloads; the page must never be left empty.
    $stored_elements = figmapress_connector_store_elementor_document(
        $post_id,
        $content,
        $page_settings,
        $page_template,
        $request_id,
        $source_key
    );
    if ( is_wp_error( $stored_elements ) ) {
        if ( $request_lock_key ) {
            delete_option( $request_lock_key );
        }
        if ( $created ) {
            wp_delete_post( $post_id, true );
        }
        return $stored_elements;
    }
    delete_post_meta( $post_id, '_figmapress_prepared' );
    if ( $request_lock_key ) {
        delete_option( $request_lock_key );
    }

    // Return immediately after the editable document is durable. Remote image
    // downloads are resumed through the bounded /media endpoint. Keeping them
    // out of this request prevents shared hosts from terminating a large page
    // update before Elementor has cleared its CSS cache.
    $imported_media = 0;
    figmapress_connector_clear_elementor_cache( $post_id );
    $media_progress = figmapress_connector_elementor_media_progress( $content, $post_id );

    return rest_ensure_response(
        array_merge(
            array(
            'id'            => $post_id,
            'slug'          => get_post_field( 'post_name', $post_id ),
            'status'        => 'draft',
            'target'        => 'elementor',
            'editLink'      => admin_url( 'post.php?post=' . $post_id . '&action=elementor' ),
            'previewLink'   => get_preview_post_link( $post_id ),
            'rawLink'       => get_permalink( $post_id ),
            'importedMedia' => $imported_media,
            'storedElements' => $stored_elements,
            'idempotent'     => $reuse_existing,
            'updated'        => $reuse_existing,
            'warnings'      => $warnings,
            ),
            $media_progress
        )
    );
}

/**
 * Confirm an Elementor draft after a host terminates the final upload response.
 * This lightweight route never decodes the stored document; it proves the
 * request identity, source identity, draft status, and durable byte length.
 */
function figmapress_connector_rest_confirm_elementor_page( WP_REST_Request $request ) {
    $post_id = absint( $request->get_param( 'id' ) );
    $params  = $request->get_json_params();
    if ( ! is_array( $params ) ) {
        $params = $request->get_body_params();
    }
    $request_id = isset( $params['requestId'] ) ? sanitize_text_field( $params['requestId'] ) : '';
    $source_key = isset( $params['sourceKey'] ) ? sanitize_text_field( $params['sourceKey'] ) : '';
    if (
        $post_id <= 0 || 'page' !== get_post_type( $post_id ) || 'draft' !== get_post_status( $post_id ) ||
        ! preg_match( '/^[a-f0-9-]{16,64}$/i', $request_id ) ||
        ! preg_match( figmapress_connector_site_source_key_pattern(), $source_key )
    ) {
        return new WP_Error( 'figmapress_invalid_confirmation', 'Elementor下書きの保存確認情報が無効です。', array( 'status' => 422 ) );
    }
    $receipt           = figmapress_connector_elementor_storage_receipt( $post_id );
    $stored_request_id = isset( $receipt['_figmapress_stored_request_id'] ) ? (string) $receipt['_figmapress_stored_request_id'] : '';
    $stored_source_key = isset( $receipt['_figmapress_stored_source_key'] ) ? (string) $receipt['_figmapress_stored_source_key'] : '';
    $expected_bytes    = isset( $receipt['_figmapress_stored_bytes'] ) ? absint( $receipt['_figmapress_stored_bytes'] ) : 0;
    $expected_hash     = isset( $receipt['_figmapress_stored_hash'] ) ? (string) $receipt['_figmapress_stored_hash'] : '';
    $stored_bytes      = figmapress_connector_elementor_storage_bytes( $post_id );
    $stored_hash       = figmapress_connector_elementor_storage_hash( $post_id );
    $request_matches   = '' !== $stored_request_id && hash_equals( $stored_request_id, $request_id );
    $source_matches    = '' !== $stored_source_key && hash_equals( $stored_source_key, $source_key );
    $bytes_match       = $expected_bytes >= 100 && $stored_bytes === $expected_bytes;
    $hash_matches      = preg_match( '/^[a-f0-9]{64}$/', $expected_hash ) && hash_equals( $expected_hash, $stored_hash );
    if ( ! $request_matches || ! $source_matches || ! $bytes_match || ! $hash_matches ) {
        return new WP_Error(
            'figmapress_elementor_not_confirmed',
            'Elementor下書きの完全保存を確認できませんでした。',
            array(
                'status'         => 409,
                'requestMatches' => $request_matches,
                'sourceMatches'  => $source_matches,
                'bytesMatch'     => $bytes_match,
                'hashMatches'    => $hash_matches,
            )
        );
    }
    $request_lock_key = 'figmapress_request_' . substr( hash_hmac( 'sha256', $source_key, wp_salt( 'nonce' ) ), 0, 32 );
    delete_option( $request_lock_key );
    delete_post_meta( $post_id, '_figmapress_prepared' );
    $total_media = absint( get_post_meta( $post_id, '_figmapress_media_total', true ) );
    $saved_media = count( figmapress_connector_load_media_map( $post_id ) );
    return rest_ensure_response(
        array(
            'id'             => $post_id,
            'slug'           => get_post_field( 'post_name', $post_id ),
            'status'         => 'draft',
            'target'         => 'elementor',
            'editLink'       => admin_url( 'post.php?post=' . $post_id . '&action=elementor' ),
            'previewLink'    => get_preview_post_link( $post_id ),
            'rawLink'        => get_permalink( $post_id ),
            'storedElements' => 1,
            'storedBytes'    => $stored_bytes,
            'idempotent'     => true,
            'updated'        => true,
            'savedMedia'     => min( $saved_media, $total_media ),
            'totalMedia'     => $total_media,
            'remainingMedia' => max( 0, $total_media - $saved_media ),
            'failedMedia'    => 0,
            'mediaComplete'  => $saved_media >= $total_media,
            'warnings'       => array( 'WordPressの応答終了後に同じ下書きの完全保存を再確認しました。' ),
        )
    );
}

/**
 * Confirm that a mutation or snapshot request belongs to the FigmaPress draft
 * created by the current browser flow.
 */
function figmapress_connector_validate_owned_elementor_draft( WP_REST_Request $request ) {
    $post_id    = absint( $request->get_param( 'id' ) );
    $params     = $request->get_json_params();
    if ( ! is_array( $params ) ) {
        $params = $request->get_body_params();
    }
    $request_id = isset( $params['requestId'] ) ? sanitize_text_field( $params['requestId'] ) : '';
    if ( $post_id <= 0 || 'page' !== get_post_type( $post_id ) || 'draft' !== get_post_status( $post_id ) ) {
        return new WP_Error( 'figmapress_draft_not_found', 'The requested Elementor draft is not available.', array( 'status' => 404 ) );
    }
    if ( '' === $request_id || ! preg_match( '/^[a-f0-9-]{16,64}$/i', $request_id ) ) {
        return new WP_Error( 'figmapress_invalid_request_id', '作成リクエストの識別情報が無効です。', array( 'status' => 422 ) );
    }

    $stored_request_id = (string) get_post_meta( $post_id, '_figmapress_request_id', true );
    if ( '' === $stored_request_id || ! hash_equals( $stored_request_id, $request_id ) ) {
        return new WP_Error( 'figmapress_draft_mismatch', 'この下書きは現在の変換処理では更新できません。', array( 'status' => 403 ) );
    }
    return $post_id;
}

/**
 * Import the next bounded media batch for an existing draft. Every completed
 * batch is persisted, so a browser timeout or reload can safely resume it.
 */
function figmapress_connector_rest_localize_elementor_media( WP_REST_Request $request ) {
    $post_id = figmapress_connector_validate_owned_elementor_draft( $request );
    if ( is_wp_error( $post_id ) ) {
        return $post_id;
    }

    $content = figmapress_connector_read_elementor_data( $post_id );
    if ( ! is_array( $content ) ) {
        return new WP_Error( 'figmapress_empty_template', 'The Elementor draft contains no editable document.', array( 'status' => 422 ) );
    }

    $warnings         = array();
    $imported_media   = 0;
    $media_deadline   = microtime( true ) + 24;
    $localized_images = figmapress_connector_load_media_map( $post_id );
    $media_failures   = figmapress_connector_load_media_failures( $post_id );
    $params           = $request->get_json_params();
    if ( ! is_array( $params ) ) {
        $params = $request->get_body_params();
    }
    if ( ! empty( $params['retryFailed'] ) ) {
        $media_failures = array();
    }
    figmapress_connector_apply_elementor_image_map( $content, $localized_images );
    figmapress_connector_localize_elementor_images(
        $content,
        $post_id,
        $warnings,
        $imported_media,
        $media_deadline,
        $localized_images,
        $media_failures
    );
    figmapress_connector_save_media_map( $post_id, $localized_images );
    figmapress_connector_save_media_failures( $post_id, $media_failures );

    $page_settings = get_post_meta( $post_id, '_elementor_page_settings', true );
    if ( ! is_array( $page_settings ) ) {
        $page_settings = array();
    }
    $page_template = get_post_meta( $post_id, '_wp_page_template', true );
    if ( ! in_array( $page_template, array( 'elementor_canvas', 'elementor_header_footer', 'default' ), true ) ) {
        $page_template = 'elementor_canvas';
    }
    $stored = figmapress_connector_store_elementor_document( $post_id, $content, $page_settings, $page_template );
    if ( is_wp_error( $stored ) ) {
        return $stored;
    }
    figmapress_connector_clear_elementor_cache( $post_id );

    $progress = figmapress_connector_elementor_media_progress( $content, $post_id );
    if ( $progress['failedMedia'] > 0 ) {
        $warnings[] = '3回試行しても保存できない画像があります。元URLを保持して下書きは編集可能な状態にしています。';
    }
    return rest_ensure_response(
        array_merge(
            array(
                'postId'         => $post_id,
                'status'         => 'draft',
                'importedMedia'  => $imported_media,
                'storedElements' => $stored,
                'warnings'       => array_values( array_unique( $warnings ) ),
            ),
            $progress
        )
    );
}

function figmapress_connector_snapshot_upload_path( $url ) {
    $upload_dir  = wp_upload_dir();
    $upload_url  = isset( $upload_dir['baseurl'] ) ? trailingslashit( $upload_dir['baseurl'] ) : '';
    $upload_path = isset( $upload_dir['basedir'] ) ? trailingslashit( $upload_dir['basedir'] ) : '';
    $clean_url   = is_string( $url ) ? strtok( $url, '?#' ) : false;
    if ( ! $upload_url || ! $upload_path || ! is_string( $clean_url ) || 0 !== strpos( $clean_url, $upload_url ) ) {
        return null;
    }
    $relative_path = rawurldecode( substr( $clean_url, strlen( $upload_url ) ) );
    $candidate     = $upload_path . ltrim( $relative_path, '/' );
    $real_upload   = realpath( $upload_path );
    $real_candidate = realpath( $candidate );
    if (
        ! $real_upload
        || ! $real_candidate
        || 0 !== strpos( $real_candidate, trailingslashit( $real_upload ) )
        || ! is_readable( $real_candidate )
    ) {
        return null;
    }
    return $real_candidate;
}

/**
 * Convert a local Media Library image to a bounded data URL for html2canvas.
 * The data is returned only by the authenticated snapshot response and is not
 * written back to Elementor or exposed by the public draft URL.
 */
function figmapress_connector_snapshot_image_data_url( $url, &$total_bytes, &$asset_cache ) {
    $clean_url = esc_url_raw( html_entity_decode( $url, ENT_QUOTES, 'UTF-8' ), array( 'http', 'https' ) );
    if ( '' === $clean_url ) {
        return null;
    }
    if ( array_key_exists( $clean_url, $asset_cache ) ) {
        return is_string( $asset_cache[ $clean_url ] ) ? $asset_cache[ $clean_url ] : null;
    }
    if ( $total_bytes >= 24 * MB_IN_BYTES ) {
        $asset_cache[ $clean_url ] = null;
        return null;
    }
    $attachment_id = attachment_url_to_postid( $clean_url );
    if ( ! $attachment_id ) {
        // Elementor commonly renders an intermediate image size while
        // attachment_url_to_postid() can resolve only the original filename.
        $original_url = preg_replace(
            '/(?:-\d+x\d+|-scaled)(?=\.[A-Za-z0-9]{2,5}(?:$|[?#]))/',
            '',
            $clean_url
        );
        if ( is_string( $original_url ) && $original_url !== $clean_url ) {
            $attachment_id = attachment_url_to_postid( $original_url );
        }
    }
    if ( ! $attachment_id ) {
        $asset_cache[ $clean_url ] = null;
        return null;
    }
    $path = figmapress_connector_snapshot_upload_path( $clean_url );
    if ( ! $path ) {
        $path = get_attached_file( $attachment_id );
    }

    // The comparison captures at most 800px wide. Prefer WordPress's
    // generated 768px asset when it is smaller than the source so all images
    // fit in one authenticated snapshot without materially reducing accuracy.
    $preview = wp_get_attachment_image_src( $attachment_id, 'medium_large' );
    if ( is_array( $preview ) && ! empty( $preview[0] ) ) {
        $preview_path = figmapress_connector_snapshot_upload_path( $preview[0] );
        $source_size  = is_string( $path ) && is_readable( $path ) ? filesize( $path ) : false;
        $preview_size = $preview_path ? filesize( $preview_path ) : false;
        if ( false !== $preview_size && $preview_size > 0 && ( false === $source_size || $preview_size < $source_size ) ) {
            $path = $preview_path;
        }
    }
    if ( ! is_string( $path ) || ! is_readable( $path ) ) {
        $asset_cache[ $clean_url ] = null;
        return null;
    }
    $size = filesize( $path );
    if ( false === $size || $size <= 0 || $size > 4 * MB_IN_BYTES || $total_bytes + $size > 24 * MB_IN_BYTES ) {
        $asset_cache[ $clean_url ] = null;
        return null;
    }
    $mime = wp_check_filetype( $path );
    $type = isset( $mime['type'] ) ? $mime['type'] : '';
    if ( ! in_array( $type, array( 'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif' ), true ) ) {
        $asset_cache[ $clean_url ] = null;
        return null;
    }
    $contents = file_get_contents( $path );
    if ( false === $contents ) {
        $asset_cache[ $clean_url ] = null;
        return null;
    }
    $total_bytes += $size;
    $asset_cache[ $clean_url ] = 'data:' . $type . ';base64,' . base64_encode( $contents );
    return $asset_cache[ $clean_url ];
}

function figmapress_connector_embed_snapshot_html_images( $html, &$total_bytes, &$asset_cache ) {
    return preg_replace_callback(
        '#(<img\b[^>]*\bsrc=["\'])(https?://[^"\']+)(["\'])#i',
        function ( $matches ) use ( &$total_bytes, &$asset_cache ) {
            $data_url = figmapress_connector_snapshot_image_data_url( $matches[2], $total_bytes, $asset_cache );
            return $data_url ? $matches[1] . $data_url . $matches[3] : $matches[0];
        },
        $html
    );
}

function figmapress_connector_embed_snapshot_css_images( $css, &$total_bytes, &$asset_cache ) {
    return preg_replace_callback(
        '#url\((["\']?)(https?://[^"\')]+)\1\)#i',
        function ( $matches ) use ( &$total_bytes, &$asset_cache ) {
            $data_url = figmapress_connector_snapshot_image_data_url( $matches[2], $total_bytes, $asset_cache );
            return $data_url ? 'url("' . $data_url . '")' : $matches[0];
        },
        $css
    );
}

/**
 * Return Elementor's active frontend foundation CSS for an isolated snapshot.
 * REST rendering does not run the complete theme enqueue lifecycle on every
 * host, so wp_print_styles() can omit the .e-con rules that apply container
 * height, positioning and flex layout variables.
 */
function figmapress_connector_snapshot_elementor_frontend_css() {
    $candidates = array();
    if ( defined( 'ELEMENTOR_ASSETS_PATH' ) ) {
        $candidates[] = trailingslashit( ELEMENTOR_ASSETS_PATH ) . 'css/frontend.min.css';
    }
    if ( defined( 'ELEMENTOR_PATH' ) ) {
        $candidates[] = trailingslashit( ELEMENTOR_PATH ) . 'assets/css/frontend.min.css';
    }

    foreach ( array_unique( $candidates ) as $path ) {
        if ( ! is_string( $path ) || ! is_readable( $path ) ) {
            continue;
        }
        $size = filesize( $path );
        if ( false === $size || $size <= 0 || $size > 1500000 ) {
            continue;
        }
        $css = file_get_contents( $path );
        if ( is_string( $css ) && '' !== trim( $css ) ) {
            return $css;
        }
    }
    return '';
}

/**
 * Read the Connector widget stylesheet for authenticated snapshot parity.
 *
 * REST requests do not always run the normal wp_enqueue_scripts lifecycle.
 * Relying only on an enqueued handle can therefore leave functional widgets
 * unstyled in Visual QA even though the public Elementor page is correct.
 */
function figmapress_connector_snapshot_interactions_css() {
    $path = FIGMAPRESS_CONNECTOR_DIR . 'assets/elementor-interactions.css';
    if ( ! is_readable( $path ) ) {
        return '';
    }
    $size = filesize( $path );
    if ( false === $size || $size <= 0 || $size > 100000 ) {
        return '';
    }
    $css = file_get_contents( $path );
    return is_string( $css ) ? figmapress_connector_snapshot_css_compatibility( $css ) : '';
}

/**
 * Keep snapshot CSS compatible with html2canvas while preserving the public
 * stylesheet's progressive color-mix() declarations. Every affected rule has
 * an rgba fallback immediately before the modern declaration.
 */
function figmapress_connector_snapshot_css_compatibility( $css ) {
    $compatible = preg_replace(
        '/^[\t ]*(?:outline|background|border-bottom):[^;\r\n]*color-mix\([^;\r\n]*;[\t ]*$/mi',
        '',
        (string) $css
    );
    return is_string( $compatible ) ? $compatible : '';
}

/**
 * Render the stored Elementor document through Elementor's real frontend
 * renderer. The response is authenticated and never exposes the draft publicly.
 */
function figmapress_connector_rest_elementor_snapshot( WP_REST_Request $request ) {
    $post_id = figmapress_connector_validate_owned_elementor_draft( $request );
    if ( is_wp_error( $post_id ) ) {
        return $post_id;
    }
    if ( ! class_exists( '\\Elementor\\Plugin' ) || ! isset( \Elementor\Plugin::$instance->frontend ) ) {
        return new WP_Error( 'figmapress_elementor_missing', 'Elementor is not active on this site.', array( 'status' => 409 ) );
    }

    try {
        $frontend = \Elementor\Plugin::$instance->frontend;
        // The REST lifecycle can skip the hooks that normally register these
        // assets. Register them explicitly before Elementor resolves widget
        // style dependencies and before wp_print_styles() runs.
        figmapress_connector_register_elementor_assets();
        if ( method_exists( $frontend, 'enqueue_styles' ) ) {
            $frontend->enqueue_styles();
        }
        wp_enqueue_style( 'elementor-frontend' );
        wp_enqueue_style( 'figmapress-elementor-interactions' );
        figmapress_connector_enqueue_page_webfonts( $post_id );

        if ( class_exists( '\\Elementor\\Core\\Files\\CSS\\Post' ) ) {
            $post_css = new \Elementor\Core\Files\CSS\Post( $post_id );
            if ( method_exists( $post_css, 'update' ) ) {
                $post_css->update();
            }
            if ( method_exists( $post_css, 'enqueue' ) ) {
                $post_css->enqueue();
            }
        }

        $html = $frontend->get_builder_content_for_display( $post_id, true );
        if ( ! is_string( $html ) || '' === trim( $html ) ) {
            return new WP_Error( 'figmapress_snapshot_empty', 'Elementor rendered an empty document.', array( 'status' => 500 ) );
        }
        if ( strlen( $html ) > 2500000 ) {
            return new WP_Error( 'figmapress_snapshot_too_large', 'The rendered Elementor document is too large to compare safely.', array( 'status' => 413 ) );
        }

        // Scripts are unnecessary for pixel comparison. Remove them even
        // though the browser snapshot sandbox also blocks script execution.
        $html = preg_replace( '#<script\b[^>]*>.*?</script>#is', '', $html );
        $embedded_asset_bytes = 0;
        $embedded_asset_cache = array();
        $html                 = figmapress_connector_embed_snapshot_html_images( $html, $embedded_asset_bytes, $embedded_asset_cache );
        $styles = '';
        $elementor_frontend_css = figmapress_connector_snapshot_elementor_frontend_css();
        if ( '' !== $elementor_frontend_css ) {
            $styles .= '<style data-figmapress-elementor-frontend-css>'
                . $elementor_frontend_css
                . '</style>';
        }
        $interactions_css = figmapress_connector_snapshot_interactions_css();
        if ( '' !== $interactions_css ) {
            $styles .= '<style data-figmapress-interactions-css>'
                . $interactions_css
                . '</style>';
        }

        ob_start();
        wp_print_styles();
        $printed_styles = ob_get_clean();
        if ( ! is_string( $printed_styles ) ) {
            $printed_styles = '';
        }
        if ( strlen( $printed_styles ) > 500000 ) {
            $printed_styles = substr( $printed_styles, 0, 500000 );
        }
        $styles .= $printed_styles;

        // Elementor's generated post stylesheet contains background images.
        // Inline the local file after the regular styles so those images can
        // also be embedded without cross-origin canvas tainting.
        $upload_dir    = wp_upload_dir();
        $post_css_path = trailingslashit( $upload_dir['basedir'] ) . 'elementor/css/post-' . $post_id . '.css';
        if ( is_readable( $post_css_path ) && filesize( $post_css_path ) <= 500000 ) {
            $post_css = file_get_contents( $post_css_path );
            if ( is_string( $post_css ) ) {
                $styles .= '<style data-figmapress-elementor-post-css>'
                    . figmapress_connector_embed_snapshot_css_images( $post_css, $embedded_asset_bytes, $embedded_asset_cache )
                    . '</style>';
            }
        }

        return rest_ensure_response(
            array(
                'postId'         => $post_id,
                'html'           => $html,
                'styles'         => $styles,
                'storedElements' => figmapress_connector_count_elementor_elements( figmapress_connector_read_elementor_data( $post_id ) ),
                'embeddedAssetsBytes' => $embedded_asset_bytes,
                'embeddedAssetsCount' => count( array_filter( $embedded_asset_cache, 'is_string' ) ),
                'omittedAssetsCount' => count( array_filter( $embedded_asset_cache, 'is_null' ) ),
                'webfonts'       => array_keys( figmapress_connector_page_webfonts( $post_id ) ),
                'generatedAt'    => gmdate( 'c' ),
            )
        );
    } catch ( Throwable $error ) {
        return new WP_Error(
            'figmapress_snapshot_failed',
            'Elementorの実ページ描画を取得できませんでした。',
            array( 'status' => 500 )
        );
    }
}

/**
 * Replace only a matching FigmaPress draft document. A WordPress revision is
 * created first and the caller can send the baseline template again to roll
 * back a correction that did not improve the measured output.
 */
function figmapress_connector_rest_update_elementor_document( WP_REST_Request $request ) {
    $post_id = figmapress_connector_validate_owned_elementor_draft( $request );
    if ( is_wp_error( $post_id ) ) {
        return $post_id;
    }

    $params   = $request->get_json_params();
    $template = isset( $params['template'] ) && is_array( $params['template'] ) ? $params['template'] : null;
    if ( ! $template || '0.4' !== ( isset( $template['version'] ) ? (string) $template['version'] : '' ) ) {
        return new WP_Error( 'figmapress_invalid_template', 'The Elementor template payload is invalid.', array( 'status' => 422 ) );
    }

    $element_count = 0;
    $content       = figmapress_connector_sanitize_elementor_elements(
        isset( $template['content'] ) ? $template['content'] : array(),
        $element_count
    );
    if ( is_wp_error( $content ) ) {
        return $content;
    }
    if ( 0 === $element_count ) {
        return new WP_Error( 'figmapress_empty_template', 'The Elementor template contains no supported elements.', array( 'status' => 422 ) );
    }

    $page_settings = isset( $template['page_settings'] ) && is_array( $template['page_settings'] )
        ? figmapress_connector_sanitize_elementor_value( $template['page_settings'] )
        : array();
    $page_template = isset( $params['pageTemplate'] ) ? $params['pageTemplate'] : 'elementor_canvas';
    if ( ! in_array( $page_template, array( 'elementor_canvas', 'elementor_header_footer', 'default' ), true ) ) {
        $page_template = 'elementor_canvas';
    }

    // Visual QA sends the corrected source template again. Reapply every
    // previously imported image before saving so a correction can never roll
    // Media Library URLs back to expiring Figma URLs.
    $media_total = figmapress_connector_count_unique_elementor_images( $content );
    update_post_meta( $post_id, '_figmapress_media_total', $media_total );
    $localized_images = figmapress_connector_load_media_map( $post_id );
    figmapress_connector_apply_elementor_image_map( $content, $localized_images );

    $revision_id = wp_save_post_revision( $post_id );
    $stored      = figmapress_connector_store_elementor_document( $post_id, $content, $page_settings, $page_template );
    if ( is_wp_error( $stored ) ) {
        return $stored;
    }
    update_post_meta( $post_id, '_figmapress_last_visual_update', time() );
    figmapress_connector_clear_elementor_cache( $post_id );

    return rest_ensure_response(
        array(
            'postId'         => $post_id,
            'status'         => 'draft',
            'storedElements' => $stored,
            'revisionId'     => is_numeric( $revision_id ) ? absint( $revision_id ) : null,
        )
    );
}

function figmapress_connector_ensure_elementor_containers() {
    if ( ! class_exists( '\\Elementor\\Plugin' ) || ! isset( \Elementor\Plugin::$instance->elements_manager ) ) {
        return new WP_Error(
            'figmapress_elementor_container_unavailable',
            'Elementor Containers are not available on this site.',
            array( 'status' => 409 )
        );
    }

    $elements_manager = \Elementor\Plugin::$instance->elements_manager;
    if ( method_exists( $elements_manager, 'get_element_types' ) ) {
        $container = $elements_manager->get_element_types( 'container' );
        if ( $container ) {
            return false;
        }
    }

    if ( ! current_user_can( 'manage_options' ) ) {
        return new WP_Error(
            'figmapress_elementor_container_inactive',
            'Elementor Containers are disabled. Ask a WordPress administrator to enable Elementor > Settings > Features > Container.',
            array( 'status' => 409 )
        );
    }

    if ( ! isset( \Elementor\Plugin::$instance->experiments ) ) {
        return new WP_Error(
            'figmapress_elementor_container_unavailable',
            'Elementor Containers are not available on this site.',
            array( 'status' => 409 )
        );
    }

    $experiments = \Elementor\Plugin::$instance->experiments;
    $feature     = method_exists( $experiments, 'get_features' )
        ? $experiments->get_features( 'container' )
        : null;
    if ( ! $feature ) {
        return new WP_Error(
            'figmapress_elementor_container_unavailable',
            'This Elementor version does not provide the Container feature required by the generated page.',
            array( 'status' => 409 )
        );
    }

    $option_key = method_exists( $experiments, 'get_feature_option_key' )
        ? $experiments->get_feature_option_key( 'container' )
        : 'elementor_experiment-container';
    update_option( $option_key, 'active' );

    if ( 'active' !== get_option( $option_key ) ) {
        return new WP_Error(
            'figmapress_elementor_container_activation_failed',
            'Elementor Containers could not be enabled on this site.',
            array( 'status' => 500 )
        );
    }

    return true;
}

function figmapress_connector_store_elementor_document( $post_id, $content, $page_settings, $page_template, $request_id = '', $source_key = '' ) {
    $expected_elements = figmapress_connector_count_elementor_elements( $content );
    $encoded_content   = wp_json_encode( $content );
    if ( false === $encoded_content ) {
        return new WP_Error(
            'figmapress_elementor_encode_failed',
            'Elementor data could not be encoded for storage.',
            array(
                'status'           => 500,
                'expectedElements' => $expected_elements,
            )
        );
    }
    $encoded_bytes = strlen( $encoded_content );

    // Store the complete editable document before calling Elementor's
    // Document API. On shared hosts a multi-megabyte absolute-positioned page
    // can spend the whole PHP request inside Document::save(), leaving an empty
    // draft and a stale request lock. Elementor reads these same metadata keys,
    // so this direct write is both a durable checkpoint and the fast path for
    // large documents.
    // Store this attempt's expected database fingerprint before the large
    // metadata write. Some shared hosts commit _elementor_data and terminate
    // PHP from inside update_metadata() before the next statement runs. The
    // confirmation route still requires the database byte length and SHA-256
    // to equal these values, so a partial or previous document cannot pass.
    if (
        preg_match( '/^[a-f0-9-]{16,64}$/i', $request_id ) &&
        preg_match( figmapress_connector_site_source_key_pattern(), $source_key )
    ) {
        update_post_meta( $post_id, '_figmapress_stored_request_id', $request_id );
        update_post_meta( $post_id, '_figmapress_stored_source_key', $source_key );
        update_post_meta( $post_id, '_figmapress_stored_bytes', $encoded_bytes );
        update_post_meta( $post_id, '_figmapress_stored_hash', hash( 'sha256', $encoded_content ) );
    }
    $direct_meta_write = update_metadata(
        'post',
        $post_id,
        '_elementor_data',
        wp_slash( $encoded_content )
    );
    update_post_meta( $post_id, '_elementor_edit_mode', 'builder' );
    update_post_meta( $post_id, '_elementor_template_type', 'wp-page' );
    update_post_meta( $post_id, '_elementor_version', defined( 'ELEMENTOR_VERSION' ) ? ELEMENTOR_VERSION : '' );
    update_post_meta( $post_id, '_elementor_page_settings', $page_settings );
    update_post_meta( $post_id, '_wp_page_template', $page_template );

    $saved_with_document_api = false;
    $document_api_skipped    = $expected_elements > 350 || $encoded_bytes > 600000;
    if (
        ! $document_api_skipped &&
        class_exists( '\\Elementor\\Plugin' ) &&
        isset( \Elementor\Plugin::$instance->documents )
    ) {
        try {
            $document = \Elementor\Plugin::$instance->documents->get( $post_id );
            if ( $document && method_exists( $document, 'save' ) ) {
                $saved_with_document_api = true === $document->save(
                    array(
                        'elements' => $content,
                        'settings' => $page_settings,
                    )
                );
            }
        } catch ( Throwable $error ) {
            $saved_with_document_api = false;
        }

        // Elementor may normalize the document while dropping FigmaPress QA
        // metadata. Restore the already-sanitized source after its bookkeeping.
        $direct_meta_write = update_metadata(
            'post',
            $post_id,
            '_elementor_data',
            wp_slash( $encoded_content )
        );
        update_post_meta( $post_id, '_elementor_page_settings', $page_settings );
        update_post_meta( $post_id, '_wp_page_template', $page_template );
    }

    // Persistent object caches can briefly retain an older value. Force the
    // verification read back to the database after the final metadata write.
    // For a large document, decoding the complete JSON for a second element
    // count can multiply peak memory. Verify the durable database byte length
    // instead; the incoming structure was already sanitized and counted.
    wp_cache_delete( $post_id, 'post_meta' );
    if ( $document_api_skipped ) {
        $stored_bytes    = figmapress_connector_elementor_storage_bytes( $post_id );
        $stored_data     = null;
        $stored_elements = $stored_bytes === $encoded_bytes ? $expected_elements : 0;
    } else {
        $stored_data     = figmapress_connector_read_elementor_data( $post_id );
        $stored_elements = is_array( $stored_data )
            ? figmapress_connector_count_elementor_elements( $stored_data )
            : 0;
        $stored_bytes    = is_string( $stored_data ) ? strlen( $stored_data ) : 0;
    }

    if ( $stored_elements !== $expected_elements ) {
        return new WP_Error(
            'figmapress_elementor_save_failed',
            'Elementor data could not be stored on this server.',
            array(
                'status'                => 500,
                'expectedElements'      => $expected_elements,
                'storedElements'        => $stored_elements,
                'documentSaveCompleted' => $saved_with_document_api,
                'documentApiSkipped'    => $document_api_skipped,
                'directMetaWrite'       => false !== $direct_meta_write,
                'encodedBytes'          => $encoded_bytes,
                'storedBytes'           => $stored_bytes,
            )
        );
    }

    return $stored_elements;
}

function figmapress_connector_read_elementor_data( $post_id ) {
    $stored_value = get_metadata( 'post', $post_id, '_elementor_data', true );
    if ( is_array( $stored_value ) ) {
        return $stored_value;
    }
    if ( ! is_string( $stored_value ) || '' === trim( $stored_value ) ) {
        return null;
    }

    $decoded = json_decode( $stored_value, true );
    return is_array( $decoded ) ? $decoded : null;
}

function figmapress_connector_elementor_storage_bytes( $post_id ) {
    global $wpdb;
    $bytes = $wpdb->get_var(
        $wpdb->prepare(
            "SELECT OCTET_LENGTH(meta_value) FROM {$wpdb->postmeta} WHERE post_id = %d AND meta_key = %s ORDER BY meta_id DESC LIMIT 1",
            absint( $post_id ),
            '_elementor_data'
        )
    );
    return is_numeric( $bytes ) ? absint( $bytes ) : 0;
}

function figmapress_connector_elementor_storage_hash( $post_id ) {
    global $wpdb;
    $hash = $wpdb->get_var(
        $wpdb->prepare(
            "SELECT LOWER(SHA2(meta_value, 256)) FROM {$wpdb->postmeta} WHERE post_id = %d AND meta_key = %s ORDER BY meta_id DESC LIMIT 1",
            absint( $post_id ),
            '_elementor_data'
        )
    );
    return is_string( $hash ) ? strtolower( $hash ) : '';
}

function figmapress_connector_elementor_storage_receipt( $post_id ) {
    global $wpdb;
    $keys         = array(
        '_figmapress_stored_request_id',
        '_figmapress_stored_source_key',
        '_figmapress_stored_bytes',
        '_figmapress_stored_hash',
    );
    $placeholders = implode( ',', array_fill( 0, count( $keys ), '%s' ) );
    $query_args   = array_merge( array( absint( $post_id ) ), $keys );
    $rows         = $wpdb->get_results(
        $wpdb->prepare(
            "SELECT meta_key, meta_value FROM {$wpdb->postmeta} WHERE post_id = %d AND meta_key IN ({$placeholders}) ORDER BY meta_id ASC",
            $query_args
        ),
        ARRAY_A
    );
    $receipt      = array();
    foreach ( is_array( $rows ) ? $rows : array() as $row ) {
        if ( isset( $row['meta_key'], $row['meta_value'] ) && in_array( $row['meta_key'], $keys, true ) ) {
            $receipt[ $row['meta_key'] ] = $row['meta_value'];
        }
    }
    return $receipt;
}

function figmapress_connector_count_elementor_elements( $elements ) {
    if ( ! is_array( $elements ) ) {
        return 0;
    }
    $count = 0;
    foreach ( $elements as $element ) {
        if ( ! is_array( $element ) ) {
            continue;
        }
        ++$count;
        if ( isset( $element['elements'] ) && is_array( $element['elements'] ) ) {
            $count += figmapress_connector_count_elementor_elements( $element['elements'] );
        }
    }
    return $count;
}

function figmapress_connector_sanitize_elementor_elements( $elements, &$count ) {
    if ( ! is_array( $elements ) ) {
        return new WP_Error( 'figmapress_invalid_elements', 'Elementor content must be an array.', array( 'status' => 422 ) );
    }

    $result          = array();
    $allowed_widgets = array(
        'heading',
        'text-editor',
        'button',
        'image',
        'figmapress-nav',
        'figmapress-link',
        'figmapress-carousel',
        'figmapress-contact-form',
        'figmapress-accordion',
    );
    foreach ( $elements as $element ) {
        if ( ! is_array( $element ) || $count >= 1200 ) {
            continue;
        }
        $el_type = isset( $element['elType'] ) ? $element['elType'] : '';
        if ( 'container' !== $el_type && 'widget' !== $el_type ) {
            continue;
        }
        $widget_type = isset( $element['widgetType'] ) ? sanitize_key( $element['widgetType'] ) : '';
        if ( 'widget' === $el_type && ! in_array( $widget_type, $allowed_widgets, true ) ) {
            continue;
        }

        ++$count;
        $children = figmapress_connector_sanitize_elementor_elements(
            isset( $element['elements'] ) ? $element['elements'] : array(),
            $count
        );
        if ( is_wp_error( $children ) ) {
            return $children;
        }

        $clean = array(
            'id'       => preg_replace( '/[^a-f0-9]/', '', strtolower( isset( $element['id'] ) ? $element['id'] : '' ) ),
            'elType'   => $el_type,
            'isInner'  => ! empty( $element['isInner'] ),
            'settings' => figmapress_connector_sanitize_elementor_value( isset( $element['settings'] ) ? $element['settings'] : array() ),
            'elements' => $children,
        );
        if ( strlen( $clean['id'] ) < 6 ) {
            $clean['id'] = substr( md5( wp_generate_uuid4() ), 0, 8 );
        }
        if ( 'widget' === $el_type ) {
            $clean['widgetType'] = $widget_type;
        }
        $result[] = $clean;
    }
    return $result;
}

function figmapress_connector_sanitize_elementor_value( $value, $key = '', $depth = 0 ) {
    if ( $depth > 24 ) {
        return null;
    }
    if ( is_array( $value ) ) {
        $clean = array();
        foreach ( $value as $child_key => $child_value ) {
            // Elementor uses case-sensitive setting keys such as `isLinked`.
            // Keep their casing while still rejecting unexpected characters.
            $safe_key = is_int( $child_key )
                ? $child_key
                : preg_replace( '/[^A-Za-z0-9_-]/', '', (string) $child_key );
            if ( '' === $safe_key || null === $safe_key ) {
                continue;
            }
            $clean[ $safe_key ] = figmapress_connector_sanitize_elementor_value( $child_value, (string) $safe_key, $depth + 1 );
        }
        return $clean;
    }
    if ( is_bool( $value ) || is_int( $value ) || is_float( $value ) || null === $value ) {
        return $value;
    }
    if ( ! is_string( $value ) ) {
        return '';
    }
    if ( 'editor' === $key ) {
        add_filter( 'safe_style_css', 'figmapress_connector_allow_layout_css' );
        try {
            return wp_kses_post( $value );
        } finally {
            remove_filter( 'safe_style_css', 'figmapress_connector_allow_layout_css' );
        }
    }
    if ( 'url' === $key ) {
        return esc_url_raw( $value, array( 'http', 'https', 'mailto', 'tel' ) );
    }
    return sanitize_text_field( $value );
}

function figmapress_connector_allow_layout_css( $properties ) {
    return array_values(
        array_unique(
            array_merge(
                $properties,
                array(
                    'display',
                    'flex-direction',
                    'justify-content',
                    'min-height',
                    'overflow',
                    'overflow-wrap',
                    'white-space',
                    'word-break',
                )
            )
        )
    );
}

function figmapress_connector_image_setting_url( $image ) {
    return is_array( $image ) && isset( $image['url'] ) && is_string( $image['url'] )
        ? trim( $image['url'] )
        : '';
}

function figmapress_connector_image_setting_key( $image ) {
    if ( ! is_array( $image ) || empty( $image['figmapress_key'] ) || ! is_string( $image['figmapress_key'] ) ) {
        return '';
    }
    $key = preg_replace( '/[^A-Za-z0-9:_-]/', '', $image['figmapress_key'] );
    return is_string( $key ) ? substr( $key, 0, 190 ) : '';
}

function figmapress_connector_collect_elementor_image_urls( $elements, &$urls, $remote_only = false ) {
    foreach ( $elements as $element ) {
        if ( ! is_array( $element ) ) {
            continue;
        }
        $settings    = isset( $element['settings'] ) && is_array( $element['settings'] ) ? $element['settings'] : array();
        $image_slots = array();
        if ( 'widget' === ( isset( $element['elType'] ) ? $element['elType'] : '' ) ) {
            $widget_type = isset( $element['widgetType'] ) ? $element['widgetType'] : '';
            if ( 'image' === $widget_type && isset( $settings['image'] ) ) {
                $image_slots[] = $settings['image'];
            }
            if ( 'figmapress-nav' === $widget_type ) {
                foreach ( array( 'logo', 'cta_icon' ) as $nav_image_key ) {
                    if ( isset( $settings[ $nav_image_key ] ) ) {
                        $image_slots[] = $settings[ $nav_image_key ];
                    }
                }
            }
            if ( 'figmapress-carousel' === $widget_type ) {
                if ( isset( $settings['items'] ) && is_array( $settings['items'] ) ) {
                    foreach ( $settings['items'] as $item ) {
                        if ( is_array( $item ) && isset( $item['image'] ) ) {
                            $image_slots[] = $item['image'];
                        }
                    }
                }
                foreach ( array( 'previous_icon', 'next_icon' ) as $icon_key ) {
                    if ( isset( $settings[ $icon_key ] ) ) {
                        $image_slots[] = $settings[ $icon_key ];
                    }
                }
            }
        }
        if ( 'container' === ( isset( $element['elType'] ) ? $element['elType'] : '' ) && isset( $settings['background_image'] ) ) {
            $image_slots[] = $settings['background_image'];
        }
        foreach ( $image_slots as $image ) {
            $url = figmapress_connector_image_setting_url( $image );
            if ( '' === $url ) {
                continue;
            }
            if (
                $remote_only
                && is_array( $image )
                && 'library' === ( isset( $image['source'] ) ? $image['source'] : '' )
                && ! empty( $image['id'] )
            ) {
                continue;
            }
            $urls[ hash( 'sha256', $url ) ] = $url;
        }
        if ( isset( $element['elements'] ) && is_array( $element['elements'] ) ) {
            figmapress_connector_collect_elementor_image_urls( $element['elements'], $urls, $remote_only );
        }
    }
}

function figmapress_connector_count_unique_elementor_images( $elements ) {
    $urls = array();
    figmapress_connector_collect_elementor_image_urls( $elements, $urls, false );
    return count( $urls );
}

function figmapress_connector_load_media_map( $post_id ) {
    $stored = get_post_meta( $post_id, '_figmapress_media_map', true );
    $map    = array();
    if ( ! is_array( $stored ) ) {
        return $map;
    }
    foreach ( array_slice( $stored, 0, 300, true ) as $entry ) {
        if ( ! is_array( $entry ) ) {
            continue;
        }
        $source_url    = isset( $entry['sourceUrl'] ) ? esc_url_raw( $entry['sourceUrl'], array( 'https' ) ) : '';
        $attachment_id = isset( $entry['id'] ) ? absint( $entry['id'] ) : 0;
        $local_url     = $attachment_id ? wp_get_attachment_url( $attachment_id ) : false;
        if ( '' === $source_url || ! $local_url ) {
            continue;
        }
        $map[ $source_url ] = array(
            'id'     => $attachment_id,
            'url'    => $local_url,
            'source' => 'library',
            'sourceUrl' => $source_url,
            'stableKey' => isset( $entry['stableKey'] ) ? figmapress_connector_image_setting_key( array( 'figmapress_key' => $entry['stableKey'] ) ) : '',
        );
        if ( '' !== $map[ $source_url ]['stableKey'] ) {
            $map[ 'key:' . $map[ $source_url ]['stableKey'] ] = $map[ $source_url ];
        }
    }
    return $map;
}

function figmapress_connector_save_media_map( $post_id, $map ) {
    $stored = array();
    foreach ( $map as $entry ) {
        if ( count( $stored ) >= 300 || ! is_array( $entry ) ) {
            continue;
        }
        $source_url = isset( $entry['sourceUrl'] ) ? $entry['sourceUrl'] : '';
        $stable_key = isset( $entry['stableKey'] ) ? $entry['stableKey'] : '';
        $attachment_id = isset( $entry['id'] ) ? absint( $entry['id'] ) : 0;
        if ( 0 !== strpos( $source_url, 'https://' ) || ! $attachment_id || ! wp_get_attachment_url( $attachment_id ) ) {
            continue;
        }
        $record_key = '' !== $stable_key ? 'key:' . $stable_key : 'url:' . hash( 'sha256', $source_url );
        $stored[ hash( 'sha256', $record_key ) ] = array(
            'sourceUrl' => $source_url,
            'stableKey' => $stable_key,
            'id'        => $attachment_id,
        );
    }
    update_post_meta( $post_id, '_figmapress_media_map', $stored );
}

function figmapress_connector_load_media_failures( $post_id ) {
    $stored = get_post_meta( $post_id, '_figmapress_media_failures', true );
    return is_array( $stored ) ? array_slice( $stored, 0, 300, true ) : array();
}

function figmapress_connector_save_media_failures( $post_id, $failures ) {
    $clean = array();
    foreach ( array_slice( $failures, 0, 300, true ) as $url_hash => $attempts ) {
        if ( preg_match( '/^[a-f0-9]{64}$/', (string) $url_hash ) ) {
            $clean[ $url_hash ] = min( 3, absint( $attempts ) );
        }
    }
    if ( $clean ) {
        update_post_meta( $post_id, '_figmapress_media_failures', $clean );
    } else {
        delete_post_meta( $post_id, '_figmapress_media_failures' );
    }
}

function figmapress_connector_apply_image_map_setting( &$image, $localized_images ) {
    $url = figmapress_connector_image_setting_url( $image );
    $stable_key = figmapress_connector_image_setting_key( $image );
    $match = '' !== $stable_key && isset( $localized_images[ 'key:' . $stable_key ] )
        ? $localized_images[ 'key:' . $stable_key ]
        : ( '' !== $url && isset( $localized_images[ $url ] ) ? $localized_images[ $url ] : null );
    if ( is_array( $match ) ) {
        $image = array_merge(
            $image,
            array(
                'id'     => isset( $match['id'] ) ? $match['id'] : '',
                'url'    => isset( $match['url'] ) ? $match['url'] : $url,
                'source' => 'library',
            )
        );
    }
}

function figmapress_connector_apply_elementor_image_map( &$elements, $localized_images ) {
    foreach ( $elements as &$element ) {
        if ( ! is_array( $element ) ) {
            continue;
        }
        if ( 'widget' === ( isset( $element['elType'] ) ? $element['elType'] : '' ) && 'image' === ( isset( $element['widgetType'] ) ? $element['widgetType'] : '' ) && isset( $element['settings']['image'] ) ) {
            figmapress_connector_apply_image_map_setting( $element['settings']['image'], $localized_images );
        }
        if ( 'widget' === ( isset( $element['elType'] ) ? $element['elType'] : '' ) && 'figmapress-nav' === ( isset( $element['widgetType'] ) ? $element['widgetType'] : '' ) ) {
            foreach ( array( 'logo', 'cta_icon' ) as $nav_image_key ) {
                if ( isset( $element['settings'][ $nav_image_key ] ) ) {
                    figmapress_connector_apply_image_map_setting( $element['settings'][ $nav_image_key ], $localized_images );
                }
            }
        }
        if ( 'widget' === ( isset( $element['elType'] ) ? $element['elType'] : '' ) && 'figmapress-carousel' === ( isset( $element['widgetType'] ) ? $element['widgetType'] : '' ) ) {
            if ( isset( $element['settings']['items'] ) && is_array( $element['settings']['items'] ) ) {
                foreach ( $element['settings']['items'] as &$carousel_item ) {
                    if ( isset( $carousel_item['image'] ) ) {
                        figmapress_connector_apply_image_map_setting( $carousel_item['image'], $localized_images );
                    }
                }
                unset( $carousel_item );
            }
            foreach ( array( 'previous_icon', 'next_icon' ) as $icon_key ) {
                if ( isset( $element['settings'][ $icon_key ] ) ) {
                    figmapress_connector_apply_image_map_setting( $element['settings'][ $icon_key ], $localized_images );
                }
            }
        }
        if ( 'container' === ( isset( $element['elType'] ) ? $element['elType'] : '' ) && isset( $element['settings']['background_image'] ) ) {
            figmapress_connector_apply_image_map_setting( $element['settings']['background_image'], $localized_images );
        }
        if ( ! empty( $element['elements'] ) ) {
            figmapress_connector_apply_elementor_image_map( $element['elements'], $localized_images );
        }
    }
    unset( $element );
}

function figmapress_connector_elementor_media_progress( $elements, $post_id ) {
    $pending_urls = array();
    figmapress_connector_collect_elementor_image_urls( $elements, $pending_urls, true );
    $failures = figmapress_connector_load_media_failures( $post_id );
    $failed   = 0;
    foreach ( $pending_urls as $url_hash => $url ) {
        if ( isset( $failures[ $url_hash ] ) && absint( $failures[ $url_hash ] ) >= 3 ) {
            ++$failed;
        }
    }
    $pending_total = count( $pending_urls );
    $remaining     = max( 0, $pending_total - $failed );
    $total         = absint( get_post_meta( $post_id, '_figmapress_media_total', true ) );
    if ( $total < $pending_total ) {
        $total = $pending_total;
    }
    return array(
        'savedMedia'     => max( 0, $total - $pending_total ),
        'totalMedia'     => $total,
        'remainingMedia' => $remaining,
        'failedMedia'    => $failed,
        'mediaComplete'  => 0 === $remaining && 0 === $failed,
    );
}

function figmapress_connector_localize_elementor_images( &$elements, $post_id, &$warnings, &$imported_media, $deadline, &$localized_images, &$media_failures ) {
    foreach ( $elements as &$element ) {
        if ( microtime( true ) >= $deadline ) {
            figmapress_connector_add_media_budget_warning( $warnings );
            return;
        }
        if ( 'widget' === $element['elType'] && 'image' === ( isset( $element['widgetType'] ) ? $element['widgetType'] : '' ) && isset( $element['settings']['image'] ) ) {
            figmapress_connector_localize_image_setting( $element['settings']['image'], $post_id, $warnings, $imported_media, $deadline, $localized_images, $media_failures );
        }
        if ( 'widget' === $element['elType'] && 'figmapress-nav' === ( isset( $element['widgetType'] ) ? $element['widgetType'] : '' ) ) {
            foreach ( array( 'logo', 'cta_icon' ) as $nav_image_key ) {
                if ( isset( $element['settings'][ $nav_image_key ] ) ) {
                    figmapress_connector_localize_image_setting( $element['settings'][ $nav_image_key ], $post_id, $warnings, $imported_media, $deadline, $localized_images, $media_failures );
                }
            }
        }
        if ( 'widget' === $element['elType'] && 'figmapress-carousel' === ( isset( $element['widgetType'] ) ? $element['widgetType'] : '' ) ) {
            if ( isset( $element['settings']['items'] ) && is_array( $element['settings']['items'] ) ) {
                foreach ( $element['settings']['items'] as &$carousel_item ) {
                    if ( isset( $carousel_item['image'] ) ) {
                        figmapress_connector_localize_image_setting( $carousel_item['image'], $post_id, $warnings, $imported_media, $deadline, $localized_images, $media_failures );
                    }
                }
                unset( $carousel_item );
            }
            foreach ( array( 'previous_icon', 'next_icon' ) as $icon_key ) {
                if ( isset( $element['settings'][ $icon_key ] ) ) {
                    figmapress_connector_localize_image_setting( $element['settings'][ $icon_key ], $post_id, $warnings, $imported_media, $deadline, $localized_images, $media_failures );
                }
            }
        }
        if ( 'container' === $element['elType'] && isset( $element['settings']['background_image'] ) ) {
            figmapress_connector_localize_image_setting( $element['settings']['background_image'], $post_id, $warnings, $imported_media, $deadline, $localized_images, $media_failures );
        }
        if ( ! empty( $element['elements'] ) ) {
            figmapress_connector_localize_elementor_images( $element['elements'], $post_id, $warnings, $imported_media, $deadline, $localized_images, $media_failures );
        }
    }
}

function figmapress_connector_add_media_budget_warning( &$warnings ) {
    $message = '画像の保存は時間上限に達したため一部を元URLのまま保持しました。';
    if ( ! in_array( $message, $warnings, true ) ) {
        $warnings[] = $message;
    }
}

function figmapress_connector_localize_image_setting( &$image, $post_id, &$warnings, &$imported_media, $deadline, &$localized_images, &$media_failures ) {
    if ( ! is_array( $image ) ) {
        return;
    }
    if ( 'library' === ( isset( $image['source'] ) ? $image['source'] : '' ) && ! empty( $image['id'] ) ) {
        return;
    }
    $url = isset( $image['url'] ) ? $image['url'] : '';
    if ( ! $url ) {
        return;
    }
    $stable_key = figmapress_connector_image_setting_key( $image );
    if ( isset( $localized_images[ $url ] ) ) {
        if ( '' !== $stable_key ) {
            $stable_entry              = $localized_images[ $url ];
            $stable_entry['stableKey'] = $stable_key;
            $localized_images[ 'key:' . $stable_key ] = $stable_entry;
        }
        figmapress_connector_apply_image_map_setting( $image, $localized_images );
        return;
    }
    if ( '' !== $stable_key && isset( $localized_images[ 'key:' . $stable_key ] ) ) {
        figmapress_connector_apply_image_map_setting( $image, $localized_images );
        return;
    }
    $url_hash = hash( 'sha256', $url );
    if ( isset( $media_failures[ $url_hash ] ) && absint( $media_failures[ $url_hash ] ) >= 3 ) {
        return;
    }
    if ( $imported_media >= 10 ) {
        return;
    }
    $remaining = (int) floor( $deadline - microtime( true ) );
    if ( $remaining < 1 ) {
        figmapress_connector_add_media_budget_warning( $warnings );
        return;
    }
    $attachment = figmapress_connector_sideload_image(
        $url,
        $post_id,
        isset( $image['alt'] ) ? $image['alt'] : '',
        min( 15, $remaining )
    );
    if ( is_wp_error( $attachment ) ) {
        $media_failures[ $url_hash ] = min( 3, ( isset( $media_failures[ $url_hash ] ) ? absint( $media_failures[ $url_hash ] ) : 0 ) + 1 );
        $warnings[] = '画像をメディアライブラリへ保存できませんでした: ' . $attachment->get_error_message();
        return;
    }
    $image['id']     = $attachment['id'];
    $image['url']    = $attachment['url'];
    $image['source'] = 'library';
    $localized_entry = array(
        'id'     => $image['id'],
        'url'    => $image['url'],
        'source' => $image['source'],
        'sourceUrl' => $url,
        'stableKey' => $stable_key,
    );
    $localized_images[ $url ] = $localized_entry;
    if ( '' !== $stable_key ) {
        $localized_images[ 'key:' . $stable_key ] = $localized_entry;
    }
    unset( $media_failures[ $url_hash ] );
    ++$imported_media;
}

function figmapress_connector_sideload_image( $url, $post_id, $alt, $download_timeout = 6 ) {
    if ( 0 !== strpos( $url, 'https://' ) || ! wp_http_validate_url( $url ) ) {
        return new WP_Error( 'figmapress_invalid_image_url', 'The image URL is not a public HTTPS URL.' );
    }
    require_once ABSPATH . 'wp-admin/includes/file.php';
    require_once ABSPATH . 'wp-admin/includes/image.php';
    require_once ABSPATH . 'wp-admin/includes/media.php';

    $tmp = download_url( $url, max( 1, (int) $download_timeout ) );
    if ( is_wp_error( $tmp ) ) {
        return $tmp;
    }
    if ( filesize( $tmp ) > 10 * MB_IN_BYTES ) {
        @unlink( $tmp );
        return new WP_Error( 'figmapress_image_too_large', 'The image exceeds 10 MB.' );
    }

    $mime = wp_get_image_mime( $tmp );
    $exts = array( 'image/jpeg' => 'jpg', 'image/png' => 'png', 'image/gif' => 'gif', 'image/webp' => 'webp', 'image/avif' => 'avif' );
    if ( ! isset( $exts[ $mime ] ) ) {
        @unlink( $tmp );
        return new WP_Error( 'figmapress_invalid_image', 'The downloaded file is not a supported image.' );
    }

    $file_array = array(
        'name'     => 'figmapress-' . substr( md5( $url ), 0, 12 ) . '.' . $exts[ $mime ],
        'tmp_name' => $tmp,
    );
    $attachment_id = media_handle_sideload( $file_array, $post_id, sanitize_text_field( $alt ) );
    if ( is_wp_error( $attachment_id ) ) {
        @unlink( $tmp );
        return $attachment_id;
    }
    update_post_meta( $attachment_id, '_wp_attachment_image_alt', sanitize_text_field( $alt ) );
    return array( 'id' => $attachment_id, 'url' => wp_get_attachment_url( $attachment_id ) );
}

function figmapress_connector_clear_elementor_cache( $post_id ) {
    try {
        if ( class_exists( '\\Elementor\\Core\\Files\\CSS\\Post' ) ) {
            $css_file = new \Elementor\Core\Files\CSS\Post( $post_id );
            $css_file->delete();
        }
        if ( isset( \Elementor\Plugin::$instance->files_manager ) ) {
            \Elementor\Plugin::$instance->files_manager->clear_cache();
        }
    } catch ( Throwable $error ) {
        // Elementor regenerates CSS on the next editor/frontend request.
    }
}
