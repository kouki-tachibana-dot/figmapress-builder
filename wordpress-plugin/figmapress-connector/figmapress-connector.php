<?php
/**
 * Plugin Name:       FigmaPress Connector
 * Plugin URI:        https://github.com/kouki-tachibana-dot/figmapress-builder
 * Description:       Connects FigmaPress to Gutenberg and Elementor draft pages.
 * Version:           0.17.14
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
define( 'FIGMAPRESS_CONNECTOR_VERSION', '0.17.14' );

require_once FIGMAPRESS_CONNECTOR_DIR . 'includes/pairing.php';
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

/** Google-hosted families that FigmaPress may request from a saved manifest. */
function figmapress_connector_supported_webfont_families() {
    return array(
        'BIZ UDPGothic',
        'BIZ UDPMincho',
        'IBM Plex Sans JP',
        'Inter',
        'Lato',
        'M PLUS 1p',
        'M PLUS Rounded 1c',
        'Montserrat',
        'Noto Sans JP',
        'Noto Serif JP',
        'Open Sans',
        'Poppins',
        'Roboto',
        'Shippori Mincho',
        'Zen Kaku Gothic New',
        'Zen Maru Gothic',
    );
}

/**
 * Read a bounded webfont manifest generated from the Figma text styles.
 *
 * The allowlist prevents saved Elementor data from turning this into an
 * arbitrary remote stylesheet loader.
 */
function figmapress_connector_page_webfonts( $post_id ) {
    $settings = get_post_meta( $post_id, '_elementor_page_settings', true );
    if ( is_string( $settings ) ) {
        $decoded  = json_decode( $settings, true );
        $settings = is_array( $decoded ) ? $decoded : array();
    }
    $manifest = is_array( $settings ) && isset( $settings['figmapress_webfonts'] ) && is_array( $settings['figmapress_webfonts'] )
        ? $settings['figmapress_webfonts']
        : array();
    $supported = figmapress_connector_supported_webfont_families();
    $fonts     = array();

    foreach ( array_slice( $manifest, 0, 4 ) as $font ) {
        $family = is_array( $font ) && isset( $font['family'] )
            ? sanitize_text_field( $font['family'] )
            : '';
        if ( ! in_array( $family, $supported, true ) ) {
            continue;
        }
        $weights = array();
        foreach ( isset( $font['weights'] ) && is_array( $font['weights'] ) ? array_slice( $font['weights'], 0, 6 ) : array() as $weight ) {
            $normalized = absint( $weight );
            if ( $normalized >= 100 && $normalized <= 900 && 0 === $normalized % 100 ) {
                $weights[] = $normalized;
            }
        }
        $weights = array_values( array_unique( $weights ) );
        sort( $weights, SORT_NUMERIC );
        if ( ! $weights ) {
            $weights = array( 400 );
        }
        $fonts[ $family ] = $weights;
    }

    return $fonts;
}

function figmapress_connector_webfont_stylesheet_url( $post_id ) {
    $families = array();
    foreach ( figmapress_connector_page_webfonts( $post_id ) as $family => $weights ) {
        $encoded_family = str_replace( '%20', '+', rawurlencode( $family ) );
        $families[]     = 'family=' . $encoded_family . ':wght@' . implode( ';', $weights );
    }
    if ( ! $families ) {
        return '';
    }
    return esc_url_raw(
        'https://fonts.googleapis.com/css2?' . implode( '&', $families ) . '&display=swap'
    );
}

/**
 * Load only the font families used by the current FigmaPress Elementor page.
 * This is independent of Elementor's optional local Google Fonts setting.
 */
function figmapress_connector_enqueue_page_webfonts( $post_id = 0 ) {
    $post_id = absint( $post_id );
    if ( ! $post_id ) {
        $post_id = get_queried_object_id();
    }
    if ( ! $post_id || ! get_post_meta( $post_id, '_figmapress_request_id', true ) ) {
        return;
    }
    $url = figmapress_connector_webfont_stylesheet_url( $post_id );
    if ( '' === $url ) {
        return;
    }
    wp_enqueue_style(
        'figmapress-page-webfonts-' . $post_id,
        $url,
        array(),
        null
    );
}
add_action( 'wp_enqueue_scripts', 'figmapress_connector_enqueue_page_webfonts', 20 );

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
function figmapress_connector_load_elementor_widget_classes() {
    if ( ! class_exists( '\\Elementor\\Widget_Base' ) ) {
        return false;
    }

    require_once FIGMAPRESS_CONNECTOR_DIR . 'includes/elementor-widgets.php';

    return class_exists( 'FigmaPress_Nav_Widget' )
        && class_exists( 'FigmaPress_Link_Widget' )
        && class_exists( 'FigmaPress_Carousel_Widget' )
        && class_exists( 'FigmaPress_Contact_Form_Widget' )
        && class_exists( 'FigmaPress_Accordion_Widget' );
}

function figmapress_connector_register_elementor_widgets( $widgets_manager ) {
    if ( ! figmapress_connector_load_elementor_widget_classes() ) {
        return;
    }
    $widgets_manager->register( new FigmaPress_Nav_Widget() );
    $widgets_manager->register( new FigmaPress_Link_Widget() );
    $widgets_manager->register( new FigmaPress_Carousel_Widget() );
    $widgets_manager->register( new FigmaPress_Contact_Form_Widget() );
    $widgets_manager->register( new FigmaPress_Accordion_Widget() );
}
add_action( 'elementor/widgets/register', 'figmapress_connector_register_elementor_widgets' );

/** Format a bounded number for a generated CSS value. */
function figmapress_connector_css_number( $value, $minimum, $maximum ) {
    if ( ! is_numeric( $value ) ) {
        return null;
    }
    $number = max( (float) $minimum, min( (float) $maximum, (float) $value ) );
    return rtrim( rtrim( number_format( $number, 3, '.', '' ), '0' ), '.' );
}

/** Build an rgba() value from numeric channels only. */
function figmapress_connector_gradient_color_css( $color ) {
    if ( ! is_array( $color ) ) {
        return '';
    }
    $red   = figmapress_connector_css_number( isset( $color['red'] ) ? $color['red'] : null, 0, 255 );
    $green = figmapress_connector_css_number( isset( $color['green'] ) ? $color['green'] : null, 0, 255 );
    $blue  = figmapress_connector_css_number( isset( $color['blue'] ) ? $color['blue'] : null, 0, 255 );
    $alpha = figmapress_connector_css_number( isset( $color['alpha'] ) ? $color['alpha'] : null, 0, 1 );
    if ( null === $red || null === $green || null === $blue || null === $alpha ) {
        return '';
    }
    return 'rgba(' . $red . ',' . $green . ',' . $blue . ',' . $alpha . ')';
}

/**
 * Generate one safe CSS gradient from the structured FigmaPress setting.
 *
 * Arbitrary CSS strings are never accepted. Types, numeric ranges, colors and
 * stop count are all bounded before the value reaches a style attribute.
 */
function figmapress_connector_gradient_css( $gradient ) {
    if ( ! is_array( $gradient ) ) {
        return '';
    }
    $type = isset( $gradient['type'] ) ? sanitize_key( $gradient['type'] ) : '';
    if ( ! in_array( $type, array( 'linear', 'radial' ), true ) ) {
        return '';
    }
    $stops = array();
    foreach ( isset( $gradient['stops'] ) && is_array( $gradient['stops'] ) ? array_slice( $gradient['stops'], 0, 8 ) : array() as $stop ) {
        if ( ! is_array( $stop ) ) {
            continue;
        }
        $color    = figmapress_connector_gradient_color_css( isset( $stop['color'] ) ? $stop['color'] : null );
        $position = figmapress_connector_css_number( isset( $stop['position'] ) ? $stop['position'] : null, -200, 300 );
        if ( '' === $color || null === $position ) {
            continue;
        }
        $stops[] = $color . ' ' . $position . '%';
    }
    if ( count( $stops ) < 2 ) {
        return '';
    }

    if ( 'linear' === $type ) {
        $angle = figmapress_connector_css_number( isset( $gradient['angle'] ) ? $gradient['angle'] : 180, 0, 360 );
        return 'linear-gradient(' . $angle . 'deg,' . implode( ',', $stops ) . ')';
    }

    $center   = isset( $gradient['center'] ) && is_array( $gradient['center'] ) ? $gradient['center'] : array();
    $radius   = isset( $gradient['radius'] ) && is_array( $gradient['radius'] ) ? $gradient['radius'] : array();
    $center_x = figmapress_connector_css_number( isset( $center['x'] ) ? $center['x'] : 50, -100, 200 );
    $center_y = figmapress_connector_css_number( isset( $center['y'] ) ? $center['y'] : 50, -100, 200 );
    $radius_x = figmapress_connector_css_number( isset( $radius['x'] ) ? $radius['x'] : 50, 0.1, 400 );
    $radius_y = figmapress_connector_css_number( isset( $radius['y'] ) ? $radius['y'] : 50, 0.1, 400 );
    return 'radial-gradient(ellipse ' . $radius_x . '% ' . $radius_y . '% at ' . $center_x . '% ' . $center_y . '%,' . implode( ',', $stops ) . ')';
}

/**
 * Generate bounded CSS declarations from structured Figma effect values.
 *
 * No CSS property name or free-form value is read from the saved document.
 * Opacity, shadow geometry, colors and blur radii are rebuilt from numbers.
 */
function figmapress_connector_effects_css( $effects ) {
    if ( ! is_array( $effects ) ) {
        return '';
    }
    $declarations = array();

    if ( array_key_exists( 'opacity', $effects ) ) {
        $opacity = figmapress_connector_css_number( $effects['opacity'], 0, 1 );
        if ( null !== $opacity ) {
            $declarations[] = 'opacity:' . $opacity;
        }
    }

    $shadows = array();
    foreach ( isset( $effects['shadows'] ) && is_array( $effects['shadows'] ) ? array_slice( $effects['shadows'], 0, 8 ) : array() as $shadow ) {
        if ( ! is_array( $shadow ) ) {
            continue;
        }
        $type = isset( $shadow['type'] ) ? sanitize_key( $shadow['type'] ) : '';
        if ( ! in_array( $type, array( 'drop', 'inner' ), true ) ) {
            continue;
        }
        $x      = figmapress_connector_css_number( isset( $shadow['x'] ) ? $shadow['x'] : null, -2000, 2000 );
        $y      = figmapress_connector_css_number( isset( $shadow['y'] ) ? $shadow['y'] : null, -2000, 2000 );
        $blur   = figmapress_connector_css_number( isset( $shadow['blur'] ) ? $shadow['blur'] : null, 0, 2000 );
        $spread = figmapress_connector_css_number( isset( $shadow['spread'] ) ? $shadow['spread'] : null, -2000, 2000 );
        $color  = figmapress_connector_gradient_color_css( isset( $shadow['color'] ) ? $shadow['color'] : null );
        if ( null === $x || null === $y || null === $blur || null === $spread || '' === $color ) {
            continue;
        }
        $shadows[] = $x . 'px ' . $y . 'px ' . $blur . 'px ' . $spread . 'px ' . $color . ( 'inner' === $type ? ' inset' : '' );
    }
    if ( $shadows ) {
        $declarations[] = 'box-shadow:' . implode( ',', $shadows );
    }

    $blur = isset( $effects['blur'] )
        ? figmapress_connector_css_number( $effects['blur'], 0, 200 )
        : null;
    if ( null !== $blur && (float) $blur > 0 ) {
        $declarations[] = 'filter:blur(' . $blur . 'px)';
    }
    $background_blur = isset( $effects['backgroundBlur'] )
        ? figmapress_connector_css_number( $effects['backgroundBlur'], 0, 200 )
        : null;
    if ( null !== $background_blur && (float) $background_blur > 0 ) {
        $declarations[] = '-webkit-backdrop-filter:blur(' . $background_blur . 'px)';
        $declarations[] = 'backdrop-filter:blur(' . $background_blur . 'px)';
    }

    return $declarations ? implode( ';', $declarations ) . ';' : '';
}

/**
 * Build safe CSS custom properties for an editable Figma image crop.
 *
 * Figma stores crop geometry as a normalized 2x3 affine matrix. The generated
 * manifest contains numbers only; this function bounds every value and rebuilds
 * the CSS instead of accepting an arbitrary transform string from post meta.
 */
function figmapress_connector_image_css( $image, $source = array() ) {
    if ( ! is_array( $image ) ) {
        return array();
    }
    $mode = isset( $image['mode'] ) ? sanitize_key( $image['mode'] ) : '';
    if ( ! in_array( $mode, array( 'fill', 'fit', 'stretch', 'tile' ), true ) ) {
        return array();
    }

    $declarations = array();
    $translate_x  = '0';
    $translate_y  = '0';
    $matrix       = '';
    if ( isset( $image['transform'] ) && is_array( $image['transform'] ) ) {
        $transform = $image['transform'];
        $a         = figmapress_connector_css_number( isset( $transform['a'] ) ? $transform['a'] : null, -100, 100 );
        $b         = figmapress_connector_css_number( isset( $transform['b'] ) ? $transform['b'] : null, -100, 100 );
        $c         = figmapress_connector_css_number( isset( $transform['c'] ) ? $transform['c'] : null, -100, 100 );
        $d         = figmapress_connector_css_number( isset( $transform['d'] ) ? $transform['d'] : null, -100, 100 );
        $tx        = figmapress_connector_css_number( isset( $transform['tx'] ) ? 100 * (float) $transform['tx'] : null, -10000, 10000 );
        $ty        = figmapress_connector_css_number( isset( $transform['ty'] ) ? 100 * (float) $transform['ty'] : null, -10000, 10000 );
        if ( null !== $a && null !== $b && null !== $c && null !== $d && null !== $tx && null !== $ty ) {
            $translate_x = $tx;
            $translate_y = $ty;
            $matrix      = 'matrix(' . $a . ',' . $c . ',' . $b . ',' . $d . ',0,0)';
        }
    }

    $rotation = isset( $image['rotation'] )
        ? figmapress_connector_css_number( $image['rotation'], -3600, 3600 )
        : null;
    $parts    = array();
    if ( '' !== $matrix ) {
        $parts[] = $matrix;
    }
    if ( null !== $rotation && abs( (float) $rotation ) > 0.0001 ) {
        $parts[] = 'rotate(' . $rotation . 'deg)';
    }
    $transform_css = $parts ? implode( ' ', $parts ) : 'none';
    $declarations[] = '--figmapress-image-translate:' . $translate_x . '% ' . $translate_y . '%';
    $declarations[] = '--figmapress-image-matrix:' . $transform_css;
    $declarations[] = '--figmapress-image-transform:translate(' . $translate_x . '%,' . $translate_y . '%) ' . $transform_css;

    $filters = isset( $image['filters'] ) && is_array( $image['filters'] ) ? $image['filters'] : array();
    $filter  = array();
    if ( isset( $filters['exposure'] ) ) {
        $exposure = figmapress_connector_css_number( $filters['exposure'], -1, 1 );
        if ( null !== $exposure ) {
            $filter[] = 'brightness(' . figmapress_connector_css_number( pow( 2, (float) $exposure ), 0.05, 20 ) . ')';
        }
    }
    if ( isset( $filters['contrast'] ) ) {
        $contrast = figmapress_connector_css_number( $filters['contrast'], -1, 1 );
        if ( null !== $contrast ) {
            $filter[] = 'contrast(' . figmapress_connector_css_number( 1 + (float) $contrast, 0, 2 ) . ')';
        }
    }
    if ( isset( $filters['saturation'] ) ) {
        $saturation = figmapress_connector_css_number( $filters['saturation'], -1, 1 );
        if ( null !== $saturation ) {
            $filter[] = 'saturate(' . figmapress_connector_css_number( 1 + (float) $saturation, 0, 2 ) . ')';
        }
    }
    $declarations[] = '--figmapress-image-filter:' . ( $filter ? implode( ' ', $filter ) : 'none' );

    if ( 'tile' === $mode ) {
        $scale = isset( $image['scalingFactor'] )
            ? figmapress_connector_css_number( 100 * (float) $image['scalingFactor'], 1, 2000 )
            : '100';
        $declarations[] = '--figmapress-image-tile-size:' . $scale . '%';
        $url    = is_array( $source ) && isset( $source['url'] ) ? esc_url_raw( $source['url'], array( 'http', 'https' ) ) : '';
        $scheme = $url ? wp_parse_url( $url, PHP_URL_SCHEME ) : '';
        if ( $url && in_array( strtolower( (string) $scheme ), array( 'http', 'https' ), true ) ) {
            $quoted_url     = str_replace( array( '\\', '"' ), array( '\\\\', '\\"' ), $url );
            $declarations[] = '--figmapress-image-tile-url:url("' . $quoted_url . '")';
        }
    }

    return array(
        'mode'  => $mode,
        'style' => implode( ';', $declarations ) . ';',
    );
}

/**
 * Expose stable Figma node identities in Elementor's rendered DOM.
 *
 * The authenticated snapshot endpoint uses these attributes to measure the
 * actual WordPress output section by section. They contain no credentials or
 * unpublished copy beyond the layer names already stored in the document.
 */
function figmapress_connector_add_elementor_render_attributes( $element ) {
    if ( ! is_object( $element ) || ! method_exists( $element, 'get_settings_for_display' ) || ! method_exists( $element, 'add_render_attribute' ) ) {
        return;
    }
    static $processed = array();
    $object_id        = function_exists( 'spl_object_id' ) ? spl_object_id( $element ) : 0;
    if ( $object_id && isset( $processed[ $object_id ] ) ) {
        return;
    }
    if ( $object_id ) {
        $processed[ $object_id ] = true;
    }

    $settings  = $element->get_settings_for_display();
    $node_id   = isset( $settings['figmapress_node_id'] ) ? sanitize_text_field( $settings['figmapress_node_id'] ) : '';
    $node_name = isset( $settings['figmapress_node_name'] ) ? sanitize_text_field( $settings['figmapress_node_name'] ) : '';
    if ( '' !== $node_id && preg_match( '/^[A-Za-z0-9:_-]{1,160}$/', $node_id ) ) {
        $element->add_render_attribute( '_wrapper', 'data-figmapress-node-id', $node_id );
    }
    if ( '' !== $node_name ) {
        $element->add_render_attribute( '_wrapper', 'data-figmapress-node-name', $node_name );
    }
    if ( isset( $settings['figmapress_section'] ) && 'yes' === $settings['figmapress_section'] ) {
        $element->add_render_attribute( '_wrapper', 'data-figmapress-section', 'true' );
    }
    $gradient_css = figmapress_connector_gradient_css(
        isset( $settings['figmapress_gradient'] ) ? $settings['figmapress_gradient'] : null
    );
    if ( '' !== $gradient_css ) {
        $element->add_render_attribute( '_wrapper', 'style', 'background-image:' . $gradient_css . ';' );
    }
    $effects_css = figmapress_connector_effects_css(
        isset( $settings['figmapress_effects'] ) ? $settings['figmapress_effects'] : null
    );
    if ( '' !== $effects_css ) {
        $element->add_render_attribute( '_wrapper', 'style', $effects_css );
    }
    $image_css = figmapress_connector_image_css(
        isset( $settings['figmapress_image'] ) ? $settings['figmapress_image'] : null,
        isset( $settings['image'] ) ? $settings['image'] : array()
    );
    if ( $image_css ) {
        $element->add_render_attribute( '_wrapper', 'class', 'figmapress-image-adjusted' );
        $element->add_render_attribute( '_wrapper', 'class', 'figmapress-image-' . $image_css['mode'] );
        $element->add_render_attribute( '_wrapper', 'data-figmapress-image-mode', $image_css['mode'] );
        $element->add_render_attribute( '_wrapper', 'style', $image_css['style'] );
    }
    $element_type = method_exists( $element, 'get_type' ) ? $element->get_type() : '';
    $widget_name  = method_exists( $element, 'get_name' ) ? $element->get_name() : '';
    $kind         = 'container';
    if ( 'widget' === $element_type ) {
        $kind = 'text-editor' === $widget_name ? 'text' : ( 'image' === $widget_name ? 'visual' : 'widget' );
    }
    $element->add_render_attribute( '_wrapper', 'data-figmapress-kind', $kind );

    $classes = isset( $settings['css_classes'] ) ? preg_split( '/\s+/', $settings['css_classes'] ) : array();
    foreach ( $classes as $class_name ) {
        $safe_class = sanitize_html_class( $class_name );
        if ( '' !== $safe_class ) {
            $element->add_render_attribute( '_wrapper', 'class', $safe_class );
        }
    }
    if ( in_array( 'figmapress-layout', $classes, true ) ) {
        $element->add_render_attribute( '_wrapper', 'class', 'figmapress-figma-preview' );
    }
}
add_action( 'elementor/frontend/element/before_render', 'figmapress_connector_add_elementor_render_attributes' );
add_action( 'elementor/frontend/widget/before_render', 'figmapress_connector_add_elementor_render_attributes' );

/** Preserve Elementor metadata in the WordPress revision created before QA updates. */
function figmapress_connector_revision_meta_keys( $keys ) {
    return array_values(
        array_unique(
            array_merge(
                $keys,
                array(
                    '_elementor_data',
                    '_elementor_page_settings',
                    '_elementor_edit_mode',
                    '_elementor_template_type',
                    '_elementor_version',
                    '_wp_page_template',
                )
            )
        )
    );
}
add_filter( 'wp_post_revision_meta_keys', 'figmapress_connector_revision_meta_keys' );

/**
 * Small helper used by render.php files. Centralizes attribute escaping
 * so individual block templates stay short.
 */
function figmapress_attr( $attributes, $key, $default = '' ) {
    return isset( $attributes[ $key ] ) ? $attributes[ $key ] : $default;
}
