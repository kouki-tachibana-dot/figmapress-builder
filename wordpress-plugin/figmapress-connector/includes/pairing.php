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

function figmapress_connector_authenticate_pairing_token( $user_id ) {
    if ( $user_id || ! figmapress_connector_is_scoped_rest_request() ) {
        return $user_id;
    }

    $header_token = isset( $_SERVER['HTTP_X_FIGMAPRESS_TOKEN'] )
        ? trim( wp_unslash( $_SERVER['HTTP_X_FIGMAPRESS_TOKEN'] ) )
        : '';
    $body_token   = isset( $_POST['figmapress_token'] )
        ? trim( wp_unslash( $_POST['figmapress_token'] ) )
        : '';
    $token        = '' !== $header_token ? $header_token : $body_token;
    if (
        ! preg_match(
            '/^fp1\.([1-9][0-9]{0,19})\.([A-Za-z0-9_-]{32,128})$/',
            $token,
            $matches
        )
    ) {
        return $user_id;
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
        return $user_id;
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
add_filter(
    'determine_current_user',
    'figmapress_connector_authenticate_pairing_token',
    18
);

function figmapress_connector_allow_pairing_cors_header( $headers ) {
    $headers[] = 'X-FigmaPress-Token';
    return array_values( array_unique( $headers ) );
}
add_filter(
    'rest_allowed_cors_headers',
    'figmapress_connector_allow_pairing_cors_header'
);

function figmapress_connector_builder_url() {
    return 'https://figmapress-builder.vercel.app';
}

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
