import type { Metadata } from "next";
import { LegalLayout } from "@/components/legal-layout";

export const metadata: Metadata = { title: "プライバシー | FigmaPress" };

export default function PrivacyPage() {
  return (
    <LegalLayout
      eyebrow="Privacy notice"
      title="プライバシー"
      summary="FigmaPress公開版は、アカウント登録や広告トラッカーを使用せず、接続に必要な情報だけを限定して処理します。"
    >
      <section>
        <h2>処理するデータ</h2>
        <p>変換時にFigma URL／ファイルキー、Figma JSON、OAuthトークンまたはPersonal Access Tokenを処理します。WordPress接続ではブラウザから対象サイトへの直接接続を優先し、CORSで接続できない場合だけ、サイトURL、ユーザー名、Application PasswordまたはConnector専用トークン、生成ページを当サービスのサーバーで一時処理します。</p>
      </section>
      <section>
        <h2>保存と利用</h2>
        <p>入力内容と認証情報は、依頼された変換または下書き作成のためだけに利用し、サーバー側のデータベースやファイルへ保存しません。Figma OAuthトークンは暗号化したHttpOnly Cookie、PATは標準で同じタブのセッションストレージに保持します。「このブラウザに保存する」を選んだPATと、WordPressのConnector専用接続（サイトURL、ユーザー名、90日限定トークン）は利用中のブラウザのローカルストレージへ保存します。Application Passwordは保存しません。共有端末ではブラウザ保存を使用せず、接続解除または「この接続を削除」を実行してください。</p>
      </section>
      <section>
        <h2>ホスティングと外部サービス</h2>
        <p>ホスティング基盤は、IPアドレス、時刻、User Agent、応答状態などの標準的なリクエスト情報を運用・セキュリティ目的で処理する場合があります。Figma APIと利用者自身のWordPressサイトには、処理に必要なデータが送信され、それぞれのプライバシーポリシーが適用されます。</p>
      </section>
      <p className="legal-page__date">最終更新：2026年7月27日</p>
    </LegalLayout>
  );
}
