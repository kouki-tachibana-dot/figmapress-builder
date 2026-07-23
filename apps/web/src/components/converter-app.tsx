"use client";

import { useState, useSyncExternalStore, type ChangeEvent, type FormEvent, type MouseEvent } from "react";
import {
  WordPressDirectError,
  createWordPressDraftDirect,
  probeWordPressDirect,
} from "@/lib/wordpress-browser";
import { readWordPressCredentials } from "@/lib/wordpress-form";
import {
  runVisualQa,
  type VisualQaBrowserResult,
  type VisualQaReference,
} from "@/lib/visual-qa-browser";
import { resolveVisualQaDraftGate } from "@/lib/visual-qa";

type SourceMode = "figma" | "json";
type OutputTarget = "gutenberg" | "elementor";

const FIGMA_TOKEN_SESSION_KEY = "figmapress:figma-token";
const FIGMA_TOKEN_LOCAL_KEY = "figmapress:figma-token:persistent";
const FIGMA_TOKEN_PERSIST_KEY = "figmapress:remember-figma-token";
const FUNCTIONAL_WIDGETS_CONNECTOR_VERSION = "0.7.0";

function versionAtLeast(version: string | undefined, minimum: string): boolean {
  if (!version) return false;
  const current = version.split(".").map((part) => Number.parseInt(part, 10) || 0);
  const required = minimum.split(".").map((part) => Number.parseInt(part, 10) || 0);
  for (let index = 0; index < Math.max(current.length, required.length); index += 1) {
    if ((current[index] ?? 0) > (required[index] ?? 0)) return true;
    if ((current[index] ?? 0) < (required[index] ?? 0)) return false;
  }
  return true;
}

function readSessionFigmaToken(): string {
  if (typeof window === "undefined") return "";
  try {
    if (window.localStorage.getItem(FIGMA_TOKEN_PERSIST_KEY) === "true") {
      return window.localStorage.getItem(FIGMA_TOKEN_LOCAL_KEY) ?? "";
    }
    return window.sessionStorage.getItem(FIGMA_TOKEN_SESSION_KEY) ?? "";
  } catch {
    return "";
  }
}

function readPersistentTokenFlag(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(FIGMA_TOKEN_PERSIST_KEY) === "true";
  } catch {
    return false;
  }
}

const tokenListeners = new Set<() => void>();

function subscribeSessionFigmaToken(listener: () => void): () => void {
  tokenListeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (
      event.key === FIGMA_TOKEN_SESSION_KEY ||
      event.key === FIGMA_TOKEN_LOCAL_KEY ||
      event.key === FIGMA_TOKEN_PERSIST_KEY
    ) {
      listener();
    }
  };
  window.addEventListener("storage", onStorage);
  return () => {
    tokenListeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

function writeFigmaToken(value: string, persistent = readPersistentTokenFlag()): void {
  try {
    if (persistent) {
      window.localStorage.setItem(FIGMA_TOKEN_PERSIST_KEY, "true");
      if (value) window.localStorage.setItem(FIGMA_TOKEN_LOCAL_KEY, value);
      else window.localStorage.removeItem(FIGMA_TOKEN_LOCAL_KEY);
      window.sessionStorage.removeItem(FIGMA_TOKEN_SESSION_KEY);
    } else {
      window.localStorage.removeItem(FIGMA_TOKEN_PERSIST_KEY);
      window.localStorage.removeItem(FIGMA_TOKEN_LOCAL_KEY);
      if (value) window.sessionStorage.setItem(FIGMA_TOKEN_SESSION_KEY, value);
      else window.sessionStorage.removeItem(FIGMA_TOKEN_SESSION_KEY);
    }
  } catch {
    // Storage can be unavailable in hardened or private browsing modes.
  }
  for (const listener of tokenListeners) listener();
}

function createRequestId(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
}

interface ElementorTemplate {
  title: string;
  type: "page";
  version: "0.4";
  page_settings: Record<string, unknown>;
  content: unknown[];
}

interface ConversionResult {
  blueprint: {
    pages: Array<{ title: string; slug: string }>;
  };
  pageContent: string;
  elementorTemplate: ElementorTemplate;
  previewHtml: string;
  qualityReport: {
    version: "1.0";
    score: number;
    grade: "A" | "B" | "C";
    readyForDraft: boolean;
    metrics: {
      responsiveVariants: 1 | 2;
      visibleNodes: number;
      boundedNodes: number;
      editableTextNodes: number;
      autoLayoutFrames: number;
      mappedAutoLayoutFrames: number;
      absoluteLayoutNodes: number;
      typography: {
        horizontalTextNodes: number;
        wrappingTextNodes: number;
        explicitLineBreakTextNodes: number;
        mixedStyleTextNodes: number;
        truncatedTextNodes: number;
      };
      functionalWidgets: {
        navigation: number;
        contactForm: number;
        accordion: number;
      };
    };
    checks: Array<{
      id: string;
      label: string;
      status: "pass" | "info" | "warning";
      detail: string;
    }>;
  } | null;
  themeJson: unknown;
  warnings: string[];
  summary: {
    pageTitle: string;
    sectionCount: number;
    sectionTypes: string[];
  };
  visualReferences: {
    desktop?: VisualQaReference;
    mobile?: VisualQaReference;
  };
}

interface WordPressResult {
  id: number;
  slug: string;
  status: string;
  editLink?: string;
  previewLink?: string;
  target?: OutputTarget;
  importedMedia?: number;
  warnings?: string[];
}

interface WordPressStatus {
  authenticated: true;
  user: { id: number; name: string };
  connectorInstalled: boolean;
  connectorVersion?: string;
  wordpressVersion?: string;
  elementor: { active: boolean; version?: string };
  functionalWidgets?: {
    navigation: boolean;
    contactForm: boolean;
    accordion: boolean;
  };
  canEditPages: boolean;
}

const sectionLabels: Record<string, string> = {
  "section/hero": "ヒーロー",
  "section/service": "サービス",
  "section/features": "特徴",
  "section/faq": "FAQ",
  "section/cta": "CTA",
  "section/contact": "お問い合わせ",
};

async function readApi<T>(response: Response): Promise<T> {
  const data = (await response.json()) as { ok?: boolean; error?: string } & T;
  if (!response.ok || data.ok === false) {
    throw new Error(data.error || "処理に失敗しました。");
  }
  return data;
}

function downloadText(filename: string, value: string, type: string) {
  const url = URL.createObjectURL(new Blob([value], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

function previewDocument(content: string): string {
  return `<!doctype html>
<html lang="ja"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src 'self' https: data:; style-src 'unsafe-inline';">
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
*{box-sizing:border-box}body{margin:0;background:#f5f3ed;color:#13212a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;line-height:1.65}
section{padding:64px clamp(24px,7vw,88px);max-width:1100px;margin:0 auto}h1,h2,h3{line-height:1.13;letter-spacing:-.035em}h1{font-size:clamp(36px,7vw,72px);margin:0 0 20px}h2{font-size:clamp(28px,5vw,48px);margin:0 0 28px}h3{font-size:20px}p{color:#53636c}a{display:inline-block;background:#c8ff61;color:#102029;text-decoration:none;font-weight:750;padding:13px 20px;border-radius:999px}
.wp-block-figmapress-hero{display:grid;grid-template-columns:1fr;align-items:center;gap:48px;min-height:520px}.wp-block-figmapress-hero[data-layout="text-left-image-right"]{grid-template-columns:1.15fr .85fr}.wp-block-figmapress-hero__image img{width:100%;border-radius:24px}.wp-block-figmapress-service-list,.wp-block-figmapress-faq{background:#fff}.wp-block-figmapress-card-grid__items,.wp-block-figmapress-service-list__items{list-style:none;padding:0;display:grid;grid-template-columns:repeat(3,1fr);gap:16px}.wp-block-figmapress-card-grid__item,.wp-block-figmapress-service-list__item{padding:24px;background:#fff;border:1px solid #dbe1df;border-radius:18px}.wp-block-figmapress-faq__items dt{font-weight:750;margin-top:20px}.wp-block-figmapress-faq__items dd{margin:6px 0 0;color:#53636c}.wp-block-figmapress-cta{text-align:center;background:#112832;color:#fff;border-radius:28px}.wp-block-figmapress-cta h2{color:#fff}.wp-block-figmapress-contact{text-align:center}
.figmapress-figma-preview{container-type:inline-size;overflow:hidden;position:relative;width:100%}.figmapress-figma-preview *{box-sizing:border-box;margin:0;max-width:none}.figmapress-figma-preview img{display:block}.figmapress-figma-preview--mobile{display:none}
@media(max-width:767px){section{padding:44px 22px}.wp-block-figmapress-hero{grid-template-columns:1fr;min-height:auto}.wp-block-figmapress-card-grid__items,.wp-block-figmapress-service-list__items{grid-template-columns:1fr}.figmapress-figma-preview--desktop{display:none}.figmapress-figma-preview--mobile{display:block}}
</style></head><body>${content}</body></html>`;
}

export function ConverterApp({ sampleJson }: { sampleJson: string }) {
  const [mode, setMode] = useState<SourceMode>("figma");
  const [fileKeyOrUrl, setFileKeyOrUrl] = useState("");
  const figmaToken = useSyncExternalStore(
    subscribeSessionFigmaToken,
    readSessionFigmaToken,
    () => "",
  );
  const persistFigmaToken = useSyncExternalStore(
    subscribeSessionFigmaToken,
    readPersistentTokenFlag,
    () => false,
  );
  const [jsonText, setJsonText] = useState(sampleJson);
  const [output, setOutput] = useState<ConversionResult | null>(null);
  const [converting, setConverting] = useState(false);
  const [error, setError] = useState("");
  const [wpBusy, setWpBusy] = useState(false);
  const [wpChecking, setWpChecking] = useState(false);
  const [wpError, setWpError] = useState("");
  const [wpResult, setWpResult] = useState<WordPressResult | null>(null);
  const [wpStatus, setWpStatus] = useState<WordPressStatus | null>(null);
  const [wpTransport, setWpTransport] = useState<"direct" | "proxy" | null>(null);
  const [wpTarget, setWpTarget] = useState<OutputTarget>("elementor");
  const [visualQaBusy, setVisualQaBusy] = useState(false);
  const [visualQaError, setVisualQaError] = useState("");
  const [visualQaResults, setVisualQaResults] = useState<VisualQaBrowserResult[]>([]);
  const [visualQaAcknowledged, setVisualQaAcknowledged] = useState(false);
  const [draftRequestId, setDraftRequestId] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [username, setUsername] = useState("");
  const [applicationPassword, setApplicationPassword] = useState("");
  const [confirmed, setConfirmed] = useState(false);

  const srcDoc = output ? previewDocument(output.previewHtml) : "";
  const connectorSupportsInteractions = wpStatus?.functionalWidgets
    ? Object.values(wpStatus.functionalWidgets).every(Boolean)
    : versionAtLeast(wpStatus?.connectorVersion, FUNCTIONAL_WIDGETS_CONNECTOR_VERSION);
  const visualQaReferenceCount = output
    ? Number(Boolean(output.visualReferences.desktop)) +
      Number(Boolean(output.visualReferences.mobile))
    : 0;
  const visualQaGate = resolveVisualQaDraftGate({
    enabled: wpTarget === "elementor",
    referenceCount: visualQaReferenceCount,
    resultStatuses: visualQaResults.map((result) => result.status),
    busy: visualQaBusy,
    error: Boolean(visualQaError),
    acknowledged: visualQaAcknowledged,
  });
  const visualQaComplete = visualQaGate.complete;
  const visualQaHasFailure = visualQaGate.hasFailure;
  const visualQaGateRequired = visualQaGate.state !== "off";
  const visualQaBlocksDraft = visualQaGate.blocksDraft;

  function updateFigmaToken(value: string) {
    writeFigmaToken(value);
  }

  function updateFigmaTokenPersistence(persistent: boolean) {
    writeFigmaToken(figmaToken, persistent);
  }

  async function convert(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setConverting(true);
    setError("");
    setOutput(null);
    setWpResult(null);
    setVisualQaError("");
    setVisualQaResults([]);
    setVisualQaAcknowledged(false);

    try {
      let body: Record<string, unknown>;
      if (mode === "figma") {
        body = { mode, fileKeyOrUrl, token: figmaToken };
      } else {
        let data: unknown;
        try {
          data = JSON.parse(jsonText) as unknown;
        } catch {
          throw new Error("貼り付けたJSONの形式を確認してください。");
        }
        body = { mode, data };
      }

      const response = await fetch("/api/convert", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await readApi<{ ok: true } & ConversionResult>(response);
      setOutput(data);
      setDraftRequestId(createRequestId());
      requestAnimationFrame(() => {
        document.getElementById("result")?.scrollIntoView({ behavior: "smooth" });
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "変換に失敗しました。");
    } finally {
      setConverting(false);
    }
  }

  function loadJsonFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (file.size > 1_400_000) {
      setError("JSONファイルは1.4MB以下にしてください。");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setJsonText(String(reader.result ?? ""));
    reader.onerror = () => setError("JSONファイルを読み込めませんでした。");
    reader.readAsText(file);
  }

  async function createWordPressDraft(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!output || !confirmed) return;
    if (visualQaBlocksDraft) {
      setWpError(
        !visualQaComplete
          ? "Elementor下書きの前にFigma視覚差分を測定してください。"
          : "重大な視覚差分の確認チェックを入れてから下書きを作成してください。",
      );
      return;
    }
    const credentials = readWordPressCredentials(new FormData(event.currentTarget), {
      baseUrl,
      username,
      applicationPassword,
    });
    setWpBusy(true);
    setWpError("");
    setWpResult(null);

    try {
      const page = output.blueprint.pages[0];
      const requestId = draftRequestId || createRequestId();
      if (!draftRequestId) setDraftRequestId(requestId);
      const payload = wpTarget === "elementor"
        ? {
            target: wpTarget,
            ...credentials,
            title: page?.title || output.summary.pageTitle,
            slug: page?.slug || "/",
            template: output.elementorTemplate,
            pageTemplate: "elementor_canvas",
            requestId,
          }
        : {
            target: wpTarget,
            ...credentials,
            title: page?.title || output.summary.pageTitle,
            slug: page?.slug || "/",
            content: output.pageContent,
          };
      if (wpTransport === "direct") {
        const result = await createWordPressDraftDirect(
          credentials,
          wpTarget === "elementor"
            ? {
                target: "elementor",
                title: payload.title,
                slug: payload.slug,
                template: output.elementorTemplate,
                pageTemplate: "elementor_canvas",
                requestId,
              }
            : {
                target: "gutenberg",
                title: payload.title,
                slug: payload.slug,
                content: output.pageContent,
              },
        );
        setWpResult(result);
      } else {
        const response = await fetch("/api/wordpress", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const data = await readApi<{ ok: true; result: WordPressResult }>(response);
        setWpResult(data.result);
      }
      setApplicationPassword("");
    } catch (caught) {
      setWpError(caught instanceof Error ? caught.message : "下書きを作成できませんでした。");
    } finally {
      setWpBusy(false);
    }
  }

  async function checkWordPressConnection(event: MouseEvent<HTMLButtonElement>) {
    const credentials = readWordPressCredentials(
      event.currentTarget.form ? new FormData(event.currentTarget.form) : null,
      {
        baseUrl,
        username,
        applicationPassword,
      },
    );
    setBaseUrl(credentials.baseUrl);
    setUsername(credentials.username);
    setApplicationPassword(credentials.applicationPassword);
    setWpChecking(true);
    setWpError("");
    setWpStatus(null);
    setWpTransport(null);
    try {
      try {
        const status = await probeWordPressDirect(credentials);
        setWpStatus(status);
        setWpTransport("direct");
      } catch (directError) {
        if (!(directError instanceof WordPressDirectError) || directError.kind !== "network") {
          throw directError;
        }
        const response = await fetch("/api/wordpress/status", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(credentials),
        });
        const data = await readApi<{ ok: true; status: WordPressStatus }>(response);
        setWpStatus(data.status);
        setWpTransport("proxy");
      }
    } catch (caught) {
      setWpError(caught instanceof Error ? caught.message : "接続診断に失敗しました。");
    } finally {
      setWpChecking(false);
    }
  }

  async function checkVisualQuality() {
    if (!output) return;
    const references = (
      [
        ["desktop", output.visualReferences.desktop],
        ["mobile", output.visualReferences.mobile],
      ] as const
    ).filter(
      (entry): entry is readonly ["desktop" | "mobile", VisualQaReference] =>
        Boolean(entry[1]),
    );
    if (!references.length) {
      setVisualQaError("Figma基準画像がありません。Figmaからもう一度変換してください。");
      return;
    }

    setVisualQaBusy(true);
    setVisualQaError("");
    setVisualQaResults([]);
    setVisualQaAcknowledged(false);
    try {
      const results: VisualQaBrowserResult[] = [];
      for (const [variant, reference] of references) {
        results.push(await runVisualQa(reference, srcDoc, variant));
        setVisualQaResults([...results]);
      }
    } catch (caught) {
      setVisualQaError(
        caught instanceof Error
          ? caught.message
          : "画像比較を完了できませんでした。",
      );
    } finally {
      setVisualQaBusy(false);
    }
  }

  return (
    <main>
      <header className="site-header">
        <a className="brand" href="#top" aria-label="FigmaPress トップへ">
          <span className="brand__mark" aria-hidden="true">F</span>
          <span>FigmaPress</span>
        </a>
        <nav aria-label="ページ内ナビゲーション">
          <a href="#convert">変換する</a>
          <a href="#setup">導入方法</a>
          <span className="status-pill"><i /> v0.11.0 live</span>
        </nav>
      </header>

      <section className="hero" id="top">
        <div className="hero__copy">
          <span className="eyebrow">Design → editable blocks</span>
          <h1>デザインを、<br /><em>編集できる</em>サイトに。</h1>
          <p>
            Figmaの構造を読み取り、WordPressで扱えるGutenbergブロックまたはElementorページへ変換。
            コードを書かずに、下書きページまで作成できます。
          </p>
          <div className="hero__actions">
            <a className="button button--primary" href="#convert">無料で変換する <span>↘</span></a>
            <button
              className="text-button"
              type="button"
              onClick={() => {
                setMode("json");
                document.getElementById("convert")?.scrollIntoView({ behavior: "smooth" });
              }}
            >
              サンプルで試す
            </button>
          </div>
          <div className="trust-row">
            <span>✓ サーバーに認証情報を保存しない</span>
            <span>✓ 下書きのみ作成</span>
            <span>✓ 無料・登録不要</span>
          </div>
        </div>
        <div className="hero__visual" aria-hidden="true">
          <div className="visual-orbit visual-orbit--one" />
          <div className="visual-orbit visual-orbit--two" />
          <div className="flow-card flow-card--figma">
            <span className="flow-card__icon">◆</span>
            <div><small>SOURCE</small><strong>Figma design</strong></div>
          </div>
          <div className="flow-line"><span /><span /><span /></div>
          <div className="flow-card flow-card--blueprint">
            <span className="flow-card__icon">⌘</span>
            <div><small>STRUCTURE</small><strong>Site Blueprint</strong></div>
          </div>
          <div className="flow-line"><span /><span /><span /></div>
          <div className="flow-card flow-card--wp">
            <span className="flow-card__icon">W</span>
            <div><small>OUTPUT</small><strong>WordPress draft</strong></div>
          </div>
          <div className="visual-note">2 editable targets <b>ready</b></div>
        </div>
      </section>

      <section className="converter-section" id="convert">
        <div className="section-heading">
          <span className="step-number">01</span>
          <div>
            <span className="eyebrow">Converter</span>
            <h2>変換元を選ぶ</h2>
            <p>Figmaファイルを直接読み込むか、JSONを貼り付けて開始します。</p>
          </div>
        </div>

        <div className="workspace-card">
          <div className="source-tabs" role="tablist" aria-label="変換元">
            <button
              aria-selected={mode === "figma"}
              aria-controls="source-panel"
              className={mode === "figma" ? "is-active" : ""}
              onClick={() => setMode("figma")}
              role="tab"
              type="button"
            >
              <span>◆</span> Figmaから読み込む
            </button>
            <button
              aria-selected={mode === "json"}
              aria-controls="source-panel"
              className={mode === "json" ? "is-active" : ""}
              onClick={() => setMode("json")}
              role="tab"
              type="button"
            >
              <span>{"{ }"}</span> JSONを使う
            </button>
          </div>

          <form className="source-form" id="source-panel" onSubmit={convert} role="tabpanel">
            {mode === "figma" ? (
              <div className="form-grid">
                <label className="field field--wide">
                  <span>FigmaファイルURL またはファイルキー</span>
                  <input
                    autoComplete="off"
                    onChange={(event) => setFileKeyOrUrl(event.target.value)}
                    placeholder="https://www.figma.com/design/…"
                    required
                    value={fileKeyOrUrl}
                  />
                </label>
                <div className="field field--wide">
                  <label htmlFor="figma-personal-access-token">Figma Personal Access Token</label>
                  <div className="token-input-row">
                    <input
                      autoComplete="off"
                      id="figma-personal-access-token"
                      onChange={(event) => updateFigmaToken(event.target.value)}
                      placeholder="figd_…"
                      required
                      type="password"
                      value={figmaToken}
                    />
                    {figmaToken && (
                      <button onClick={() => updateFigmaToken("")} type="button">消去</button>
                    )}
                  </div>
                  <small>
                    file_content:read 権限が必要です。標準ではこのタブ内だけに保持します。
                  </small>
                  <label className="token-persistence">
                    <input
                      checked={persistFigmaToken}
                      onChange={(event) => updateFigmaTokenPersistence(event.target.checked)}
                      type="checkbox"
                    />
                    <span>このブラウザに保存する（共有端末ではオフ）</span>
                  </label>
                </div>
              </div>
            ) : (
              <div className="json-field">
                <div className="json-field__head">
                  <label htmlFor="figma-json">Figma JSON</label>
                  <label className="file-button">
                    JSONファイルを選択
                    <input accept=".json,application/json" onChange={loadJsonFile} type="file" />
                  </label>
                </div>
                <textarea
                  id="figma-json"
                  onChange={(event) => setJsonText(event.target.value)}
                  spellCheck={false}
                  value={jsonText}
                />
              </div>
            )}

            <details className="naming-guide">
              <summary>対応するFigmaレイヤー名を確認</summary>
              <p>
                Elementor高忠実度変換では、一般的なHeader/Menu-Item、フォーム項目、FAQ・年表を自動検出します。
                他のデザインでは <code>{"{wp:nav}"}</code>、<code>{"{wp:form}"}</code>、<code>{"{wp:accordion}"}</code> の明示名も利用できます。
                同じページに <code>PC-page</code> と <code>SP-page</code> を置くと、端末別レイアウトとして自動統合します。
                特定フレームの「選択範囲へのリンク」を貼り付けてください。
                Gutenberg専用ブロックでは <code>section/hero</code> などの意味レイヤー名を利用します。
              </p>
            </details>

            {error && <div className="alert alert--error" role="alert">{error}</div>}
            <div className="form-footer">
              <p><span className="lock">⌁</span> サーバー保存なし。標準はタブ内、選択時のみこのブラウザに保持します。</p>
              <button className="button button--primary button--submit" disabled={converting} type="submit">
                {converting ? <><span className="spinner" /> 変換中…</> : <>WordPress用に変換 <span>→</span></>}
              </button>
            </div>
          </form>
        </div>
      </section>

      {output && (
        <section className="result-section" id="result">
          <div className="section-heading">
            <span className="step-number step-number--success">✓</span>
            <div>
              <span className="eyebrow">Conversion complete</span>
              <h2>変換できました</h2>
              <p>{output.summary.pageTitle} — {output.summary.sectionCount}セクションを生成しました。</p>
            </div>
          </div>

          <div className="result-grid">
            <div className="preview-card">
              <div className="card-bar">
                <span>ページプレビュー</span>
                <div className="browser-dots"><i /><i /><i /></div>
              </div>
              <iframe sandbox="" srcDoc={srcDoc} title="生成ページのプレビュー" />
            </div>
            <aside className="output-card">
              <span className="eyebrow">Generated</span>
              <h3>{output.summary.sectionCount} sections</h3>
              <div className="section-tags">
                {output.summary.sectionTypes.map((type) => (
                  <span key={type}>{sectionLabels[type] || type}</span>
                ))}
              </div>
              {output.qualityReport && (
                <div className="quality-report">
                  <div className="quality-report__score">
                    <strong>{output.qualityReport.score}</strong>
                    <span>
                      <b>構造診断 {output.qualityReport.grade}</b>
                      <small>{output.qualityReport.readyForDraft ? "下書き作成可能" : "要確認"}</small>
                    </span>
                  </div>
                  <div className="quality-report__checks">
                    {output.qualityReport.checks.map((check) => (
                      <p className={`is-${check.status}`} key={check.id}>
                        <i aria-hidden="true">{check.status === "pass" ? "✓" : check.status === "warning" ? "!" : "i"}</i>
                        <span><b>{check.label}</b><small>{check.detail}</small></span>
                      </p>
                    ))}
                  </div>
                </div>
              )}
              {(output.visualReferences.desktop || output.visualReferences.mobile) && (
                <div className="visual-qa-launch">
                  <strong>Visual QA</strong>
                  <p>FigmaのPC/SP基準画像と生成ページを画素単位で比較します。</p>
                  <button
                    disabled={visualQaBusy}
                    onClick={checkVisualQuality}
                    type="button"
                  >
                    {visualQaBusy ? <><span className="spinner" /> 比較中…</> : "視覚差分を測定"}
                  </button>
                </div>
              )}
              {output.warnings.length > 0 && (
                <div className="warning-list">
                  <strong>確認事項</strong>
                  {output.warnings.map((warning) => <p key={warning}>• {warning}</p>)}
                </div>
              )}
              <div className="download-list">
                <button onClick={() => downloadText("site.blueprint.json", JSON.stringify(output.blueprint, null, 2), "application/json")} type="button">
                  <span>Site Blueprint</span><b>JSON ↓</b>
                </button>
                <button onClick={() => downloadText("page-content.html", output.pageContent, "text/html")} type="button">
                  <span>Gutenberg Blocks</span><b>HTML ↓</b>
                </button>
                <button onClick={() => downloadText("elementor-template.json", JSON.stringify(output.elementorTemplate, null, 2), "application/json")} type="button">
                  <span>Elementor Template</span><b>JSON ↓</b>
                </button>
                {output.qualityReport && (
                  <button onClick={() => downloadText("quality-report.json", JSON.stringify(output.qualityReport, null, 2), "application/json")} type="button">
                    <span>Quality Report</span><b>JSON ↓</b>
                  </button>
                )}
                <button onClick={() => downloadText("theme.json", JSON.stringify(output.themeJson, null, 2), "application/json")} type="button">
                  <span>WordPress Theme</span><b>JSON ↓</b>
                </button>
              </div>
            </aside>
          </div>

          {(output.visualReferences.desktop || output.visualReferences.mobile) && (
            <div className="visual-qa-card">
              <div className="visual-qa-card__head">
                <div>
                  <span className="eyebrow">Pixel comparison</span>
                  <h3>Figma視覚差分レポート</h3>
                  <p>
                    赤い箇所ほどFigmaとの差が大きい領域です。位置・色・画像・文字折り返しをPC/SP別、セクション別、文字要素別に実測します。
                  </p>
                </div>
                {visualQaResults.length > 0 && (
                  <button
                    onClick={() => downloadText(
                      "visual-quality-report.json",
                      JSON.stringify(
                        visualQaResults.map((result) =>
                          Object.fromEntries(
                            Object.entries(result).filter(([key]) => key !== "diffImageUrl"),
                          ),
                        ),
                        null,
                        2,
                      ),
                      "application/json",
                    )}
                    type="button"
                  >
                    レポートJSON ↓
                  </button>
                )}
              </div>
              {visualQaError && (
                <div className="alert alert--error" role="alert">{visualQaError}</div>
              )}
              {visualQaBusy && visualQaResults.length === 0 && (
                <div className="visual-qa-progress" role="status">
                  <span className="spinner" /> 長いページを縮小して比較しています…
                </div>
              )}
              {visualQaResults.length > 0 && (
                <div className="visual-qa-results">
                  {visualQaResults.map((result) => (
                    <article
                      className={`visual-qa-result is-${result.status}`}
                      key={result.variant}
                    >
                      <div className="visual-qa-result__score">
                        <strong>{result.score}</strong>
                        <span>
                          <b>{result.variant === "desktop" ? "PC" : "スマホ"}</b>
                          <small>
                            {result.status === "pass"
                              ? "視覚品質 良好"
                              : result.status === "review"
                                ? "要微調整"
                                : "要改善"}
                          </small>
                        </span>
                      </div>
                      <dl className="visual-qa-metrics">
                        <div><dt>差分面積</dt><dd>{result.changedPixelRatio}%</dd></div>
                        <div><dt>平均色差</dt><dd>{result.meanColorError}</dd></div>
                        <div><dt>全体高差</dt><dd>{result.heightDifferenceRatio > 0 ? "+" : ""}{result.heightDifferenceRatio}%</dd></div>
                        <div><dt>測定寸法</dt><dd>{result.width}×{result.height}</dd></div>
                      </dl>
                      {(result.status !== "pass" || result.alignment.safeToApply) && (
                        <div className={`visual-qa-alignment ${result.alignment.safeToApply ? "is-safe" : "is-guarded"}`}>
                          <div>
                            <strong>
                              {result.alignment.safeToApply
                                ? "全体位置の補正候補"
                                : "一括位置補正は見送り"}
                            </strong>
                            <span>
                              {result.alignment.confidence === "high"
                                ? "確度 高"
                                : result.alignment.confidence === "medium"
                                  ? "確度 中"
                                  : "確度 低"}
                            </span>
                          </div>
                          {result.alignment.safeToApply && (
                            <dl>
                              <div><dt>X</dt><dd>{result.alignment.offsetX >= 0 ? "+" : ""}{result.alignment.offsetX}px</dd></div>
                              <div><dt>Y</dt><dd>{result.alignment.offsetY >= 0 ? "+" : ""}{result.alignment.offsetY}px</dd></div>
                              <div><dt>誤差削減見込</dt><dd>{result.alignment.errorReductionRatio}%</dd></div>
                            </dl>
                          )}
                          <p>{result.alignment.reason}</p>
                          {result.alignment.safeToApply && (
                            <small>PC/SPを別々に判定した非破壊の補正候補です。値はレポートJSONにも保存されます。</small>
                          )}
                        </div>
                      )}
                      {result.hotspots.length > 0 && (
                        <div className="visual-qa-hotspots">
                          <strong>差分集中箇所</strong>
                          {result.hotspots.map((hotspot) => (
                            <p key={`${hotspot.startPercent}-${hotspot.endPercent}`}>
                              <span>{hotspot.label}</span>
                              <b>{hotspot.changedPixelRatio}%</b>
                            </p>
                          ))}
                        </div>
                      )}
                      {(result.sections.length > 0 || result.textNodes.length > 0) && (
                        <div className="visual-qa-regions">
                          {result.sections.some((region) => region.changedPixelRatio > 0) && (
                            <section>
                              <strong>セクション別の差分影響</strong>
                              {result.sections
                                .filter((region) => region.changedPixelRatio > 0)
                                .slice(0, 4)
                                .map((region) => (
                                  <p key={region.nodeId}>
                                    <span>
                                      <b>{region.name}</b>
                                      <small>領域内差分 {region.changedPixelRatio}%</small>
                                    </span>
                                    <em>全体影響 {region.impactRatio}%</em>
                                  </p>
                                ))}
                            </section>
                          )}
                          {result.textNodes.some((region) => region.changedPixelRatio > 0) && (
                            <section>
                              <strong>文字要素別の差分影響</strong>
                              {result.textNodes
                                .filter((region) => region.changedPixelRatio > 0)
                                .slice(0, 5)
                                .map((region) => (
                                  <p key={region.nodeId}>
                                    <span>
                                      <b>{region.name}</b>
                                      <small>文字領域差分 {region.changedPixelRatio}%</small>
                                    </span>
                                    <em>全体影響 {region.impactRatio}%</em>
                                  </p>
                                ))}
                            </section>
                          )}
                        </div>
                      )}
                      <ul className="visual-qa-recommendations">
                        {result.recommendations.map((recommendation) => (
                          <li key={recommendation}>{recommendation}</li>
                        ))}
                      </ul>
                      <details className="visual-qa-diff">
                        <summary>差分ヒートマップを見る</summary>
                        {/* Generated in-browser as a data URL; Next Image cannot optimize it. */}
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          alt={`${result.variant === "desktop" ? "PC" : "スマホ"}版の視覚差分ヒートマップ`}
                          loading="lazy"
                          src={result.diffImageUrl}
                        />
                      </details>
                    </article>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="wordpress-card">
            <div className="wordpress-card__intro">
              <span className="wp-mark">W</span>
              <div>
                <span className="eyebrow">Publish to WordPress</span>
                <h3>下書きページを作成</h3>
                <p>GutenbergまたはElementorを選び、公開せず下書きとして送信します。</p>
              </div>
            </div>
            <form onSubmit={createWordPressDraft}>
              <fieldset className="target-picker">
                <legend>編集方式</legend>
                <label className={wpTarget === "gutenberg" ? "is-active" : ""}>
                  <input checked={wpTarget === "gutenberg"} name="target" onChange={() => setWpTarget("gutenberg")} type="radio" />
                  <span><strong>Gutenberg</strong><small>6種の意味ブロックへ簡易変換</small></span>
                </label>
                <label className={wpTarget === "elementor" ? "is-active" : ""}>
                  <input checked={wpTarget === "elementor"} name="target" onChange={() => setWpTarget("elementor")} type="radio" />
                  <span><strong>Elementor（推奨）</strong><small>Figmaレイアウト・文字・画像を保持</small></span>
                </label>
              </fieldset>
              <div className="form-grid form-grid--three">
                <label className="field">
                  <span>WordPress URL</span>
                  <input name="baseUrl" onChange={(event) => { setBaseUrl(event.target.value); setWpStatus(null); setWpTransport(null); }} placeholder="https://example.com" required type="url" value={baseUrl} />
                </label>
                <label className="field">
                  <span>ユーザー名</span>
                  <input autoComplete="username" name="username" onChange={(event) => { setUsername(event.target.value); setWpStatus(null); setWpTransport(null); }} required value={username} />
                </label>
                <label className="field">
                  <span>Application Password</span>
                  <input autoComplete="current-password" name="applicationPassword" onChange={(event) => { setApplicationPassword(event.target.value); setWpStatus(null); setWpTransport(null); }} required type="password" value={applicationPassword} />
                </label>
              </div>
              <div className="connection-row">
                <button className="connection-button" disabled={wpChecking || !baseUrl || !username || applicationPassword.length < 8} onClick={checkWordPressConnection} type="button">
                  {wpChecking ? "診断中…" : "接続を診断"}
                </button>
                {wpStatus && (
                  <div className="connection-status" role="status">
                    <strong>✓ {wpStatus.user.name} として認証</strong>
                    <span>WP {wpStatus.wordpressVersion || "確認済み"}</span>
                    <span>Connector {wpStatus.connectorInstalled ? `v${wpStatus.connectorVersion || "installed"}` : "未導入"}</span>
                    <span>Elementor {wpStatus.elementor.active ? `v${wpStatus.elementor.version || "active"}` : "未導入"}</span>
                    {wpStatus.functionalWidgets && (
                      <span>機能Widget {Object.values(wpStatus.functionalWidgets).filter(Boolean).length}/3</span>
                    )}
                    <span>{wpTransport === "direct" ? "ブラウザ直結" : "サーバー経由"}</span>
                  </div>
                )}
              </div>
              {wpStatus && !wpStatus.connectorInstalled && (
                <div className="alert alert--error" role="alert">Connectorプラグインをインストールしてから再診断してください。</div>
              )}
              {wpStatus && wpTarget === "elementor" && !wpStatus.elementor.active && (
                <div className="alert alert--error" role="alert">このサイトではElementorが有効化されていません。</div>
              )}
              {wpStatus && wpTarget === "elementor" && wpStatus.connectorInstalled && !connectorSupportsInteractions && (
                <div className="alert alert--error" role="alert">
                  メニュー・フォーム・アコーディオンを動作させるにはConnector v{FUNCTIONAL_WIDGETS_CONNECTOR_VERSION}以上が必要です。<a href="/downloads/figmapress-connector.zip" download>最新版ZIPをダウンロード</a>し、WordPressの「プラグインを追加 → プラグインのアップロード」から一度だけ更新してください。
                </div>
              )}
              {visualQaGateRequired && !visualQaComplete && (
                <div className="visual-qa-gate is-pending" role="status">
                  <div>
                    <strong>Elementor下書き前の視覚確認が必要です</strong>
                    <span>FigmaのPC/SP基準画像と生成結果を比較してから送信します。</span>
                  </div>
                  <button disabled={visualQaBusy} onClick={checkVisualQuality} type="button">
                    {visualQaBusy ? "比較中…" : "視覚差分を測定"}
                  </button>
                </div>
              )}
              {visualQaGateRequired && visualQaComplete && !visualQaHasFailure && (
                <div className="visual-qa-gate is-clear" role="status">
                  <div>
                    <strong>✓ 視覚品質チェック完了</strong>
                    <span>PC/SPの重大差分は検出されていません。</span>
                  </div>
                </div>
              )}
              {visualQaGateRequired && visualQaComplete && visualQaHasFailure && (
                <label className="visual-qa-gate is-warning">
                  <input
                    checked={visualQaAcknowledged}
                    onChange={(event) => setVisualQaAcknowledged(event.target.checked)}
                    type="checkbox"
                  />
                  <span>
                    <strong>重大な視覚差分を確認しました</strong>
                    <small>差分レポートを確認したうえで、調整用のElementor下書きを作成します。</small>
                  </span>
                </label>
              )}
              <label className="consent">
                <input checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} type="checkbox" />
                <span>認証情報がこの処理のためだけに一時利用され、保存されないことを確認しました。</span>
              </label>
              {wpError && <div className="alert alert--error" role="alert">{wpError}</div>}
              {wpResult && (
                <div className="alert alert--success" role="status">
                  下書き #{wpResult.id} を作成しました。
                  {wpResult.editLink && <a href={wpResult.editLink} rel="noreferrer" target="_blank"> WordPressで編集 ↗</a>}
                  {typeof wpResult.importedMedia === "number" && <span>（画像 {wpResult.importedMedia}件を保存）</span>}
                  {wpResult.warnings?.map((warning) => <span key={warning}> {warning}</span>)}
                </div>
              )}
              <div className="wp-footer">
                <span>常に <code>status: draft</code></span>
                <button
                  className="button button--dark"
                  disabled={!confirmed || wpBusy || visualQaBlocksDraft || !wpStatus || !wpStatus.connectorInstalled || !wpStatus.canEditPages || (wpTarget === "elementor" && (!wpStatus.elementor.active || !connectorSupportsInteractions))}
                  type="submit"
                >
                  {wpBusy ? "作成中…" : `${wpTarget === "elementor" ? "Elementor" : "Gutenberg"}下書きを作成 →`}
                </button>
              </div>
            </form>
          </div>
        </section>
      )}

      <section className="setup-section" id="setup">
        <div className="section-heading section-heading--light">
          <span className="step-number">02</span>
          <div>
            <span className="eyebrow">One-time setup</span>
            <h2>WordPressに導入</h2>
            <p>WordPressサイトごとに初回だけインストールします。以後は管理画面の通常更新で完了します。</p>
          </div>
        </div>
        <div className="setup-grid">
          <article>
            <span className="setup-icon">01</span>
            <h3>Connectorを追加</h3>
            <p>専用ブロックと安全なElementor接続REST APIを追加します。</p>
            <a href="/downloads/figmapress-connector.zip" download>Plugin ZIPをダウンロード ↓</a>
          </article>
          <article>
            <span className="setup-icon">02</span>
            <h3>必要機能を有効化</h3>
            <p>Connectorを有効化。Elementor出力ではElementor本体も有効化します。以後XServer操作は不要です。</p>
          </article>
          <article>
            <span className="setup-icon">03</span>
            <h3>変換して下書き作成</h3>
            <p>このページに戻り、WordPress接続情報を入力して送信します。</p>
            <a href="/downloads/figmapress-block-theme.zip" download>Theme ZIP（任意）をダウンロード ↓</a>
          </article>
        </div>
      </section>

      <section className="scope-strip">
        <div><span>READY</span><strong>Gutenberg blocks</strong><p>編集可能な6セクション</p></div>
        <div><span>READY</span><strong>Elementor documents</strong><p>機能Widget化・画像永続化</p></div>
        <div><span>SECURITY</span><strong>Local-only token</strong><p>サーバー保存なし・ブラウザ保存を選択可能</p></div>
      </section>

      <footer>
        <div className="brand brand--footer"><span className="brand__mark">F</span><span>FigmaPress</span></div>
        <p>Figmaから、運用できるWordPressへ。</p>
        <div><a href="#convert">変換する</a><a href="#setup">導入方法</a><a href="/privacy">プライバシー</a><a href="/security">セキュリティ</a><span>v0.11.0</span></div>
      </footer>
    </main>
  );
}
