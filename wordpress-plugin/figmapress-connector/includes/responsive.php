<?php
/** Responsive root visibility follows the target site's Elementor settings. */
if ( ! defined( 'ABSPATH' ) ) {
    exit;
}

function figmapress_connector_responsive_breakpoints() {
    $defaults = array( 'mobile' => 767, 'tablet' => 1024 );
    if ( ! class_exists( '\\Elementor\\Plugin' ) || ! isset( \Elementor\Plugin::$instance->breakpoints ) ) {
        return $defaults;
    }
    $manager = \Elementor\Plugin::$instance->breakpoints;
    if ( ! method_exists( $manager, 'get_active_breakpoints' ) ) {
        return $defaults;
    }
    try {
        $registered = $manager->get_active_breakpoints();
        $values = $defaults;
        foreach ( $values as $name => $default ) {
            if ( isset( $registered[ $name ] ) && is_object( $registered[ $name ] ) && method_exists( $registered[ $name ], 'get_value' ) ) {
                $value = $registered[ $name ]->get_value();
                if ( is_numeric( $value ) && $value >= 1 && $value <= 10000 ) {
                    $values[ $name ] = (int) $value;
                }
            }
        }
        return $values['mobile'] < $values['tablet'] ? $values : $defaults;
    } catch ( \Throwable $error ) {
        return $defaults;
    }
}

function figmapress_connector_responsive_css() {
    $css = file_get_contents( FIGMAPRESS_CONNECTOR_DIR . 'assets/elementor-responsive-0198.css' );
    if ( ! is_string( $css ) ) {
        return '';
    }
    $values = figmapress_connector_responsive_breakpoints();
    return strtr( $css, array(
        '(max-width: 767px)' => '(max-width: ' . $values['mobile'] . 'px)',
        '(max-width: 1024px)' => '(max-width: ' . $values['tablet'] . 'px)',
    ) );
}
