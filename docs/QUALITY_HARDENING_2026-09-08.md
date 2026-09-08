# FigmaPress 品質強化の実装・検証記録

実施日: 2026-09-08。基準 `bfd229d`（v0.30.5）。作業ブランチ `codex/quality-hardening-20260908`。

計画コミット `04179a5`、実装・回帰試験コミット `19006d8`。作業場所は `figmapress-quality`。旧作業フォルダと直前の監査コピーは保持した。

## 現在地

### v0.31.5（独立した検証コピー一式）

2026-09-09の続行記録は [REVIEW_COPIES_2026-09-09.md](./REVIEW_COPIES_2026-09-09.md)。元ページの非破壊を保ちながら、資料待ちと実サイト検証を分離する。実WordPressの確認状況は同記録を正とする。

### v0.31.4（読み取り専用ページ対応表）

- Builder v0.31.4 / Connector v0.19.10。WordPressのページ本文・タイトル・メニューを変更せず、確定した採用ページのIDを照会する処理を追加。
- 5種の未解決状態（missing / duplicate / not_draft / forbidden / identity_mismatch）は勝手に補完しない。完全な対応表だけを既存の厳密な下書きURL検証へ渡す。
- 認証を行ってからページ単位の権限を確認する。公式の[REST endpoint権限設計](https://developer.wordpress.org/rest-api/extending-the-rest-api/adding-custom-endpoints/)に従い、サイト構築に必要なメニュー編集権限を読み取りには要求しない。
- [get_posts](https://developer.wordpress.org/reference/functions/get_posts/)は最大2 IDの取得に制限し、曖昧なページを先頭1件で選ばない。全postmetaのキャッシュを避け、巨大なElementorデータを対応表照会のために読まない。
- PHP実コールバックを実行する書き込み検出付きテスト、Basic/ペアリング/全403フォールバック、9ページ取得、権限・入力拒否を追加。ブラウザでは未確定の拒否、構成変更中の古い応答破棄、未解決表示、390px横はみ出しなし、書き込み通信0件を検証。
- 検証コピーの一式作成と実保存再読込は、この照会の合格とは別の未完了項目。

配信・回帰試験:

- 公開URL: [Builder v0.31.4](https://figmapress-builder.vercel.app/?release=0.31.4#convert)。HTTP200、ブラウザ版数0.31.4を確認。
- Target: production / Status: READY / Commit: `d328aa979ce7d5b7269775ad1f3006d9fcf77648` / Framework: Next.js 16.3.0 / Build: 18秒。
- [最終deployment](https://figmapress-builder-63sl7qjgk-chat-oikaze.vercel.app)、ID `dpl_HCUGgEdwCPFSwaYmzc8rkz4CKyjK`。候補を検査後にpromote。直前v0.31.3は `dpl_2JFFzhvVUiFmZfJxaV6SLBMDNPgk` として保持。
- 単体265件・ブラウザ19件、型・Lint・本番ビルド・PHP構文・ZIP整合性が成功。依存監査の検出0件。[GitHub CI 34236361767](https://github.com/kouki-tachibana-dot/figmapress-builder/actions/runs/34236361767)も同commitで成功。
- 公開Connector ZIPはHTTP200、検証したローカルZIPとSHA-256完全一致: `43db1e9cefb83ee96a861bc13da70ba7a354fa01dc1766e6f96a23efaa654a2f`。
- 最終deploymentの過去30分errorログは1件。意図的なHTTP URL拒否試験（target `site-map`、HTTPS必須、4ms）と一致。それ以外のerrorは同検索範囲では検出されなかった。Drains/長期監視設定は今回未確認。
- [390pxの未解決表示](./qa/2026-09-08/builder-0314-readonly-map-390.png)は合成フィクスチャ。実WordPressの画面一致を示す画像ではない。

実WordPressでの照会:

- `tachibana-kouki.com` のWordPress標準アップロード画面で、検証済みZIPを使ってConnectorのみ0.19.9→0.19.10へ更新。「プラグインの更新に成功しました」とプラグイン一覧の0.19.10/有効状態を確認。Elementor、Pro、テーマ、WordPress本体は更新していない。
- 公開Builder v0.31.4で保存済みPATを使い実Figmaを読み込み、19候補から既定の9フレームだけを選択。「採用9ページを確定しました。除外10ページ。」を確認。
- 保存済みConnector接続の診断が成功。WP 7.1 / Connector 0.19.10 / Elementor 4.2.4 / Pro 4.2.3を取得した。診断はWidget登録確認であり、全Widgetの編集・保存・機能試験ではない。
- 「既存ページの対応表を取得（変更なし）」を実行し、9ページすべて解決。未解決0件。下記ID一覧と、WordPress内bridgeの「ページ対応表を読み取りました。ページ・メニューは変更していません。」をDOM・画面で確認。ブラウザのerror/warnログは取得範囲で0件。

| ページkey | 実WordPress下書きID |
| --- | --- |
| home | 184626 |
| company | 184627 |
| reasons | 184628 |
| services | 184629 |
| works | 184630 |
| demolition | 184631 |
| news | 184632 |
| contact | 184633 |
| officers | 184634 |

今回はページ保存・下書き準備・メニュー作成を実行していない。既存9下書きに残る旧リンクの修正、別の検証コピー9ページ作成、実Elementorでの保存再読込、全ページのPC/Tablet/SP機能検査は未完了。読み取り専用対応表の合格を製品完成率やリンク動作の合格として扱わない。

### v0.31.3（保存経路の追加修正）

- サーバー経由の `/api/wordpress` だけ、旧版の6種類のページkey・最大8ページという制限が残っていた。直接/paired Connectorと同じ2〜20ページ、動的なページkeyへ統一した。
- 単に制限を緩めず、home必須・ページkeyの重複禁止・各source keyと対象site keyの完全一致を追加。別サイトの識別子、不正key、ページ内へのstatus追加などを拒否する。
- 採用ページUIでもhomeなしの構成を確定時に拒否し、WordPressへ送る前に不足を知らせる。
- この修正は既存の下書きを変更する操作ではない。実WordPress書き込みを使わず、9ページ入力がURL安全検査まで進むことと、異なるsource keyがその前に422で止まることをAPI試験する。
- 最終コード `6def570e5c42a8de11a476cd288125237c0a1fac`。単体258件、ブラウザ17件、型・Lint・ビルド成功。[CI 34232704100](https://github.com/kouki-tachibana-dot/figmapress-builder/actions/runs/34232704100)も成功。
- production候補 [6et73lzmz](https://figmapress-builder-6et73lzmz-chat-oikaze.vercel.app)、ID `dpl_2JFFzhvVUiFmZfJxaV6SLBMDNPgk`、READY、Next.js 16.3.0、ビルド21秒。候補HTTP200/版数0.31.3と9ページ入力の安全拒否試験（HTTP URLで400、外部WP送信なし）を確認。
- promote成功。公開URL [v0.31.3](https://figmapress-builder.vercel.app/?release=0.31.3#convert) でHTTP200と版数を再確認した。Connectorはv0.19.9のままで、今回WordPress側の更新操作はない。
- 配信後30分のerrorログは1件。上記の意図的なHTTP URL拒否試験（`公開版ではHTTPSのWordPressサイトのみ接続できます。`、7ms）と一致し、それ以外のerrorは同検索範囲では検出されなかった。Drains/継続監視は今回未確認。

### v0.31.2（追加実装・配信済み）

資料の添付を他作業の前提にせず、採用ページ固定と読み取り専用検査を強化した。

- 19候補の自動採用を廃止。ページを明示選択して確定するまで一括変換検査・保存を禁止する。
- 選択した構成を変換API、QA、メニュー準備、保存で共有。現在のプレビューも確定構成で取り直し、旧案をキャッシュから戻さない。
- 保存ボタンも採用ページ一式のQAで判定し、未採用の単体プレビューのPDF・視覚検査を前提にしない。WordPressページ準備の直前には、保存する全テンプレートを厳格な構造/リンク/未接続検査で再確認する。
- 選択変更・再変換・元URL変更でキャッシュと検査結果を破棄する。途中で届く古い検査結果も採用しない。
- 資料未接続は別欄へ記録し、他ページの構造・画面比較を続行可能にした。下書き保存の未接続ゲートは維持し、架空PDFやURLは作らない。
- ローカル: `npm run test:product` 単体254件・型・Lint・ビルド成功、`npm run test:e2e` 16件成功、依存監査0件。
- ブラウザ回帰: 19候補から9ページだけの取得、9→10ページへの変更で全キャッシュ再取得、構成なし/異なるフレームのAPI拒否を確認。合成データによる試験であり、実Figma全9ページの合格ではない。
- 今回はWordPressのConnector・下書き・公開ページ・メニューを変更していない。読み取り専用の既存ページ対応表と検証コピー作成は次工程。

配信結果:

- URL: [公開Builder v0.31.2](https://figmapress-builder.vercel.app/?release=0.31.2#convert)。ブラウザの版数、保存済みPAT利用準備状態を確認。
- Target: production / Status: READY / Commit: `652c8146dd12a2a3a68895a16e2527bd75aba329` / Framework: Next.js 16.3.0 / Build: 22秒。
- [配信候補](https://figmapress-builder-bube6yama-chat-oikaze.vercel.app)、ID `dpl_7cyKhTgRcXCu6t5ru53HjwZgqTi5`。候補HTTP200と版数を確認してpromote成功。
- 最終コードの[GitHub CI 34231438005](https://github.com/kouki-tachibana-dot/figmapress-builder/actions/runs/34231438005)成功。単体254件・ブラウザ16件。
- 公開Connector manifestはv0.19.9のまま。Connector更新は今回不要。
- 配信後errorログ（対象deployment・過去30分）は `No logs found`。Drains/継続監視の設定は今回未確認で、長期無障害を意味しない。
- [390pxのページ選択回帰画面](./qa/2026-09-08/builder-0312-selection-regression-390.png)は合成19候補で9→10選択へ変更した試験。実Figma/WPの視覚一致画像ではない。

公開版の実Figma試験:

- 保存済みPATで会社案内を再変換し、実19候補を確認した。以下の9ページのみチェックして「採用9ページを確定しました。除外10ページ。」を確認。初期状態で自動選択されないこと、確定後は未採用プレビューのQAが保存判定に混ざらないことも確認。
- 検査用に、従来承認済みのサンプル原稿保持を選択。資料添付なしで採用9ページの事前検査を開始した。WordPress保存の同意・送信ボタンは操作していない。
- **完了結果**: 実Figma全9ページの取得後、PC/SP全18画面が比較ゲートに合格、最低知覚スコア99.90。無修正でのBuilder生成プレビュー比較であり、WordPress保存後の視覚比較でも製品完成率でもない。
- 構造検査: ネイティブElementor 9ページ、main/header/footer/H1 各27個（PC/派生Tablet/SP）、文字1265個、画像911個、Button11個、構造化URL15件、ナビゲーション27個、リンク471件、移動先9ページ、フォーム3個。フォームの受信は未試験、画像数は破損ゼロを意味しない。
- サンプル原稿98要素を承認済みのまま保持。未接続資料12要素（会社案内9・お問い合わせ3）は未完了一覧に残り、保存ボタンは無効。資料未提供でも他の構造/画素比較が完了することを実データで確認した。

| 採用ページ | 主フレームID | ページkey |
| --- | --- | --- |
| ホーム | 192:176 | home |
| 会社案内 | 192:657 | company |
| 選ばれる理由 | 192:944 | reasons |
| 事業内容 | 192:1226 | services |
| 施工事例 | 192:1532 | works |
| 解体工事 | 192:1808 | demolition |
| お知らせ | 192:2071 | news |
| お問い合わせ | 192:2359 | contact |
| 役員一覧 | 402:14 | officers |

### v0.31.1時点の配信・実サイト検証

ユーザーの明示承認後、**Builder v0.31.1 / Connector v0.19.9を配信**。テストWordPress `tachibana-kouki.com` のConnectorを0.19.6→0.19.8→0.19.9へ更新し、有効化状態を確認。公開ページ本文、既存9下書きの保存内容、公開メニュー割当、実メール送信は変更していない。新しい下書きの保存は未実行。

「99.9%完成」とは判定しない。原本との視覚一致、実WordPress保存後の動作、編集耐性には未検証項目がある。計画は [IMPLEMENTATION_PLAN.md](./IMPLEMENTATION_PLAN.md)、必須条件は [ACCEPTANCE_CRITERIA.md](./ACCEPTANCE_CRITERIA.md) に記録した。

## 実装した改善

| 対象 | 修正 | 現時点の証拠 |
| --- | --- | --- |
| 内部リンク | 推測した `/home/` 等のURLを撤去。対象サイト・source key・下書きID・preview URLが一致するWordPress応答だけを採用 | 未取得・別サイト・別ディレクトリ・誤ID・公開済み・重複・危険URLを拒否する単体試験 |
| 視覚QA | `runVisualQa` が対象端末のdisplayを強制する処理を撤去。実CSSで1端末だけ可視か検査 | CSSなし・誤端末・全非表示・透明化を、DOMの表示修正なしで不合格にするブラウザ試験 |
| レスポンシブ | PCのみ/PC+SP/PC+Tablet/3端末で安全に継承。Elementorのmobile/tablet設定値をPHPから取得 | 320/390/440/767/768/834/1024/1025/1440px、カスタム600/900pxの境界を確認 |
| 資料リンク | アコーディオンに入るFigmaの明示URLを維持。未接続PDF/ダウンロード文言を保存前に検出 | ネイティブ/代替Accordion、リンクあり/なし、別リンクとの混在の単体試験 |
| 編集性 | 重なりがなく幅・左端・間隔が揃った縦積みだけ、通常のFlexコンテナに変換 | 元データ非破壊、余白・間隔、通常配置、重なり/装飾/絶対指定を推定しない試験 |
| 誤解しにくい表示 | 「生成完了」と「品質合格」を区別。常時LIVE表示と初回アクセスでの誤った旧版通知を撤去 | PC/スマホの実操作と自動ブラウザ試験 |
| 配布と回帰 | ZIP全ファイル・manifest・PHP・readme・packageの一致検査、CIのブラウザ試験と失敗証拠保存 | ローカル、GitHub CI、配信ZIPで一致 |

### 実運用テストで追加修正した問題

- **部分比較の誤合格**: 実Figmaの会社案内ではPC基準画像が取得できず、スマホだけ比較できた。この状態を「視覚品質チェック完了」と表示する判定漏れを修正。v0.31.1では原稿のある全端末に基準画像と重複しない結果が必要。画像取得全失敗・端末取り違え・重複・比較中も保存を止める。派生Tabletは原本一致の対象に数えない。修正commit `0d26d99`。
- **スマホメニューの白文字**: 更新後の実ページでメニューを開くと、写真上の白文字設定が白いドロップダウンにも継承されていた。Connector v0.19.9でパネル内だけ独立した文字色を設定。通常・ホバー・フォーカスで可読性を維持し、PCヘッダーの白文字は保持。共有サーバーの古い外部CSSキャッシュを避けるため既存inline stylesheetへ追加。修正commit `f0c1ce0`。

## 本番配信・接続の証拠

- 公開URL: https://figmapress-builder.vercel.app/ 。HTTP 200、ブラウザ版数v0.31.1。
- 最終配信commit: `f0c1ce0167fcfae5b61d470b46db8f8ab2efcff3`。
- Vercel: production / Ready / Next.js 16.3.0。ビルド21秒。[配信](https://figmapress-builder-dn3oueo2t-chat-oikaze.vercel.app)、ID `dpl_DEBoTtxWRm6PcCmdDk7aEJiq2fQJ`。候補を検査後、公開エイリアスへpromote成功。
- GitHub CI: [run 34196386245](https://github.com/kouki-tachibana-dot/figmapress-builder/actions/runs/34196386245) が成功。先行リリースの245件/12件に追加回帰を加えた最終結果は単体250件・ブラウザ14件。
- 配布Connector ZIPのSHA-256: `2eea9e4637724c841b1df035da4694bd5ad4bfa1edc2a44f51a430e680b0d920`。候補配信と公開URLから取得したZIPの両方で、ローカルZIPとの全バイト一致を確認。公開manifestもHTTP 200 / v0.19.9。
- 最終deploymentを指定し過去30分のerrorログを検索した結果は `No logs found`。長期運用や全外部連携でエラーがないことを保証する結果ではない。
- WordPress管理画面: Connector v0.19.9が有効。Elementor 4.2.4 / Pro 4.2.3は更新していない。
- 保存済みConnector接続でWordPress診断成功。ネイティブWidget 4/4、機能Widget 5/5を取得。これは登録有無の診断であり、全Widgetの保存・編集・再初期化試験を意味しない。

## 検証結果

- `npm run test:product`: 単体250件、型検査、Lint、Next.js本番ビルドが成功。
- `npm run test:e2e`: Chromiumで14件成功。9件は生成ルート/CSS/QA helperの隔離フィクスチャ、3件はBuilder実APIでのPC/SPサンプル変換と不正JSON検出。追加2件はPC基準画像欠落のUI表示・保存禁止、および白文字ヘッダーとスマホメニューの配色分離。
- PHP構文: 13ファイル成功。
- `npm audit --omit=dev --audit-level=high`: 検出0件。
- `git diff --check`: 成功。
- Builder UIの検証では実WordPress APIを遮断し、呼び出し0件、JavaScript/consoleエラー0件、親画面とプレビューの横はみ出し0件を確認。
- Playwrightのtrace用スクリプトが保護iframeに拒否されることを切り分けた。アプリのsandboxを緩めず、Builder試験だけtraceを無効にして失敗スクリーンショットを保存する。エラーを無視するフィルタは使用していない。

### 画面証拠

- [Builder 1440px](./qa/2026-09-08/builder-converted-1440.png)
- [Builder 390px](./qa/2026-09-08/builder-converted-390.png)

上記2枚は同梱JSONサンプルのBuilder画面であり、建工101 FigmaとWordPressの一致画像ではない。

実Figma会社案内（PC `192:657` / SP `192:794`）を保存済み接続で再変換した。初回のスマホ[比較JSON](./qa/2026-09-08/company-mobile-builder-0310-visual-report.json)は、描画440×7559px、測定238×4089px、知覚スコア99.9、生RGBA差分5.3%、実質差分1.8%。この時点ではPC基準画像が取得できていなかった。

最終配信v0.31.1で会社案内の特定フレームを再取得し、**PC/SP両方の比較が完了**。[最終比較JSON](./qa/2026-09-08/company-pc-mobile-builder-0311-visual-report.json)を保存。

| 対象 | 描画幅×高さ | 測定幅×高さ | 知覚スコア | 生RGBA差分 | 実質差分 | 内容領域差分 | 最大区間差分 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| PC | 1440×7865 | 960×5243 | 99.9 | 2.5% | 1.1% | 1.8% | 2.5% |
| SP | 440×7559 | 440×7559 | 99.9 | 3.1% | 0.9% | 1.6% | 3.1% |

両端末とも高さ差0%、全体/セクション/文字/画像/装飾の自動補正適用0件。これはBuilderプレビューの比較であり、WordPress保存後の一致率・製品完成率ではない。初回と最終では測定解像度が違うため、差分率の変化を実装改善量とは扱わない。文字領域には個別10%以上の差分が残り、引き続き目視・実Elementorでの確認が必要。

最終版でダウンロードした実Elementor JSONの構造検査は合格（132コンテナ、338ウィジェット、181テキスト、149画像、端末ごとにmain/header/footer/H1あり、ネストしたリンク違反0）。ただし未接続ダウンロードが**9要素**（「Web資料のダウンロードはこちら」「こちらからダウンロード」「令和7年度 ご請求書フォーマット.pdf」が各3端末）残る。構造合格・視覚スコアだけで保存/完成にしない。

既存検証下書き `#187815` をConnector v0.19.9で再読込。440/834/1024/1440pxで可視端末ルートが各1個、横はみ出し0を実測。スマホメニュー9項目の文字色は `rgb(32,32,32)`、PCは `rgb(255,255,255)` を維持。目視で白文字消失の解消を確認した。ネイティブAccordionのクリック、Enter、Spaceで開閉を確認（アニメーション完了後に状態を測定）。これらは既存下書きの互換性検査であり、新版のElementor保存試験ではない。

旧下書きのメニューURLには `/home/`、`/company/` 等の推測スラッグが残っている。Connector更新は保存済みページ本文を書き換えないため、この問題は今回まだ解消していない。

## 残る条件・制限

1. **全9ページの実機検証**: 更新の承認・Connector更新は完了。現在の全Figma認識は47候補、サイト一式は旧案を含む19ページ。対象9ページのフレーム固定と非破壊の対応表取得を先行し、公開ページ・手修正下書きを変更せず保存・再読込・リンク巡回・原本比較を行う。一括保存は未実行。
2. **正式資料**: 請求書フォーマットPDFとWeb資料の実ファイル/正式URLが未提供。存在しない資料URLは生成しない。未接続のまま保存しようとすると停止する。
3. **対応表の再取得UX**: 今回のページ対応表は同じアプリセッション内の下書き準備応答を使用する。再読み込み後は単独レビューコピーの前にサイト一式の準備が必要。読み取り専用の対応表再取得は次フェーズ。
4. **編集性は部分改善**: 自由配置や装飾の絶対配置は残る。縦積みグループの外側が絶対配置の場合もある。実Elementorで文量2倍・途中追加・並べ替え・再保存する試験は未実施。
5. **継続運用**: 既存の保存ハッシュ/リビジョン機構は保持したが、Figma差分と人の手修正を比較して競合を解決する新しい更新フローは未実装。
6. **機能**: 実Proウィジェットの編集・保存・再初期化、フォームのテスト送信と受信、実PDFの取得確認は未実施。送信先/テスト送信は別途確認する。
7. **原本比較**: 既存の全テキスト表示診断と視覚スコアだけでは合格にしない。今回の無補正検査は視覚QAの端末ルート切替に対する改善であり、実サイト全体のCSS/機能を検証した証拠ではない。

## 次の実行順序

1. 採用9ページを明示選択・固定するUIと、既存ページ対応表の読み取り専用再取得を実装。旧案を自動採用しない。
2. Figma原本のPC/SP/存在するTabletの基準画像と、既存9ページの対応を再取得。新しい検証用下書きに限定して構築。
3. 正式資料リンクを接続し、全リンクが正しい下書きIDへ到達することを認証済みブラウザで確認。
4. セクション高→文字→画像→装飾の順で原本差分を修正。原本と同じ幅の画像・差分JSONを保存。
5. 実Elementorで通常編集・保存再読込・Pro機能・キーボード操作を確認し、未実施を0件にする。
6. 手修正競合の検出と復元フローを追加。全必須条件を満たした時点で公開可否を判断する。公開そのものは別承認。

## 参照した公式仕様

- [Elementor breakpoint system](https://developers.elementor.com/breakpoint-system-changes-in-elementor-v3-2-0/): 登録済みブレークポイントの取得と値参照。
- [Elementor responsive data](https://developers.elementor.com/docs/data-structure/responsive-data): 端末別設定を持つネイティブデータ構造。
- [GitHub upload-artifact](https://github.com/actions/upload-artifact): ブラウザ失敗時の証拠をCI artifactとして保持。

reference-site-builderスキルに沿い、承認されたFigmaを正本に据え、視覚一致の証拠がない項目を完了扱いしない工程にした。
