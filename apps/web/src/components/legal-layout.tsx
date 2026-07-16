import type { ReactNode } from "react";
import Link from "next/link";

interface LegalLayoutProps {
  eyebrow: string;
  title: string;
  summary: string;
  children: ReactNode;
}

export function LegalLayout({ eyebrow, title, summary, children }: LegalLayoutProps) {
  return (
    <main className="legal-page">
      <header className="legal-header">
        <Link className="brand" href="/">
          <span className="brand__mark" aria-hidden="true">F</span>
          <span>FigmaPress</span>
        </Link>
        <Link href="/">← 変換画面へ戻る</Link>
      </header>
      <article>
        <span className="eyebrow">{eyebrow}</span>
        <h1>{title}</h1>
        <p className="legal-page__lead">{summary}</p>
        <div className="legal-page__body">{children}</div>
      </article>
    </main>
  );
}
