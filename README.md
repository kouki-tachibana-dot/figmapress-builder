# FigmaPress Builder

Figma の構造を、WordPress で扱える Gutenberg ブロックへ変換する
オープンソースの Web アプリ＋CLIです。

## Public Beta v0.2

ブラウザ版では次の操作を登録不要で行えます。

- Figma URL／ファイルキーと Personal Access Token から直接変換
- Figma JSONを貼り付け、またはファイルとして読み込んで変換
- Site Blueprint、Gutenberg HTML、`theme.json` のダウンロード
- 生成ページの安全なサンドボックスプレビュー
- HTTPSのWordPressサイトへ下書き固定ページを作成
- WordPress Plugin／Theme ZIPのダウンロード

```bash
npm install
npm run dev:web
```

`http://localhost:3000` を開くとWebアプリを利用できます。

### 認証情報の扱い

Figma TokenとWordPress Application Passwordは対象APIへのリクエスト中だけ
メモリ上で使用し、データベース・ファイル・Cookieへ保存しません。APIレスポンスは
`no-store` です。WordPress接続はHTTPS公開ホストだけを許可し、内部IP、localhost、
リダイレクトを拒否します。詳細は [SECURITY.md](./SECURITY.md) と
[PRIVACY.md](./PRIVACY.md) を参照してください。

### Public Betaの制約

- Figma OAuthは未実装で、現時点では利用者自身のPersonal Access Tokenが必要
- Figmaレイヤーは所定の `section/*` 命名規則に従う必要がある
- WordPressへの送信は固定ページの `draft` 作成だけ
- Elementor Exporterは未実装（Future Phase）

---

# CLI MVP

Figma デザイン（または mock Figma JSON）から、**WordPress 上で編集可能な
Gutenberg ブロックページ** を自動生成する MVP です。

```
Figma → Site Blueprint → Gutenberg Block HTML → WordPress Draft Page
```

> このリポジトリの最重要方針:
> **Figma の見た目を absolute 配置 HTML にしてそのまま貼り付けない。**
> Figma を中立的な Site Blueprint へ変換し、編集可能な Gutenberg ブロックとして出力します。

---

## MVP の範囲

このリポジトリで動くもの:

- mock Figma JSON から LP 構造を読み取る
- Site Blueprint JSON を生成する
- Site Blueprint から Gutenberg ブロック HTML を生成する
- tokens → `theme.json` を生成する
- WordPress REST API で **下書き** 固定ページを作成する
- `figmapress/*` カスタムブロックを WordPress 側で登録・最低限表示する

## 今回やらないこと

- Figma Plugin / SaaS 管理画面 / 複数ユーザー管理 / 課金
- Elementor 出力の実装（**設計だけ拡張可能にしてある — 後述**）
- Bricks 対応 / Next.js 出力
- カスタム投稿タイプ / マルチページ生成
- 高度な React 編集 UI / Visual QA / Responsive UI
- Figma Webhook / 本番公開（`status: draft` のみ）

---

## ディレクトリ構成

```
figmapress-builder/
├── apps/api/                    (将来用 — MVP では未使用)
├── packages/
│   ├── blueprint/               Site Blueprint 型・zod schema・validator
│   ├── figma-parser/            mock Figma JSON → Site Blueprint
│   ├── exporter/                Exporter インターフェース（中立）
│   ├── block-renderer/          GutenbergExporter 実装
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

| 環境変数 | 用途 | MVP で必須? |
| --- | --- | --- |
| `WORDPRESS_BASE_URL` | 例: `https://example.com` | `wp:create-draft` で必須 |
| `WORDPRESS_USERNAME` | WordPress ユーザー名 | 同上 |
| `WORDPRESS_APPLICATION_PASSWORD` | Application Password | 同上 |
| `FIGMA_ACCESS_TOKEN` | 実 Figma API 接続（Priority B） | 不要 |
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

これで `figmapress/hero`, `figmapress/service-list`, `figmapress/card-grid`,
`figmapress/faq`, `figmapress/cta`, `figmapress/contact` が登録されます。

### Theme (ブロックテーマ)

1. `wordpress-theme/figmapress-block-theme/` フォルダ全体を
   `wp-content/themes/figmapress-block-theme/` にコピー
2. 外観 → テーマ → **FigmaPress Block Theme** を有効化

> Plugin と Theme の役割は **完全に分離** されています。Plugin はブロック
> 登録のみ、Theme は `theme.json`・テンプレート・スタイルのみ担当します。

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
→ 仕様通りの挙動です（MVP は hero / service / features / faq / cta /
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

今回は `GutenbergExporter` だけを実装しています。

---

## Future Phase: Elementor Exporter

将来 Elementor 対応を追加する場合は、下記の段階で進めます。
**MVP では実装しません。** 設計だけ準備しています。

### Phase E1 — Elementor JSON 出力 MVP

```
Site Blueprint → elementor-template.json
```

WordPress への自動 import は行わず、Elementor に **手動 import 可能**
な JSON を生成することをゴールにします。

### Phase E2 — Elementor インポート自動化

```
elementor-template.json → wp elementor library import → Elementor Library
```

### Phase E3 — Elementor ページ自動作成

```
Elementor JSON → Library import → 固定ページ作成 → Canvas/Full Width 指定 → Preview URL 返却
```

### 想定パッケージ

```
packages/elementor-renderer/
  src/
    ElementorExporter.ts
    widgets/
    template-json.ts
```

### Figma section → Elementor ウィジェットの対応（予定）

| section | Elementor 出力 |
| --- | --- |
| `section/hero` | Container + Heading + Text Editor + Button + Image |
| `section/service` | Container + Heading + Icon Box / Text Editor |
| `section/features` | Container + Card 風 inner container |
| `section/faq` | Accordion |
| `section/cta` | Container + Heading + Button |
| `section/contact` | Shortcode Widget (Contact Form 7 など) |

### 最初は対応しないもの

- Elementor Pro 専用機能
- Theme Builder 連携
- WooCommerce / Popup Builder
- 高度な Motion Effects / 独自 Widget 開発

> Elementor 対応は Gutenberg 版 MVP の **完成後** に着手します。

---

## ライセンス

MIT
