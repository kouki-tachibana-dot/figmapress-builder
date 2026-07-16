<?php
if ( ! defined( 'ABSPATH' ) ) { exit; }

$headline = figmapress_attr( $attributes, 'headline' );
$items    = figmapress_attr( $attributes, 'items', array() );
$wrapper  = get_block_wrapper_attributes( array( 'class' => 'wp-block-figmapress-card-grid' ) );
?>
<section <?php echo $wrapper; ?>>
    <?php if ( $headline ) : ?>
        <h2 class="wp-block-figmapress-card-grid__headline"><?php echo esc_html( $headline ); ?></h2>
    <?php endif; ?>
    <ul class="wp-block-figmapress-card-grid__items">
        <?php foreach ( (array) $items as $item ) : ?>
            <li class="wp-block-figmapress-card-grid__item">
                <h3><?php echo esc_html( $item['title'] ?? '' ); ?></h3>
                <p><?php echo esc_html( $item['text'] ?? '' ); ?></p>
            </li>
        <?php endforeach; ?>
    </ul>
</section>
