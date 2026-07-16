"use client";

export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <main className="fatal-error">
      <div className="fatal-error__card">
        <span className="eyebrow">FigmaPress</span>
        <h1>画面を読み込めませんでした</h1>
        <p>一時的な問題が発生しました。再読み込みしてもう一度お試しください。</p>
        <button className="button button--primary" onClick={reset} type="button">
          再読み込み
        </button>
      </div>
    </main>
  );
}
