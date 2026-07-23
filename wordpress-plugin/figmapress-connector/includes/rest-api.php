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
        '/elementor/pages',
        array(
            'methods'             => WP_REST_Server::CREATABLE,
            'callback'            => 'figmapress_connector_rest_create_elementor_page',
            'permission_callback' => 'figmapress_connector_rest_can_edit_pages',
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

function figmapress_connector_rest_is_authenticated() {
    if ( is_user_logged_in() ) {
        return true;
    }
    return new WP_Error( 'figmapress_auth_required', 'Authentication is required.', array( 'status' => 401 ) );
}

function figmapress_connector_rest_status() {
    global $wp_version;
    return rest_ensure_response(
        array(
            'connectorVersion' => FIGMAPRESS_CONNECTOR_VERSION,
            'wordpressVersion' => $wp_version,
            'canEditPages'      => current_user_can( 'edit_pages' ),
            'elementor'         => array(
                'active'  => did_action( 'elementor/loaded' ) > 0 || defined( 'ELEMENTOR_VERSION' ),
                'version' => defined( 'ELEMENTOR_VERSION' ) ? ELEMENTOR_VERSION : null,
            ),
            'functionalWidgets' => array(
                'navigation'  => class_exists( 'FigmaPress_Nav_Widget' ),
                'contactForm' => class_exists( 'FigmaPress_Contact_Form_Widget' ),
                'accordion'   => class_exists( 'FigmaPress_Accordion_Widget' ),
            ),
        )
    );
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
    $template   = isset( $params['template'] ) && is_array( $params['template'] ) ? $params['template'] : null;
    if ( '' === $title || ! $template || '0.4' !== ( isset( $template['version'] ) ? (string) $template['version'] : '' ) ) {
        return new WP_Error( 'figmapress_invalid_template', 'The Elementor template payload is invalid.', array( 'status' => 422 ) );
    }
    if ( '' !== $request_id && ! preg_match( '/^[a-f0-9-]{16,64}$/i', $request_id ) ) {
        return new WP_Error( 'figmapress_invalid_request_id', '作成リクエストの識別情報が無効です。', array( 'status' => 422 ) );
    }

    $request_lock_key = '' !== $request_id
        ? 'figmapress_request_' . substr( hash_hmac( 'sha256', $request_id, wp_salt( 'nonce' ) ), 0, 32 )
        : '';
    if ( '' !== $request_id ) {
        $existing_pages = get_posts(
            array(
                'post_type'              => 'page',
                'post_status'            => array( 'draft', 'pending', 'private', 'publish', 'future' ),
                'posts_per_page'         => 1,
                'fields'                 => 'ids',
                'meta_key'               => '_figmapress_request_id',
                'meta_value'             => $request_id,
                'no_found_rows'          => true,
                'orderby'                => 'ID',
                'order'                  => 'DESC',
                'suppress_filters'       => false,
                'update_post_meta_cache' => false,
                'update_post_term_cache' => false,
            )
        );
        $existing_id = isset( $existing_pages[0] ) ? absint( $existing_pages[0] ) : 0;
        if ( $existing_id && current_user_can( 'edit_post', $existing_id ) ) {
            $stored_elements = figmapress_connector_count_elementor_elements( figmapress_connector_read_elementor_data( $existing_id ) );
            $existing_lock   = get_option( $request_lock_key );
            $lock_started    = is_array( $existing_lock ) && isset( $existing_lock['started'] )
                ? absint( $existing_lock['started'] )
                : 0;
            if ( $lock_started && $lock_started >= time() - ( 10 * MINUTE_IN_SECONDS ) ) {
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
            if ( 0 === $stored_elements ) {
                wp_delete_post( $existing_id, true );
                delete_option( $request_lock_key );
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
                        'warnings'       => array( '前回の処理で作成済みの下書きを再利用しました。重複ページは作成していません。' ),
                    )
                );
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

    if ( '' !== $request_id ) {
        $lock_value       = array(
            'started' => time(),
            'user'    => get_current_user_id(),
        );
        $locked           = add_option( $request_lock_key, $lock_value, '', false );
        if ( ! $locked ) {
            $existing_lock = get_option( $request_lock_key );
            $started       = is_array( $existing_lock ) && isset( $existing_lock['started'] )
                ? absint( $existing_lock['started'] )
                : 0;
            if ( $started && $started < time() - ( 10 * MINUTE_IN_SECONDS ) ) {
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
    }

    $page_template = isset( $params['pageTemplate'] ) ? $params['pageTemplate'] : 'elementor_canvas';
    if ( ! in_array( $page_template, array( 'elementor_canvas', 'elementor_header_footer', 'default' ), true ) ) {
        $page_template = 'elementor_canvas';
    }

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
    if ( is_wp_error( $post_id ) ) {
        if ( $request_lock_key ) {
            delete_option( $request_lock_key );
        }
        return $post_id;
    }
    if ( '' !== $request_id && ! add_post_meta( $post_id, '_figmapress_request_id', $request_id, true ) ) {
        delete_option( $request_lock_key );
        wp_delete_post( $post_id, true );
        return new WP_Error(
            'figmapress_request_id_store_failed',
            '下書きの重複防止情報を安全に保存できませんでした。',
            array( 'status' => 500 )
        );
    }
    $page_settings = isset( $template['page_settings'] ) && is_array( $template['page_settings'] )
        ? figmapress_connector_sanitize_elementor_value( $template['page_settings'] )
        : array();

    // Persist the complete editable document before any remote image work.
    // Hosts can terminate slow downloads; the page must never be left empty.
    $stored_elements = figmapress_connector_store_elementor_document( $post_id, $content, $page_settings, $page_template );
    if ( is_wp_error( $stored_elements ) ) {
        if ( $request_lock_key ) {
            delete_option( $request_lock_key );
        }
        wp_delete_post( $post_id, true );
        return $stored_elements;
    }
    if ( $request_lock_key ) {
        delete_option( $request_lock_key );
    }

    $imported_media = 0;
    $media_deadline = microtime( true ) + 12;
    figmapress_connector_localize_elementor_images( $content, $post_id, $warnings, $imported_media, $media_deadline );
    $localized_store = figmapress_connector_store_elementor_document( $post_id, $content, $page_settings, $page_template );
    if ( is_wp_error( $localized_store ) ) {
        $warnings[] = '画像の保存後にElementorデータを更新できなかったため、画像処理前の編集可能データを保持しました。';
    } else {
        $stored_elements = $localized_store;
    }
    figmapress_connector_clear_elementor_cache( $post_id );

    return rest_ensure_response(
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
            'idempotent'     => false,
            'warnings'      => $warnings,
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

function figmapress_connector_store_elementor_document( $post_id, $content, $page_settings, $page_template ) {
    update_post_meta( $post_id, '_wp_page_template', $page_template );

    $saved_with_document_api = false;
    if ( class_exists( '\\Elementor\\Plugin' ) && isset( \Elementor\Plugin::$instance->documents ) ) {
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
    }

    $expected_elements = figmapress_connector_count_elementor_elements( $content );
    $stored_data       = figmapress_connector_read_elementor_data( $post_id );
    $stored_elements   = is_array( $stored_data )
        ? figmapress_connector_count_elementor_elements( $stored_data )
        : 0;

    // Document::save() can return true even when Elementor normalizes every
    // generated element away or its internal metadata write fails. Verify the
    // result instead of trusting the return value, then preserve the already
    // sanitized Elementor JSON directly when it is incomplete.
    $direct_meta_write = null;
    $encoded_bytes     = 0;
    if ( $stored_elements !== $expected_elements ) {
        $encoded_content = wp_json_encode( $content );
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

        $encoded_bytes     = strlen( $encoded_content );
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

        // Some persistent object caches can briefly retain the value written
        // by Document::save(). Force the verification read back to the DB.
        wp_cache_delete( $post_id, 'post_meta' );
        $stored_data     = figmapress_connector_read_elementor_data( $post_id );
        $stored_elements = is_array( $stored_data )
            ? figmapress_connector_count_elementor_elements( $stored_data )
            : 0;
    }

    // Elementor reads the template assignment from WordPress post meta, so
    // restore it after Document::save() processes document settings.
    update_post_meta( $post_id, '_wp_page_template', $page_template );

    if ( ! is_array( $stored_data ) || $stored_elements !== $expected_elements ) {
        return new WP_Error(
            'figmapress_elementor_save_failed',
            'Elementor data could not be stored on this server.',
            array(
                'status'                => 500,
                'expectedElements'      => $expected_elements,
                'storedElements'        => $stored_elements,
                'documentSaveCompleted' => $saved_with_document_api,
                'directMetaWrite'       => false !== $direct_meta_write,
                'encodedBytes'          => $encoded_bytes,
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

function figmapress_connector_count_elementor_elements( $elements ) {
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

function figmapress_connector_localize_elementor_images( &$elements, $post_id, &$warnings, &$imported_media, $deadline ) {
    foreach ( $elements as &$element ) {
        if ( microtime( true ) >= $deadline ) {
            figmapress_connector_add_media_budget_warning( $warnings );
            return;
        }
        if ( 'widget' === $element['elType'] && 'image' === ( isset( $element['widgetType'] ) ? $element['widgetType'] : '' ) && isset( $element['settings']['image'] ) ) {
            figmapress_connector_localize_image_setting( $element['settings']['image'], $post_id, $warnings, $imported_media, $deadline );
        }
        if ( 'widget' === $element['elType'] && 'figmapress-nav' === ( isset( $element['widgetType'] ) ? $element['widgetType'] : '' ) && isset( $element['settings']['logo'] ) ) {
            figmapress_connector_localize_image_setting( $element['settings']['logo'], $post_id, $warnings, $imported_media, $deadline );
        }
        if ( 'container' === $element['elType'] && isset( $element['settings']['background_image'] ) ) {
            figmapress_connector_localize_image_setting( $element['settings']['background_image'], $post_id, $warnings, $imported_media, $deadline );
        }
        if ( ! empty( $element['elements'] ) ) {
            figmapress_connector_localize_elementor_images( $element['elements'], $post_id, $warnings, $imported_media, $deadline );
        }
    }
}

function figmapress_connector_add_media_budget_warning( &$warnings ) {
    $message = '画像の保存は時間上限に達したため一部を元URLのまま保持しました。';
    if ( ! in_array( $message, $warnings, true ) ) {
        $warnings[] = $message;
    }
}

function figmapress_connector_localize_image_setting( &$image, $post_id, &$warnings, &$imported_media, $deadline ) {
    if ( ! is_array( $image ) || $imported_media >= 60 ) {
        return;
    }
    $url = isset( $image['url'] ) ? $image['url'] : '';
    if ( ! $url ) {
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
        min( 6, $remaining )
    );
    if ( is_wp_error( $attachment ) ) {
        $warnings[] = '画像をメディアライブラリへ保存できませんでした: ' . $attachment->get_error_message();
        return;
    }
    $image['id']     = $attachment['id'];
    $image['url']    = $attachment['url'];
    $image['source'] = 'library';
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
