=== FigmaPress Connector ===
Contributors: figmapress
Tags: blocks, figma, gutenberg, elementor
Requires at least: 6.4
Requires PHP: 7.4
Stable tag: 0.19.6
License: GPLv2 or later

Connects FigmaPress output to editable Gutenberg blocks and Elementor pages.

== Installation ==
1. Upload the figmapress-connector folder to /wp-content/plugins/.
2. Activate the plugin via Plugins > Installed Plugins.
3. Open the FigmaPress web app or run `npm run wp:create-draft` locally to
   create a draft page containing figmapress/* blocks.

== Changelog ==

= 0.19.6 =
* カナ項目のID・name・プレースホルダーを連結しても境界を正しく判定し、通常名オートコンプリートを確実に解除します。

= 0.19.5 =
* Elementor Proの後勝ちCSSでもラジオ・チェック選択肢のタップ領域を44px以上に保ちます。
* 会社名カナ・氏名カナへ誤った通常名オートコンプリートを付けず、日本語入力を妨げないようにします。

= 0.19.4 =
* クエリ文字列を削除する共有サーバーでも更新が確実に届くよう、スマホ操作補完を版固有ファイル名で配信します。
* Elementor Proの初期化前後を再検出し、スマホメニューの44px操作領域、日本語開閉名、ARIA連携を確実に反映します。
* フォーム項目をID、name、ラベル、プレースホルダーから判定し、自動入力、入力モード、必須状態を補完します。

= 0.19.3 =
* Elementor下書きのCSS URLを保存内容の版で更新し、再構築後も古い配置がブラウザに残る問題を解消しました。
* スマホメニューへ44px操作領域、開閉状態の日本語読み上げ、Escape復帰、現在ページ通知を追加しました。
* Elementor Proフォームへ自動入力属性、必須状態、入力モード、送信結果の読み上げ、スマホ44px操作領域を追加しました。
* Figmaのページタイトルと主要セクション名を編集可能なHTML見出しとして出力します。

= 0.19.2 =
* Figmaの文字シャドウをElementorでも文字シャドウとして保存し、文字領域の外側に四角い影が出る問題を解消しました。
* 文字は編集可能なElementorテキストのまま、Figmaと同じ影の位置・ぼかし・色を保持します。

= 0.19.1 =
* 共有サーバー向け大容量分割保存でも、登録済みのAccordion、Form、Nav Menu、Image Carouselを安全に許可します。
* 未登録のElementor Proウィジェットは分割保存でも拒否し、壊れた空ページを防ぎます。

= 0.19.0 =
* Elementor Proの実ウィジェット登録状況を接続診断で返します。
* Accordion、Form、Nav Menu、Image Carouselのネイティブ保存を安全に許可します。
* Pro画像カルーセルの画像もWordPressメディアライブラリへ永続化します。

= 0.18.2 =
* Figmaに独立CTAがない高忠実度ヘッダーで、CTAが全面を覆ってロゴとメニューを隠す問題を解消しました。
* 背景レイヤーがないヘッダーをヒーロー上へ透明に重ね、PC/SPのFigma配置を保持します。
* 一般名のスマホメニュー画像も右上の位置情報から復元します。

= 0.18.1 =
* 単一ページの大容量分割保存でも、事前準備なしで安全なElementor下書きを作成できるようにしました。
* 同じFigma変換元の公開済みページは変更せず、編集可能な下書きだけを更新します。
* 公開済みページしかない場合は新しい下書きを作成し、HTTP 409で停止する問題を解消しました。

= 0.18.0 =
* 公開画面とElementor編集画面を同じネイティブのコンテナ・文字・画像・機能ウィジェットから描画します。
* Figma全画面画像と透明操作レイヤーを使う旧形式を保存前に拒否し、見えている文字が実テキストであることを保証します。
* Figma画像は視覚QAの比較資料にだけ使用し、Elementor本文には保存しません。

= 0.17.30 =
* Figmaでグループ化されていない企業向け問い合わせ欄も、PC/SP双方で送信可能なフォームへ合成します。
* 企業名、読み方、担当者、住所、電話、メール、流入元、質問、個人情報同意などFigma上の全入力項目を保持します。
* 動的入力項目は保存済みWidget定義だけを許可し、必須、形式、文字数、選択肢をサーバー側でも再検証します。

= 0.17.29 =
* Added pixel-locked Figma presentation layers while preserving native Elementor editing and functional overlays.
* Added responsive public/editor switching for exact desktop and mobile artwork.
= 0.17.28 =
* Figma内で検出した任意のページ名を最大20ページまで下書きと未割り当てメニューへ安全に構築できるようにしました。
* 建工101のような企業サイト向けに、会社案内・事業内容・施工事例・お問い合わせ等のページキーを受け付けます。

= 0.17.27 =
* スマートフォンの展開メニューを後続コンテンツより前面に固定し、全ページでリンクを操作できるようにしました。
* FigmaPressが作成したElementor下書きの通常編集をElementorへ安全に案内し、大容量ページでのブロックエディタ起動時メモリ超過を防ぎます。

= 0.17.26 =
* 大容量Elementorページの分割保存後も画像完了と誤判定せず、再開可能なメディア保存を必ず開始します。
* 保存応答が途切れて確認経路へ切り替わった場合も、期限付きFigma画像URLをWordPressメディアへ引き継ぎます。

= 0.17.25 =
* WordPress内の安全接続が初回完了後も準備完了通知を継続し、同じFigmaPressタブから複数ページ構築を安全に再実行できます。
* 再実行時も同じ下書きIDと未割り当てメニューを再利用します。

= 0.17.24 =
* 日本語を含むElementor JSONをUTF-8文字の途中で分割せず、共有サーバーのMySQLへ各分割片を安全に追記します。
* WordPress内の安全接続と通常の分割接続で同じ文字境界処理を使用します。

= 0.17.23 =
* 管理者によるFigmaPressの分割送信はページ容量にかかわらず検証済み低メモリ保存を使用し、共有サーバー上のElementor・save_post処理による停止を防ぎます。
* JSON構造、許可Widget、下書き所有権、変換元を検証してから、同じ下書きへ直接保存します。

= 0.17.22 =
* 小容量Elementorページの更新でも、タイトルが同じ既存下書きは不要な投稿更新を省略し、共有サーバー上の保存フック停止を防ぎます。
* Elementor本文がまだ空の準備済み下書きでは空リビジョンを作らず、本文保存を最優先します。

= 0.17.21 =
* WordPress内の安全接続でもElementor分割送信を先頭から自動再開し、共有サーバーが途中の応答を閉じても同じ下書きへ安全に再送します。
* 最終保存は長く待機し、応答が切れた場合も保存証明を時間差で再確認してから失敗を確定します。

= 0.17.20 =
* 複数ページの再構築時、タイトルが変わっていない既存下書きは不要な投稿更新を省略し、Elementorなどの保存処理を再発火させません。
* 同じFigma変換元は同じ下書きIDと未割り当てメニューへ安全に再接続し、タイトル変更がある場合だけ更新します。

= 0.17.19 =
* XServerなどの共有サーバーでは、大容量Elementor JSONをPHPで結合・再展開せず、分割データをDBへ順次追記してDB内で同じ下書きへ置き換えます。
* 保存先は準備済みの同一下書きに限定し、JSON構造・変換元・要求ID・危険な埋め込みを検証してから完了印を記録します。

= 0.17.18 =
* 保存確認の完了印をWordPressメタキャッシュではなくDBから直接取得し、本文と同じ永続状態で照合します。
* 失敗時は要求・変換元・容量・SHA-256の一致可否だけを返し、識別子や本文は応答へ露出しません。

= 0.17.17 =
* 大容量Elementor本文のDB更新処理中に共有サーバーが応答を終了する環境でも、書き込み前に今回の期待容量・SHA-256を記録し、実データとの完全一致後だけ処理を継続します。
* 不完全な本文・前回本文・別要求は従来どおり成功扱いせず、下書き限定と重複防止を維持します。

= 0.17.16 =
* 共有サーバーがElementor保存後の応答をHTTP 500やタイムアウトで失った場合、同じ要求・同じ下書き・同じFigma変換元・保存容量・SHA-256を軽量照合して処理を安全に継続します。
* 完了印は各保存の直前に消去してから書き直すため、古い下書きを今回の保存成功と誤判定しません。

= 0.17.15 =
* 分割受信した大容量Elementor JSONを保存処理前に二重展開せず、保存成功後の応答直前に共有サーバーがメモリ超過する問題を修正しました。
* 下書き限定・同一sourceKey更新・未割り当てメニューの保護はそのまま維持します。

= 0.17.14 =
* 大容量Elementor下書きの更新時に旧文書のリビジョン複製を省略し、共有サーバーのPHPメモリ超過を防ぎます。
* 大容量文書は再デコードせずDB保存容量で完全保存を確認し、新規・既存の同じ下書きIDへ安全に置換します。

= 0.17.13 =
* 大容量のElementor編集データと画像保存を対象WordPress内の安全接続で処理し、共有サーバーの外部通信待ちを回避しました。
* 安全接続はFigmaPress本番オリジン・Connectorトークン・下書きIDに限定し、ページ公開やメニュー割り当ては行いません。

= 0.17.12 =
* 未作成ページの権限確認に存在しない投稿IDを渡さず、WordPress 7系で複数ページ準備が停止する問題を修正しました。
* 既存ページは従来どおり下書き状態と編集権限を確認し、公開済みページを自動更新しません。

= 0.17.11 =
* 複数ページ準備時に既存の大容量Elementorデータを展開せず、共有サーバーのメモリ上限内で同じ下書きを更新できるようにしました。
* WordPress前面の安全接続からもメニュー関数を確実に読み込み、6ページ後の未割り当てメニュー作成を安定化しました。

= 0.17.10 =
* WordPress安全接続をFigmaPress内の限定iframeで待機させ、自動ポップアップを禁止するブラウザでも複数下書きを構築できるようにしました。
* 埋め込み元はFigmaPress本番オリジンだけに固定し、Connectorトークン、下書き限定、未割り当てメニューの保護を維持します。

= 0.17.9 =
* Vercel送信元やクロスオリジン書き込みを拒否するサイト向けに、対象WordPress内で同一オリジン送信する安全な接続ウィンドウを追加しました。
* 接続ウィンドウはFigmaPress本番オリジンと起動元を照合し、Connectorトークンを対象WordPress以外へ保存・転送しません。

= 0.17.8 =
* wp-admin配下の外部書き込みを拒否するセキュリティープラグイン向けに、認証前はゲスト状態を保つ専用REST経路を追加しました。
* 専用REST内でConnectorトークンと検証済みユーザーのページ・メニュー権限を明示確認し、下書き限定と未割り当てメニューを維持します。

= 0.17.7 =
* Cookieなしのユーザー切替を不正ログインとして遮断するセキュリティープラグイン向けに、検証済みユーザーIDへ権限確認を直接行う方式へ変更しました。
* Connectorトークン、ページ・メニュー権限、下書き限定、未割り当てメニューの保護はそのまま維持します。

= 0.17.6 =
* セキュリティープラグインが認証済みadmin-postを拒否する共有サーバーでは、WordPress標準のadmin-ajaxへ自動で再試行します。
* どちらの経路でも同じConnectorトークン、編集権限、下書き限定、未割り当てメニューの保護を維持します。

= 0.17.5 =
* 認証済みREST書き込みを遮断する共有サーバー向けに、複数ページ準備をWordPress標準のadmin-post経路でも安全に実行できるようにしました。
* フォールバック経路でも同じConnectorトークン、編集権限、下書き限定、未割り当てメニューの保護を維持します。

= 0.17.4 =
* 共有サーバーが長いConnectorトークンを含む複数ページPOSTだけ拒否する場合に、HTTPS本文の16進互換形式へ自動切り替えます。
* Connector側で元のトークンへ復元して既存のハッシュ照合を行い、権限・有効期限・失効機能を維持します。

= 0.17.3 =
* 複数ページ準備を既存のElementor書き込み系REST配下へ移し、共有サーバーが特定経路だけHTTP 403で遮断する問題を回避します。
* 旧経路も互換用に保持し、既存連携を壊さず新しい安全経路を優先します。

= 0.17.2 =
* 新規下書きにElementorデータがまだない場合も0件として安全に扱い、共有サーバーのPHP警告による応答破損を防止します。
* 複数ページ準備のエラーでHTTP番号を表示し、ホスティング側の拒否とWordPress内部エラーを区別しやすくしました。

= 0.17.1 =
* 複数ページ準備の接続トークンをHTTPS本文で送信し、XServerなど共有サーバーの認証ヘッダー遮断を回避します。
* ブラウザ直結と安全なサーバー経由の両方で同じ互換経路を利用し、下書き限定の保護を維持します。

= 0.17.0 =
* Figmaの意味セクションから複数のElementor下書きページを重複なく作成・更新できるようにしました。
* 各ページURLをヘッダー、CTA、本文リンクへ接続し、FigmaPress管理メニューを安全な未割り当て状態で作成します。
* 公開済みページは自動更新せず、既存下書きのURLと公開中サイトのメニュー割り当てを保持します。

= 0.16.26 =
* Connector専用の分割送信を事前確認不要のHTTPSフォームへ変更し、共有サーバーの遅いCORS確認による切断を防止します。
* 接続トークンはURLに含めず、FigmaPress専用REST経路の暗号化された本文だけで受け取ります。

= 0.16.25 =
* WordPressの再確認時に最新版マニフェストをキャッシュなしで取得します。
* 古い更新通知を自動消去し、表示中の版と配布版の不一致を防止します。

= 0.16.24 =
* XServerなど共有サーバー向けにElementor分割送信を小容量化し、通信切断を防止します。
* 最大4MBの編集可能データを128分割まで安全に再構成できるようにしました。

= 0.16.23 =
* 大容量Elementor文書は編集可能データを先に確定し、共有サーバーの実行時間内に下書きを返せるようにしました。
* 小規模文書ではElementor標準保存を維持し、大規模文書だけ安全な直接保存経路へ自動切り替えします。

= 0.16.22 =
* WordPressの「再確認」でConnectorの配布情報も即時更新し、新版を待たずに検出できるようにしました。
* プラグイン更新後も独自キャッシュを確実に消去し、次回更新を取りこぼさないようにしました。

= 0.16.21 =
* 大容量Elementor下書きの保存中に通信が切れても、リクエストロックを安全に解除して再送できるようにしました。
* ロックをリクエスト固有トークンで保護し、別の更新処理を誤って解除しないようにしました。

= 0.16.20 =
* Figmaにメニューアイコンがないスマホヘッダーでは、操作ボタンをCTAの左へ自動配置して重なりを解消します。
* メニューの標準チェック操作を開閉状態と同期し、外側タップ・リンク選択・Escキーで確実に閉じられるようにします。

= 0.16.19 =
* Figmaに本文が存在しないアコーディオン項目を空の展開状態にせず、デザインどおり閉じた状態で維持します。
* 本文を持つ最初の項目を初期表示し、空項目のマウス・キーボード操作を安全に無効化します。

= 0.16.18 =
* FigmaスマホヘッダーのロゴとCTAアイコンを実画像のまま表示します。
* CTAアイコンもWordPressメディアへ保存し、外部URLの期限に依存しない表示へ更新します。

= 0.16.17 =
* 大きいElementor文書を認証済みの小さいリクエストへ分割し、共有サーバーの送信サイズ制限を回避します。
* 分割データはユーザー単位・15分期限で一時保持し、全件受信後だけ既存下書きを更新します。

= 0.16.16 =
* 大きいElementor文書は編集可能データとCSSキャッシュ更新を先に確定し、共有サーバーのタイムアウトを防止します。
* Figma画像は既存の段階保存APIへ分離し、下書き作成後も中断・再開できる状態を維持します。

= 0.16.15 =
* 赤いスマホCTA上のハンバーガー線を白へ切り替え、視認性を確保しました。
* 操作位置、クリック領域、アイコン表示の3層を実ページに合わせて仕上げました。

= 0.16.14 =
* スマホのハンバーガー線をCTAより前面へ表示し、操作位置を明確にしました。
* 透明な標準チェック領域を最前面、表示アイコンをその直下に固定しました。

= 0.16.13 =
* ブラウザー標準のメニューチェック領域をFigmaのアイコン座標へ直接重ねました。
* Elementorに妨げられるラベル経由を避け、ユーザー操作を標準部品へ直接届けます。

= 0.16.12 =
* スマホメニューをブラウザー標準のチェック操作でも開閉できる構造へ変更しました。
* JavaScript最適化やElementorのイベント競合があっても、メニュー機能を維持します。

= 0.16.11 =
* Elementorより先にwindowでメニューボタン操作を捕捉し、競合するクリック処理を遮断します。
* 実ページ上でメニュー状態が直後に戻る問題への最終防御を追加しました。

= 0.16.10 =
* Elementorがクリック伝播を停止する構成でも、スマホメニューが確実に反応するキャプチャ方式へ強化しました。
* 実ページ上のクリック経路に合わせてメニュー操作の互換性を改善しました。

= 0.16.9 =
* Elementorがメニューボタンを再描画しても動作を維持する委譲イベント方式へ変更しました。
* スマホメニューの開閉、リンク選択、外側クリック、Escapeキー操作を動的なDOMでも安定化しました。

= 0.16.8 =
* Elementorが段階的に描画される環境でも、スマホメニューを確実に初期化できるようにしました。
* メニューボタンが現れる前に初期化済みになる競合を解消しました。

= 0.16.7 =
* スマホヘッダーのCTAとメニューアイコンへFigma座標を適用しました。
* アコーディオンの各見出しと本文をFigma上の位置へ直接合わせ、縦方向の累積ずれを削減しました。

= 0.16.6 =
* Figmaの実測座標と縦横比をナビ、問い合わせフォーム、アコーディオンへ引き継ぐ設計寸法モードを追加しました。
* PC・スマホで機能Widgetの高さ、入力欄、文字位置が周辺セクションとずれる問題を改善しました。

= 0.16.5 =
* 機能Widget CSSに古い比較エンジン向けの色フォールバックを追加しました。
* 実ページVisual QAがcolor-mix()で停止する互換性問題を修正しました。

= 0.16.4 =
* REST経由の実ページVisual QAでも機能Widgetの本番CSSを確実に適用します。
* フォームとアコーディオンが未装飾状態で比較される誤判定を修正しました。

= 0.16.3 =
* REST経由の実ページVisual QAでもElementor本体のコンテナCSSを確実に適用します。
* PC・スマホの高さと絶対配置が実サイトと異なる誤判定を修正しました。

= 0.16.2 =
* 実ページVisual QAではWordPress生成の比較用画像を優先し、画像数が多いページでも欠落なく測定できるようにしました。
* 同じ画像の重複埋め込みを除外し、QAレスポンスの容量とメモリ使用量を抑えました。

= 0.16.1 =
* 共有サーバーで取得に時間がかかるFigma画像向けに、段階保存の通信枠を安全な範囲で拡張しました。
* 大きい画像や配信の遅い画像が短いタイムアウトで失敗扱いになる問題を改善しました。
* スマホメニューの展開パネルを不透明化し、背後のヒーロー文字との重なりを防止しました。

= 0.16.0 =
* 画像を時間制限付きバッチで段階保存し、通信中断後も同じ下書きから再開可能にしました。
* Visual QAの補正保存時に、メディアライブラリへ保存済みの画像がFigma URLへ戻る問題を修正しました。
* Figmaファイルとノードが同じ場合は既存下書きを更新し、重複ページを作成しないようにしました。
* 画像の保存件数・残件数・失敗件数をFigmaPress画面へ返すようにしました。

= 0.15.4 =
* PC・タブレットのお問い合わせフォームをFigmaの1920px基準から比例縮小し、フッター上部への重なりを解消。

= 0.15.3 =
* Figmaの実測行数から日本語テキストの折返しを補完し、カード・スマホフッターの横はみ出しを修正。
* 320〜440px幅でお問い合わせフォームを比例縮小し、フッターとの重なりを抑制。

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
