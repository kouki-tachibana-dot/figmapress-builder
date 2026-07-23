<?php
/**
 * Plugin Name:       FigmaPress Connector
 * Plugin URI:        https://github.com/kouki-tachibana-dot/figmapress-builder
 * Description:       Connects FigmaPress to Gutenberg and Elementor draft pages.
 * Version:           0.5.0
 * Requires at least: 6.4
 * Requires PHP:      7.4
 * Update URI:        https://figmapress-builder.vercel.app/downloads/figmapress-connector.json
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
define( 'FIGMAPRESS_CONNECTOR_VERSION', '0.5.0' );

require_once FIGMAPRESS_CONNECTOR_DIR . 'includes/rest-api.php';
require_once FIGMAPRESS_CONNECTOR_DIR . 'includes/contact-form.php';
require_once FIGMAPRESS_CONNECTOR_DIR . 'includes/update-checker.php';

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

/** Register assets that Elementor loads only when a FigmaPress widget is used. */
function figmapress_connector_register_elementor_assets() {
    wp_register_style(
        'figmapress-elementor-interactions',
        FIGMAPRESS_CONNECTOR_URL . 'assets/elementor-interactions.css',
        array(),
        FIGMAPRESS_CONNECTOR_VERSION
    );
    wp_register_script(
        'figmapress-elementor-interactions',
        FIGMAPRESS_CONNECTOR_URL . 'assets/elementor-interactions.js',
        array(),
        FIGMAPRESS_CONNECTOR_VERSION,
        true
    );
}
add_action( 'wp_enqueue_scripts', 'figmapress_connector_register_elementor_assets' );
add_action( 'elementor/frontend/before_register_scripts', 'figmapress_connector_register_elementor_assets' );

/** Group the functional widgets together in Elementor's widget panel. */
function figmapress_connector_register_elementor_category( $elements_manager ) {
    $elements_manager->add_category(
        'figmapress',
        array(
            'title' => esc_html__( 'FigmaPress', 'figmapress-connector' ),
            'icon'  => 'eicon-plug',
        )
    );
}
add_action( 'elementor/elements/categories_registered', 'figmapress_connector_register_elementor_category' );

/** Register free, editable interaction widgets without requiring Elementor Pro. */
function figmapress_connector_register_elementor_widgets( $widgets_manager ) {
    if ( ! class_exists( '\\Elementor\\Widget_Base' ) ) {
        return;
    }
    require_once FIGMAPRESS_CONNECTOR_DIR . 'includes/elementor-widgets.php';
    $widgets_manager->register( new FigmaPress_Nav_Widget() );
    $widgets_manager->register( new FigmaPress_Contact_Form_Widget() );
    $widgets_manager->register( new FigmaPress_Accordion_Widget() );
}
add_action( 'elementor/widgets/register', 'figmapress_connector_register_elementor_widgets' );

/**
 * Small helper used by render.php files. Centralizes attribute escaping
 * so individual block templates stay short.
 */
function figmapress_attr( $attributes, $key, $default = '' ) {
    return isset( $attributes[ $key ] ) ? $attributes[ $key ] : $default;
}
