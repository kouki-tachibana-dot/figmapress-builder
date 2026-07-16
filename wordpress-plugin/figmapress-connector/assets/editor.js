( function ( wp ) {
    'use strict';

    if ( ! wp || ! wp.blocks || ! wp.element || ! wp.serverSideRender ) {
        return;
    }

    const el = wp.element.createElement;
    const Fragment = wp.element.Fragment;
    const useState = wp.element.useState;
    const registerBlockType = wp.blocks.registerBlockType;
    const getBlockType = wp.blocks.getBlockType;
    const InspectorControls = wp.blockEditor.InspectorControls;
    const useBlockProps = wp.blockEditor.useBlockProps;
    const PanelBody = wp.components.PanelBody;
    const TextControl = wp.components.TextControl;
    const TextareaControl = wp.components.TextareaControl;
    const SelectControl = wp.components.SelectControl;
    const Notice = wp.components.Notice;
    const ServerSideRender = wp.serverSideRender.default || wp.serverSideRender;

    const stringAttribute = { type: 'string', default: '' };
    const arrayAttribute = { type: 'array', default: [] };

    const blocks = [
        {
            name: 'figmapress/hero',
            title: 'FigmaPress Hero',
            icon: 'format-image',
            attributes: {
                headline: stringAttribute,
                subtext: stringAttribute,
                primaryButtonText: stringAttribute,
                primaryButtonUrl: stringAttribute,
                imageUrl: stringAttribute,
                imageId: { type: 'number', default: 0 },
                layoutVariant: { type: 'string', default: 'stacked' },
            },
            fields: [
                { key: 'headline', label: '見出し' },
                { key: 'subtext', label: '本文', type: 'textarea' },
                { key: 'primaryButtonText', label: 'ボタン文言' },
                { key: 'primaryButtonUrl', label: 'ボタンURL' },
                { key: 'imageUrl', label: '画像URL' },
                { key: 'layoutVariant', label: 'レイアウト', type: 'layout' },
            ],
        },
        {
            name: 'figmapress/service-list',
            title: 'FigmaPress Service List',
            icon: 'list-view',
            attributes: { headline: stringAttribute, items: arrayAttribute },
            fields: [
                { key: 'headline', label: '見出し' },
                { key: 'items', label: 'サービス項目（JSON）', type: 'json' },
            ],
        },
        {
            name: 'figmapress/card-grid',
            title: 'FigmaPress Card Grid',
            icon: 'grid-view',
            attributes: { headline: stringAttribute, items: arrayAttribute },
            fields: [
                { key: 'headline', label: '見出し' },
                { key: 'items', label: 'カード項目（JSON）', type: 'json' },
            ],
        },
        {
            name: 'figmapress/faq',
            title: 'FigmaPress FAQ',
            icon: 'editor-help',
            attributes: { headline: stringAttribute, items: arrayAttribute },
            fields: [
                { key: 'headline', label: '見出し' },
                { key: 'items', label: 'FAQ項目（JSON）', type: 'json' },
            ],
        },
        {
            name: 'figmapress/cta',
            title: 'FigmaPress CTA',
            icon: 'megaphone',
            attributes: {
                headline: stringAttribute,
                buttonText: stringAttribute,
                buttonUrl: stringAttribute,
            },
            fields: [
                { key: 'headline', label: '見出し' },
                { key: 'buttonText', label: 'ボタン文言' },
                { key: 'buttonUrl', label: 'ボタンURL' },
            ],
        },
        {
            name: 'figmapress/contact',
            title: 'FigmaPress Contact',
            icon: 'email',
            attributes: {
                headline: stringAttribute,
                text: stringAttribute,
                buttonText: stringAttribute,
                buttonUrl: stringAttribute,
            },
            fields: [
                { key: 'headline', label: '見出し' },
                { key: 'text', label: '本文', type: 'textarea' },
                { key: 'buttonText', label: 'ボタン文言' },
                { key: 'buttonUrl', label: 'ボタンURL' },
            ],
        },
    ];

    function makeEdit( config ) {
        return function Edit( props ) {
            const blockProps = useBlockProps();
            const initialJson = JSON.stringify( props.attributes.items || [], null, 2 );
            const jsonState = useState( initialJson );
            const jsonDraft = jsonState[ 0 ];
            const setJsonDraft = jsonState[ 1 ];
            const errorState = useState( '' );
            const jsonError = errorState[ 0 ];
            const setJsonError = errorState[ 1 ];

            const controls = config.fields.map( function ( field ) {
                if ( field.type === 'json' ) {
                    return el( TextareaControl, {
                        key: field.key,
                        label: field.label,
                        value: jsonDraft,
                        rows: 10,
                        onChange: function ( value ) {
                            setJsonDraft( value );
                            try {
                                const parsed = JSON.parse( value );
                                if ( ! Array.isArray( parsed ) ) {
                                    throw new Error( 'array required' );
                                }
                                props.setAttributes( { [ field.key ]: parsed } );
                                setJsonError( '' );
                            } catch ( error ) {
                                setJsonError( 'JSON配列の形式を確認してください。' );
                            }
                        },
                    } );
                }
                if ( field.type === 'layout' ) {
                    return el( SelectControl, {
                        key: field.key,
                        label: field.label,
                        value: props.attributes[ field.key ] || 'stacked',
                        options: [
                            { label: '縦積み', value: 'stacked' },
                            { label: 'テキスト左・画像右', value: 'text-left-image-right' },
                        ],
                        onChange: function ( value ) {
                            props.setAttributes( { [ field.key ]: value } );
                        },
                    } );
                }

                const Control = field.type === 'textarea' ? TextareaControl : TextControl;
                return el( Control, {
                    key: field.key,
                    label: field.label,
                    value: props.attributes[ field.key ] || '',
                    onChange: function ( value ) {
                        props.setAttributes( { [ field.key ]: value } );
                    },
                } );
            } );

            if ( jsonError ) {
                controls.push(
                    el( Notice, { key: 'json-error', status: 'error', isDismissible: false }, jsonError )
                );
            }

            return el(
                Fragment,
                null,
                el(
                    InspectorControls,
                    null,
                    el( PanelBody, { title: 'FigmaPress設定', initialOpen: true }, controls )
                ),
                el(
                    'div',
                    blockProps,
                    el( ServerSideRender, {
                        block: config.name,
                        attributes: props.attributes,
                    } )
                )
            );
        };
    }

    blocks.forEach( function ( config ) {
        if ( getBlockType( config.name ) ) {
            return;
        }
        registerBlockType( config.name, {
            apiVersion: 3,
            title: config.title,
            category: 'design',
            icon: config.icon,
            attributes: config.attributes,
            edit: makeEdit( config ),
            save: function () {
                return null;
            },
        } );
    } );
} )( window.wp );
