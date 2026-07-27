# FigmaPress Builder

Figma の構造を、WordPress で扱える Gutenberg ブロックまたはElementorページへ変換する
オープンソースの Web アプリ＋CLIです。

## v0.23.0 — Decoration Geometry

Figmaのカード背景・フォーム枠・CTA背景・区切り線など、内容を持たない装飾Containerを独立して追跡します。PC／スマホ別に位置・幅・高さの補正候補を測定し、子要素のないElementor Containerだけへ反映します。機能Widgetや内容を含むContainerには触れず、対象装飾すべてとページ全体が改善した場合だけ採用します。

## v0.22.0 — Element Geometry

Figma基準画像と生成結果の写真・画像・アイコン・背景装飾をノード単位で追跡し、PC／スマホ別に位置・幅・高さの安全な補正候補を判定します。Elementor標準Transformへ反映後、対象画像すべてとページ全体を再測定し、改善しない補正は自動で巻き戻します。

## v0.21.0 — Visual QA Geometry

Figma基準画像と生成結果の文字領域を比較し、位置に加えて幅・高さの微差をPC／スマホ別に推定します。安全範囲内の候補だけをElementor標準Transformへ反映し、再測定で対象文字が改善しない場合は生成データと実下書きの両方を自動で巻き戻します。

## v0.20.0 — Visual Fidelity II

Figma画像の切り抜き、拡大縮小、せん断、回転、タイル倍率と基本フィルターを構造化してElementorへ保持します。正確なFigmaレンダーを最優先し、レンダー取得上限時も元画像と変形行列で編集可能な高忠実度フォールバックを行います。

## v0.19.0 — Functional Parity

FigmaのCarousel／Slider、プロトタイプリンク、CTA、電話、メールを実動Elementor Widgetへ変換します。カルーセルは前後ボタン、ドット、キーボード、スワイプ、動きの軽減設定に対応し、PC版とスマホ版の表示枚数を独立して保持します。

## v0.18.0 — Native Figma Image Fidelity

**Web版:** [https://figmapress-builder.vercel.app](https://figmapress-builder.vercel.app)

ブラウザ版では次の操作を登録不要で行えます。

- Figma URL／ファイルキーと Personal Access Token から直接変換
- Figma JSONを貼り付け、またはファイルとして読み込んで変換
- Site Blueprint、Gutenberg HTML、Elementor Template JSON、`theme.json` のダウンロード
- 生成ページの安全なサンドボックスプレビュー
- WordPress接続診断（認証、権限、Connector、Elementor）
- HTTPSのWordPressサイトへGutenberg／Elementor下書き固定ページを作成
- Figma画像をWordPressメディアライブラリへ取り込み、期限切れを防止
- Figmaの座標・サイズ・文字スタイルをElementorへ直接反映
- Figma Auto Layoutの方向、間隔、余白、整列、折返し、伸縮をElementor Flexboxの通常フローへ変換
- 変換後にレイヤー構造、編集可能文字、Auto Layout、レスポンシブ、実動パーツを自動診断
- 品質診断結果を画面で確認し、`quality-report.json` として保存
- FigmaのPC／スマホ基準画像と生成ページを同一寸法で画素比較
- 視覚一致スコア、差分面積、平均色差、ページ内の差分集中箇所を自動算出
- PC／スマホ別の差分ヒートマップと改善提案を画面表示し、JSONとして保存
- 差分をセクション／文字要素単位で再計測し、ページ全体への影響が大きい順に表示
- PC／スマホ別に全体位置ずれの補正候補、確度、推定誤差削減率を自動判定
- 安全と判定したPC／スマホ別の全体位置ずれをElementor標準Transformへワンクリック反映
- 補正後にFigma基準画像と自動再比較し、実測スコアが改善した場合だけ生成データへ採用
- 改善しない補正はプレビューとElementor JSONの両方から自動で巻き戻し
- ページ高の不一致や局所差分を単純な全体移動と誤認しない安全判定
- 全体補正後も残る位置ずれをセクション単位で測定し、PC／スマホ別に安全な候補を提示
- FigmaノードIDが一致するElementor要素だけへ局所補正を反映し、他セクションの位置を保持
- 全体移動と局所移動を合成してElementor標準Transformへ保存し、回転指定も維持
- 局所補正後に対象セクションを再測定し、領域差分が改善しない場合は自動で巻き戻し
- 文字領域ごとに±6pxの位置と±5%の幅・高さを探索し、安全なPC／スマホ別補正候補を提示
- 影響の大きい文字要素だけをFigmaノードIDで限定し、Elementor標準の移動・X/Yスケールへ保存
- 文字寸法補正後に対象文字とページ全体を再測定し、改善しない候補を自動で巻き戻し
- 写真・画像・アイコン・背景装飾をFigmaノードIDで追跡し、差分影響の大きい順に表示
- 画像要素ごとに位置とX/Yスケールの安全なPC／スマホ別補正候補を提示
- 画像補正をElementor標準Transformへ保存し、全対象が改善した場合だけ採用
- カード背景・フォーム枠・CTA背景・区切り線などの子要素なし装飾Containerを独立追跡
- 背景・枠の位置・寸法補正は子要素なしElementor Containerだけへ反映し、機能Widgetを保護
- 背景・枠補正後に対象装飾すべてとページ全体を再測定し、改善しない補正を自動で巻き戻し
- 長いページでは画面内の主要な文字・画像候補へ測定対象を絞り、Visual QAの処理時間を抑制
- Elementor下書き作成後にWordPress上の実フロントエンド描画をPC／スマホで再取得
- 実Elementor描画をFigma基準画像と再比較し、改善する追加補正だけを下書きへ保存
- 実ページ補正が改善しない場合は元のElementor JSONへ自動で戻し、更新前リビジョンも保持
- Connectorが実DOMへFigmaノードIDを付与し、実ページでもセクション単位の差分を追跡
- Figmaの使用書体とウェイトを安全なマニフェストとしてElementorデータへ保存
- FigmaPressページだけに必要なWebフォントを読み込み、日本語の代替字形もNoto Sans／Serif JPへ固定
- Connectorの許可リストと件数上限で、保存データから任意の外部CSSを読み込めないよう制限
- 実ページVisual QAはWebフォントの読込完了後に計測し、改行・文字幅・行高の揺れを低減
- Figmaの線形・放射グラデーションを角度、中心、半径、最大8色のストップまで保持
- Elementor標準の編集可能な2色グラデーションと、Connectorによる完全な複数色描画を併用
- グラデーション設定は構造化データだけを許可し、任意CSSを実行できないよう数値と件数を制限
- 品質診断でグラデーションの検出数、再現数、複数色数を確認
- Figmaレイヤーの透明度、複数の外側／内側シャドウ、レイヤーぼかし、背景ぼかしを保持
- Elementor標準の編集可能なシャドウと、Connectorによる完全な複数効果描画を併用
- 効果設定は構造化データだけを許可し、透明度、色、座標、半径、件数を安全な範囲へ制限
- 品質診断で透明度、影、ぼかしの検出数と再現数を確認
- Figmaレンダー上限に達してもマスク、切り抜き、調整済み写真を装飾ベクターより優先取得
- Figmaの画像フィット `FIT` / `FILL` をElementorの `contain` / `cover` へ変換
- Figmaの画像クロップ行列、回転、タイル倍率、露出・コントラスト・彩度をElementorへ構造化保存
- 正確なレンダー未取得時も、Connectorが数値を再検証して編集可能な元画像へ変形を再適用
- レンダー取得済み画像と標準フィット画像を区別し、不要な引き伸ばしを防止
- 品質診断で画像、正確な切り抜き、標準フィット、マスク、未再現の画像調整を確認
- Elementor下書き前にVisual QAを必須化し、重大差分がある場合は明示確認してから送信
- `PC-page` と `SP-page` を自動検出し、ElementorでPC／タブレット用とスマホ用を安全に切り替え
- スマホ版の画像トリミング、文字位置、セクション順をPC版の縮小ではなくFigmaどおりに保持
- スマホヘッダーへPC版のメニュー項目を引き継ぎ、CTAを残した実動メニューへ変換
- 1920px基準の文字・高さ・画像を画面幅へ連続追従し、日本語の縦書き化と位置ずれを防止
- Elementorの編集画面と生成プレビューの両方で横書き、改行、文字ボックス高、切り詰めを保持
- Figmaの折返し指定、明示改行、混在文字サイズ、縦位置、回転を保持
- 写真・マスク・ベクターをFigmaレンダーAPIから取得し、文字は編集可能なWidgetとして保持
- Figmaのメニュー、リンク、カルーセル、問い合わせフォーム、年表／FAQをElementorの実動Widgetへ変換
- ナビのモバイルメニュー、CTA遷移、カルーセル操作、フォーム送信、アコーディオン開閉をElementor Proなしで提供
- Connector導入後の更新をWordPress標準のプラグイン更新画面から実行
- タイムアウト後に同じ作成処理を再送しても、既存下書きを再利用して重複を防止
- キャッシュされた問い合わせフォームでも期限切れせず送信可能
- WordPress Plugin／Theme ZIPのダウンロード

ローカルで実行する場合は `npm install`、`npm run dev:web` の順に実行し、
`http://localhost:3000` を開いてください。

### 認証情報の扱い

Figma Tokenは標準では同じタブの `sessionStorage` だけに保持します。利用者が
「このブラウザに保存する」を選んだ場合だけ `localStorage` へ移し、画面の「消去」で削除します。
共有端末ではブラウザ保存を使用しないでください。WordPress Application Passwordはアプリでは保持しません。どちらも
サーバー側のデータベース・ファイル・Cookieへ保存しません。APIレスポンスは
`no-store` です。WordPress接続はHTTPS公開ホストだけを許可し、内部IP、localhost、
リダイレクトを拒否します。詳細は [SECURITY.md](./SECURITY.md) と
[PRIVACY.md](./PRIVACY.md) を参照してください。

### 制約

- Figma OAuthは未実装で、現時点では利用者自身のPersonal Access Tokenが必要
- Elementor高忠実度変換は任意のレイヤー名に対応。Gutenberg変換では `section/*` または Hero / Services / Features / FAQ / CTA / Contact の意味が分かる名前を推奨
- 同一Figmaページに `PC` / `Desktop` と `SP` / `Mobile` の名前を含むトップレベルフレームを配置すると端末別に自動統合。スマホフレームがない場合はPCデザインを画面幅へ連続追従
- WordPressへの送信は固定ページの `draft` 作成だけ
- Elementor Pro専用Widget、Theme Builder、WooCommerce、Popupは対象外（ナビ・リンク・カルーセル・フォーム・アコーディオンはConnector独自Widgetで対応）

---

# CLI / ローカル運用

Figma デザイン（または mock Figma JSON）から、**WordPress 上で編集可能な
Gutenberg ブロックページまたはElementorページ** を自動生成します。

```
Figma → Site Blueprint → Gutenberg / Elementor → WordPress Draft Page
```

> このリポジトリの最重要方針:
> **Figma の見た目を単一画像やHTMLとして貼り付けない。**
> 文字は編集可能なWidgetにし、複雑なビジュアルだけを画像化してWordPress要素として出力します。

---

## 実装範囲

このリポジトリで動くもの:

- 実Figma REST APIまたはFigma JSONからLP構造を読み取る
- Site Blueprint JSON を生成する
- Site Blueprint から Gutenberg ブロック HTML を生成する
- FigmaレイアウトまたはSite BlueprintからElementor 0.4形式のContainer／Widget JSONを生成する
- tokens → `theme.json` を生成する
- WordPress REST API で **下書き** 固定ページを作成する
- Connector REST APIでElementor post meta、Canvasテンプレート、CSSキャッシュを設定する
- Figmaの外部画像をWordPressメディアライブラリへ安全に取り込む
- `figmapress/*` カスタムブロックを WordPress 側で登録・最低限表示する

## 今回やらないこと

- Figma Plugin / SaaS 管理画面 / 複数ユーザー管理 / 課金
- Bricks 対応 / Next.js 出力
- カスタム投稿タイプ / マルチページ生成
- Figma OAuth / Webhook / 複数ユーザー管理 / 課金
- WordPressでの自動公開（安全のため `status: draft` のみ）

---

## ディレクトリ構成

```
figmapress-builder/
├── apps/web/                    Next.js Web UI・変換／WordPress API
├── packages/
│   ├── blueprint/               Site Blueprint 型・zod schema・validator
│   ├── figma-parser/            mock Figma JSON → Site Blueprint
│   ├── exporter/                Exporter インターフェース（中立）
│   ├── block-renderer/          GutenbergExporter 実装
│   ├── elementor-renderer/      Elementor 0.4 JSON Exporter
│   ├── token-pipeline/          tokens → theme.json
│   └── wp-connector/            WordPress REST クライアント
├── wordpress-plugin/
│   └── figmapress-connector/    figmapress/* ブロック登録プラグイン
├── wordpress-theme/
│   └── figmapress-block-theme/  ブロックテーマ（templates + parts + theme.json）
├── examples/
│   ├── mock-figma.json          サンプル Figma JSON
│   ├── sample-tokens.json
│   └── output/                  生成物の出力先
├── scripts/                     CLI エントリポイント
└── package.json
```

---

## セットアップ

### 必要環境

- Node.js 20 以上 (`fetch` がグローバルで使えるバージョン)
- npm 10 以上
- 動作中の WordPress 6.4+ サイト（Application Passwords 有効）

### インストール

```bash
cd figmapress-builder
npm install
```

### `.env` 設定

`.env.example` をコピーして `.env` を作ります。

```bash
cp .env.example .env
```

| 環境変数 | 用途 | 必須? |
| --- | --- | --- |
| `WORDPRESS_BASE_URL` | 例: `https://example.com` | `wp:create-draft` で必須 |
| `WORDPRESS_USERNAME` | WordPress ユーザー名 | 同上 |
| `WORDPRESS_APPLICATION_PASSWORD` | Application Password | 同上 |
| `FIGMA_ACCESS_TOKEN` | 実 Figma API 接続 | 不要 |
| `FIGMA_FILE_KEY` | 同上 | 不要 |

Application Password は WordPress 管理画面の **ユーザー → プロフィール →
アプリケーションパスワード** から発行できます。

---

## 使い方

### 1. mock から Site Blueprint を生成

```bash
npm run generate:blueprint
```

→ `examples/output/site.blueprint.json` が生成されます。
未対応セクション (`section/pricing` 等) は warning が出ますが処理は止まりません。

### 2. Gutenberg ブロック HTML を生成

```bash
npm run render:blocks
```

→ `examples/output/page-content.html` が生成されます。

### 3. `theme.json` を生成

```bash
npm run generate:theme
```

→ `examples/output/theme.json` と
`wordpress-theme/figmapress-block-theme/theme.json` の両方に書き出されます。

### まとめて

```bash
npm run mvp
```

`generate:blueprint` → `render:blocks` → `generate:theme` を順に実行します。

### 4. WordPress に下書きページを作成

```bash
npm run wp:create-draft
```

`page-content.html` を WordPress REST API に送信し、`status: draft` の
固定ページを作成します。実行後に編集リンクとプレビューリンクが表示されます。

> Blueprint の slug `/` は WordPress 側で `home` に変換されます（衝突時は
> `home-figmapress` などにフォールバック）。

---

## WordPress 側のインストール

### Plugin (`figmapress/*` ブロック登録)

1. `wordpress-plugin/figmapress-connector/` フォルダ全体を
   `wp-content/plugins/figmapress-connector/` にコピー
2. WordPress 管理画面 → プラグイン → **FigmaPress Connector** を有効化

異なるWordPressサイトにはそれぞれ初回インストールが必要です。0.5.0以降は、更新通知が
WordPress管理画面に表示されるため、以後のバージョン更新でXServerやFTPを触る必要はありません。

これで `figmapress/hero`, `figmapress/service-list`, `figmapress/card-grid`,
`figmapress/faq`, `figmapress/cta`, `figmapress/contact` が登録されます。

### Theme (ブロックテーマ)

1. `wordpress-theme/figmapress-block-theme/` フォルダ全体を
   `wp-content/themes/figmapress-block-theme/` にコピー
2. 外観 → テーマ → **FigmaPress Block Theme** を有効化

> Plugin と Theme の役割は **分離** されています。Plugin はブロック登録と
> 認証付きElementor接続、Theme は `theme.json`・テンプレート・スタイルを担当します。

---

## エラーハンドリング方針

| ケース | 挙動 |
| --- | --- |
| Figma JSON が不正 | エラー終了（メッセージあり） |
| 未対応 section | warning に記録して継続 |
| WordPress 認証失敗 | 認証エラーとして表示 |
| WordPress 作成失敗 | レスポンス本文を表示 |
| 画像取得失敗 | warning で継続（ページ生成は止めない） |
| tokens 抽出失敗 | デフォルト tokens で継続 |

---

## トラブルシューティング

**`Missing WordPress credentials`**
→ `.env` を作成し、`WORDPRESS_BASE_URL` / `WORDPRESS_USERNAME` /
`WORDPRESS_APPLICATION_PASSWORD` の 3 つを必ず設定してください。

**`401 / 403` が出る**
→ Application Password を再発行してください。スペースが含まれた状態で
コピーするのが正しい形式です（`xxxx xxxx xxxx xxxx xxxx xxxx`）。

**`Blueprint not found` が出る**
→ `npm run generate:blueprint` を先に実行してください。

**ブロックが認識されない / 表示されない**
→ Plugin が有効化されているか、`wp-content/plugins/figmapress-connector/`
直下に `figmapress-connector.php` があるかを確認してください。

**`section/pricing is unsupported` 等の warning**
→ 仕様通りの挙動です（対応範囲は hero / service / features / faq / cta /
contact のみ対応）。Blueprint への影響はありません。

---

## アーキテクチャの拡張ポイント — Exporter

Site Blueprint は **Exporter 非依存** の中間表現です。Gutenberg 専用の
データは Blueprint に入れず、`packages/exporter` の `SiteExporter` 経由で
変換します。

```ts
export interface SiteExporter {
  target: ExportTarget; // "gutenberg" | "elementor"
  export(blueprint: SiteBlueprint): Promise<ExportResult>;
}
```

`GutenbergExporter` と `ElementorExporter` を同じBlueprintから実行します。

---

## Elementor接続

Web画面から `elementor-template.json` をダウンロードしてElementorへ手動importできるほか、
FigmaPress Connector v0.4以上を有効化したWordPressへ直接下書きを作成できます。
ConnectorはApplication Passwordで認証された `edit_pages` 権限ユーザーだけを許可し、
Elementorの非公開post metaへJSONを保存します。

### Figma section → Elementor ウィジェット

Figma URLからの変換では、選択フレームの任意レイヤーをContainer／Heading／Text Editor／Imageへ
直接変換します。下表はGutenberg互換の意味セクションを入力した場合のフォールバックです。

| section | Elementor 出力 |
| --- | --- |
| `section/hero` | Container + Heading + Text Editor + Button + Image |
| `section/service` | Container + Heading + Card containers |
| `section/features` | Container + Card 風 inner container |
| `section/faq` | Container + Heading + Q&A containers |
| `section/cta` | Container + Heading + Button |
| `section/contact` | Container + Heading + Text Editor + Button |

### 最初は対応しないもの

- Elementor Pro 専用機能
- Theme Builder 連携
- WooCommerce / Popup Builder
- 高度な Motion Effects / 独自 Widget 開発

外部画像は下書き作成時に最大60件・各10MBまでメディアライブラリへ保存します。

---

## ライセンス

MIT
