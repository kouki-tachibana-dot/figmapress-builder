<?php
if ( ! defined( 'ABSPATH' ) ) { exit; }

$headline = figmapress_attr( $attributes, 'headline' );
$btn_text = figmapress_attr( $attributes, 'buttonText' );
$btn_url  = figmapress_attr( $attributes, 'buttonUrl' );
$wrapper  = get_block_wrapper_attributes( array( 'class' => 'wp-block-figmapress-cta' ) );
?>
<section <?php echo $wrapper; ?>>
    <?php if ( $headline ) : ?>
        <h2 class="wp-block-figmapress-cta__headline"><?php echo esc_html( $headline ); ?></h2>
    <?php endif; ?>
    <?php if ( $btn_text ) : ?>
        <a class="wp-block-figmapress-cta__button" href="<?php echo esc_url( $btn_url ); ?>"><?php echo esc_html( $btn_text ); ?></a>
    <?php endif; ?>
</section>
