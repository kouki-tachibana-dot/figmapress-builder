<?php
/** Native WordPress update integration for future Connector releases. */

if ( ! defined( 'ABSPATH' ) ) {
    exit;
}

define( 'FIGMAPRESS_CONNECTOR_MANIFEST_URL', 'https://figmapress-builder.vercel.app/downloads/figmapress-connector.json' );

function figmapress_connector_clear_update_manifest_cache() {
    delete_site_transient( 'figmapress_connector_manifest' );
}

// WordPress removes its update_plugins transient when an administrator clicks
// "Check again". Mirror that lifecycle so our separately cached manifest can
// never hide a release that WordPress was explicitly asked to discover.
add_action( 'delete_site_transient_update_plugins', 'figmapress_connector_clear_update_manifest_cache' );

function figmapress_connector_update_manifest() {
    $cached = get_site_transient( 'figmapress_connector_manifest' );
    if ( is_array( $cached ) ) {
        return $cached;
    }
    $request_url = add_query_arg(
        array(
            'installed' => FIGMAPRESS_CONNECTOR_VERSION,
            'check'     => gmdate( 'YmdHi' ),
        ),
        FIGMAPRESS_CONNECTOR_MANIFEST_URL
    );
    $response = wp_safe_remote_get(
        $request_url,
        array(
            'timeout'    => 5,
            'user-agent' => 'FigmaPress Connector/' . FIGMAPRESS_CONNECTOR_VERSION,
        )
    );
    if ( is_wp_error( $response ) || 200 !== wp_remote_retrieve_response_code( $response ) ) {
        return null;
    }
    $data = json_decode( wp_remote_retrieve_body( $response ), true );
    if (
        ! is_array( $data ) || empty( $data['version'] ) || empty( $data['download_url'] ) ||
        'https' !== wp_parse_url( $data['download_url'], PHP_URL_SCHEME ) ||
        'figmapress-builder.vercel.app' !== wp_parse_url( $data['download_url'], PHP_URL_HOST )
    ) {
        return null;
    }
    set_site_transient( 'figmapress_connector_manifest', $data, 6 * HOUR_IN_SECONDS );
    return $data;
}

function figmapress_connector_offer_update( $transient ) {
    if ( ! is_object( $transient ) ) {
        return $transient;
    }
    $plugin   = plugin_basename( FIGMAPRESS_CONNECTOR_DIR . 'figmapress-connector.php' );
    $manifest = figmapress_connector_update_manifest();
    if ( ! $manifest || ! version_compare( $manifest['version'], FIGMAPRESS_CONNECTOR_VERSION, '>' ) ) {
        if ( isset( $transient->response[ $plugin ] ) ) {
            unset( $transient->response[ $plugin ] );
        }
        return $transient;
    }
    $transient->response[ $plugin ] = (object) array(
        'id'           => 'figmapress-connector',
        'slug'         => 'figmapress-connector',
        'plugin'       => $plugin,
        'new_version'  => sanitize_text_field( $manifest['version'] ),
        'url'          => isset( $manifest['homepage'] ) ? esc_url_raw( $manifest['homepage'] ) : 'https://figmapress-builder.vercel.app',
        'package'      => esc_url_raw( $manifest['download_url'] ),
        'requires'     => isset( $manifest['requires'] ) ? sanitize_text_field( $manifest['requires'] ) : '6.4',
        'requires_php' => isset( $manifest['requires_php'] ) ? sanitize_text_field( $manifest['requires_php'] ) : '7.4',
        'tested'       => isset( $manifest['tested'] ) ? sanitize_text_field( $manifest['tested'] ) : '',
    );
    return $transient;
}
add_filter( 'pre_set_site_transient_update_plugins', 'figmapress_connector_offer_update' );

function figmapress_connector_plugin_information( $result, $action, $args ) {
    if ( 'plugin_information' !== $action || empty( $args->slug ) || 'figmapress-connector' !== $args->slug ) {
        return $result;
    }
    $manifest = figmapress_connector_update_manifest();
    if ( ! $manifest ) {
        return $result;
    }
    return (object) array(
        'name'          => 'FigmaPress Connector',
        'slug'          => 'figmapress-connector',
        'version'       => sanitize_text_field( $manifest['version'] ),
        'author'        => '<a href="https://figmapress-builder.vercel.app">FigmaPress</a>',
        'homepage'      => isset( $manifest['homepage'] ) ? esc_url_raw( $manifest['homepage'] ) : 'https://figmapress-builder.vercel.app',
        'requires'      => isset( $manifest['requires'] ) ? sanitize_text_field( $manifest['requires'] ) : '6.4',
        'requires_php'  => isset( $manifest['requires_php'] ) ? sanitize_text_field( $manifest['requires_php'] ) : '7.4',
        'tested'        => isset( $manifest['tested'] ) ? sanitize_text_field( $manifest['tested'] ) : '',
        'download_link' => esc_url_raw( $manifest['download_url'] ),
        'sections'      => array(
            'description' => 'FigmaPressからGutenberg／Elementor下書きを作成し、機能ウィジェットを提供します。',
            'changelog'   => isset( $manifest['changelog'] ) ? wp_kses_post( $manifest['changelog'] ) : '',
        ),
    );
}
add_filter( 'plugins_api', 'figmapress_connector_plugin_information', 20, 3 );

function figmapress_connector_clear_update_manifest( $upgrader, $options ) {
    if ( isset( $options['type'] ) && 'plugin' === $options['type'] ) {
        figmapress_connector_clear_update_manifest_cache();
    }
}
add_action( 'upgrader_process_complete', 'figmapress_connector_clear_update_manifest', 10, 2 );
