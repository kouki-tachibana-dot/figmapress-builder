# FigmaPress Builder

Figma の構造を、WordPress で扱える Gutenberg ブロックまたはElementorページへ変換する
オープンソースの Web アプリ＋CLIです。

## v0.8.0 — Auto Layout変換と品質診断

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
- `PC-page` と `SP-page` を自動検出し、ElementorでPC／タブレット用とスマホ用を安全に切り替え
- スマホ版の画像トリミング、文字位置、セクション順をPC版の縮小ではなくFigmaどおりに保持
- スマホヘッダーへPC版のメニュー項目を引き継ぎ、CTAを残した実動メニューへ変換
- 1920px基準の文字・高さ・画像を画面幅へ連続追従し、日本語の縦書き化と位置ずれを防止
- Figmaの折返し指定、混在文字サイズ、縦位置、回転を保持
- 写真・マスク・ベクターをFigmaレンダーAPIから取得し、文字は編集可能なWidgetとして保持
- Figmaのメニュー、問い合わせフォーム、年表／FAQをElementorの実動Widgetへ変換
- ナビのモバイルメニュー、フォーム送信、アコーディオン開閉をElementor Proなしで提供
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
- Elementor Pro専用Widget、Theme Builder、WooCommerce、Popupは対象外（ナビ・フォーム・アコーディオンはConnector独自Widgetで対応）

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
