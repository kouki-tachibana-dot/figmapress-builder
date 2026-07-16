<?php
/**
 * Server render for figmapress/hero.
 * Mirrors the markup produced by the TypeScript renderer so the front-end
 * looks identical whether the page is freshly rendered or cached.
 */
if ( ! defined( 'ABSPATH' ) ) { exit; }

$headline   = figmapress_attr( $attributes, 'headline' );
$subtext    = figmapress_attr( $attributes, 'subtext' );
$btn_text   = figmapress_attr( $attributes, 'primaryButtonText' );
$btn_url    = figmapress_attr( $attributes, 'primaryButtonUrl' );
$image_url  = figmapress_attr( $attributes, 'imageUrl' );
$layout     = figmapress_attr( $attributes, 'layoutVariant', 'stacked' );

$wrapper = get_block_wrapper_attributes( array(
    'class'       => 'wp-block-figmapress-hero',
    'data-layout' => $layout,
) );
?>
<section <?php echo $wrapper; ?>>
    <div class="wp-block-figmapress-hero__body">
        <?php if ( $headline ) : ?>
            <h1 class="wp-block-figmapress-hero__headline"><?php echo esc_html( $headline ); ?></h1>
        <?php endif; ?>
        <?php if ( $subtext ) : ?>
            <p class="wp-block-figmapress-hero__subtext"><?php echo esc_html( $subtext ); ?></p>
        <?php endif; ?>
        <?php if ( $btn_text ) : ?>
            <a class="wp-block-figmapress-hero__button" href="<?php echo esc_url( $btn_url ); ?>"><?php echo esc_html( $btn_text ); ?></a>
        <?php endif; ?>
    </div>
    <?php if ( $image_url ) : ?>
        <figure class="wp-block-figmapress-hero__image">
            <img src="<?php echo esc_url( $image_url ); ?>" alt="<?php echo esc_attr( $headline ); ?>" />
        </figure>
    <?php endif; ?>
</section>
