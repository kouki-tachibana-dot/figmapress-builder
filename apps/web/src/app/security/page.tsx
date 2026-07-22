import type { Metadata } from "next";
import { LegalLayout } from "@/components/legal-layout";

export const metadata: Metadata = { title: "セキュリティ | FigmaPress" };

export default function SecurityPage() {
  return (
    <LegalLayout
      eyebrow="Security"
      title="セキュリティ"
      summary="認証情報をサーバー保存せず、WordPressへの操作をHTTPSの下書き作成だけに限定しています。"
    >
      <section>
        <h2>認証情報</h2>
        <p>Figma Tokenは同じタブのセッションストレージだけに保持し、サーバーでは1回のリクエスト中だけ利用します。WordPress Application Passwordは保存せず、ブラウザから対象サイトへの直接接続を優先します。CORSで接続できない場合だけサーバーで1回のリクエスト中に利用し、応答には含めません。Figma Tokenには、短い有効期限と <code>file_content:read</code> だけを設定することを推奨します。</p>
      </section>
      <section>
        <h2>WordPress接続</h2>
        <p>HTTPSの公開ホストだけを許可します。localhost、プライベートIP、リンクローカル、予約済みIP、外部リダイレクトを拒否します。作成する固定ページは常に <code>status: draft</code> です。Elementor作成はConnectorプラグインで <code>edit_pages</code> 権限、Widget許可リスト、再帰サニタイズを検査します。</p>
      </section>
      <section>
        <h2>画像の永続化</h2>
        <p>Elementor作成時はFigmaの期限付き画像URLをWordPressメディアライブラリへ取り込みます。公開HTTPS画像だけを許可し、最大60件、1件10MBまでに制限します。</p>
      </section>
      <section>
        <h2>アプリケーション防御</h2>
        <p>リクエスト容量制限、入力検証、タイムアウト、同一オリジン検査、簡易レート制限、厳格なセキュリティヘッダーを有効にしています。ページプレビューはスクリプトを実行できないサンドボックス内で表示します。</p>
      </section>
      <section>
        <h2>脆弱性の報告</h2>
        <p>公開Issueには詳細を書かず、GitHubリポジトリのSecurityタブにあるPrivate vulnerability reportingからご連絡ください。</p>
      </section>
    </LegalLayout>
  );
}
