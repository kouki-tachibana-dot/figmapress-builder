<?php
/**
 * One-click browser pairing for FigmaPress Builder.
 *
 * Pairing tokens authenticate only requests to the figmapress/v1 namespace.
 * They cannot be used as general WordPress REST credentials.
 */

if ( ! defined( 'ABSPATH' ) ) {
    exit;
}

define( 'FIGMAPRESS_CONNECTOR_PAIRING_TTL', 90 * DAY_IN_SECONDS );

function figmapress_connector_is_scoped_rest_request() {
    global $wp;
    $resolved_route = (
        isset( $wp->query_vars ) &&
        is_array( $wp->query_vars ) &&
        isset( $wp->query_vars['rest_route'] )
    )
        ? wp_unslash( $wp->query_vars['rest_route'] )
        : '';
    $query_route = isset( $_GET['rest_route'] )
        ? wp_unslash( $_GET['rest_route'] )
        : '';
    $rest_route = '' !== $resolved_route ? $resolved_route : $query_route;
    if ( '' !== $rest_route ) {
        return 1 === preg_match(
            '#^/?figmapress/v1(?:/|$)#',
            $rest_route
        );
    }

    $request_uri = isset( $_SERVER['REQUEST_URI'] )
        ? wp_unslash( $_SERVER['REQUEST_URI'] )
        : '';
    $request_path = wp_parse_url( $request_uri, PHP_URL_PATH );
    if ( ! is_string( $request_path ) ) {
        return false;
    }
    $rest_prefix = '/'
        . trim( rest_get_url_prefix(), '/' )
        . '/figmapress/v1';
    return 1 === preg_match(
        '#'
        . preg_quote( $rest_prefix, '#' )
        . '(?:/|$)#',
        $request_path
    );
}

function figmapress_connector_pairing_token_hash( $token ) {
    return hash_hmac( 'sha256', $token, wp_salt( 'auth' ) );
}

function figmapress_connector_pairing_token_from_request() {
    $header_token = isset( $_SERVER['HTTP_X_FIGMAPRESS_TOKEN'] )
        ? trim( wp_unslash( $_SERVER['HTTP_X_FIGMAPRESS_TOKEN'] ) )
        : '';
    $body_token   = isset( $_POST['figmapress_token'] )
        ? trim( wp_unslash( $_POST['figmapress_token'] ) )
        : '';
    $hex_token    = isset( $_POST['figmapress_token_hex'] )
        ? trim( wp_unslash( $_POST['figmapress_token_hex'] ) )
        : '';
    if (
        '' === $body_token &&
        strlen( $hex_token ) >= 80 &&
        strlen( $hex_token ) <= 400 &&
        0 === strlen( $hex_token ) % 2 &&
        ctype_xdigit( $hex_token )
    ) {
        $decoded_token = hex2bin( $hex_token );
        if ( false !== $decoded_token ) {
            $body_token = $decoded_token;
        }
    }
    return '' !== $header_token ? $header_token : $body_token;
}

function figmapress_connector_verify_pairing_token( $token ) {
    if (
        ! preg_match(
            '/^fp1\.([1-9][0-9]{0,19})\.([A-Za-z0-9_-]{32,128})$/',
            $token,
            $matches
        )
    ) {
        return 0;
    }

    $paired_user_id = absint( $matches[1] );
    $user           = get_user_by( 'id', $paired_user_id );
    $stored_hash    = (string) get_user_meta(
        $paired_user_id,
        '_figmapress_pairing_token_hash',
        true
    );
    $expires_at     = absint(
        get_user_meta(
            $paired_user_id,
            '_figmapress_pairing_expires_at',
            true
        )
    );
    if (
        ! $user ||
        '' === $stored_hash ||
        $expires_at <= time() ||
        ! hash_equals(
            $stored_hash,
            figmapress_connector_pairing_token_hash( $token )
        )
    ) {
        return 0;
    }

    $last_used = absint(
        get_user_meta(
            $paired_user_id,
            '_figmapress_pairing_last_used',
            true
        )
    );
    if ( $last_used < time() - HOUR_IN_SECONDS ) {
        update_user_meta(
            $paired_user_id,
            '_figmapress_pairing_last_used',
            time()
        );
    }
    $GLOBALS['figmapress_pairing_authenticated'] = true;
    return $paired_user_id;
}

function figmapress_connector_is_manual_pairing_request() {
    $rest_route = isset( $_GET['rest_route'] )
        ? wp_unslash( $_GET['rest_route'] )
        : '';
    if ( '/figmapress/v1/paired/site-prepare' === rtrim( $rest_route, '/' ) ) {
        return true;
    }

    $request_uri = isset( $_SERVER['REQUEST_URI'] )
        ? wp_unslash( $_SERVER['REQUEST_URI'] )
        : '';
    $request_path = wp_parse_url( $request_uri, PHP_URL_PATH );
    if ( ! is_string( $request_path ) ) {
        return false;
    }
    $manual_path = '/'
        . trim( rest_get_url_prefix(), '/' )
        . '/figmapress/v1/paired/site-prepare';
    return 1 === preg_match(
        '#' . preg_quote( $manual_path, '#' ) . '/?$#',
        $request_path
    );
}

function figmapress_connector_authenticate_pairing_token( $user_id ) {
    if (
        $user_id ||
        figmapress_connector_is_manual_pairing_request() ||
        ! figmapress_connector_is_scoped_rest_request()
    ) {
        return $user_id;
    }
    $paired_user_id = figmapress_connector_verify_pairing_token(
        figmapress_connector_pairing_token_from_request()
    );
    return $paired_user_id ? $paired_user_id : $user_id;
}
add_filter(
    'determine_current_user',
    'figmapress_connector_authenticate_pairing_token',
    18
);

function figmapress_connector_register_manual_pairing_route() {
    register_rest_route(
        'figmapress/v1',
        '/paired/site-prepare',
        array(
            'methods'             => WP_REST_Server::CREATABLE,
            'callback'            => 'figmapress_connector_rest_prepare_site_paired',
            'permission_callback' => '__return_true',
        )
    );
}
add_action(
    'rest_api_init',
    'figmapress_connector_register_manual_pairing_route'
);

function figmapress_connector_rest_prepare_site_paired( WP_REST_Request $request ) {
    $paired_user_id = figmapress_connector_verify_pairing_token(
        figmapress_connector_pairing_token_from_request()
    );
    if ( ! $paired_user_id ) {
        return new WP_Error(
            'figmapress_auth_required',
            'Authentication is required.',
            array( 'status' => 401 )
        );
    }
    if ( ! user_can( $paired_user_id, 'edit_pages' ) || ! user_can( $paired_user_id, 'edit_theme_options' ) ) {
        return new WP_Error(
            'figmapress_site_permission_required',
            '複数ページとメニューを作成する権限がありません。',
            array( 'status' => 403 )
        );
    }
    return figmapress_connector_rest_prepare_site(
        $request,
        $paired_user_id
    );
}

function figmapress_connector_allow_pairing_cors_header( $headers ) {
    $headers[] = 'X-FigmaPress-Token';
    return array_values( array_unique( $headers ) );
}
add_filter(
    'rest_allowed_cors_headers',
    'figmapress_connector_allow_pairing_cors_header'
);

/**
 * Shared-host fallback for installations that block authenticated REST writes.
 * This endpoint is still protected by the same scoped, hashed pairing token.
 */
function figmapress_connector_admin_post_prepare_site() {
    $paired_user_id = figmapress_connector_verify_pairing_token(
        figmapress_connector_pairing_token_from_request()
    );
    if ( ! $paired_user_id ) {
        wp_send_json(
            array(
                'code'    => 'figmapress_auth_required',
                'message' => 'Authentication is required.',
                'data'    => array( 'status' => 401 ),
            ),
            401
        );
    }
    if ( ! user_can( $paired_user_id, 'edit_pages' ) || ! user_can( $paired_user_id, 'edit_theme_options' ) ) {
        wp_send_json(
            array(
                'code'    => 'figmapress_site_permission_required',
                'message' => '複数ページとメニューを作成する権限がありません。',
                'data'    => array( 'status' => 403 ),
            ),
            403
        );
    }

    $payload = isset( $_POST['payload'] )
        ? wp_unslash( $_POST['payload'] )
        : '';
    $request = new WP_REST_Request(
        'POST',
        '/figmapress/v1/elementor/site-prepare'
    );
    $request->set_param( 'payload', $payload );
    // Keep the paired user explicit instead of creating a cookie-less admin
    // session. Security plugins commonly block that session switch even after
    // the Connector token has been verified. The site handler performs every
    // capability check against this verified user ID.
    $result = figmapress_connector_rest_prepare_site(
        $request,
        $paired_user_id
    );
    if ( is_wp_error( $result ) ) {
        $error_data = $result->get_error_data();
        $status = is_array( $error_data ) && isset( $error_data['status'] )
            ? absint( $error_data['status'] )
            : 400;
        wp_send_json(
            array(
                'code'    => $result->get_error_code(),
                'message' => $result->get_error_message(),
                'data'    => is_array( $error_data )
                    ? $error_data
                    : array( 'status' => $status ),
            ),
            $status
        );
    }
    $response = rest_ensure_response( $result );
    wp_send_json( $response->get_data(), $response->get_status() );
}
add_action(
    'admin_post_nopriv_figmapress_site_prepare',
    'figmapress_connector_admin_post_prepare_site'
);
add_action(
    'admin_post_figmapress_site_prepare',
    'figmapress_connector_admin_post_prepare_site'
);
add_action(
    'wp_ajax_nopriv_figmapress_site_prepare',
    'figmapress_connector_admin_post_prepare_site'
);
add_action(
    'wp_ajax_figmapress_site_prepare',
    'figmapress_connector_admin_post_prepare_site'
);

function figmapress_connector_builder_url() {
    return 'https://figmapress-builder.vercel.app';
}

/**
 * Browser-origin bridge for hosts that reject Vercel or cross-origin writes.
 * The bridge accepts messages only from the pinned production Builder origin
 * and the exact parent iframe or opener window that loaded it.
 */
function figmapress_connector_render_browser_bridge() {
    if ( ! isset( $_GET['figmapress_bridge'] ) || '1' !== wp_unslash( $_GET['figmapress_bridge'] ) ) {
        return;
    }
    nocache_headers();
    status_header( 200 );
    header( 'Content-Type: text/html; charset=UTF-8' );
    header( 'Referrer-Policy: no-referrer' );
    header_remove( 'X-Frame-Options' );
    header( "Content-Security-Policy: default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; frame-ancestors https://figmapress-builder.vercel.app; base-uri 'none'; form-action 'none'" );
    $builder_origin = wp_json_encode( figmapress_connector_builder_url() );
    $prepare_url    = wp_json_encode(
        rest_url( 'figmapress/v1/paired/site-prepare' )
    );
    $elementor_upload_url = wp_json_encode(
        rest_url( 'figmapress/v1/elementor/uploads/' )
    );
    $elementor_page_url = wp_json_encode(
        rest_url( 'figmapress/v1/elementor/pages/' )
    );
    ?>
<!doctype html>
<html lang="ja">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <title>FigmaPress WordPress安全接続</title>
    <style>
        body{margin:0;background:#f5f7fb;color:#172033;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
        main{max-width:520px;margin:12vh auto;padding:32px;background:#fff;border:1px solid #dfe5ef;border-radius:18px;box-shadow:0 12px 35px rgba(23,32,51,.1)}
        h1{font-size:22px;margin:0 0 12px}p{line-height:1.7;margin:0 0 12px}.status{font-weight:700;color:#176b47}
        button{border:0;border-radius:999px;padding:10px 18px;background:#172033;color:#fff;cursor:pointer}
    </style>
</head>
<body>
<main>
    <h1>WordPress安全接続</h1>
    <p id="status" class="status">FigmaPressからの下書き準備を待っています…</p>
    <p>この画面は対象WordPress内で通信し、認証情報をサーバーへ保存しません。</p>
    <button id="close" type="button">閉じる</button>
</main>
<script>
(() => {
    'use strict';
    const allowedOrigin = <?php echo $builder_origin; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped ?>;
    const prepareUrl = <?php echo $prepare_url; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped ?>;
    const elementorUploadUrl = <?php echo $elementor_upload_url; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped ?>;
    const elementorPageUrl = <?php echo $elementor_page_url; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped ?>;
    const status = document.getElementById('status');
    const closeButton = document.getElementById('close');
    const embedded = window.parent !== window;
    const peer = embedded ? window.parent : window.opener;
    let busy = false;
    const tokenPattern = /^fp1\.[1-9][0-9]{0,19}\.[A-Za-z0-9_-]{32,128}$/;
    const requestPattern = /^[a-f0-9-]{16,64}$/i;
    const hex = (value) => Array.from(
        new TextEncoder().encode(value),
        (byte) => byte.toString(16).padStart(2, '0')
    ).join('');
    const base64Bytes = (bytes) => {
        let binary = '';
        for (let offset = 0; offset < bytes.length; offset += 8192) {
            binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
        }
        return btoa(binary);
    };
    const parseResponse = async (response) => {
        const text = await response.text();
        let parsed = null;
        try { parsed = JSON.parse(text); } catch (_) { parsed = null; }
        if (!response.ok) {
            throw Object.assign(new Error(
                parsed && typeof parsed.message === 'string'
                    ? parsed.message
                    : 'WordPressが安全接続の処理を受け付けませんでした。'
            ), { status: response.status });
        }
        return parsed;
    };
    const postForm = async (url, connectorToken, fields) => {
        const form = new URLSearchParams();
        form.set('figmapress_token_hex', hex(connectorToken));
        Object.entries(fields).forEach(([key, value]) => form.set(key, String(value)));
        const response = await fetch(url, {
            method: 'POST',
            headers: { Accept: 'application/json' },
            body: form,
            credentials: 'same-origin',
            redirect: 'error',
            signal: AbortSignal.timeout(45000),
        });
        return parseResponse(response);
    };
    const post = (message) => {
        if (peer && (embedded || !peer.closed)) {
            peer.postMessage(message, allowedOrigin);
        }
    };
    const readyTimer = window.setInterval(() => {
        if (!busy) post({ type: 'figmapress:bridge-ready' });
    }, 500);
    post({ type: 'figmapress:bridge-ready' });
    if (embedded) {
        closeButton.hidden = true;
    } else {
        closeButton.addEventListener('click', () => window.close());
    }
    window.addEventListener('message', async (event) => {
        if (
            busy || !peer || event.origin !== allowedOrigin || event.source !== peer ||
            !event.data || ![
                'figmapress:prepare-site',
                'figmapress:save-elementor',
                'figmapress:confirm-elementor',
                'figmapress:localize-media'
            ].includes(event.data.type)
        ) return;
        const { requestId, connectorToken, payload } = event.data;
        if (
            typeof requestId !== 'string' || !requestPattern.test(requestId) ||
            typeof connectorToken !== 'string' || !tokenPattern.test(connectorToken) ||
            !payload || typeof payload !== 'object'
        ) return;
        const action = event.data.type;
        const serialized = JSON.stringify(payload);
        const maxBytes = action === 'figmapress:save-elementor' ? 4000000 : 100000;
        if (serialized.length < 20 || serialized.length > maxBytes) return;
        busy = true;
        window.clearInterval(readyTimer);
        status.textContent = action === 'figmapress:prepare-site'
            ? '下書きページとメニューを準備しています…'
            : action === 'figmapress:save-elementor'
                ? 'Elementor編集データを安全に保存しています…'
                : '画像をメディアライブラリへ保存しています…';
        try {
            let parsed = null;
            let responseType = 'figmapress:site-prepared';
            if (action === 'figmapress:prepare-site') {
                parsed = await postForm(prepareUrl, connectorToken, { payload: serialized });
            } else if (action === 'figmapress:save-elementor') {
                if (!payload || typeof payload.requestId !== 'string' || !requestPattern.test(payload.requestId)) return;
                const bytes = new TextEncoder().encode(serialized);
                const chunkBytes = 8000;
                const total = Math.ceil(bytes.length / chunkBytes);
                if (total < 1 || total > 128) throw new Error('Elementorデータが大きすぎます。');
                for (let index = 0; index < total; index += 1) {
                    parsed = await postForm(
                        elementorUploadUrl + encodeURIComponent(payload.requestId),
                        connectorToken,
                        {
                            index,
                            total,
                            chunk: base64Bytes(bytes.subarray(index * chunkBytes, (index + 1) * chunkBytes)),
                        }
                    );
                    if (parsed && parsed.status === 'draft') break;
                    if (index === total - 1) throw new Error('Elementor下書きの保存を確認できませんでした。');
                    await new Promise((resolve) => window.setTimeout(resolve, 75));
                }
                responseType = 'figmapress:elementor-saved';
            } else if (action === 'figmapress:confirm-elementor') {
                if (
                    !Number.isInteger(payload.postId) || payload.postId < 1 ||
                    typeof payload.requestId !== 'string' || !requestPattern.test(payload.requestId) ||
                    typeof payload.sourceKey !== 'string'
                ) return;
                parsed = await postForm(
                    elementorPageUrl + encodeURIComponent(payload.postId) + '/stored',
                    connectorToken,
                    {
                        requestId: payload.requestId,
                        sourceKey: payload.sourceKey,
                    }
                );
                responseType = 'figmapress:elementor-confirmed';
            } else {
                if (
                    !Number.isInteger(payload.postId) || payload.postId < 1 ||
                    typeof payload.requestId !== 'string' || !requestPattern.test(payload.requestId)
                ) return;
                parsed = await postForm(
                    elementorPageUrl + encodeURIComponent(payload.postId) + '/media',
                    connectorToken,
                    {
                        requestId: payload.requestId,
                        retryFailed: payload.retryFailed === true ? '1' : '0',
                    }
                );
                responseType = 'figmapress:elementor-media';
            }
            status.textContent = '下書き準備が完了しました。FigmaPressへ戻ります…';
            post({
                type: responseType,
                requestId,
                ok: true,
                status: 200,
                result: parsed,
            });
        } catch (error) {
            const message = error instanceof Error
                ? error.message
                : 'WordPress安全接続でエラーが発生しました。';
            const responseStatus = error && typeof error.status === 'number'
                ? error.status
                : 0;
            status.textContent = message;
            post({
                type: action === 'figmapress:save-elementor'
                    ? 'figmapress:elementor-saved'
                    : action === 'figmapress:confirm-elementor'
                        ? 'figmapress:elementor-confirmed'
                    : action === 'figmapress:localize-media'
                        ? 'figmapress:elementor-media'
                        : 'figmapress:site-prepared',
                requestId,
                ok: false,
                status: responseStatus,
                error: message,
            });
        } finally {
            busy = false;
            if (embedded) {
                window.setTimeout(() => post({ type: 'figmapress:bridge-ready' }), 0);
            }
        }
    });
})();
</script>
</body>
</html>
    <?php
    exit;
}
add_action(
    'template_redirect',
    'figmapress_connector_render_browser_bridge',
    0
);

function figmapress_connector_base64url_encode( $value ) {
    return rtrim(
        strtr( base64_encode( $value ), '+/', '-_' ),
        '='
    );
}

function figmapress_connector_register_pairing_page() {
    add_management_page(
        'FigmaPress接続',
        'FigmaPress接続',
        'edit_pages',
        'figmapress-connection',
        'figmapress_connector_render_pairing_page'
    );
}
add_action( 'admin_menu', 'figmapress_connector_register_pairing_page' );

function figmapress_connector_render_pairing_page() {
    if ( ! current_user_can( 'edit_pages' ) ) {
        wp_die( esc_html__( 'この操作を行う権限がありません。', 'figmapress-connector' ) );
    }
    $user_id    = get_current_user_id();
    $expires_at = absint(
        get_user_meta(
            $user_id,
            '_figmapress_pairing_expires_at',
            true
        )
    );
    $last_used  = absint(
        get_user_meta(
            $user_id,
            '_figmapress_pairing_last_used',
            true
        )
    );
    $is_active  = (
        '' !== (string) get_user_meta(
            $user_id,
            '_figmapress_pairing_token_hash',
            true
        ) &&
        $expires_at > time()
    );
    ?>
    <div class="wrap">
        <h1>FigmaPress接続</h1>
        <p>
            Application Passwordの代わりに、FigmaPress Connector専用の接続を作成します。
            この接続はFigmaPressのREST経路だけで利用でき、WordPressの通常ログインには使えません。
        </p>
        <?php if ( isset( $_GET['figmapress_revoked'] ) ) : ?>
            <div class="notice notice-success is-dismissible"><p>FigmaPress接続を解除しました。</p></div>
        <?php endif; ?>
        <table class="widefat striped" style="max-width:760px;margin:24px 0">
            <tbody>
                <tr>
                    <th style="width:220px">状態</th>
                    <td><?php echo $is_active ? '<strong style="color:#3b7b2a">接続トークン有効</strong>' : '未接続'; ?></td>
                </tr>
                <?php if ( $is_active ) : ?>
                    <tr>
                        <th>有効期限</th>
                        <td><?php echo esc_html( wp_date( 'Y-m-d H:i', $expires_at ) ); ?></td>
                    </tr>
                    <tr>
                        <th>最終利用</th>
                        <td><?php echo $last_used ? esc_html( wp_date( 'Y-m-d H:i', $last_used ) ) : 'まだ利用されていません'; ?></td>
                    </tr>
                <?php endif; ?>
            </tbody>
        </table>
        <form action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>" method="post" target="_blank">
            <input type="hidden" name="action" value="figmapress_generate_pairing">
            <?php wp_nonce_field( 'figmapress_generate_pairing' ); ?>
            <?php submit_button(
                $is_active
                    ? '新しい接続に入れ替えてFigmaPressを開く'
                    : 'FigmaPressに接続する',
                'primary',
                'submit',
                false
            ); ?>
        </form>
        <?php if ( $is_active ) : ?>
            <form action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>" method="post" style="margin-top:12px">
                <input type="hidden" name="action" value="figmapress_revoke_pairing">
                <?php wp_nonce_field( 'figmapress_revoke_pairing' ); ?>
                <?php submit_button( '接続を解除', 'secondary', 'submit', false ); ?>
            </form>
        <?php endif; ?>
        <p class="description" style="margin-top:18px">
            接続は90日間有効です。新しい接続を作ると以前の接続は直ちに無効になります。
        </p>
    </div>
    <?php
}

function figmapress_connector_generate_pairing() {
    if ( ! current_user_can( 'edit_pages' ) ) {
        wp_die( esc_html__( 'この操作を行う権限がありません。', 'figmapress-connector' ) );
    }
    check_admin_referer( 'figmapress_generate_pairing' );

    $user = wp_get_current_user();
    try {
        $secret = figmapress_connector_base64url_encode( random_bytes( 32 ) );
    } catch ( Exception $error ) {
        $secret = wp_generate_password( 64, false, false );
    }
    $token      = 'fp1.' . absint( $user->ID ) . '.' . $secret;
    $expires_at = time() + FIGMAPRESS_CONNECTOR_PAIRING_TTL;
    update_user_meta(
        $user->ID,
        '_figmapress_pairing_token_hash',
        figmapress_connector_pairing_token_hash( $token )
    );
    update_user_meta(
        $user->ID,
        '_figmapress_pairing_expires_at',
        $expires_at
    );
    delete_user_meta( $user->ID, '_figmapress_pairing_last_used' );

    $payload = figmapress_connector_base64url_encode(
        wp_json_encode(
            array(
                'version'        => 1,
                'baseUrl'        => untrailingslashit( home_url( '/' ) ),
                'username'       => $user->user_login,
                'connectorToken' => $token,
                'expiresAt'      => $expires_at * 1000,
            )
        )
    );
    $location = figmapress_connector_builder_url()
        . '/#figmapress-connect='
        . rawurlencode( $payload );
    nocache_headers();
    wp_redirect( $location, 303, 'FigmaPress Connector' );
    exit;
}
add_action(
    'admin_post_figmapress_generate_pairing',
    'figmapress_connector_generate_pairing'
);

function figmapress_connector_revoke_pairing() {
    if ( ! current_user_can( 'edit_pages' ) ) {
        wp_die( esc_html__( 'この操作を行う権限がありません。', 'figmapress-connector' ) );
    }
    check_admin_referer( 'figmapress_revoke_pairing' );
    $user_id = get_current_user_id();
    delete_user_meta( $user_id, '_figmapress_pairing_token_hash' );
    delete_user_meta( $user_id, '_figmapress_pairing_expires_at' );
    delete_user_meta( $user_id, '_figmapress_pairing_last_used' );
    wp_safe_redirect(
        add_query_arg(
            array(
                'page'                 => 'figmapress-connection',
                'figmapress_revoked'   => 1,
            ),
            admin_url( 'tools.php' )
        )
    );
    exit;
}
add_action(
    'admin_post_figmapress_revoke_pairing',
    'figmapress_connector_revoke_pairing'
);
