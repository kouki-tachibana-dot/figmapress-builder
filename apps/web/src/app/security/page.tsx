import type { Metadata } from "next";
import { LegalLayout } from "@/components/legal-layout";

export const metadata: Metadata = { title: "セキュリティ | FigmaPress" };

export default function SecurityPage() {
  return (
    <LegalLayout
      eyebrow="Security"
      title="セキュリティ"
      summary="認証情報をサーバーのデータベースやファイルへ保存せず、WordPressへの操作をHTTPSの下書き作成だけに限定しています。"
    >
      <section>
        <h2>認証情報</h2>
        <p>ローカル直接モードでは、利用者自身の<code>file_content:read</code>権限付きPATを使用し、OAuth審査なしで変換できます。PATはOAuthより優先され、標準で同じタブのセッションストレージだけに保持し、明示的に選んだ場合だけローカルストレージへ移します。共通PATやPATのサーバー保存は行いません。任意のFigma OAuthはPKCEを使い、トークンをAES-256-GCMで暗号化したHttpOnly・SameSite Cookieに保持します。WordPress Application Passwordは保存しません。Connector専用接続を選んだ場合だけ、サイトURL、ユーザー名、90日限定トークンをブラウザに保存します。</p>
      </section>
      <section>
        <h2>WordPress接続</h2>
        <p>HTTPSの公開ホストだけを許可します。localhost、プライベートIP、リンクローカル、予約済みIP、外部リダイレクトを拒否します。専用トークンはWordPress側にHMACハッシュだけを保存し、<code>figmapress/v1</code> REST経路だけで認証します。通常ログインや他のREST APIには使えず、新規発行または管理画面の解除で直ちに失効します。作成する固定ページは常に <code>status: draft</code> です。Elementor作成は <code>edit_pages</code> 権限、Widget許可リスト、再帰サニタイズを検査し、再送時は既存下書きを再利用します。</p>
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
