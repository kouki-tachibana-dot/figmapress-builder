<?php
/**
 * Plugin Name:       FigmaPress Connector
 * Plugin URI:        https://github.com/kouki-tachibana-dot/figmapress-builder
 * Description:       Connects FigmaPress to Gutenberg and Elementor draft pages.
 * Version:           0.4.1
 * Requires at least: 6.4
 * Requires PHP:      7.4
 * Author:            FigmaPress
 * License:           GPL-2.0-or-later
 * Text Domain:       figmapress-connector
 *
 * @package FigmaPressConnector
 */

if ( ! defined( 'ABSPATH' ) ) {
    exit;
}

define( 'FIGMAPRESS_CONNECTOR_DIR', plugin_dir_path( __FILE__ ) );
define( 'FIGMAPRESS_CONNECTOR_URL', plugin_dir_url( __FILE__ ) );
define( 'FIGMAPRESS_CONNECTOR_VERSION', '0.4.1' );

require_once FIGMAPRESS_CONNECTOR_DIR . 'includes/rest-api.php';

/**
 * Register all figmapress/* blocks on init.
 *
 * Each block lives in its own directory under blocks/<name>/ with a
 * block.json metadata file and a render.php callback. Server-side
 * rendering avoids a separate JavaScript build step.
 */
function figmapress_connector_register_blocks() {
    $blocks = array(
        'hero',
        'service-list',
        'card-grid',
        'faq',
        'cta',
        'contact',
    );

    foreach ( $blocks as $block ) {
        $block_dir = FIGMAPRESS_CONNECTOR_DIR . 'blocks/' . $block;
        if ( file_exists( $block_dir . '/block.json' ) ) {
            register_block_type( $block_dir );
        }
    }
}
add_action( 'init', 'figmapress_connector_register_blocks' );

/**
 * Enqueue shared front-end styles for all figmapress/* blocks.
 */
function figmapress_connector_enqueue_assets() {
    wp_enqueue_style(
        'figmapress-connector',
        FIGMAPRESS_CONNECTOR_URL . 'assets/style.css',
        array(),
        FIGMAPRESS_CONNECTOR_VERSION
    );
}
add_action( 'wp_enqueue_scripts', 'figmapress_connector_enqueue_assets' );
add_action( 'enqueue_block_editor_assets', 'figmapress_connector_enqueue_assets' );

/**
 * Register the lightweight block editor controls shared by all blocks.
 */
function figmapress_connector_enqueue_editor_script() {
    wp_enqueue_script(
        'figmapress-connector-editor',
        FIGMAPRESS_CONNECTOR_URL . 'assets/editor.js',
        array(
            'wp-blocks',
            'wp-element',
            'wp-components',
            'wp-block-editor',
            'wp-server-side-render',
        ),
        FIGMAPRESS_CONNECTOR_VERSION,
        true
    );
}
add_action( 'enqueue_block_editor_assets', 'figmapress_connector_enqueue_editor_script' );

/**
 * Small helper used by render.php files. Centralizes attribute escaping
 * so individual block templates stay short.
 */
function figmapress_attr( $attributes, $key, $default = '' ) {
    return isset( $attributes[ $key ] ) ? $attributes[ $key ] : $default;
}
