<?php
if ( ! defined( 'ABSPATH' ) ) { exit; }

$headline = figmapress_attr( $attributes, 'headline' );
$text     = figmapress_attr( $attributes, 'text' );
$btn_text = figmapress_attr( $attributes, 'buttonText' );
$btn_url  = figmapress_attr( $attributes, 'buttonUrl' );
$wrapper  = get_block_wrapper_attributes( array( 'class' => 'wp-block-figmapress-contact' ) );
?>
<section <?php echo $wrapper; ?>>
    <?php if ( $headline ) : ?>
        <h2 class="wp-block-figmapress-contact__headline"><?php echo esc_html( $headline ); ?></h2>
    <?php endif; ?>
    <?php if ( $text ) : ?>
        <p class="wp-block-figmapress-contact__text"><?php echo esc_html( $text ); ?></p>
    <?php endif; ?>
    <?php if ( $btn_text ) : ?>
        <a class="wp-block-figmapress-contact__button" href="<?php echo esc_url( $btn_url ); ?>"><?php echo esc_html( $btn_text ); ?></a>
    <?php endif; ?>
</section>
