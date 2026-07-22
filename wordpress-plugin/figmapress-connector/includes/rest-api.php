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
        )
    );
}

function figmapress_connector_rest_create_elementor_page( WP_REST_Request $request ) {
    if ( ! did_action( 'elementor/loaded' ) && ! defined( 'ELEMENTOR_VERSION' ) ) {
        return new WP_Error( 'figmapress_elementor_missing', 'Elementor is not active on this site.', array( 'status' => 409 ) );
    }

    $params   = $request->get_json_params();
    $title    = isset( $params['title'] ) ? sanitize_text_field( $params['title'] ) : '';
    $slug     = isset( $params['slug'] ) ? sanitize_title( $params['slug'] ) : '';
    $template = isset( $params['template'] ) && is_array( $params['template'] ) ? $params['template'] : null;
    if ( '' === $title || ! $template || '0.4' !== ( isset( $template['version'] ) ? (string) $template['version'] : '' ) ) {
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
        return $post_id;
    }

    $warnings       = array();
    $imported_media = 0;
    figmapress_connector_localize_elementor_images( $content, $post_id, $warnings, $imported_media );
    $page_settings = isset( $template['page_settings'] ) && is_array( $template['page_settings'] )
        ? figmapress_connector_sanitize_elementor_value( $template['page_settings'] )
        : array();

    update_post_meta( $post_id, '_elementor_edit_mode', 'builder' );
    update_post_meta( $post_id, '_elementor_template_type', 'wp-page' );
    update_post_meta( $post_id, '_elementor_version', defined( 'ELEMENTOR_VERSION' ) ? ELEMENTOR_VERSION : '' );
    update_post_meta( $post_id, '_elementor_data', wp_slash( wp_json_encode( $content ) ) );
    update_post_meta( $post_id, '_elementor_page_settings', $page_settings );
    update_post_meta( $post_id, '_wp_page_template', $page_template );
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
            'warnings'      => $warnings,
        )
    );
}

function figmapress_connector_sanitize_elementor_elements( $elements, &$count ) {
    if ( ! is_array( $elements ) ) {
        return new WP_Error( 'figmapress_invalid_elements', 'Elementor content must be an array.', array( 'status' => 422 ) );
    }

    $result          = array();
    $allowed_widgets = array( 'heading', 'text-editor', 'button', 'image' );
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

function figmapress_connector_localize_elementor_images( &$elements, $post_id, &$warnings, &$imported_media ) {
    foreach ( $elements as &$element ) {
        if ( 'widget' === $element['elType'] && 'image' === ( isset( $element['widgetType'] ) ? $element['widgetType'] : '' ) && isset( $element['settings']['image'] ) ) {
            figmapress_connector_localize_image_setting( $element['settings']['image'], $post_id, $warnings, $imported_media );
        }
        if ( 'container' === $element['elType'] && isset( $element['settings']['background_image'] ) ) {
            figmapress_connector_localize_image_setting( $element['settings']['background_image'], $post_id, $warnings, $imported_media );
        }
        if ( ! empty( $element['elements'] ) ) {
            figmapress_connector_localize_elementor_images( $element['elements'], $post_id, $warnings, $imported_media );
        }
    }
}

function figmapress_connector_localize_image_setting( &$image, $post_id, &$warnings, &$imported_media ) {
    if ( ! is_array( $image ) || $imported_media >= 60 ) {
        return;
    }
    $url = isset( $image['url'] ) ? $image['url'] : '';
    if ( ! $url ) {
        return;
    }
    $attachment = figmapress_connector_sideload_image( $url, $post_id, isset( $image['alt'] ) ? $image['alt'] : '' );
    if ( is_wp_error( $attachment ) ) {
        $warnings[] = '画像をメディアライブラリへ保存できませんでした: ' . $attachment->get_error_message();
        return;
    }
    $image['id']     = $attachment['id'];
    $image['url']    = $attachment['url'];
    $image['source'] = 'library';
    ++$imported_media;
}

function figmapress_connector_sideload_image( $url, $post_id, $alt ) {
    if ( 0 !== strpos( $url, 'https://' ) || ! wp_http_validate_url( $url ) ) {
        return new WP_Error( 'figmapress_invalid_image_url', 'The image URL is not a public HTTPS URL.' );
    }
    require_once ABSPATH . 'wp-admin/includes/file.php';
    require_once ABSPATH . 'wp-admin/includes/image.php';
    require_once ABSPATH . 'wp-admin/includes/media.php';

    $tmp = download_url( $url, 20 );
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
