=== FigmaPress Connector ===
Contributors: figmapress
Tags: blocks, figma, gutenberg, elementor
Requires at least: 6.4
Requires PHP: 7.4
Stable tag: 0.15.2
License: GPLv2 or later

Connects FigmaPress output to editable Gutenberg blocks and Elementor pages.

== Installation ==
1. Upload the figmapress-connector folder to /wp-content/plugins/.
2. Activate the plugin via Plugins > Installed Plugins.
3. Open the FigmaPress web app or run `npm run wp:create-draft` locally to
   create a draft page containing figmapress/* blocks.

== Changelog ==
= 0.15.2 =
* ElementorナビゲーションWidgetの高さをヘッダー内容に合わせ、ページ全体を覆うクリック領域を解消。
* メニューの下にあるフォームやアコーディオンを正常に操作できるよう修正。

= 0.15.1 =
* REST診断時にもElementor Widgetクラスを安全に読み込み、利用可能な5種類を正しく報告。
* 更新直後に機能Widgetが0/5と誤判定され、下書き作成が停止する問題を修正。

= 0.15.0 =
* WordPress管理画面の「ツール → FigmaPress接続」からワンクリック接続を追加。
* Application Passwordを繰り返し入力せず、90日・即時失効可能なConnector専用トークンで接続。
* 接続トークンをfigmapress/v1 REST経路だけに限定し、通常のWordPressログインや他のREST APIでは拒否。
* Gutenberg下書きもConnector専用経路から安全に作成可能。

= 0.14.0 =
* Figma画像の切り抜き、拡大縮小、せん断、回転を編集可能な構造化データとして保持。
* TILE画像の繰り返しと倍率、露出・コントラスト・彩度のフォールバック描画に対応。
* 正確なFigmaレンダーを優先し、取得上限時だけ元画像と変形行列へ安全に切り替え。
* 品質診断で正確レンダー、構造化変形、標準フィットを分けて確認可能。

= 0.13.0 =
* FigmaのCarousel／Sliderレイヤーを編集可能なElementorカルーセルへ変換。
* 前後ボタン、ドット、キーボード、スワイプ、動きの軽減設定に対応。
* FigmaプロトタイプのURL・セクション遷移と、CTA・電話・メールのリンクを実動化。
* PC版とスマホ版の表示枚数を独立して保持。

= 0.12.0 =
* Figmaレイヤーの透明度、複数の外側／内側シャドウ、レイヤーぼかし、背景ぼかしを再現。
* Elementor標準の編集可能なシャドウ設定も同時保存。
* 構造化された色・座標・半径だけを受け付け、任意CSSの実行を防止。
* 実ページVisual QAでもプレビューと同じ複数効果を描画。

= 0.11.0 =
* Figmaの線形・放射グラデーションを角度、中心、半径、最大8色のストップまで再現。
* Elementor標準の編集可能なグラデーション設定も同時保存。
* 構造化された色・位置・角度だけを受け付け、任意CSSの実行を防止。
* 実ページVisual QAでもプレビューと同じ複数色グラデーションを描画。

= 0.10.0 =
* Figmaで使用している書体とウェイトを対象Elementorページだけに読み込み。
* 日本語の代替字形をNoto Sans／Serif JPへ固定し、文字幅・改行・行高の環境差を低減。
* 許可済みGoogle Fontsと件数上限だけを受け付け、任意の外部CSS読込を防止。
* 実ページVisual QAでもWebフォントの読込完了後にPC／スマホを比較。

= 0.9.0 =
* 作成したElementor下書きを実際のフロントエンド描画でPC／スマホ再検証。
* 実測で改善した位置補正だけを下書きへ保存し、悪化時は自動で元へ戻す。
* FigmaノードIDを実Elementor DOMへ付与し、セクション単位の差分測定に対応。
* Visual QA更新前のWordPressリビジョンを保存。

= 0.8.0 =
* Figma Auto LayoutをElementor Flexboxの通常フローへ変換。
* 方向、間隔、余白、整列、折返し、伸縮設定を保持。
* レイヤー構造、編集可能文字、レスポンシブ、実動パーツの品質診断に対応。

= 0.7.0 =
* 同じFigmaページのPC版とスマホ版を自動検出し、端末別Elementorレイアウトとして出力。
* スマホ版の文字位置、画像トリミング、セクション順を独立して保持。
* スマホヘッダーへPC版メニュー項目を引き継ぎ、CTA付きの実動メニューとして表示。
* PC版とスマホ版でアンカーIDを分離し、非表示レイアウトへの誤スクロールを防止。

= 0.6.0 =
* Elementor下書き作成を再送しても重複ページを作らないように改善。
* キャッシュされた問い合わせフォームでも期限切れにならないように改善。
* モバイルメニューのEscキー、外側クリック、フォーカス復帰に対応。
* 問い合わせ送信のタイムアウト表示とアクセシビリティを改善。

= 0.5.0 =
* Convert Figma navigation layers into a real responsive navigation widget.
* Convert contact-form visuals into a validated WordPress mail form with anti-spam protections.
* Convert timeline and FAQ rows into accessible, editable accordion widgets.
* Add native WordPress update checks so future releases do not require FTP replacement.

= 0.4.6 =
* Detect when Elementor Containers are unavailable before creating a page.
* Let administrators enable Elementor's stable Container feature during creation without modifying existing page content.
* Show Connector warnings in the web app after a successful draft creation.

= 0.4.5 =
* Verify Elementor's actual stored element count and fall back to direct metadata when its document API reports success without preserving the generated page.
* Accept both JSON strings and decoded metadata arrays during storage verification.

= 0.4.4 =
* Save generated pages through Elementor's document API for Elementor 4.x compatibility.
* Verify the stored Elementor document before importing images and remove failed empty drafts.

= 0.4.3 =
* Save Elementor content before downloading images so interrupted imports never leave an empty page.
* Limit synchronous Media Library imports to a safe time budget and preserve remote images that cannot be localized in time.

= 0.4.2 =
* Retry Application Password authentication through a namespaced HTTPS header when a host strips standard HTTP Basic Authorization.
* Add a credential-free diagnostic endpoint that reports whether authentication headers reach WordPress.

= 0.4.1 =
* Preserve responsive Figma typography, explicit line wrapping, mixed text sizes, and rotations in Elementor pages.
* Keep the inline layout styles required by editable Figma text during REST sanitization.

= 0.4.0 =
* Adds high-fidelity Figma layout conversion for Elementor.
* Keeps text editable while localizing rendered vectors, masks, and images.
* Raises the safe image import limit for image-rich pages.
* Allows authenticated connection diagnostics to report missing edit_pages capability correctly.

= 0.3.0 =
* Adds authenticated connection diagnostics.
* Adds native Elementor document creation and Media Library image imports.
* Keeps all remote page creation draft-only.

= 0.2.0 =
* First public beta release.
* Adds six server-rendered Gutenberg blocks.
