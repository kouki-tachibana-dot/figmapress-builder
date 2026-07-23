<?php
/** Public contact-form endpoint used by the FigmaPress Elementor widget. */

if ( ! defined( 'ABSPATH' ) ) {
    exit;
}

function figmapress_connector_register_contact_route() {
    register_rest_route(
        'figmapress/v1',
        '/contact',
        array(
            'methods'             => WP_REST_Server::CREATABLE,
            'callback'            => 'figmapress_connector_submit_contact',
            'permission_callback' => '__return_true',
        )
    );
}
add_action( 'rest_api_init', 'figmapress_connector_register_contact_route' );

function figmapress_connector_submit_contact( WP_REST_Request $request ) {
    $same_origin = figmapress_connector_contact_same_origin( $request );
    if ( is_wp_error( $same_origin ) ) {
        return $same_origin;
    }

    $page_id     = absint( $request->get_param( 'page_id' ) );
    $widget_id   = preg_replace( '/[^a-f0-9]/', '', strtolower( (string) $request->get_param( 'widget_id' ) ) );
    $rendered_at = absint( $request->get_param( 'rendered_at' ) );
    $token       = sanitize_text_field( (string) $request->get_param( 'form_token' ) );
    $now         = time();
    $expected    = hash_hmac( 'sha256', $page_id . '|' . $widget_id . '|' . $rendered_at, wp_salt( 'auth' ) );
    if (
        ! $page_id || strlen( $widget_id ) < 6 || ! $rendered_at || ! hash_equals( $expected, $token ) ||
        $rendered_at > $now + 300 || $rendered_at < $now - ( 2 * DAY_IN_SECONDS )
    ) {
        return new WP_Error( 'figmapress_form_expired', 'フォームを再読み込みしてから送信してください。', array( 'status' => 403 ) );
    }
    if ( $now - $rendered_at < 2 || '' !== trim( (string) $request->get_param( 'website' ) ) ) {
        return new WP_Error( 'figmapress_form_spam', '送信を受け付けられませんでした。', array( 'status' => 400 ) );
    }

    $post = get_post( $page_id );
    if ( ! $post || ( 'publish' !== $post->post_status && ! current_user_can( 'edit_post', $page_id ) ) ) {
        return new WP_Error( 'figmapress_form_unavailable', 'このフォームは現在利用できません。', array( 'status' => 404 ) );
    }
    $widget = figmapress_connector_find_elementor_widget( figmapress_connector_read_elementor_data( $page_id ), $widget_id );
    if ( ! $widget || 'figmapress-contact-form' !== ( isset( $widget['widgetType'] ) ? $widget['widgetType'] : '' ) ) {
        return new WP_Error( 'figmapress_form_unavailable', 'フォーム設定を確認できませんでした。', array( 'status' => 404 ) );
    }

    $rate_limited = figmapress_connector_contact_rate_limit();
    if ( is_wp_error( $rate_limited ) ) {
        return $rate_limited;
    }

    $name       = sanitize_text_field( (string) $request->get_param( 'name' ) );
    $email      = sanitize_email( (string) $request->get_param( 'email' ) );
    $region     = sanitize_text_field( (string) $request->get_param( 'region' ) );
    $message    = sanitize_textarea_field( (string) $request->get_param( 'message' ) );
    $preference = 'no' === $request->get_param( 'reply_preference' ) ? 'no' : 'yes';
    if ( '' === $name || ! is_email( $email ) || '' === $message ) {
        return new WP_Error( 'figmapress_form_invalid', 'お名前、メールアドレス、内容を確認してください。', array( 'status' => 422 ) );
    }
    if (
        figmapress_connector_text_length( $name ) > 120 || figmapress_connector_text_length( $email ) > 254 ||
        figmapress_connector_text_length( $region ) > 160 || figmapress_connector_text_length( $message ) > 5000
    ) {
        return new WP_Error( 'figmapress_form_too_long', '入力内容が長すぎます。', array( 'status' => 422 ) );
    }

    $settings  = isset( $widget['settings'] ) && is_array( $widget['settings'] ) ? $widget['settings'] : array();
    $recipient = isset( $settings['recipient'] ) ? sanitize_email( $settings['recipient'] ) : '';
    if ( ! is_email( $recipient ) ) {
        $recipient = sanitize_email( get_option( 'admin_email' ) );
    }
    if ( ! is_email( $recipient ) ) {
        return new WP_Error( 'figmapress_form_recipient', '送信先メールアドレスが設定されていません。', array( 'status' => 500 ) );
    }

    $subject = sprintf( '[%s] Webサイトからのお問い合わせ', wp_specialchars_decode( get_bloginfo( 'name' ), ENT_QUOTES ) );
    $body    = "お名前: {$name}\nメールアドレス: {$email}\nお住まいの地域: {$region}\n返信希望: " . ( 'yes' === $preference ? '希望する' : '希望しない' ) . "\n\nご相談・ご意見の内容:\n{$message}\n";
    $headers = array( 'Reply-To: ' . $name . ' <' . $email . '>' );
    if ( ! wp_mail( $recipient, $subject, $body, $headers ) ) {
        return new WP_Error( 'figmapress_form_mail_failed', 'メールを送信できませんでした。サイト管理者へお問い合わせください。', array( 'status' => 500 ) );
    }

    $next_time  = time();
    $next_token = hash_hmac( 'sha256', $page_id . '|' . $widget_id . '|' . $next_time, wp_salt( 'auth' ) );
    return rest_ensure_response(
        array(
            'message'     => '送信しました。',
            'page_id'     => $page_id,
            'widget_id'   => $widget_id,
            'rendered_at' => $next_time,
            'form_token'  => $next_token,
        )
    );
}

function figmapress_connector_contact_same_origin( WP_REST_Request $request ) {
    $source = $request->get_header( 'origin' );
    if ( ! $source ) {
        $source = $request->get_header( 'referer' );
    }
    if ( ! $source ) {
        return new WP_Error( 'figmapress_form_origin', '送信元を確認できませんでした。', array( 'status' => 403 ) );
    }
    $source_host = wp_parse_url( $source, PHP_URL_HOST );
    $site_host   = wp_parse_url( home_url( '/' ), PHP_URL_HOST );
    if ( ! $source_host || ! $site_host || 0 !== strcasecmp( $source_host, $site_host ) ) {
        return new WP_Error( 'figmapress_form_origin', '別のサイトからは送信できません。', array( 'status' => 403 ) );
    }
    return true;
}

function figmapress_connector_contact_rate_limit() {
    $address = isset( $_SERVER['REMOTE_ADDR'] ) ? sanitize_text_field( wp_unslash( $_SERVER['REMOTE_ADDR'] ) ) : 'unknown';
    $key     = 'figmapress_contact_' . substr( hash_hmac( 'sha256', $address, wp_salt( 'nonce' ) ), 0, 32 );
    $count   = absint( get_transient( $key ) );
    if ( $count >= 5 ) {
        return new WP_Error( 'figmapress_form_rate_limited', '送信回数が上限に達しました。しばらくしてからお試しください。', array( 'status' => 429 ) );
    }
    set_transient( $key, $count + 1, 10 * MINUTE_IN_SECONDS );
    return true;
}

function figmapress_connector_find_elementor_widget( $elements, $widget_id ) {
    if ( ! is_array( $elements ) ) {
        return null;
    }
    foreach ( $elements as $element ) {
        if ( ! is_array( $element ) ) {
            continue;
        }
        if ( isset( $element['id'] ) && $widget_id === $element['id'] ) {
            return $element;
        }
        $found = figmapress_connector_find_elementor_widget( isset( $element['elements'] ) ? $element['elements'] : array(), $widget_id );
        if ( $found ) {
            return $found;
        }
    }
    return null;
}

function figmapress_connector_text_length( $value ) {
    return function_exists( 'mb_strlen' ) ? mb_strlen( $value ) : strlen( $value );
}
