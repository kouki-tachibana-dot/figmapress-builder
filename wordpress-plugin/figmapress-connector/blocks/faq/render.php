<?php
if ( ! defined( 'ABSPATH' ) ) { exit; }

$headline = figmapress_attr( $attributes, 'headline' );
$items    = figmapress_attr( $attributes, 'items', array() );
$wrapper  = get_block_wrapper_attributes( array( 'class' => 'wp-block-figmapress-faq' ) );
?>
<section <?php echo $wrapper; ?>>
    <?php if ( $headline ) : ?>
        <h2 class="wp-block-figmapress-faq__headline"><?php echo esc_html( $headline ); ?></h2>
    <?php endif; ?>
    <dl class="wp-block-figmapress-faq__items">
        <?php foreach ( (array) $items as $item ) : ?>
            <dt><?php echo esc_html( $item['question'] ?? '' ); ?></dt>
            <dd><?php echo esc_html( $item['answer'] ?? '' ); ?></dd>
        <?php endforeach; ?>
    </dl>
</section>
