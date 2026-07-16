import type { Metadata } from "next";
import { LegalLayout } from "@/components/legal-layout";

export const metadata: Metadata = { title: "プライバシー | FigmaPress" };

export default function PrivacyPage() {
  return (
    <LegalLayout
      eyebrow="Privacy notice"
      title="プライバシー"
      summary="FigmaPress Public Betaは、アカウント登録・広告トラッカー・アプリケーションCookieを使用しません。"
    >
      <section>
        <h2>処理するデータ</h2>
        <p>変換時にFigma URL／ファイルキー、Figma JSON、Personal Access Tokenを処理します。WordPress下書き作成時には、サイトURL、ユーザー名、Application Password、生成ページを処理します。</p>
      </section>
      <section>
        <h2>保存と利用</h2>
        <p>入力内容と認証情報は、依頼された変換または下書き作成のためだけにメモリ上で利用します。本サービスにはデータベースがなく、ファイル、Cookie、ブラウザストレージ、アプリケーションログへ保存しません。</p>
      </section>
      <section>
        <h2>ホスティングと外部サービス</h2>
        <p>ホスティング基盤は、IPアドレス、時刻、User Agent、応答状態などの標準的なリクエスト情報を運用・セキュリティ目的で処理する場合があります。Figma APIと利用者自身のWordPressサイトには、処理に必要なデータが送信され、それぞれのプライバシーポリシーが適用されます。</p>
      </section>
      <p className="legal-page__date">最終更新：2026年7月16日</p>
    </LegalLayout>
  );
}
