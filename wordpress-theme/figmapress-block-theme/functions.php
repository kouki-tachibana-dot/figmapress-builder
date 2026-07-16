<?php
/**
 * FigmaPress Block Theme — theme setup.
 *
 * Block registration is intentionally NOT here. Per spec §5-7, the Theme
 * owns presentation (theme.json, templates, parts) and the FigmaPress
 * Connector plugin owns figmapress/* block registration.
 */

if ( ! defined( 'ABSPATH' ) ) {
    exit;
}

function figmapress_theme_setup() {
    add_theme_support( 'wp-block-styles' );
    add_theme_support( 'editor-styles' );
    add_theme_support( 'responsive-embeds' );
    add_theme_support( 'html5', array( 'search-form', 'comment-form', 'comment-list', 'gallery', 'caption', 'style', 'script' ) );
}
add_action( 'after_setup_theme', 'figmapress_theme_setup' );

function figmapress_theme_enqueue() {
    wp_enqueue_style(
        'figmapress-block-theme',
        get_stylesheet_uri(),
        array(),
        wp_get_theme()->get( 'Version' )
    );
}
add_action( 'wp_enqueue_scripts', 'figmapress_theme_enqueue' );
