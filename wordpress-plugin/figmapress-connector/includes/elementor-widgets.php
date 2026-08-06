<?php
/** Elementor widgets for functional FigmaPress output. */

if ( ! defined( 'ABSPATH' ) ) {
    exit;
}

/** Sanitize a CSS color while allowing the rgba() colors returned by Figma. */
function figmapress_connector_css_color( $value, $fallback ) {
    $value = trim( (string) $value );
    if ( sanitize_hex_color( $value ) ) {
        return $value;
    }
    if ( preg_match( '/^rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}(?:\s*,\s*(?:0(?:\.\d+)?|1(?:\.0+)?))?\s*\)$/', $value ) ) {
        return $value;
    }
    return $fallback;
}

/** Decode Figma geometry stored in an Elementor hidden setting. */
function figmapress_connector_design_geometry( $settings ) {
    $raw = isset( $settings['design_geometry'] ) ? $settings['design_geometry'] : '';
    if ( ! is_string( $raw ) || '' === $raw ) {
        return null;
    }
    $geometry = json_decode( $raw, true );
    return is_array( $geometry ) ? $geometry : null;
}

/** Convert a normalized Figma box into safe inline positioning. */
function figmapress_connector_geometry_style( $box, $include_text = false ) {
    if ( ! is_array( $box ) ) {
        return '';
    }
    $style = '';
    foreach ( array( 'x' => 'left', 'y' => 'top', 'width' => 'width', 'height' => 'height' ) as $key => $property ) {
        if ( isset( $box[ $key ] ) && is_numeric( $box[ $key ] ) ) {
            $style .= $property . ':' . (float) $box[ $key ] . '%;';
        }
    }
    if ( $include_text ) {
        if ( isset( $box['fontSize'] ) && is_numeric( $box['fontSize'] ) ) {
            $style .= 'font-size:' . (float) $box['fontSize'] . 'cqw;';
        }
        if ( isset( $box['fontWeight'] ) && is_numeric( $box['fontWeight'] ) ) {
            $style .= 'font-weight:' . max( 100, min( 900, (int) $box['fontWeight'] ) ) . ';';
        }
        if ( isset( $box['letterSpacing'] ) && is_numeric( $box['letterSpacing'] ) ) {
            $style .= 'letter-spacing:' . (float) $box['letterSpacing'] . 'cqw;';
        }
    }
    return $style;
}

/** Preserve a Figma component's imported width-to-height ratio. */
function figmapress_connector_aspect_style( $geometry ) {
    if (
        ! is_array( $geometry )
        || ! isset( $geometry['root']['width'], $geometry['root']['height'] )
        || ! is_numeric( $geometry['root']['width'] )
        || ! is_numeric( $geometry['root']['height'] )
        || (float) $geometry['root']['width'] <= 0
        || (float) $geometry['root']['height'] <= 0
    ) {
        return '';
    }
    return 'aspect-ratio:' . (float) $geometry['root']['width'] . '/' . (float) $geometry['root']['height'] . ';';
}

abstract class FigmaPress_Widget_Base extends \Elementor\Widget_Base {
    public function get_categories() {
        return array( 'figmapress' );
    }

    public function get_style_depends() {
        return array( 'figmapress-elementor-interactions' );
    }

    public function get_script_depends() {
        return array( 'figmapress-elementor-interactions' );
    }
}

final class FigmaPress_Nav_Widget extends FigmaPress_Widget_Base {
    public function get_name() {
        return 'figmapress-nav';
    }

    public function get_title() {
        return esc_html__( 'FigmaPress ナビ', 'figmapress-connector' );
    }

    public function get_icon() {
        return 'eicon-nav-menu';
    }

    protected function register_controls() {
        $this->start_controls_section(
            'content',
            array( 'label' => esc_html__( 'ナビゲーション', 'figmapress-connector' ) )
        );
        $this->add_control(
            'logo',
            array(
                'label' => esc_html__( 'ロゴ', 'figmapress-connector' ),
                'type'  => \Elementor\Controls_Manager::MEDIA,
            )
        );
        $this->add_control(
            'cta_icon',
            array(
                'label' => esc_html__( 'CTAアイコン', 'figmapress-connector' ),
                'type'  => \Elementor\Controls_Manager::MEDIA,
            )
        );
        $repeater = new \Elementor\Repeater();
        $repeater->add_control(
            'label',
            array(
                'label'   => esc_html__( '表示名', 'figmapress-connector' ),
                'type'    => \Elementor\Controls_Manager::TEXT,
                'default' => esc_html__( 'メニュー', 'figmapress-connector' ),
            )
        );
        $repeater->add_control(
            'url',
            array(
                'label'   => esc_html__( 'リンク', 'figmapress-connector' ),
                'type'    => \Elementor\Controls_Manager::URL,
                'default' => array( 'url' => '#content' ),
            )
        );
        $this->add_control(
            'items',
            array(
                'label'       => esc_html__( 'メニュー項目', 'figmapress-connector' ),
                'type'        => \Elementor\Controls_Manager::REPEATER,
                'fields'      => $repeater->get_controls(),
                'title_field' => '{{{ label }}}',
            )
        );
        $this->add_control(
            'cta_label',
            array(
                'label'   => esc_html__( 'CTA表示名', 'figmapress-connector' ),
                'type'    => \Elementor\Controls_Manager::TEXT,
                'default' => esc_html__( 'お問い合わせ', 'figmapress-connector' ),
            )
        );
        $this->add_control(
            'cta_url',
            array(
                'label'   => esc_html__( 'CTAリンク', 'figmapress-connector' ),
                'type'    => \Elementor\Controls_Manager::URL,
                'default' => array( 'url' => '#contact' ),
            )
        );
        $this->add_control(
            'home_url',
            array(
                'label'   => esc_html__( 'ロゴリンク', 'figmapress-connector' ),
                'type'    => \Elementor\Controls_Manager::URL,
                'default' => array( 'url' => '#top' ),
            )
        );
        $this->add_control(
            'layout_variant',
            array(
                'type'    => \Elementor\Controls_Manager::HIDDEN,
                'default' => 'single',
            )
        );
        $this->add_control(
            'design_geometry',
            array(
                'type'    => \Elementor\Controls_Manager::HIDDEN,
                'default' => '',
            )
        );
        $this->end_controls_section();

        $this->start_controls_section(
            'colors',
            array(
                'label' => esc_html__( '色', 'figmapress-connector' ),
                'tab'   => \Elementor\Controls_Manager::TAB_STYLE,
            )
        );
        foreach ( array(
            'background_color' => array( '背景色', '#FFFFFF' ),
            'accent_color'     => array( 'アクセント色', '#D10B2C' ),
            'text_color'       => array( '文字色', '#202020' ),
        ) as $key => $control ) {
            $this->add_control(
                $key,
                array(
                    'label'   => esc_html__( $control[0], 'figmapress-connector' ),
                    'type'    => \Elementor\Controls_Manager::COLOR,
                    'default' => $control[1],
                )
            );
        }
        $this->end_controls_section();
    }

    protected function render() {
        $settings   = $this->get_settings_for_display();
        $items      = isset( $settings['items'] ) && is_array( $settings['items'] ) ? $settings['items'] : array();
        $logo       = isset( $settings['logo']['url'] ) ? $settings['logo']['url'] : '';
        $cta_icon   = isset( $settings['cta_icon']['url'] ) ? $settings['cta_icon']['url'] : '';
        $cta_url    = isset( $settings['cta_url']['url'] ) ? $settings['cta_url']['url'] : '#contact';
        $home_url   = isset( $settings['home_url']['url'] ) ? $settings['home_url']['url'] : '#top';
        $is_mobile  = isset( $settings['layout_variant'] ) && 'mobile' === $settings['layout_variant'];
        $menu_id    = 'figmapress-menu-' . $this->get_id();
        $menu_state_id = $menu_id . '-state';
        $background = figmapress_connector_css_color( isset( $settings['background_color'] ) ? $settings['background_color'] : '', '#FFFFFF' );
        $accent     = figmapress_connector_css_color( isset( $settings['accent_color'] ) ? $settings['accent_color'] : '', '#D10B2C' );
        $text       = figmapress_connector_css_color( isset( $settings['text_color'] ) ? $settings['text_color'] : '', '#202020' );
        $geometry   = figmapress_connector_design_geometry( $settings );
        $fidelity   = is_array( $geometry );
        $nav_style  = '--figmapress-nav-bg:' . $background . ';--figmapress-accent:' . $accent . ';--figmapress-text:' . $text . ';' . figmapress_connector_aspect_style( $geometry );
        ?>
        <nav class="figmapress-nav<?php echo $is_mobile ? ' figmapress-nav--mobile' : ''; ?><?php echo $fidelity ? ' figmapress-nav--fidelity' : ''; ?>" aria-label="<?php esc_attr_e( 'メインナビゲーション', 'figmapress-connector' ); ?>" style="<?php echo esc_attr( $nav_style ); ?>">
            <?php if ( $fidelity && ! empty( $geometry['topBar'] ) ) : ?>
                <span class="figmapress-nav__topbar" aria-hidden="true" style="<?php echo esc_attr( figmapress_connector_geometry_style( $geometry['topBar'] ) ); ?>"></span>
            <?php endif; ?>
            <?php if ( $logo ) : ?>
                <a class="figmapress-nav__logo" href="<?php echo esc_url( $home_url ); ?>" aria-label="<?php esc_attr_e( 'ページ先頭', 'figmapress-connector' ); ?>"<?php echo $fidelity && ! empty( $geometry['logo'] ) ? ' style="' . esc_attr( figmapress_connector_geometry_style( $geometry['logo'] ) ) . '"' : ''; ?>><img src="<?php echo esc_url( $logo ); ?>" alt="<?php esc_attr_e( 'サイトロゴ', 'figmapress-connector' ); ?>"></a>
            <?php endif; ?>
            <?php if ( $fidelity && $cta_icon && ! empty( $geometry['ctaIcon'] ) ) : ?>
                <img class="figmapress-nav__cta-icon" src="<?php echo esc_url( $cta_icon ); ?>" alt="" aria-hidden="true" style="<?php echo esc_attr( figmapress_connector_geometry_style( $geometry['ctaIcon'] ) ); ?>">
            <?php endif; ?>
            <input class="figmapress-nav__state" id="<?php echo esc_attr( $menu_state_id ); ?>" type="checkbox" aria-controls="<?php echo esc_attr( $menu_id ); ?>" aria-label="<?php esc_attr_e( 'メニューを開閉', 'figmapress-connector' ); ?>"<?php echo $fidelity && ! empty( $geometry['toggle'] ) ? ' style="' . esc_attr( figmapress_connector_geometry_style( $geometry['toggle'] ) ) . '"' : ''; ?>>
            <label class="figmapress-nav__toggle" for="<?php echo esc_attr( $menu_state_id ); ?>"<?php echo $fidelity && ! empty( $geometry['toggle'] ) ? ' style="' . esc_attr( figmapress_connector_geometry_style( $geometry['toggle'] ) ) . '"' : ''; ?>><span></span><span></span><span></span><span class="screen-reader-text"><?php esc_html_e( 'メニューを開閉', 'figmapress-connector' ); ?></span></label>
            <?php if ( $is_mobile && ! empty( $settings['cta_label'] ) ) : ?>
                <a class="figmapress-nav__mobile-cta" href="<?php echo esc_url( $cta_url ); ?>"<?php echo $fidelity && ! empty( $geometry['cta'] ) ? ' style="' . esc_attr( figmapress_connector_geometry_style( $geometry['cta'], true ) ) . '"' : ''; ?>><?php echo esc_html( $settings['cta_label'] ); ?></a>
            <?php endif; ?>
            <div class="figmapress-nav__panel" id="<?php echo esc_attr( $menu_id ); ?>">
                <ul class="figmapress-nav__items">
                    <?php foreach ( $items as $index => $item ) :
                        $url = isset( $item['url']['url'] ) ? $item['url']['url'] : '#';
                        $item_geometry = $fidelity && isset( $geometry['items'][ $index ] ) ? $geometry['items'][ $index ] : null;
                        ?>
                        <li<?php echo $item_geometry ? ' style="' . esc_attr( figmapress_connector_geometry_style( $item_geometry, true ) ) . '"' : ''; ?>><a href="<?php echo esc_url( $url ); ?>"><?php echo esc_html( isset( $item['label'] ) ? $item['label'] : '' ); ?></a></li>
                    <?php endforeach; ?>
                </ul>
                <?php if ( ! empty( $settings['cta_label'] ) ) : ?>
                    <a class="figmapress-nav__cta" href="<?php echo esc_url( $cta_url ); ?>"<?php echo $fidelity && ! empty( $geometry['cta'] ) ? ' style="' . esc_attr( figmapress_connector_geometry_style( $geometry['cta'], true ) ) . '"' : ''; ?>><?php echo esc_html( $settings['cta_label'] ); ?></a>
                <?php endif; ?>
            </div>
        </nav>
        <?php
    }
}

final class FigmaPress_Link_Widget extends FigmaPress_Widget_Base {
    public function get_name() {
        return 'figmapress-link';
    }

    public function get_title() {
        return esc_html__( 'FigmaPress リンク領域', 'figmapress-connector' );
    }

    public function get_icon() {
        return 'eicon-editor-link';
    }

    protected function register_controls() {
        $this->start_controls_section(
            'content',
            array( 'label' => esc_html__( 'リンク', 'figmapress-connector' ) )
        );
        $this->add_control(
            'link_label',
            array(
                'label'   => esc_html__( '読み上げラベル', 'figmapress-connector' ),
                'type'    => \Elementor\Controls_Manager::TEXT,
                'default' => esc_html__( 'リンク', 'figmapress-connector' ),
            )
        );
        $this->add_control(
            'link_url',
            array(
                'label'   => esc_html__( 'リンク先', 'figmapress-connector' ),
                'type'    => \Elementor\Controls_Manager::URL,
                'default' => array( 'url' => '#' ),
            )
        );
        $this->end_controls_section();
    }

    protected function render() {
        $settings = $this->get_settings_for_display();
        $url      = isset( $settings['link_url']['url'] ) ? $settings['link_url']['url'] : '';
        $label    = isset( $settings['link_label'] ) && '' !== $settings['link_label']
            ? $settings['link_label']
            : esc_html__( 'リンク', 'figmapress-connector' );
        $external = ! empty( $settings['link_url']['is_external'] );
        $nofollow = ! empty( $settings['link_url']['nofollow'] );
        if ( '' === $url ) {
            return;
        }
        ?>
        <a class="figmapress-link" href="<?php echo esc_url( $url ); ?>" aria-label="<?php echo esc_attr( $label ); ?>"<?php echo $external ? ' target="_blank"' : ''; ?><?php echo $external || $nofollow ? ' rel="' . esc_attr( trim( ( $external ? 'noopener noreferrer ' : '' ) . ( $nofollow ? 'nofollow' : '' ) ) ) . '"' : ''; ?>><span class="screen-reader-text"><?php echo esc_html( $label ); ?></span></a>
        <?php
    }
}

final class FigmaPress_Carousel_Widget extends FigmaPress_Widget_Base {
    public function get_name() {
        return 'figmapress-carousel';
    }

    public function get_title() {
        return esc_html__( 'FigmaPress カルーセル', 'figmapress-connector' );
    }

    public function get_icon() {
        return 'eicon-slider-album';
    }

    protected function register_controls() {
        $this->start_controls_section(
            'content',
            array( 'label' => esc_html__( 'カルーセル', 'figmapress-connector' ) )
        );
        $repeater = new \Elementor\Repeater();
        $repeater->add_control(
            'image',
            array(
                'label' => esc_html__( '画像', 'figmapress-connector' ),
                'type'  => \Elementor\Controls_Manager::MEDIA,
            )
        );
        $repeater->add_control(
            'title',
            array(
                'label'   => esc_html__( 'タイトル', 'figmapress-connector' ),
                'type'    => \Elementor\Controls_Manager::TEXT,
                'default' => esc_html__( 'スライド', 'figmapress-connector' ),
            )
        );
        $repeater->add_control(
            'url',
            array(
                'label' => esc_html__( 'リンク', 'figmapress-connector' ),
                'type'  => \Elementor\Controls_Manager::URL,
            )
        );
        $this->add_control(
            'items',
            array(
                'label'       => esc_html__( 'スライド', 'figmapress-connector' ),
                'type'        => \Elementor\Controls_Manager::REPEATER,
                'fields'      => $repeater->get_controls(),
                'title_field' => '{{{ title }}}',
            )
        );
        foreach ( array(
            'items_per_view'        => array( 'PC表示枚数', 3 ),
            'items_per_view_mobile' => array( 'スマホ表示枚数', 1 ),
        ) as $key => $control ) {
            $this->add_control(
                $key,
                array(
                    'label'   => esc_html__( $control[0], 'figmapress-connector' ),
                    'type'    => \Elementor\Controls_Manager::NUMBER,
                    'default' => $control[1],
                    'min'     => 1,
                    'max'     => 6,
                    'step'    => 1,
                )
            );
        }
        foreach ( array(
            'show_dots' => array( 'ドットを表示', 'yes' ),
            'loop'      => array( 'ループ', '' ),
            'autoplay'  => array( '自動再生', '' ),
        ) as $key => $control ) {
            $this->add_control(
                $key,
                array(
                    'label'        => esc_html__( $control[0], 'figmapress-connector' ),
                    'type'         => \Elementor\Controls_Manager::SWITCHER,
                    'return_value' => 'yes',
                    'default'      => $control[1],
                )
            );
        }
        $this->add_control(
            'previous_icon',
            array(
                'label' => esc_html__( '前へアイコン', 'figmapress-connector' ),
                'type'  => \Elementor\Controls_Manager::MEDIA,
            )
        );
        $this->add_control(
            'next_icon',
            array(
                'label' => esc_html__( '次へアイコン', 'figmapress-connector' ),
                'type'  => \Elementor\Controls_Manager::MEDIA,
            )
        );
        $this->end_controls_section();

        $this->start_controls_section(
            'colors',
            array(
                'label' => esc_html__( '色', 'figmapress-connector' ),
                'tab'   => \Elementor\Controls_Manager::TAB_STYLE,
            )
        );
        $this->add_control(
            'accent_color',
            array(
                'label'   => esc_html__( 'アクセント色', 'figmapress-connector' ),
                'type'    => \Elementor\Controls_Manager::COLOR,
                'default' => '#D10B2C',
            )
        );
        $this->end_controls_section();
    }

    protected function render() {
        $settings       = $this->get_settings_for_display();
        $items          = isset( $settings['items'] ) && is_array( $settings['items'] ) ? $settings['items'] : array();
        $count          = count( $items );
        $per_view       = max( 1, min( 6, absint( isset( $settings['items_per_view'] ) ? $settings['items_per_view'] : 3 ) ) );
        $mobile_view    = max( 1, min( 6, absint( isset( $settings['items_per_view_mobile'] ) ? $settings['items_per_view_mobile'] : 1 ) ) );
        $accent         = figmapress_connector_css_color( isset( $settings['accent_color'] ) ? $settings['accent_color'] : '', '#D10B2C' );
        $previous_icon  = isset( $settings['previous_icon']['url'] ) ? $settings['previous_icon']['url'] : '';
        $next_icon      = isset( $settings['next_icon']['url'] ) ? $settings['next_icon']['url'] : '';
        if ( 0 === $count ) {
            return;
        }
        ?>
        <section class="figmapress-carousel" aria-label="<?php esc_attr_e( 'スライドショー', 'figmapress-connector' ); ?>" data-per-view="<?php echo esc_attr( $per_view ); ?>" data-mobile-per-view="<?php echo esc_attr( $mobile_view ); ?>" data-loop="<?php echo 'yes' === ( isset( $settings['loop'] ) ? $settings['loop'] : '' ) ? 'true' : 'false'; ?>" data-autoplay="<?php echo 'yes' === ( isset( $settings['autoplay'] ) ? $settings['autoplay'] : '' ) ? 'true' : 'false'; ?>" style="--figmapress-accent:<?php echo esc_attr( $accent ); ?>" tabindex="0">
            <div class="figmapress-carousel__viewport">
                <div class="figmapress-carousel__track">
                    <?php foreach ( $items as $index => $item ) :
                        $title    = isset( $item['title'] ) && '' !== $item['title'] ? $item['title'] : sprintf( esc_html__( 'スライド %d', 'figmapress-connector' ), $index + 1 );
                        $image    = isset( $item['image']['url'] ) ? $item['image']['url'] : '';
                        $url      = isset( $item['url']['url'] ) ? $item['url']['url'] : '';
                        $external = ! empty( $item['url']['is_external'] );
                        ?>
                        <article class="figmapress-carousel__slide" role="group" aria-roledescription="<?php esc_attr_e( 'スライド', 'figmapress-connector' ); ?>" aria-label="<?php echo esc_attr( sprintf( '%d / %d', $index + 1, $count ) ); ?>">
                            <?php if ( '' !== $url ) : ?><a class="figmapress-carousel__item-link" href="<?php echo esc_url( $url ); ?>"<?php echo $external ? ' target="_blank" rel="noopener noreferrer"' : ''; ?>><?php endif; ?>
                            <?php if ( $image ) : ?><img src="<?php echo esc_url( $image ); ?>" alt="<?php echo esc_attr( $title ); ?>" loading="lazy"><?php endif; ?>
                            <?php if ( $title ) : ?><h3><?php echo esc_html( $title ); ?></h3><?php endif; ?>
                            <?php if ( '' !== $url ) : ?></a><?php endif; ?>
                        </article>
                    <?php endforeach; ?>
                </div>
            </div>
            <button class="figmapress-carousel__button figmapress-carousel__button--previous" type="button" aria-label="<?php esc_attr_e( '前のスライド', 'figmapress-connector' ); ?>"><?php if ( $previous_icon ) : ?><img src="<?php echo esc_url( $previous_icon ); ?>" alt=""><?php else : ?><span aria-hidden="true">‹</span><?php endif; ?></button>
            <button class="figmapress-carousel__button figmapress-carousel__button--next" type="button" aria-label="<?php esc_attr_e( '次のスライド', 'figmapress-connector' ); ?>"><?php if ( $next_icon ) : ?><img src="<?php echo esc_url( $next_icon ); ?>" alt=""><?php else : ?><span aria-hidden="true">›</span><?php endif; ?></button>
            <?php if ( 'yes' === ( isset( $settings['show_dots'] ) ? $settings['show_dots'] : 'yes' ) ) : ?>
                <div class="figmapress-carousel__dots" role="group" aria-label="<?php esc_attr_e( 'スライドを選択', 'figmapress-connector' ); ?>"></div>
            <?php endif; ?>
            <p class="screen-reader-text figmapress-carousel__status" aria-live="polite" aria-atomic="true"></p>
        </section>
        <?php
    }
}

final class FigmaPress_Contact_Form_Widget extends FigmaPress_Widget_Base {
    public function get_name() {
        return 'figmapress-contact-form';
    }

    public function get_title() {
        return esc_html__( 'FigmaPress 問い合わせフォーム', 'figmapress-connector' );
    }

    public function get_icon() {
        return 'eicon-form-horizontal';
    }

    protected function register_controls() {
        $this->start_controls_section(
            'content',
            array( 'label' => esc_html__( 'フォーム', 'figmapress-connector' ) )
        );
        $controls = array(
            'title'           => array( '見出し', 'お問い合わせ' ),
            'name_label'      => array( '名前ラベル', 'お名前' ),
            'email_label'     => array( 'メールラベル', 'メールアドレス' ),
            'region_label'    => array( '地域ラベル', 'お住まいの地域' ),
            'message_label'   => array( '本文ラベル', 'ご相談・ご意見の内容' ),
            'reply_label'     => array( '返信希望ラベル', '返信希望' ),
            'reply_yes_label' => array( '返信希望する', '希望する' ),
            'reply_no_label'  => array( '返信希望しない', '希望しない' ),
            'button_text'     => array( '送信ボタン', '送信する' ),
            'success_message' => array( '送信完了文', '送信しました。お問い合わせありがとうございます。' ),
        );
        foreach ( $controls as $key => $control ) {
            $this->add_control(
                $key,
                array(
                    'label'   => esc_html__( $control[0], 'figmapress-connector' ),
                    'type'    => \Elementor\Controls_Manager::TEXT,
                    'default' => esc_html__( $control[1], 'figmapress-connector' ),
                )
            );
        }
        $this->add_control(
            'recipient',
            array(
                'label'       => esc_html__( '送信先メール', 'figmapress-connector' ),
                'description' => esc_html__( '空欄の場合はWordPress管理者メールへ送信します。', 'figmapress-connector' ),
                'type'        => \Elementor\Controls_Manager::TEXT,
                'input_type'  => 'email',
            )
        );
        $this->add_control(
            'design_geometry',
            array(
                'type'    => \Elementor\Controls_Manager::HIDDEN,
                'default' => '',
            )
        );
        $this->end_controls_section();

        $this->start_controls_section(
            'colors',
            array(
                'label' => esc_html__( '色', 'figmapress-connector' ),
                'tab'   => \Elementor\Controls_Manager::TAB_STYLE,
            )
        );
        foreach ( array(
            'panel_color'  => array( 'パネル色', '#FFE2E8' ),
            'accent_color' => array( 'ボタン色', '#B90A23' ),
            'text_color'   => array( '文字色', '#202020' ),
        ) as $key => $control ) {
            $this->add_control(
                $key,
                array(
                    'label'   => esc_html__( $control[0], 'figmapress-connector' ),
                    'type'    => \Elementor\Controls_Manager::COLOR,
                    'default' => $control[1],
                )
            );
        }
        $this->end_controls_section();
    }

    protected function render() {
        $settings    = $this->get_settings_for_display();
        $page_id     = get_queried_object_id() ? get_queried_object_id() : get_the_ID();
        $rendered_at = time();
        $token       = hash_hmac( 'sha256', $page_id . '|' . $this->get_id() . '|' . $rendered_at, wp_salt( 'auth' ) );
        $panel       = figmapress_connector_css_color( isset( $settings['panel_color'] ) ? $settings['panel_color'] : '', '#FFE2E8' );
        $accent      = figmapress_connector_css_color( isset( $settings['accent_color'] ) ? $settings['accent_color'] : '', '#B90A23' );
        $text        = figmapress_connector_css_color( isset( $settings['text_color'] ) ? $settings['text_color'] : '', '#202020' );
        $field       = function ( $key, $fallback ) use ( $settings ) {
            return isset( $settings[ $key ] ) && '' !== $settings[ $key ] ? $settings[ $key ] : $fallback;
        };
        $geometry    = figmapress_connector_design_geometry( $settings );
        $fidelity    = is_array( $geometry );
        $root_style  = '--figmapress-panel:' . $panel . ';--figmapress-accent:' . $accent . ';--figmapress-text:' . $text . ';' . figmapress_connector_aspect_style( $geometry );
        $field_box   = function ( $name, $part ) use ( $geometry ) {
            return is_array( $geometry ) && isset( $geometry['fields'][ $name ][ $part ] )
                ? $geometry['fields'][ $name ][ $part ]
                : null;
        };
        ?>
        <section class="figmapress-contact<?php echo $fidelity ? ' figmapress-contact--fidelity' : ''; ?>" style="<?php echo esc_attr( $root_style ); ?>">
            <?php if ( $fidelity && ! empty( $geometry['panel'] ) ) : ?><span class="figmapress-contact__panel" aria-hidden="true" style="<?php echo esc_attr( figmapress_connector_geometry_style( $geometry['panel'] ) ); ?>"></span><?php endif; ?>
            <h2<?php echo $fidelity && ! empty( $geometry['title'] ) ? ' style="' . esc_attr( figmapress_connector_geometry_style( $geometry['title'], true ) ) . '"' : ''; ?>><?php echo esc_html( $field( 'title', 'お問い合わせ' ) ); ?></h2>
            <form class="figmapress-contact__form" data-endpoint="<?php echo esc_url( rest_url( 'figmapress/v1/contact' ) ); ?>" novalidate>
                <input type="hidden" name="page_id" value="<?php echo esc_attr( $page_id ); ?>">
                <input type="hidden" name="widget_id" value="<?php echo esc_attr( $this->get_id() ); ?>">
                <input type="hidden" name="rendered_at" value="<?php echo esc_attr( $rendered_at ); ?>">
                <input type="hidden" name="form_token" value="<?php echo esc_attr( $token ); ?>">
                <label class="figmapress-contact__honeypot" aria-hidden="true">Website<input type="text" name="website" tabindex="-1" autocomplete="off"></label>
                <label class="figmapress-contact__field figmapress-contact__field--name"><span<?php echo $fidelity ? ' style="' . esc_attr( figmapress_connector_geometry_style( $field_box( 'name', 'label' ), true ) ) . '"' : ''; ?>><?php echo esc_html( $field( 'name_label', 'お名前' ) ); ?></span><input name="name" type="text" maxlength="120" autocomplete="name" required<?php echo $fidelity ? ' style="' . esc_attr( figmapress_connector_geometry_style( $field_box( 'name', 'control' ) ) ) . '"' : ''; ?>></label>
                <label class="figmapress-contact__field figmapress-contact__field--email"><span<?php echo $fidelity ? ' style="' . esc_attr( figmapress_connector_geometry_style( $field_box( 'email', 'label' ), true ) ) . '"' : ''; ?>><?php echo esc_html( $field( 'email_label', 'メールアドレス' ) ); ?></span><input name="email" type="email" maxlength="254" autocomplete="email" required<?php echo $fidelity ? ' style="' . esc_attr( figmapress_connector_geometry_style( $field_box( 'email', 'control' ) ) ) . '"' : ''; ?>></label>
                <label class="figmapress-contact__field figmapress-contact__field--region"><span<?php echo $fidelity ? ' style="' . esc_attr( figmapress_connector_geometry_style( $field_box( 'region', 'label' ), true ) ) . '"' : ''; ?>><?php echo esc_html( $field( 'region_label', 'お住まいの地域' ) ); ?></span><input name="region" type="text" maxlength="160" autocomplete="address-level1"<?php echo $fidelity ? ' style="' . esc_attr( figmapress_connector_geometry_style( $field_box( 'region', 'control' ) ) ) . '"' : ''; ?>></label>
                <label class="figmapress-contact__field figmapress-contact__field--message"><span<?php echo $fidelity ? ' style="' . esc_attr( figmapress_connector_geometry_style( $field_box( 'message', 'label' ), true ) ) . '"' : ''; ?>><?php echo esc_html( $field( 'message_label', 'ご相談・ご意見の内容' ) ); ?></span><textarea name="message" maxlength="5000" rows="6" required<?php echo $fidelity ? ' style="' . esc_attr( figmapress_connector_geometry_style( $field_box( 'message', 'control' ) ) ) . '"' : ''; ?>></textarea></label>
                <fieldset><legend<?php echo $fidelity && ! empty( $geometry['reply']['label'] ) ? ' style="' . esc_attr( figmapress_connector_geometry_style( $geometry['reply']['label'], true ) ) . '"' : ''; ?>><?php echo esc_html( $field( 'reply_label', '返信希望' ) ); ?></legend><label class="figmapress-contact__reply figmapress-contact__reply--yes"<?php echo $fidelity && ! empty( $geometry['reply']['yes'] ) ? ' style="' . esc_attr( figmapress_connector_geometry_style( $geometry['reply']['yes'], true ) ) . '"' : ''; ?>><input name="reply_preference" type="radio" value="yes" checked><span><?php echo esc_html( $field( 'reply_yes_label', '希望する' ) ); ?></span></label><label class="figmapress-contact__reply figmapress-contact__reply--no"<?php echo $fidelity && ! empty( $geometry['reply']['no'] ) ? ' style="' . esc_attr( figmapress_connector_geometry_style( $geometry['reply']['no'], true ) ) . '"' : ''; ?>><input name="reply_preference" type="radio" value="no"><span><?php echo esc_html( $field( 'reply_no_label', '希望しない' ) ); ?></span></label></fieldset>
                <button type="submit"<?php echo $fidelity && ! empty( $geometry['button']['box'] ) ? ' style="' . esc_attr( figmapress_connector_geometry_style( $geometry['button']['box'], true ) ) . '"' : ''; ?>><?php echo esc_html( $field( 'button_text', '送信する' ) ); ?></button>
                <p class="figmapress-contact__status" data-success="<?php echo esc_attr( $field( 'success_message', '送信しました。お問い合わせありがとうございます。' ) ); ?>" aria-live="polite"></p>
            </form>
        </section>
        <?php
    }
}

final class FigmaPress_Accordion_Widget extends FigmaPress_Widget_Base {
    public function get_name() {
        return 'figmapress-accordion';
    }

    public function get_title() {
        return esc_html__( 'FigmaPress アコーディオン', 'figmapress-connector' );
    }

    public function get_icon() {
        return 'eicon-accordion';
    }

    protected function register_controls() {
        $this->start_controls_section(
            'content',
            array( 'label' => esc_html__( 'アコーディオン', 'figmapress-connector' ) )
        );
        $repeater = new \Elementor\Repeater();
        $repeater->add_control(
            'title',
            array(
                'label'   => esc_html__( '見出し', 'figmapress-connector' ),
                'type'    => \Elementor\Controls_Manager::TEXT,
                'default' => esc_html__( '項目', 'figmapress-connector' ),
            )
        );
        $repeater->add_control(
            'content',
            array(
                'label' => esc_html__( '内容', 'figmapress-connector' ),
                'type'  => \Elementor\Controls_Manager::WYSIWYG,
            )
        );
        $this->add_control(
            'items',
            array(
                'label'       => esc_html__( '項目', 'figmapress-connector' ),
                'type'        => \Elementor\Controls_Manager::REPEATER,
                'fields'      => $repeater->get_controls(),
                'title_field' => '{{{ title }}}',
            )
        );
        $this->add_control(
            'open_first',
            array(
                'label'        => esc_html__( '最初の項目を開く', 'figmapress-connector' ),
                'type'         => \Elementor\Controls_Manager::SWITCHER,
                'return_value' => 'yes',
                'default'      => 'yes',
            )
        );
        $this->add_control(
            'allow_multiple',
            array(
                'label'        => esc_html__( '複数項目を同時に開く', 'figmapress-connector' ),
                'type'         => \Elementor\Controls_Manager::SWITCHER,
                'return_value' => 'yes',
            )
        );
        $this->add_control(
            'design_geometry',
            array(
                'type'    => \Elementor\Controls_Manager::HIDDEN,
                'default' => '',
            )
        );
        $this->end_controls_section();

        $this->start_controls_section(
            'colors',
            array(
                'label' => esc_html__( '色', 'figmapress-connector' ),
                'tab'   => \Elementor\Controls_Manager::TAB_STYLE,
            )
        );
        foreach ( array(
            'background_color' => array( '背景色', '#FFFFFF' ),
            'accent_color'     => array( 'アクセント色', '#D50327' ),
            'text_color'       => array( '文字色', '#202020' ),
        ) as $key => $control ) {
            $this->add_control(
                $key,
                array(
                    'label'   => esc_html__( $control[0], 'figmapress-connector' ),
                    'type'    => \Elementor\Controls_Manager::COLOR,
                    'default' => $control[1],
                )
            );
        }
        $this->end_controls_section();
    }

    protected function render() {
        $settings   = $this->get_settings_for_display();
        $items      = isset( $settings['items'] ) && is_array( $settings['items'] ) ? $settings['items'] : array();
        $background = figmapress_connector_css_color( isset( $settings['background_color'] ) ? $settings['background_color'] : '', '#FFFFFF' );
        $accent     = figmapress_connector_css_color( isset( $settings['accent_color'] ) ? $settings['accent_color'] : '', '#D50327' );
        $text       = figmapress_connector_css_color( isset( $settings['text_color'] ) ? $settings['text_color'] : '', '#202020' );
        $geometry   = figmapress_connector_design_geometry( $settings );
        $fidelity   = is_array( $geometry );
        $root_width = $fidelity && isset( $geometry['root']['width'] ) ? (float) $geometry['root']['width'] : 0;
        $root_height = $fidelity && isset( $geometry['root']['height'] ) ? (float) $geometry['root']['height'] : 0;
        $accordion_style = '--figmapress-panel:' . $background . ';--figmapress-accent:' . $accent . ';--figmapress-text:' . $text . ';' . figmapress_connector_aspect_style( $geometry );
        if ( $root_width > 0 && $root_height > 0 && ! empty( $geometry['items'][0]['title'] ) ) {
            $first_title = $geometry['items'][0]['title'];
            $accordion_style .= '--figmapress-accordion-title-x:' . (float) $first_title['x'] . '%;';
            $accordion_style .= '--figmapress-accordion-title-size:' . ( (float) $first_title['height'] * $root_height / $root_width / 1.2 ) . 'cqw;';
            if ( ! empty( $geometry['items'][1]['title'] ) ) {
                $first_step = ( (float) $geometry['items'][1]['title']['y'] - (float) $first_title['y'] ) * $root_height / $root_width;
                $accordion_style .= '--figmapress-accordion-first-height:' . $first_step . 'cqw;';
            }
            if ( ! empty( $geometry['items'][2]['title'] ) && ! empty( $geometry['items'][1]['title'] ) ) {
                $row_step = ( (float) $geometry['items'][2]['title']['y'] - (float) $geometry['items'][1]['title']['y'] ) * $root_height / $root_width;
                $accordion_style .= '--figmapress-accordion-row-height:' . $row_step . 'cqw;';
            }
        }
        $open_first = 'yes' === ( isset( $settings['open_first'] ) ? $settings['open_first'] : 'yes' );
        $first_open_index = -1;
        if ( $open_first ) {
            foreach ( $items as $candidate_index => $candidate_item ) {
                $candidate_content = isset( $candidate_item['content'] ) ? trim( wp_strip_all_tags( (string) $candidate_item['content'] ) ) : '';
                if ( '' !== $candidate_content ) {
                    $first_open_index = $candidate_index;
                    break;
                }
            }
        }
        ?>
        <div class="figmapress-accordion<?php echo $fidelity ? ' figmapress-accordion--fidelity' : ''; ?>" data-multiple="<?php echo 'yes' === ( isset( $settings['allow_multiple'] ) ? $settings['allow_multiple'] : '' ) ? 'true' : 'false'; ?>" style="<?php echo esc_attr( $accordion_style ); ?>">
            <?php foreach ( $items as $index => $item ) : ?>
                <?php
                $item_geometry = $fidelity && isset( $geometry['items'][ $index ] ) ? $geometry['items'][ $index ] : null;
                $summary_box   = is_array( $item_geometry ) && isset( $item_geometry['title'] ) && is_array( $item_geometry['title'] ) ? $item_geometry['title'] : null;
                $item_content  = isset( $item['content'] ) ? (string) $item['content'] : '';
                $has_content   = '' !== trim( wp_strip_all_tags( $item_content ) );
                if ( is_array( $summary_box ) ) {
                    unset( $summary_box['width'] );
                }
                ?>
                <details data-has-content="<?php echo $has_content ? 'true' : 'false'; ?>"<?php echo $index === $first_open_index ? ' open' : ''; ?>>
                    <summary<?php echo ! $has_content ? ' aria-disabled="true" tabindex="-1"' : ''; ?><?php echo $summary_box ? ' style="' . esc_attr( figmapress_connector_geometry_style( $summary_box, true ) ) . '"' : ''; ?>><span><?php echo esc_html( isset( $item['title'] ) ? $item['title'] : '' ); ?></span><span class="figmapress-accordion__icon" aria-hidden="true"></span></summary>
                    <div class="figmapress-accordion__content"<?php echo $item_geometry && ! empty( $item_geometry['content'] ) ? ' style="' . esc_attr( figmapress_connector_geometry_style( $item_geometry['content'] ) ) . '"' : ''; ?>><?php echo wp_kses_post( wpautop( $item_content ) ); ?></div>
                </details>
            <?php endforeach; ?>
        </div>
        <?php
    }
}
