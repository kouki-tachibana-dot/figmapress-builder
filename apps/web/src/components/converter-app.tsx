"use client";

import { useEffect, useState, useSyncExternalStore, type ChangeEvent, type FormEvent, type MouseEvent } from "react";
import {
  applyElementorDecorationGeometryCorrections,
  applyElementorMediaGeometryCorrections,
  applyElementorSectionVisualCorrections,
  applyElementorTextGeometryCorrections,
  applyElementorVisualCorrections,
  applyPreviewDecorationGeometryCorrections,
  applyPreviewMediaGeometryCorrections,
  applyPreviewSectionVisualCorrections,
  applyPreviewTextGeometryCorrections,
  applyPreviewVisualCorrections,
  type ElementorDecorationGeometryCorrection,
  type ElementorMediaGeometryCorrection,
  type ElementorSectionVisualCorrection,
  type ElementorTemplate,
  type ElementorTextGeometryCorrection,
  type ElementorVisualCorrection,
} from "@figmapress/elementor-renderer";
import {
  WordPressDirectError,
  createWordPressDraftChunkedDirect,
  createWordPressDraftDirect,
  fetchWordPressElementorSnapshotDirect,
  localizeWordPressElementorMediaDirect,
  probeWordPressDirect,
  updateWordPressElementorDocumentDirect,
  type BrowserElementorSnapshot,
  type BrowserElementorMediaProgress,
  type BrowserWordPressConfig,
} from "@/lib/wordpress-browser";
import { readWordPressCredentials } from "@/lib/wordpress-form";
import {
  decodeWordPressPairingFragment,
  pruneWordPressProfiles,
  removeWordPressProfile,
  saveWordPressProfile,
  type WordPressConnectionProfile,
} from "@/lib/wordpress-profile";
import {
  runVisualQa,
  type VisualQaBrowserResult,
  type VisualQaReference,
} from "@/lib/visual-qa-browser";
import {
  resolveVisualQaDraftGate,
  shouldKeepDecorationGeometryCorrections,
  shouldKeepMediaGeometryCorrections,
  shouldKeepSectionVisualCorrections,
  shouldKeepTextGeometryCorrections,
  shouldKeepVisualCorrections,
} from "@/lib/visual-qa";
import { readApi } from "@/lib/api-client";
import { resolveFigmaRequestAuthentication } from "@/lib/figma-client-auth";
import { shouldProxyWordPressDraft } from "@/lib/wordpress-transport";

type SourceMode = "figma" | "json";
type OutputTarget = "gutenberg" | "elementor";

const FIGMA_TOKEN_SESSION_KEY = "figmapress:figma-token";
const FIGMA_TOKEN_LOCAL_KEY = "figmapress:figma-token:persistent";
const FIGMA_TOKEN_PERSIST_KEY = "figmapress:remember-figma-token";
const FUNCTIONAL_WIDGETS_CONNECTOR_VERSION = "0.13.0";
const ACTUAL_VISUAL_QA_CONNECTOR_VERSION = "0.16.0";
const ONE_CLICK_CONNECTOR_VERSION = "0.15.0";
const CHUNKED_UPLOAD_CONNECTOR_VERSION = "0.16.17";
const SMALL_CHUNK_UPLOAD_CONNECTOR_VERSION = "0.16.24";
const FIGMA_HEADER_MEDIA_CONNECTOR_VERSION = "0.16.18";

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

function wordpressPairingAdminUrl(baseUrl: string): string | null {
  try {
    const url = new URL(baseUrl);
    if (url.protocol !== "https:" || url.username || url.password) return null;
    url.pathname = `${url.pathname.replace(/\/+$/, "")}/wp-admin/tools.php`;
    url.search = "?page=figmapress-connection";
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
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

function figmaSourceKey(input: string): string | undefined {
  const value = input.trim();
  let fileKey = "";
  let nodeId = "root";
  if (/^[A-Za-z0-9_-]{6,160}$/.test(value)) {
    fileKey = value;
  } else {
    try {
      const url = new URL(value);
      if (!/(^|\.)figma\.com$/i.test(url.hostname)) return undefined;
      const parts = url.pathname.split("/").filter(Boolean);
      const typeIndex = parts.findIndex((part) =>
        ["design", "file", "proto", "board"].includes(part),
      );
      const candidate = typeIndex >= 0 ? parts[typeIndex + 1] ?? "" : "";
      if (!/^[A-Za-z0-9_-]{6,160}$/.test(candidate)) return undefined;
      fileKey = candidate;
      const rawNodeId = url.searchParams.get("node-id")?.trim() ?? "";
      if (/^[0-9]+(?::|-)[0-9]+$/.test(rawNodeId)) {
        nodeId = rawNodeId.replace("-", ":");
      }
    } catch {
      return undefined;
    }
  }
  return `figma:${fileKey}:${nodeId}`;
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
      images: {
        visible: number;
        mapped: number;
        exactRendered: number;
        nativeFit: number;
        structuredAdjusted: number;
        adjusted: number;
        masks: number;
      };
      gradients: {
        visible: number;
        mapped: number;
        multiStop: number;
      };
      effects: {
        visible: number;
        mapped: number;
        opacityNodes: number;
        shadowEffects: number;
        blurEffects: number;
        multiShadowNodes: number;
      };
      functionalWidgets: {
        navigation: number;
        links: number;
        carousel: number;
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
  savedMedia?: number;
  totalMedia?: number;
  remainingMedia?: number;
  failedMedia?: number;
  mediaComplete?: boolean;
  idempotent?: boolean;
  updated?: boolean;
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
    links?: boolean;
    carousel?: boolean;
    contactForm: boolean;
    accordion: boolean;
  };
  visualQa?: {
    snapshot: boolean;
    documentUpdate: boolean;
    revisions: boolean;
    webfonts?: boolean;
    gradients?: boolean;
    effects?: boolean;
    imageTransforms?: boolean;
    mediaPersistence?: boolean;
  };
  canEditPages: boolean;
  pairing?: {
    supported: boolean;
    active: boolean;
  };
}

interface WordPressVisualCorrectionSummary {
  wholePage: ElementorVisualCorrection[];
  sections: ElementorSectionVisualCorrection[];
  textGeometry: ElementorTextGeometryCorrection[];
  mediaGeometry: ElementorMediaGeometryCorrection[];
  decorationGeometry: ElementorDecorationGeometryCorrection[];
  rolledBack: boolean;
}

interface FigmaOAuthClientStatus {
  configured: boolean;
  connected: boolean;
  expiresAt?: number;
}

async function fetchFigmaOAuthStatus(): Promise<FigmaOAuthClientStatus> {
  const response = await fetch("/api/figma/oauth/status", {
    cache: "no-store",
    credentials: "same-origin",
  });
  if (!response.ok) {
    return { configured: false, connected: false };
  }
  return await response.json() as FigmaOAuthClientStatus;
}

const sectionLabels: Record<string, string> = {
  "section/hero": "ヒーロー",
  "section/service": "サービス",
  "section/features": "特徴",
  "section/faq": "FAQ",
  "section/cta": "CTA",
  "section/contact": "お問い合わせ",
};

function safeVisualCorrections(
  results: VisualQaBrowserResult[],
): ElementorVisualCorrection[] {
  return results.flatMap((result) => {
    if (
      !result.alignment.safeToApply
      || result.alignment.confidence === "low"
    ) {
      return [];
    }
    return [{
      variant: result.variant,
      offsetX: result.alignment.offsetX,
      offsetY: result.alignment.offsetY,
      captureWidth: result.width,
      confidence: result.alignment.confidence,
      errorReductionRatio: result.alignment.errorReductionRatio,
    }];
  });
}

function safeSectionVisualCorrections(
  results: VisualQaBrowserResult[],
): ElementorSectionVisualCorrection[] {
  return results.flatMap((result) => {
    const region = result.sections.find(
      (section) =>
        section.alignment?.safeToApply
        && section.alignment.confidence !== "low",
    );
    if (!region?.alignment || region.alignment.confidence === "low") return [];
    return [{
      variant: result.variant,
      nodeId: region.nodeId,
      nodeName: region.name,
      offsetX: region.alignment.offsetX,
      offsetY: region.alignment.offsetY,
      captureWidth: result.width,
      confidence: region.alignment.confidence,
      errorReductionRatio: region.alignment.errorReductionRatio,
    }];
  });
}

function safeTextGeometryCorrections(
  results: VisualQaBrowserResult[],
): ElementorTextGeometryCorrection[] {
  return results.flatMap((result) => {
    return result.textNodes
      .filter(
        (textNode) =>
          textNode.geometry?.safeToApply
          && textNode.geometry.confidence !== "low",
      )
      .slice(0, 2)
      .flatMap((region) => {
        const geometry = region.geometry;
        if (!geometry || geometry.confidence === "low") return [];
        return [{
          variant: result.variant,
          nodeId: region.nodeId,
          nodeName: region.name,
          offsetX: geometry.offsetX,
          offsetY: geometry.offsetY,
          scaleX: geometry.scaleX,
          scaleY: geometry.scaleY,
          captureWidth: result.width,
          confidence: geometry.confidence,
          errorReductionRatio: geometry.errorReductionRatio,
        }];
      });
  });
}

function safeMediaGeometryCorrections(
  results: VisualQaBrowserResult[],
): ElementorMediaGeometryCorrection[] {
  return results.flatMap((result) => {
    return result.visualNodes
      .filter(
        (visualNode) =>
          visualNode.geometry?.safeToApply
          && visualNode.geometry.confidence !== "low",
      )
      .slice(0, 2)
      .flatMap((region) => {
        const geometry = region.geometry;
        if (!geometry || geometry.confidence === "low") return [];
        return [{
          variant: result.variant,
          nodeId: region.nodeId,
          nodeName: region.name,
          offsetX: geometry.offsetX,
          offsetY: geometry.offsetY,
          scaleX: geometry.scaleX,
          scaleY: geometry.scaleY,
          captureWidth: result.width,
          confidence: geometry.confidence,
          errorReductionRatio: geometry.errorReductionRatio,
        }];
      });
  });
}

function safeDecorationGeometryCorrections(
  results: VisualQaBrowserResult[],
): ElementorDecorationGeometryCorrection[] {
  return results.flatMap((result) => {
    return result.decorationNodes
      .filter(
        (decorationNode) =>
          decorationNode.geometry?.safeToApply
          && decorationNode.geometry.confidence !== "low",
      )
      .slice(0, 2)
      .flatMap((region) => {
        const geometry = region.geometry;
        if (!geometry || geometry.confidence === "low") return [];
        return [{
          variant: result.variant,
          nodeId: region.nodeId,
          nodeName: region.name,
          offsetX: geometry.offsetX,
          offsetY: geometry.offsetY,
          scaleX: geometry.scaleX,
          scaleY: geometry.scaleY,
          captureWidth: result.width,
          confidence: geometry.confidence,
          errorReductionRatio: geometry.errorReductionRatio,
        }];
      });
  });
}

function visualScoreMap(
  results: VisualQaBrowserResult[],
): Partial<Record<"desktop" | "mobile", number>> {
  return Object.fromEntries(
    results.map((result) => [result.variant, result.score]),
  );
}

function serializableVisualQaResults(results: VisualQaBrowserResult[]) {
  return results.map((result) =>
    Object.fromEntries(
      Object.entries(result).filter(([key]) => key !== "diffImageUrl"),
    ),
  );
}

function downloadText(filename: string, value: string, type: string) {
  const url = URL.createObjectURL(new Blob([value], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

function webfontStylesheetUrl(value: unknown): string {
  if (!Array.isArray(value)) return "";
  const families = value
    .slice(0, 4)
    .flatMap((font) => {
      if (!font || typeof font !== "object") return [];
      const candidate = font as { family?: unknown; weights?: unknown };
      if (
        typeof candidate.family !== "string"
        || !/^[A-Za-z0-9 ]{1,80}$/.test(candidate.family)
      ) {
        return [];
      }
      const weights = Array.isArray(candidate.weights)
        ? candidate.weights
          .slice(0, 6)
          .filter(
            (weight): weight is number =>
              Number.isInteger(weight)
              && weight >= 100
              && weight <= 900
              && weight % 100 === 0,
          )
        : [];
      const family = encodeURIComponent(candidate.family).replace(/%20/g, "+");
      return [`family=${family}:wght@${weights.length ? weights.join(";") : "400"}`];
    });
  return families.length
    ? `https://fonts.googleapis.com/css2?${families.join("&")}&display=swap`
    : "";
}

function previewDocument(content: string, webfonts?: unknown): string {
  const webfontUrl = webfontStylesheetUrl(webfonts);
  return `<!doctype html>
<html lang="ja"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src 'self' https: data:; style-src 'unsafe-inline' https:; font-src https: data:;">
<meta name="viewport" content="width=device-width,initial-scale=1">
${webfontUrl ? `<link rel="stylesheet" href="${webfontUrl}">` : ""}
<style>
*{box-sizing:border-box}body{margin:0;background:#f5f3ed;color:#13212a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;line-height:1.65}
section{padding:64px clamp(24px,7vw,88px);max-width:1100px;margin:0 auto}h1,h2,h3{line-height:1.13;letter-spacing:-.035em}h1{font-size:clamp(36px,7vw,72px);margin:0 0 20px}h2{font-size:clamp(28px,5vw,48px);margin:0 0 28px}h3{font-size:20px}p{color:#53636c}a{display:inline-block;background:#c8ff61;color:#102029;text-decoration:none;font-weight:750;padding:13px 20px;border-radius:999px}
.wp-block-figmapress-hero{display:grid;grid-template-columns:1fr;align-items:center;gap:48px;min-height:520px}.wp-block-figmapress-hero[data-layout="text-left-image-right"]{grid-template-columns:1.15fr .85fr}.wp-block-figmapress-hero__image img{width:100%;border-radius:24px}.wp-block-figmapress-service-list,.wp-block-figmapress-faq{background:#fff}.wp-block-figmapress-card-grid__items,.wp-block-figmapress-service-list__items{list-style:none;padding:0;display:grid;grid-template-columns:repeat(3,1fr);gap:16px}.wp-block-figmapress-card-grid__item,.wp-block-figmapress-service-list__item{padding:24px;background:#fff;border:1px solid #dbe1df;border-radius:18px}.wp-block-figmapress-faq__items dt{font-weight:750;margin-top:20px}.wp-block-figmapress-faq__items dd{margin:6px 0 0;color:#53636c}.wp-block-figmapress-cta{text-align:center;background:#112832;color:#fff;border-radius:28px}.wp-block-figmapress-cta h2{color:#fff}.wp-block-figmapress-contact{text-align:center}
.figmapress-figma-preview{container-type:inline-size;overflow:hidden;position:relative;width:100%}.figmapress-figma-preview *{box-sizing:border-box;margin:0;max-width:none}.figmapress-figma-preview img{display:block}.figmapress-figma-preview--mobile{display:none}
@media(max-width:767px){section{padding:44px 22px}.wp-block-figmapress-hero{grid-template-columns:1fr;min-height:auto}.wp-block-figmapress-card-grid__items,.wp-block-figmapress-service-list__items{grid-template-columns:1fr}.figmapress-figma-preview--desktop{display:none}.figmapress-figma-preview--mobile{display:block}}
</style></head><body>${content}</body></html>`;
}

function snapshotDocument(
  snapshot: BrowserElementorSnapshot,
  baseUrl: string,
): string {
  const normalizedBaseUrl = `${new URL(baseUrl).toString().replace(/\/+$/, "")}/`;
  return `<!doctype html>
<html lang="ja"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src 'self' https: data:; style-src 'unsafe-inline' https:; font-src https: data:;">
<meta name="viewport" content="width=device-width,initial-scale=1">
<base href="${normalizedBaseUrl}">
${snapshot.styles}
<style>
html,body{margin:0!important;min-height:100%;padding:0!important;background:#fff}
*,*::before,*::after{box-sizing:border-box}
.figmapress-figma-preview,.figmapress-layout{container-type:inline-size;overflow:hidden;position:relative;width:100%}
</style></head><body class="elementor-page elementor-page-${snapshot.postId}"><div class="elementor elementor-${snapshot.postId}" data-elementor-id="${snapshot.postId}" data-elementor-type="wp-page">${snapshot.html}</div></body></html>`;
}

function visualReferencesFor(
  targetOutput: ConversionResult,
): Array<readonly ["desktop" | "mobile", VisualQaReference]> {
  return (
    [
      ["desktop", targetOutput.visualReferences.desktop],
      ["mobile", targetOutput.visualReferences.mobile],
    ] as const
  ).filter(
    (entry): entry is readonly ["desktop" | "mobile", VisualQaReference] =>
      Boolean(entry[1]),
  );
}

async function compareVisualQuality(
  targetOutput: ConversionResult,
  sourceDocument: string,
  onProgress?: (results: VisualQaBrowserResult[]) => void,
): Promise<VisualQaBrowserResult[]> {
  const references = visualReferencesFor(targetOutput);
  if (!references.length) {
    throw new Error("Figma基準画像がありません。Figmaからもう一度変換してください。");
  }
  const results: VisualQaBrowserResult[] = [];
  for (const [variant, reference] of references) {
    results.push(await runVisualQa(reference, sourceDocument, variant));
    onProgress?.([...results]);
  }
  return results;
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
  const [figmaOAuthStatus, setFigmaOAuthStatus] =
    useState<FigmaOAuthClientStatus | null>(null);
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
  const [wpVisualQaBusy, setWpVisualQaBusy] = useState(false);
  const [wpMediaBusy, setWpMediaBusy] = useState(false);
  const [wpVisualQaError, setWpVisualQaError] = useState("");
  const [wpVisualQaResults, setWpVisualQaResults] = useState<
    VisualQaBrowserResult[]
  >([]);
  const [wpVisualCorrections, setWpVisualCorrections] = useState<
    WordPressVisualCorrectionSummary
  >({
    wholePage: [],
    sections: [],
    textGeometry: [],
    mediaGeometry: [],
    decorationGeometry: [],
    rolledBack: false,
  });
  const [visualQaBusy, setVisualQaBusy] = useState(false);
  const [visualQaError, setVisualQaError] = useState("");
  const [visualQaResults, setVisualQaResults] = useState<VisualQaBrowserResult[]>([]);
  const [visualQaAcknowledged, setVisualQaAcknowledged] = useState(false);
  const [visualQaCorrections, setVisualQaCorrections] = useState<ElementorVisualCorrection[]>([]);
  const [visualQaSectionCorrections, setVisualQaSectionCorrections] = useState<
    ElementorSectionVisualCorrection[]
  >([]);
  const [visualQaTextGeometryCorrections, setVisualQaTextGeometryCorrections] =
    useState<ElementorTextGeometryCorrection[]>([]);
  const [visualQaMediaGeometryCorrections, setVisualQaMediaGeometryCorrections] =
    useState<ElementorMediaGeometryCorrection[]>([]);
  const [
    visualQaDecorationGeometryCorrections,
    setVisualQaDecorationGeometryCorrections,
  ] = useState<ElementorDecorationGeometryCorrection[]>([]);
  const [visualQaBaselineScores, setVisualQaBaselineScores] = useState<
    Partial<Record<"desktop" | "mobile", number>>
  >({});
  const [draftRequestId, setDraftRequestId] = useState("");
  const [conversionSourceKey, setConversionSourceKey] = useState<string | undefined>();
  const [baseUrl, setBaseUrl] = useState("");
  const [username, setUsername] = useState("");
  const [applicationPassword, setApplicationPassword] = useState("");
  const [connectorToken, setConnectorToken] = useState("");
  const [wordpressProfiles, setWordpressProfiles] = useState<
    WordPressConnectionProfile[]
  >([]);
  const [confirmed, setConfirmed] = useState(false);

  useEffect(() => {
    let active = true;
    const updateStatus = async () => {
      const status = await fetchFigmaOAuthStatus();
      if (active) setFigmaOAuthStatus(status);
    };
    const onMessage = (event: MessageEvent) => {
      if (
        event.origin !== window.location.origin
        || typeof event.data !== "object"
        || event.data === null
        || (event.data as { type?: unknown }).type
          !== "figmapress:figma-oauth"
      ) {
        return;
      }
      const result = event.data as {
        success?: unknown;
        message?: unknown;
      };
      if (result.success === true) {
        writeFigmaToken("");
        void updateStatus();
        setError("");
      } else if (typeof result.message === "string") {
        setError(result.message);
      }
    };
    window.addEventListener("message", onMessage);
    void updateStatus();
    return () => {
      active = false;
      window.removeEventListener("message", onMessage);
    };
  }, []);

  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      const paired = decodeWordPressPairingFragment(window.location.hash);
      let profiles = pruneWordPressProfiles(window.localStorage);
      if (paired) {
        profiles = saveWordPressProfile(window.localStorage, paired);
        window.history.replaceState(
          null,
          "",
          `${window.location.pathname}${window.location.search}`,
        );
      }
      const selected = paired ?? profiles[0];
      if (selected) {
        setBaseUrl(selected.baseUrl);
        setUsername(selected.username);
        setConnectorToken(selected.connectorToken ?? "");
        setApplicationPassword("");
      }
      setWordpressProfiles(profiles);
    });
    return () => {
      active = false;
    };
  }, []);

  const srcDoc = output
    ? previewDocument(
        output.previewHtml,
        output.elementorTemplate.page_settings.figmapress_webfonts,
      )
    : "";
  const connectorSupportsInteractions = wpStatus?.functionalWidgets
    ? wpStatus.functionalWidgets.navigation
      && wpStatus.functionalWidgets.links === true
      && wpStatus.functionalWidgets.carousel === true
      && wpStatus.functionalWidgets.contactForm
      && wpStatus.functionalWidgets.accordion
    : versionAtLeast(wpStatus?.connectorVersion, FUNCTIONAL_WIDGETS_CONNECTOR_VERSION);
  const connectorSupportsActualVisualQa = wpStatus?.visualQa
    ? wpStatus.visualQa.snapshot
      && wpStatus.visualQa.documentUpdate
      && wpStatus.visualQa.revisions
      && wpStatus.visualQa.webfonts === true
      && wpStatus.visualQa.gradients === true
      && wpStatus.visualQa.effects === true
      && wpStatus.visualQa.imageTransforms === true
      && wpStatus.visualQa.mediaPersistence === true
    : versionAtLeast(
        wpStatus?.connectorVersion,
        ACTUAL_VISUAL_QA_CONNECTOR_VERSION,
      );
  const connectorSupportsFigmaHeaderMedia = versionAtLeast(
    wpStatus?.connectorVersion,
    FIGMA_HEADER_MEDIA_CONNECTOR_VERSION,
  );
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
  const visualQaCorrectionCandidates = safeVisualCorrections(visualQaResults);
  const visualQaSectionCorrectionCandidates =
    visualQaCorrectionCandidates.length > 0 && visualQaCorrections.length === 0
      ? []
      : safeSectionVisualCorrections(visualQaResults);
  const visualQaTextGeometryCorrectionCandidates =
    (
      visualQaCorrectionCandidates.length > 0
      && visualQaCorrections.length === 0
    ) || (
      visualQaSectionCorrectionCandidates.length > 0
      && visualQaSectionCorrections.length === 0
    )
      ? []
      : safeTextGeometryCorrections(visualQaResults);
  const visualQaMediaGeometryCorrectionCandidates =
    (
      visualQaCorrectionCandidates.length > 0
      && visualQaCorrections.length === 0
    ) || (
      visualQaSectionCorrectionCandidates.length > 0
      && visualQaSectionCorrections.length === 0
    ) || (
      visualQaTextGeometryCorrectionCandidates.length > 0
      && visualQaTextGeometryCorrections.length === 0
    )
      ? []
      : safeMediaGeometryCorrections(visualQaResults);
  const visualQaDecorationGeometryCorrectionCandidates =
    (
      visualQaCorrectionCandidates.length > 0
      && visualQaCorrections.length === 0
    ) || (
      visualQaSectionCorrectionCandidates.length > 0
      && visualQaSectionCorrections.length === 0
    ) || (
      visualQaTextGeometryCorrectionCandidates.length > 0
      && visualQaTextGeometryCorrections.length === 0
    ) || (
      visualQaMediaGeometryCorrectionCandidates.length > 0
      && visualQaMediaGeometryCorrections.length === 0
    )
      ? []
      : safeDecorationGeometryCorrections(visualQaResults);

  function updateFigmaToken(value: string) {
    writeFigmaToken(value);
  }

  function updateFigmaTokenPersistence(persistent: boolean) {
    writeFigmaToken(figmaToken, persistent);
  }

  function connectFigmaAccount() {
    const popup = window.open(
      "/api/figma/oauth/start",
      "figmapress-figma-oauth",
      "popup,width=620,height=760",
    );
    if (!popup) {
      setError(
        "Figma接続画面を開けませんでした。ポップアップを許可して再試行してください。",
      );
    }
  }

  async function disconnectFigmaAccount() {
    const response = await fetch("/api/figma/oauth/disconnect", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
    });
    if (!response.ok) {
      setError("Figma接続を解除できませんでした。");
      return;
    }
    setFigmaOAuthStatus(await fetchFigmaOAuthStatus());
  }

  async function convert(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setConverting(true);
    setError("");
    setOutput(null);
    setConversionSourceKey(undefined);
    setWpResult(null);
    setWpVisualQaBusy(false);
    setWpMediaBusy(false);
    setWpVisualQaError("");
    setWpVisualQaResults([]);
    setWpVisualCorrections({
      wholePage: [],
      sections: [],
      textGeometry: [],
      mediaGeometry: [],
      decorationGeometry: [],
      rolledBack: false,
    });
    setVisualQaError("");
    setVisualQaResults([]);
    setVisualQaAcknowledged(false);
    setVisualQaCorrections([]);
    setVisualQaSectionCorrections([]);
    setVisualQaTextGeometryCorrections([]);
    setVisualQaMediaGeometryCorrections([]);
    setVisualQaDecorationGeometryCorrections([]);
    setVisualQaBaselineScores({});

    try {
      let body: Record<string, unknown>;
      let nextSourceKey: string | undefined;
      if (mode === "figma") {
        const authentication = resolveFigmaRequestAuthentication(
          figmaToken,
          figmaOAuthStatus?.connected === true,
        );
        body = {
          mode,
          fileKeyOrUrl,
          ...authentication.credentials,
        };
        nextSourceKey = figmaSourceKey(fileKeyOrUrl);
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
      setConversionSourceKey(nextSourceKey);
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

  async function fetchWordPressSnapshot(
    credentials: BrowserWordPressConfig,
    postId: number,
    requestId: string,
  ): Promise<BrowserElementorSnapshot> {
    if (wpTransport === "direct") {
      return fetchWordPressElementorSnapshotDirect(
        credentials,
        postId,
        requestId,
      );
    }
    const response = await fetch("/api/wordpress/elementor", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "snapshot",
        ...credentials,
        postId,
        requestId,
      }),
    });
    return (
      await readApi<{ ok: true; result: BrowserElementorSnapshot }>(response)
    ).result;
  }

  async function fetchWordPressMediaBatch(
    credentials: BrowserWordPressConfig,
    postId: number,
    requestId: string,
    retryFailed = false,
  ): Promise<BrowserElementorMediaProgress> {
    if (wpTransport === "direct") {
      return localizeWordPressElementorMediaDirect(
        credentials,
        postId,
        requestId,
        retryFailed,
      );
    }
    const response = await fetch("/api/wordpress/elementor", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "localize-media",
        ...credentials,
        postId,
        requestId,
        retryFailed,
      }),
    });
    return (
      await readApi<{ ok: true; result: BrowserElementorMediaProgress }>(response)
    ).result;
  }

  async function persistWordPressMedia(
    credentials: BrowserWordPressConfig,
    initialResult: WordPressResult,
    requestId: string,
    retryFailed = false,
  ): Promise<WordPressResult> {
    if (typeof initialResult.remainingMedia !== "number") return initialResult;
    let current = initialResult;
    setWpMediaBusy(true);
    try {
      for (
        let round = 0;
        ((current.remainingMedia ?? 0) > 0 || (round === 0 && retryFailed && (current.failedMedia ?? 0) > 0))
          && round < 40;
        round += 1
      ) {
        const progress = await fetchWordPressMediaBatch(
          credentials,
          current.id,
          requestId,
          retryFailed && round === 0,
        );
        const warnings = Array.from(new Set([
          ...(current.warnings ?? []),
          ...(progress.warnings ?? []),
        ])).filter((warning) =>
          !progress.mediaComplete
          || (
            !warning.includes("画像の保存は時間上限に達した")
            && !warning.includes("画像をメディアライブラリへ保存できませんでした")
            && !warning.includes("3回試行しても保存できない画像")
          ),
        );
        current = {
          ...current,
          importedMedia: progress.savedMedia,
          savedMedia: progress.savedMedia,
          totalMedia: progress.totalMedia,
          remainingMedia: progress.remainingMedia,
          failedMedia: progress.failedMedia,
          mediaComplete: progress.mediaComplete,
          warnings,
        };
        setWpResult(current);
      }
      if ((current.remainingMedia ?? 0) > 0) {
        throw new Error(
          "画像保存は途中まで完了しました。通信状態を確認して「画像保存を再開」を押してください。",
        );
      }
      return current;
    } finally {
      setWpMediaBusy(false);
    }
  }

  async function updateWordPressDocument(
    credentials: BrowserWordPressConfig,
    postId: number,
    requestId: string,
    targetOutput: ConversionResult,
  ): Promise<void> {
    if (wpTransport === "direct") {
      await updateWordPressElementorDocumentDirect(credentials, {
        postId,
        requestId,
        template: targetOutput.elementorTemplate,
        pageTemplate: "elementor_canvas",
      });
      return;
    }
    const response = await fetch("/api/wordpress/elementor", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "update",
        ...credentials,
        postId,
        requestId,
        template: targetOutput.elementorTemplate,
        pageTemplate: "elementor_canvas",
      }),
    });
    await readApi<{ ok: true }>(response);
  }

  async function verifyWordPressElementorDraft(
    credentials: BrowserWordPressConfig,
    result: WordPressResult,
    requestId: string,
    initialOutput: ConversionResult,
  ): Promise<void> {
    setWpVisualQaBusy(true);
    setWpVisualQaError("");
    setWpVisualQaResults([]);
    setWpVisualCorrections({
      wholePage: [],
      sections: [],
      textGeometry: [],
      mediaGeometry: [],
      decorationGeometry: [],
      rolledBack: false,
    });
    let currentOutput = initialOutput;
    let currentResults: VisualQaBrowserResult[] = [];
    const appliedWholePage: ElementorVisualCorrection[] = [];
    const appliedSections: ElementorSectionVisualCorrection[] = [];
    const appliedTextGeometry: ElementorTextGeometryCorrection[] = [];
    const appliedMediaGeometry: ElementorMediaGeometryCorrection[] = [];
    const appliedDecorationGeometry:
      ElementorDecorationGeometryCorrection[] = [];
    let rolledBack = false;

    const measureStoredDocument = async (
      targetOutput: ConversionResult,
    ): Promise<VisualQaBrowserResult[]> => {
      const snapshot = await fetchWordPressSnapshot(
        credentials,
        result.id,
        requestId,
      );
      if ((snapshot.omittedAssetsCount ?? 0) > 0) {
        throw new Error(
          `比較用画像を${snapshot.omittedAssetsCount}件準備できませんでした。Connectorを更新して再試行してください。`,
        );
      }
      return compareVisualQuality(
        targetOutput,
        snapshotDocument(snapshot, credentials.baseUrl),
        setWpVisualQaResults,
      );
    };

    const tryCorrection = async (
      candidateOutput: ConversionResult,
      keep: (
        before: VisualQaBrowserResult[],
        after: VisualQaBrowserResult[],
      ) => boolean,
    ): Promise<boolean> => {
      let documentUpdated = false;
      try {
        await updateWordPressDocument(
          credentials,
          result.id,
          requestId,
          candidateOutput,
        );
        documentUpdated = true;
        const correctedResults = await measureStoredDocument(candidateOutput);
        if (keep(currentResults, correctedResults)) {
          currentOutput = candidateOutput;
          currentResults = correctedResults;
          return true;
        }
      } catch (error) {
        if (!documentUpdated) throw error;
        try {
          await updateWordPressDocument(
            credentials,
            result.id,
            requestId,
            currentOutput,
          );
        } catch {
          throw new Error(
            "実ページ補正の再測定に失敗し、WordPressへの自動巻き戻しも完了できませんでした。WordPressリビジョンを確認してください。",
          );
        }
        throw error;
      }

      await updateWordPressDocument(
        credentials,
        result.id,
        requestId,
        currentOutput,
      );
      setWpVisualQaResults(currentResults);
      rolledBack = true;
      return false;
    };

    try {
      currentResults = await measureStoredDocument(currentOutput);
      setWpVisualQaResults(currentResults);

      const wholePageCandidates = safeVisualCorrections(currentResults);
      let wholePageAccepted = true;
      if (wholePageCandidates.length) {
        const candidateOutput: ConversionResult = {
          ...currentOutput,
          elementorTemplate: applyElementorVisualCorrections(
            currentOutput.elementorTemplate,
            wholePageCandidates,
          ),
          previewHtml: applyPreviewVisualCorrections(
            currentOutput.previewHtml,
            wholePageCandidates,
            "runtime",
          ),
        };
        wholePageAccepted = await tryCorrection(
          candidateOutput,
          (before, after) =>
            shouldKeepVisualCorrections(
              before,
              after,
              wholePageCandidates.map((correction) => correction.variant),
            ),
        );
        if (wholePageAccepted) {
          appliedWholePage.push(...wholePageCandidates);
        }
      }

      let sectionAccepted = true;
      if (wholePageAccepted) {
        const sectionCandidates = safeSectionVisualCorrections(currentResults);
        if (sectionCandidates.length) {
          const candidateOutput: ConversionResult = {
            ...currentOutput,
            elementorTemplate: applyElementorSectionVisualCorrections(
              currentOutput.elementorTemplate,
              sectionCandidates,
            ),
            previewHtml: applyPreviewSectionVisualCorrections(
              currentOutput.previewHtml,
              sectionCandidates,
              "runtime",
            ),
          };
          sectionAccepted = await tryCorrection(
            candidateOutput,
            (before, after) =>
              shouldKeepSectionVisualCorrections(
                before,
                after,
                sectionCandidates.map((correction) => ({
                  variant: correction.variant,
                  nodeId: correction.nodeId,
                })),
              ),
          );
          if (sectionAccepted) {
            appliedSections.push(...sectionCandidates);
          }
        }
      }

      if (wholePageAccepted && sectionAccepted) {
        const textGeometryCandidates =
          safeTextGeometryCorrections(currentResults);
        if (textGeometryCandidates.length) {
          const candidateOutput: ConversionResult = {
            ...currentOutput,
            elementorTemplate: applyElementorTextGeometryCorrections(
              currentOutput.elementorTemplate,
              textGeometryCandidates,
            ),
            previewHtml: applyPreviewTextGeometryCorrections(
              currentOutput.previewHtml,
              textGeometryCandidates,
              "runtime",
            ),
          };
          const textGeometryAccepted = await tryCorrection(
            candidateOutput,
            (before, after) =>
              shouldKeepTextGeometryCorrections(
                before,
                after,
                textGeometryCandidates.map((correction) => ({
                  variant: correction.variant,
                  nodeId: correction.nodeId,
                })),
              ),
          );
          if (textGeometryAccepted) {
            appliedTextGeometry.push(...textGeometryCandidates);
          }
        }

        const mediaGeometryCandidates =
          safeMediaGeometryCorrections(currentResults);
        if (mediaGeometryCandidates.length) {
          const candidateOutput: ConversionResult = {
            ...currentOutput,
            elementorTemplate: applyElementorMediaGeometryCorrections(
              currentOutput.elementorTemplate,
              mediaGeometryCandidates,
            ),
            previewHtml: applyPreviewMediaGeometryCorrections(
              currentOutput.previewHtml,
              mediaGeometryCandidates,
              "runtime",
            ),
          };
          const mediaGeometryAccepted = await tryCorrection(
            candidateOutput,
            (before, after) =>
              shouldKeepMediaGeometryCorrections(
                before,
                after,
                mediaGeometryCandidates.map((correction) => ({
                  variant: correction.variant,
                  nodeId: correction.nodeId,
                })),
              ),
          );
          if (mediaGeometryAccepted) {
            appliedMediaGeometry.push(...mediaGeometryCandidates);
          }
        }

        const decorationGeometryCandidates =
          safeDecorationGeometryCorrections(currentResults);
        if (decorationGeometryCandidates.length) {
          const candidateOutput: ConversionResult = {
            ...currentOutput,
            elementorTemplate: applyElementorDecorationGeometryCorrections(
              currentOutput.elementorTemplate,
              decorationGeometryCandidates,
            ),
            previewHtml: applyPreviewDecorationGeometryCorrections(
              currentOutput.previewHtml,
              decorationGeometryCandidates,
              "runtime",
            ),
          };
          const decorationGeometryAccepted = await tryCorrection(
            candidateOutput,
            (before, after) =>
              shouldKeepDecorationGeometryCorrections(
                before,
                after,
                decorationGeometryCandidates.map((correction) => ({
                  variant: correction.variant,
                  nodeId: correction.nodeId,
                })),
              ),
          );
          if (decorationGeometryAccepted) {
            appliedDecorationGeometry.push(...decorationGeometryCandidates);
          }
        }
      }

      setOutput(currentOutput);
      setWpVisualQaResults(currentResults);
      setWpVisualCorrections({
        wholePage: appliedWholePage,
        sections: appliedSections,
        textGeometry: appliedTextGeometry,
        mediaGeometry: appliedMediaGeometry,
        decorationGeometry: appliedDecorationGeometry,
        rolledBack,
      });
    } catch (caught) {
      setWpVisualQaError(
        caught instanceof Error
          ? caught.message
          : "実Elementorページの自動検証を完了できませんでした。",
      );
    } finally {
      setWpVisualQaBusy(false);
    }
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
      connectorToken,
    });
    setWpBusy(true);
    setWpError("");
    setWpResult(null);
    setWpVisualQaError("");
    setWpVisualQaResults([]);
    setWpVisualCorrections({
      wholePage: [],
      sections: [],
      textGeometry: [],
      mediaGeometry: [],
      decorationGeometry: [],
      rolledBack: false,
    });

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
            sourceKey: conversionSourceKey,
          }
        : {
            target: wpTarget,
            ...credentials,
            title: page?.title || output.summary.pageTitle,
            slug: page?.slug || "/",
            content: output.pageContent,
          };
      const serializedPayload = JSON.stringify(payload);
      const supportsChunkedElementorUpload = versionAtLeast(
        wpStatus?.connectorVersion,
        CHUNKED_UPLOAD_CONNECTOR_VERSION,
      );
      const useWordPressProxy = shouldProxyWordPressDraft(
        wpTransport,
        wpTarget,
        new TextEncoder().encode(serializedPayload).byteLength,
        supportsChunkedElementorUpload,
      );
      let createdResult: WordPressResult;
      if (!useWordPressProxy) {
        const directInput = wpTarget === "elementor"
          ? {
              target: "elementor" as const,
              title: payload.title,
              slug: payload.slug,
              template: output.elementorTemplate,
              pageTemplate: "elementor_canvas" as const,
              requestId,
              sourceKey: conversionSourceKey,
            }
          : {
              target: "gutenberg" as const,
              title: payload.title,
              slug: payload.slug,
              content: output.pageContent,
            };
        const result = wpTarget === "elementor" && supportsChunkedElementorUpload
          ? await createWordPressDraftChunkedDirect(
              credentials,
              directInput as Extract<typeof directInput, { target: "elementor" }>,
              versionAtLeast(wpStatus?.connectorVersion, SMALL_CHUNK_UPLOAD_CONNECTOR_VERSION)
                ? { chunkBytes: 32_000, maxChunks: 128, interChunkDelayMs: 75 }
                : undefined,
            )
          : await createWordPressDraftDirect(credentials, directInput);
        setWpResult(result);
        createdResult = result;
      } else {
        const response = await fetch("/api/wordpress", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: serializedPayload,
        });
        const data = await readApi<{ ok: true; result: WordPressResult }>(response);
        setWpResult(data.result);
        createdResult = data.result;
      }
      if (wpTarget === "elementor") {
        createdResult = await persistWordPressMedia(
          credentials,
          createdResult,
          requestId,
        );
        setWpResult(createdResult);
      }
      if (
        wpTarget === "elementor"
        && connectorSupportsActualVisualQa
        && visualReferencesFor(output).length > 0
      ) {
        if ((createdResult.failedMedia ?? 0) > 0) {
          setWpVisualQaError(
            "保存できない画像が残っているため、誤判定を避けて実ページ比較を保留しました。「失敗画像を再試行」後に自動で再開します。",
          );
        } else {
          await verifyWordPressElementorDraft(
            credentials,
            createdResult,
            requestId,
            output,
          );
        }
      }
      setApplicationPassword("");
    } catch (caught) {
      setWpError(caught instanceof Error ? caught.message : "下書きを作成できませんでした。");
    } finally {
      setWpBusy(false);
    }
  }

  async function resumeWordPressMedia(event: MouseEvent<HTMLButtonElement>) {
    if (!output || !wpResult || !draftRequestId) return;
    const credentials = readWordPressCredentials(
      event.currentTarget.form ? new FormData(event.currentTarget.form) : null,
      { baseUrl, username, applicationPassword, connectorToken },
    );
    setWpError("");
    setWpVisualQaError("");
    try {
      const completed = await persistWordPressMedia(
        credentials,
        wpResult,
        draftRequestId,
        true,
      );
      setWpResult(completed);
      if (
        connectorSupportsActualVisualQa
        && visualReferencesFor(output).length > 0
        && (completed.failedMedia ?? 0) === 0
      ) {
        await verifyWordPressElementorDraft(
          credentials,
          completed,
          draftRequestId,
          output,
        );
      } else if ((completed.failedMedia ?? 0) > 0) {
        setWpVisualQaError(
          "保存できない画像が残っているため、誤判定を避けて実ページ比較を保留しました。時間を置いて再試行してください。",
        );
      }
    } catch (caught) {
      setWpError(
        caught instanceof Error ? caught.message : "画像保存を再開できませんでした。",
      );
    }
  }

  async function checkWordPressConnection(event: MouseEvent<HTMLButtonElement>) {
    const credentials = readWordPressCredentials(
      event.currentTarget.form ? new FormData(event.currentTarget.form) : null,
      {
        baseUrl,
        username,
        applicationPassword,
        connectorToken,
      },
    );
    setBaseUrl(credentials.baseUrl);
    setUsername(credentials.username);
    setApplicationPassword(credentials.applicationPassword);
    setConnectorToken(credentials.connectorToken ?? "");
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
      setWordpressProfiles(
        saveWordPressProfile(
          window.localStorage,
          {
            baseUrl: credentials.baseUrl,
            username: credentials.username,
            connectorToken: credentials.connectorToken,
            expiresAt: wordpressProfiles.find(
              (profile) => profile.baseUrl === credentials.baseUrl,
            )?.expiresAt,
            updatedAt: Date.now(),
          },
        ),
      );
    } catch (caught) {
      setWpError(caught instanceof Error ? caught.message : "接続診断に失敗しました。");
    } finally {
      setWpChecking(false);
    }
  }

  function selectWordPressProfile(selectedBaseUrl: string) {
    if (!selectedBaseUrl) {
      setBaseUrl("");
      setUsername("");
      setConnectorToken("");
      setApplicationPassword("");
      setWpStatus(null);
      setWpTransport(null);
      setWpError("");
      return;
    }
    const selected = wordpressProfiles.find(
      (profile) => profile.baseUrl === selectedBaseUrl,
    );
    if (!selected) return;
    setBaseUrl(selected.baseUrl);
    setUsername(selected.username);
    setConnectorToken(selected.connectorToken ?? "");
    setApplicationPassword("");
    setWpStatus(null);
    setWpTransport(null);
    setWpError("");
  }

  function forgetWordPressProfile() {
    const profiles = removeWordPressProfile(
      window.localStorage,
      baseUrl,
    );
    setWordpressProfiles(profiles);
    const next = profiles[0];
    setBaseUrl(next?.baseUrl ?? "");
    setUsername(next?.username ?? "");
    setConnectorToken(next?.connectorToken ?? "");
    setApplicationPassword("");
    setWpStatus(null);
    setWpTransport(null);
  }

  async function measureVisualQuality(
    targetOutput: ConversionResult,
  ): Promise<VisualQaBrowserResult[] | null> {
    if (!visualReferencesFor(targetOutput).length) {
      setVisualQaError("Figma基準画像がありません。Figmaからもう一度変換してください。");
      return null;
    }

    setVisualQaBusy(true);
    setVisualQaError("");
    setVisualQaResults([]);
    setVisualQaAcknowledged(false);
    try {
      return await compareVisualQuality(
        targetOutput,
        previewDocument(
          targetOutput.previewHtml,
          targetOutput.elementorTemplate.page_settings.figmapress_webfonts,
        ),
        setVisualQaResults,
      );
    } catch (caught) {
      setVisualQaError(
        caught instanceof Error
          ? caught.message
          : "画像比較を完了できませんでした。",
      );
      return null;
    } finally {
      setVisualQaBusy(false);
    }
  }

  async function checkVisualQuality() {
    if (!output) return;
    await measureVisualQuality(output);
  }

  async function applySafeVisualCorrections() {
    if (
      !output
      || visualQaBusy
      || visualQaCorrections.length > 0
      || !visualQaCorrectionCandidates.length
    ) {
      return;
    }

    const baselineOutput = output;
    const baselineResults = visualQaResults;
    const corrections = visualQaCorrectionCandidates;
    const correctedOutput: ConversionResult = {
      ...output,
      elementorTemplate: applyElementorVisualCorrections(
        output.elementorTemplate,
        corrections,
      ),
      previewHtml: applyPreviewVisualCorrections(
        output.previewHtml,
        corrections,
      ),
    };
    setOutput(correctedOutput);
    const correctedResults = await measureVisualQuality(correctedOutput);
    const keepCorrection = correctedResults
      ? shouldKeepVisualCorrections(
          baselineResults,
          correctedResults,
          corrections.map((correction) => correction.variant),
        )
      : false;

    if (!keepCorrection) {
      setOutput(baselineOutput);
      setVisualQaResults(baselineResults);
      setVisualQaCorrections([]);
      setVisualQaBaselineScores({});
      if (correctedResults) {
        setVisualQaError(
          "位置補正で実測スコアが改善しなかったため、生成データを自動的に元へ戻しました。",
        );
      }
      return;
    }

    setVisualQaCorrections(corrections);
    setVisualQaBaselineScores(visualScoreMap(baselineResults));
    setVisualQaError("");
  }

  async function applySafeSectionVisualCorrections() {
    if (
      !output
      || visualQaBusy
      || visualQaSectionCorrections.length > 0
      || !visualQaSectionCorrectionCandidates.length
    ) {
      return;
    }

    const baselineOutput = output;
    const baselineResults = visualQaResults;
    const corrections = visualQaSectionCorrectionCandidates;
    const correctedOutput: ConversionResult = {
      ...output,
      elementorTemplate: applyElementorSectionVisualCorrections(
        output.elementorTemplate,
        corrections,
      ),
      previewHtml: applyPreviewSectionVisualCorrections(
        output.previewHtml,
        corrections,
      ),
    };
    setOutput(correctedOutput);
    const correctedResults = await measureVisualQuality(correctedOutput);
    const keepCorrection = correctedResults
      ? shouldKeepSectionVisualCorrections(
          baselineResults,
          correctedResults,
          corrections.map((correction) => ({
            variant: correction.variant,
            nodeId: correction.nodeId,
          })),
        )
      : false;

    if (!keepCorrection) {
      setOutput(baselineOutput);
      setVisualQaResults(baselineResults);
      setVisualQaSectionCorrections([]);
      if (correctedResults) {
        setVisualQaError(
          "セクション補正で対象領域が改善しなかったため、生成データを自動的に元へ戻しました。",
        );
      }
      return;
    }

    setVisualQaSectionCorrections(corrections);
    setVisualQaError("");
  }

  async function applySafeTextGeometryCorrections() {
    if (
      !output
      || visualQaBusy
      || visualQaTextGeometryCorrections.length > 0
      || !visualQaTextGeometryCorrectionCandidates.length
    ) {
      return;
    }

    const baselineOutput = output;
    const baselineResults = visualQaResults;
    const corrections = visualQaTextGeometryCorrectionCandidates;
    const correctedOutput: ConversionResult = {
      ...output,
      elementorTemplate: applyElementorTextGeometryCorrections(
        output.elementorTemplate,
        corrections,
      ),
      previewHtml: applyPreviewTextGeometryCorrections(
        output.previewHtml,
        corrections,
      ),
    };
    setOutput(correctedOutput);
    const correctedResults = await measureVisualQuality(correctedOutput);
    const keepCorrection = correctedResults
      ? shouldKeepTextGeometryCorrections(
          baselineResults,
          correctedResults,
          corrections.map((correction) => ({
            variant: correction.variant,
            nodeId: correction.nodeId,
          })),
        )
      : false;

    if (!keepCorrection) {
      setOutput(baselineOutput);
      setVisualQaResults(baselineResults);
      setVisualQaTextGeometryCorrections([]);
      if (correctedResults) {
        setVisualQaError(
          "文字寸法補正で対象領域が改善しなかったため、生成データを自動的に元へ戻しました。",
        );
      }
      return;
    }

    setVisualQaTextGeometryCorrections(corrections);
    setVisualQaError("");
  }

  async function applySafeMediaGeometryCorrections() {
    if (
      !output
      || visualQaBusy
      || visualQaMediaGeometryCorrections.length > 0
      || !visualQaMediaGeometryCorrectionCandidates.length
    ) {
      return;
    }

    const baselineOutput = output;
    const baselineResults = visualQaResults;
    const corrections = visualQaMediaGeometryCorrectionCandidates;
    const correctedOutput: ConversionResult = {
      ...output,
      elementorTemplate: applyElementorMediaGeometryCorrections(
        output.elementorTemplate,
        corrections,
      ),
      previewHtml: applyPreviewMediaGeometryCorrections(
        output.previewHtml,
        corrections,
      ),
    };
    setOutput(correctedOutput);
    const correctedResults = await measureVisualQuality(correctedOutput);
    const keepCorrection = correctedResults
      ? shouldKeepMediaGeometryCorrections(
          baselineResults,
          correctedResults,
          corrections.map((correction) => ({
            variant: correction.variant,
            nodeId: correction.nodeId,
          })),
        )
      : false;

    if (!keepCorrection) {
      setOutput(baselineOutput);
      setVisualQaResults(baselineResults);
      setVisualQaMediaGeometryCorrections([]);
      if (correctedResults) {
        setVisualQaError(
          "画像補正で対象領域が改善しなかったため、生成データを自動的に元へ戻しました。",
        );
      }
      return;
    }

    setVisualQaMediaGeometryCorrections(corrections);
    setVisualQaError("");
  }

  async function applySafeDecorationGeometryCorrections() {
    if (
      !output
      || visualQaBusy
      || visualQaDecorationGeometryCorrections.length > 0
      || !visualQaDecorationGeometryCorrectionCandidates.length
    ) {
      return;
    }

    const baselineOutput = output;
    const baselineResults = visualQaResults;
    const corrections = visualQaDecorationGeometryCorrectionCandidates;
    const correctedOutput: ConversionResult = {
      ...output,
      elementorTemplate: applyElementorDecorationGeometryCorrections(
        output.elementorTemplate,
        corrections,
      ),
      previewHtml: applyPreviewDecorationGeometryCorrections(
        output.previewHtml,
        corrections,
      ),
    };
    setOutput(correctedOutput);
    const correctedResults = await measureVisualQuality(correctedOutput);
    const keepCorrection = correctedResults
      ? shouldKeepDecorationGeometryCorrections(
          baselineResults,
          correctedResults,
          corrections.map((correction) => ({
            variant: correction.variant,
            nodeId: correction.nodeId,
          })),
        )
      : false;

    if (!keepCorrection) {
      setOutput(baselineOutput);
      setVisualQaResults(baselineResults);
      setVisualQaDecorationGeometryCorrections([]);
      if (correctedResults) {
        setVisualQaError(
          "背景・枠補正で対象領域が改善しなかったため、生成データを自動的に元へ戻しました。",
        );
      }
      return;
    }

    setVisualQaDecorationGeometryCorrections(corrections);
    setVisualQaError("");
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
          <span className="status-pill"><i /> v0.25.16 live</span>
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
                  <span>Figmaローカル直接モード</span>
                  <div className={`oauth-connect-card ${figmaToken ? "is-connected" : ""}`}>
                    <div>
                      <strong>{figmaToken ? "✓ ローカル直接モード準備済み" : "OAuth審査なしで今すぐ使えます"}</strong>
                      <small>あなたのPersonal Access Tokenをブラウザから送信します。共通トークンやサーバー保存はありません。</small>
                    </div>
                    {figmaToken && (
                      <button onClick={() => updateFigmaToken("")} type="button">トークンを消去</button>
                    )}
                  </div>
                  <label htmlFor="figma-personal-access-token">
                    Figma Personal Access Token
                  </label>
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
                  </div>
                  <small>
                    Figmaの「設定 → セキュリティ」でfile_content:read権限付きのトークンを作成してください。
                  </small>
                  <label className="token-persistence">
                    <input
                      checked={persistFigmaToken}
                      onChange={(event) => updateFigmaTokenPersistence(event.target.checked)}
                      type="checkbox"
                    />
                    <span>このブラウザに保存して、次回から入力しない（共有端末ではオフ）</span>
                  </label>
                  <details className="pat-fallback">
                    <summary>任意：Figma公式OAuthを使う</summary>
                    <div className={`oauth-connect-card ${figmaOAuthStatus?.connected ? "is-connected" : ""}`}>
                      {figmaOAuthStatus === null ? (
                        <small>接続状態を確認しています…</small>
                      ) : figmaOAuthStatus.configured ? (
                        figmaOAuthStatus.connected ? (
                          <>
                            <div>
                              <strong>✓ Figmaアカウント接続済み</strong>
                              <small>PATが入力されている場合はローカル直接モードを優先します。</small>
                            </div>
                            <button onClick={disconnectFigmaAccount} type="button">接続解除</button>
                          </>
                        ) : (
                          <>
                            <div>
                              <strong>OAuthは任意です</strong>
                              <small>Figmaの公開審査承認後に利用できます。</small>
                            </div>
                            <button onClick={connectFigmaAccount} type="button">Figmaアカウントを接続</button>
                          </>
                        )
                      ) : (
                        <div>
                          <strong>OAuthは未設定です</strong>
                          <small>ローカル直接モードはそのまま利用できます。</small>
                        </div>
                      )}
                    </div>
                  </details>
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
              <p><span className="lock">⌁</span> PATはOAuthより優先され、標準はこのタブ内、選択時だけこのブラウザに保持します。</p>
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
                    {visualQaBusy
                      ? <><span className="spinner" /> 比較中…</>
                      : visualQaCorrections.length
                        ? "補正後を再測定"
                        : "視覚差分を測定"}
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
                    赤い箇所ほどFigmaとの差が大きい領域です。位置・色・画像・文字折り返しをPC/SP別、セクション別、文字・画像・背景要素別に実測します。
                  </p>
                </div>
                {visualQaResults.length > 0 && (
                  <div className="visual-qa-card__actions">
                    {visualQaCorrectionCandidates.length > 0 && visualQaCorrections.length === 0 && (
                      <button
                        disabled={visualQaBusy}
                        onClick={applySafeVisualCorrections}
                        type="button"
                      >
                        安全補正を適用して再測定
                      </button>
                    )}
                    {visualQaSectionCorrectionCandidates.length > 0 && visualQaSectionCorrections.length === 0 && (
                      <button
                        disabled={visualQaBusy}
                        onClick={applySafeSectionVisualCorrections}
                        type="button"
                      >
                        セクション補正を適用して再測定
                      </button>
                    )}
                    {visualQaTextGeometryCorrectionCandidates.length > 0 && visualQaTextGeometryCorrections.length === 0 && (
                      <button
                        disabled={visualQaBusy}
                        onClick={applySafeTextGeometryCorrections}
                        type="button"
                      >
                        文字寸法補正を適用して再測定
                      </button>
                    )}
                    {visualQaMediaGeometryCorrectionCandidates.length > 0 && visualQaMediaGeometryCorrections.length === 0 && (
                      <button
                        disabled={visualQaBusy}
                        onClick={applySafeMediaGeometryCorrections}
                        type="button"
                      >
                        画像補正を適用して再測定
                      </button>
                    )}
                    {visualQaDecorationGeometryCorrectionCandidates.length > 0 && visualQaDecorationGeometryCorrections.length === 0 && (
                      <button
                        disabled={visualQaBusy}
                        onClick={applySafeDecorationGeometryCorrections}
                        type="button"
                      >
                        背景・枠補正を適用して再測定
                      </button>
                    )}
                    <button
                      onClick={() => downloadText(
                        "visual-quality-report.json",
                        JSON.stringify(
                          {
                            version: "1.6",
                            correctionsApplied: visualQaCorrections,
                            sectionCorrectionsApplied: visualQaSectionCorrections,
                            textGeometryCorrectionsApplied:
                              visualQaTextGeometryCorrections,
                            mediaGeometryCorrectionsApplied:
                              visualQaMediaGeometryCorrections,
                            decorationGeometryCorrectionsApplied:
                              visualQaDecorationGeometryCorrections,
                            baselineScores: visualQaBaselineScores,
                            results: serializableVisualQaResults(visualQaResults),
                          },
                          null,
                          2,
                        ),
                        "application/json",
                      )}
                      type="button"
                    >
                      レポートJSON ↓
                    </button>
                  </div>
                )}
              </div>
              {visualQaError && (
                <div className="alert alert--error" role="alert">{visualQaError}</div>
              )}
              {visualQaCorrections.length > 0 && (
                <div className="visual-qa-correction-summary" role="status">
                  <strong>✓ 安全な全体位置補正を適用し、改善を実測しました</strong>
                  <div>
                    {visualQaCorrections.map((correction) => {
                      const afterScore = visualQaResults.find(
                        (result) => result.variant === correction.variant,
                      )?.score;
                      return (
                        <span key={correction.variant}>
                          <b>{correction.variant === "desktop" ? "PC" : "スマホ"}</b>
                          X {correction.offsetX >= 0 ? "+" : ""}{correction.offsetX}px /
                          Y {correction.offsetY >= 0 ? "+" : ""}{correction.offsetY}px
                          <em>
                            score {visualQaBaselineScores[correction.variant] ?? "—"} → {afterScore ?? "—"}
                          </em>
                        </span>
                      );
                    })}
                  </div>
                  <small>Elementor標準Transformへ反映済みです。再測定で悪化する補正は自動的に取り消されます。</small>
                </div>
              )}
              {visualQaSectionCorrections.length > 0 && (
                <div className="visual-qa-correction-summary" role="status">
                  <strong>✓ セクション単位の位置補正を適用し、改善を実測しました</strong>
                  <div>
                    {visualQaSectionCorrections.map((correction) => (
                      <span key={`${correction.variant}:${correction.nodeId}`}>
                        <b>{correction.variant === "desktop" ? "PC" : "スマホ"} / {correction.nodeName}</b>
                        X {correction.offsetX >= 0 ? "+" : ""}{correction.offsetX}px /
                        Y {correction.offsetY >= 0 ? "+" : ""}{correction.offsetY}px
                        <em>領域誤差削減 {correction.errorReductionRatio}%</em>
                      </span>
                    ))}
                  </div>
                  <small>FigmaノードIDが一致するElementor要素だけに反映済みです。対象領域が改善しない補正は自動的に取り消されます。</small>
                </div>
              )}
              {visualQaTextGeometryCorrections.length > 0 && (
                <div className="visual-qa-correction-summary" role="status">
                  <strong>✓ 文字領域の位置・寸法補正を適用し、改善を実測しました</strong>
                  <div>
                    {visualQaTextGeometryCorrections.map((correction) => (
                      <span key={`${correction.variant}:${correction.nodeId}`}>
                        <b>{correction.variant === "desktop" ? "PC" : "スマホ"} / {correction.nodeName}</b>
                        X {correction.offsetX >= 0 ? "+" : ""}{correction.offsetX}px /
                        Y {correction.offsetY >= 0 ? "+" : ""}{correction.offsetY}px
                        <em>
                          幅 {Math.round(correction.scaleX * 1000) / 10}% /
                          高さ {Math.round(correction.scaleY * 1000) / 10}%
                        </em>
                      </span>
                    ))}
                  </div>
                  <small>対象文字のElementor標準Transformだけを微調整しています。再測定で改善しない候補は自動的に取り消されます。</small>
                </div>
              )}
              {visualQaMediaGeometryCorrections.length > 0 && (
                <div className="visual-qa-correction-summary" role="status">
                  <strong>✓ 画像の位置・寸法補正を適用し、改善を実測しました</strong>
                  <div>
                    {visualQaMediaGeometryCorrections.map((correction) => (
                      <span key={`${correction.variant}:${correction.nodeId}`}>
                        <b>{correction.variant === "desktop" ? "PC" : "スマホ"} / {correction.nodeName}</b>
                        X {correction.offsetX >= 0 ? "+" : ""}{correction.offsetX}px /
                        Y {correction.offsetY >= 0 ? "+" : ""}{correction.offsetY}px
                        <em>
                          幅 {Math.round(correction.scaleX * 1000) / 10}% /
                          高さ {Math.round(correction.scaleY * 1000) / 10}%
                        </em>
                      </span>
                    ))}
                  </div>
                  <small>対象画像のElementor標準Transformだけを微調整しています。全対象が改善しない場合は自動的に取り消されます。</small>
                </div>
              )}
              {visualQaDecorationGeometryCorrections.length > 0 && (
                <div className="visual-qa-correction-summary" role="status">
                  <strong>✓ 背景・枠の位置・寸法補正を適用し、改善を実測しました</strong>
                  <div>
                    {visualQaDecorationGeometryCorrections.map((correction) => (
                      <span key={`${correction.variant}:${correction.nodeId}`}>
                        <b>{correction.variant === "desktop" ? "PC" : "スマホ"} / {correction.nodeName}</b>
                        X {correction.offsetX >= 0 ? "+" : ""}{correction.offsetX}px /
                        Y {correction.offsetY >= 0 ? "+" : ""}{correction.offsetY}px
                        <em>
                          幅 {Math.round(correction.scaleX * 1000) / 10}% /
                          高さ {Math.round(correction.scaleY * 1000) / 10}%
                        </em>
                      </span>
                    ))}
                  </div>
                  <small>子要素を持たない装飾Containerだけを微調整しています。機能Widgetや内容を含むContainerは対象外で、全対象が改善しない場合は自動的に取り消されます。</small>
                </div>
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
                      {(result.sections.length > 0 || result.textNodes.length > 0 || result.visualNodes.length > 0 || result.decorationNodes.length > 0) && (
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
                                      {region.alignment?.safeToApply && (
                                        <small>
                                          補正候補 X {region.alignment.offsetX >= 0 ? "+" : ""}{region.alignment.offsetX}px /
                                          Y {region.alignment.offsetY >= 0 ? "+" : ""}{region.alignment.offsetY}px
                                        </small>
                                      )}
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
                                      {region.geometry?.safeToApply && (
                                        <small>
                                          補正候補 X {region.geometry.offsetX >= 0 ? "+" : ""}{region.geometry.offsetX}px /
                                          Y {region.geometry.offsetY >= 0 ? "+" : ""}{region.geometry.offsetY}px /
                                          幅 {Math.round(region.geometry.scaleX * 1000) / 10}% /
                                          高さ {Math.round(region.geometry.scaleY * 1000) / 10}%
                                        </small>
                                      )}
                                    </span>
                                    <em>全体影響 {region.impactRatio}%</em>
                                  </p>
                                ))}
                            </section>
                          )}
                          {result.visualNodes.some((region) => region.changedPixelRatio > 0) && (
                            <section>
                              <strong>画像要素別の差分影響</strong>
                              {result.visualNodes
                                .filter((region) => region.changedPixelRatio > 0)
                                .slice(0, 5)
                                .map((region) => (
                                  <p key={region.nodeId}>
                                    <span>
                                      <b>{region.name}</b>
                                      <small>画像領域差分 {region.changedPixelRatio}%</small>
                                      {region.geometry?.safeToApply && (
                                        <small>
                                          補正候補 X {region.geometry.offsetX >= 0 ? "+" : ""}{region.geometry.offsetX}px /
                                          Y {region.geometry.offsetY >= 0 ? "+" : ""}{region.geometry.offsetY}px /
                                          幅 {Math.round(region.geometry.scaleX * 1000) / 10}% /
                                          高さ {Math.round(region.geometry.scaleY * 1000) / 10}%
                                        </small>
                                      )}
                                    </span>
                                    <em>全体影響 {region.impactRatio}%</em>
                                  </p>
                                ))}
                            </section>
                          )}
                          {result.decorationNodes.some((region) => region.changedPixelRatio > 0) && (
                            <section>
                              <strong>背景・枠要素別の差分影響</strong>
                              {result.decorationNodes
                                .filter((region) => region.changedPixelRatio > 0)
                                .slice(0, 5)
                                .map((region) => (
                                  <p key={region.nodeId}>
                                    <span>
                                      <b>{region.name}</b>
                                      <small>装飾領域差分 {region.changedPixelRatio}%</small>
                                      {region.geometry?.safeToApply && (
                                        <small>
                                          補正候補 X {region.geometry.offsetX >= 0 ? "+" : ""}{region.geometry.offsetX}px /
                                          Y {region.geometry.offsetY >= 0 ? "+" : ""}{region.geometry.offsetY}px /
                                          幅 {Math.round(region.geometry.scaleX * 1000) / 10}% /
                                          高さ {Math.round(region.geometry.scaleY * 1000) / 10}%
                                        </small>
                                      )}
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
              {wordpressProfiles.length > 0 && (
                <div className="wp-profile-row">
                  <label>
                    <span>保存済み接続</span>
                    <select
                      onChange={(event) =>
                        selectWordPressProfile(event.target.value)
                      }
                      value={
                        wordpressProfiles.some(
                          (profile) => profile.baseUrl === baseUrl,
                        )
                          ? baseUrl
                          : ""
                      }
                    >
                      <option value="">新しいサイト</option>
                      {wordpressProfiles.map((profile) => (
                        <option key={profile.baseUrl} value={profile.baseUrl}>
                          {new URL(profile.baseUrl).host} — {profile.username}
                        </option>
                      ))}
                    </select>
                  </label>
                  {wordpressProfiles.some(
                    (profile) => profile.baseUrl === baseUrl,
                  ) && (
                    <button onClick={forgetWordPressProfile} type="button">
                      このブラウザから削除
                    </button>
                  )}
                </div>
              )}
              {connectorToken && (
                <div className="paired-connection" role="status">
                  <strong>✓ Connector専用接続を使用します</strong>
                  <span>
                    Application Passwordは不要です。このブラウザだけに保存され、WordPressの「ツール → FigmaPress接続」からいつでも無効化できます。
                  </span>
                </div>
              )}
              <div className="form-grid form-grid--three">
                <label className="field">
                  <span>WordPress URL</span>
                  <input name="baseUrl" onChange={(event) => { setBaseUrl(event.target.value); setConnectorToken(""); setWpStatus(null); setWpTransport(null); }} placeholder="https://example.com" readOnly={Boolean(connectorToken)} required type="url" value={baseUrl} />
                </label>
                <label className="field">
                  <span>ユーザー名</span>
                  <input autoComplete="username" name="username" onChange={(event) => { setUsername(event.target.value); setConnectorToken(""); setWpStatus(null); setWpTransport(null); }} readOnly={Boolean(connectorToken)} required value={username} />
                </label>
                <label className="field">
                  <span>Application Password</span>
                  <input autoComplete="current-password" disabled={Boolean(connectorToken)} name="applicationPassword" onChange={(event) => { setApplicationPassword(event.target.value); setWpStatus(null); setWpTransport(null); }} placeholder={connectorToken ? "Connector専用接続では不要" : ""} required={!connectorToken} type="password" value={applicationPassword} />
                </label>
                <input name="connectorToken" type="hidden" value={connectorToken} />
              </div>
              <div className="connection-row">
                <button className="connection-button" disabled={wpChecking || !baseUrl || !username || (!connectorToken && applicationPassword.length < 8)} onClick={checkWordPressConnection} type="button">
                  {wpChecking ? "診断中…" : "接続を診断"}
                </button>
                {wpStatus && (
                  <div className="connection-status" role="status">
                    <strong>✓ {wpStatus.user.name} として認証</strong>
                    <span>WP {wpStatus.wordpressVersion || "確認済み"}</span>
                    <span>Connector {wpStatus.connectorInstalled ? `v${wpStatus.connectorVersion || "installed"}` : "未導入"}</span>
                    <span>Elementor {wpStatus.elementor.active ? `v${wpStatus.elementor.version || "active"}` : "未導入"}</span>
                    {wpStatus.functionalWidgets && (
                      <span>機能Widget {Object.values(wpStatus.functionalWidgets).filter(Boolean).length}/5</span>
                    )}
                    {wpTarget === "elementor" && (
                      <span>実ページQA {connectorSupportsActualVisualQa ? "対応" : "更新必要"}</span>
                    )}
                    <span>{connectorToken ? "Connector専用接続" : wpTransport === "direct" ? "ブラウザ直結" : "サーバー経由"}</span>
                  </div>
                )}
              </div>
              {wpStatus && !wpStatus.connectorInstalled && (
                <div className="alert alert--error" role="alert">Connectorプラグインをインストールしてから再診断してください。</div>
              )}
              {wpStatus && wpStatus.connectorInstalled && !connectorToken && !versionAtLeast(wpStatus.connectorVersion, ONE_CLICK_CONNECTOR_VERSION) && (
                <div className="alert alert--error" role="alert">
                  毎回のApplication Password入力をなくすにはConnector v{ONE_CLICK_CONNECTOR_VERSION}以上が必要です。<a href="/downloads/figmapress-connector.zip" download>最新版ZIPをダウンロード</a>して更新してください。
                </div>
              )}
              {wpStatus && wpStatus.connectorInstalled && !connectorToken && versionAtLeast(wpStatus.connectorVersion, ONE_CLICK_CONNECTOR_VERSION) && wordpressPairingAdminUrl(baseUrl) && (
                <div className="paired-connection paired-connection--setup">
                  <strong>次回から入力不要にできます</strong>
                  <span>WordPressで専用接続を作ると、このサイトを保存済み接続から選ぶだけになります。</span>
                  <a href={wordpressPairingAdminUrl(baseUrl) ?? "#"} rel="noreferrer" target="_blank">
                    WordPressでワンクリック接続を有効化 ↗
                  </a>
                </div>
              )}
              {wpStatus && wpTarget === "elementor" && !wpStatus.elementor.active && (
                <div className="alert alert--error" role="alert">このサイトではElementorが有効化されていません。</div>
              )}
              {wpStatus && wpTarget === "elementor" && wpStatus.connectorInstalled && !connectorSupportsInteractions && (
                <div className="alert alert--error" role="alert">
                  メニュー・リンク・カルーセル・フォーム・アコーディオンを動作させるにはConnector v{FUNCTIONAL_WIDGETS_CONNECTOR_VERSION}以上が必要です。<a href="/downloads/figmapress-connector.zip" download>最新版ZIPをダウンロード</a>し、WordPressの「プラグインを追加 → プラグインのアップロード」から一度だけ更新してください。
                </div>
              )}
              {wpStatus && wpTarget === "elementor" && wpStatus.connectorInstalled && connectorSupportsInteractions && !connectorSupportsFigmaHeaderMedia && (
                <div className="alert alert--error" role="alert">
                  FigmaのヘッダーロゴとCTAアイコンを正確に表示するにはConnector v{FIGMA_HEADER_MEDIA_CONNECTOR_VERSION}以上が必要です。<a href="/downloads/figmapress-connector.zip" download>最新版ZIPをダウンロード</a>して更新してください。
                </div>
              )}
              {wpStatus && wpTarget === "elementor" && visualQaReferenceCount > 0 && wpStatus.connectorInstalled && connectorSupportsInteractions && !connectorSupportsActualVisualQa && (
                <div className="alert alert--error" role="alert">
                  実際のElementor下書きをFigmaと再比較して自動補正するにはConnector v{ACTUAL_VISUAL_QA_CONNECTOR_VERSION}以上が必要です。WordPressのプラグイン更新画面から最新版へ更新し、再診断してください。
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
                    <strong>{visualQaError ? "自動比較を完了できませんでした" : "重大な視覚差分を確認しました"}</strong>
                    <small>{visualQaError ? "生成プレビューを手動確認したうえで、調整用のElementor下書きを作成します。" : "差分レポートを確認したうえで、調整用のElementor下書きを作成します。"}</small>
                  </span>
                </label>
              )}
              <label className="consent">
                <input checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} type="checkbox" />
                <span>Application Passwordは保存されません。Connector専用接続を使う場合だけ、対象サイト・ユーザー名・90日限定トークンがこのブラウザに保存されることを確認しました。</span>
              </label>
              {wpError && <div className="alert alert--error" role="alert">{wpError}</div>}
              {wpResult && (
                <div className="alert alert--success" role="status">
                  下書き #{wpResult.id} を{wpResult.updated ? "更新" : "作成"}しました。
                  {wpResult.editLink && <a href={wpResult.editLink} rel="noreferrer" target="_blank"> WordPressで編集 ↗</a>}
                  {typeof wpResult.totalMedia === "number" ? (
                    <span>
                      （画像 {wpResult.savedMedia ?? 0}/{wpResult.totalMedia}件を保存
                      {(wpResult.failedMedia ?? 0) > 0 ? `・${wpResult.failedMedia}件失敗` : ""}）
                    </span>
                  ) : typeof wpResult.importedMedia === "number" ? (
                    <span>（画像 {wpResult.importedMedia}件を保存）</span>
                  ) : null}
                  {wpMediaBusy && <span> 画像をメディアライブラリへ段階保存中…</span>}
                  {!wpMediaBusy && ((wpResult.remainingMedia ?? 0) > 0 || (wpResult.failedMedia ?? 0) > 0) && (
                    <button onClick={resumeWordPressMedia} type="button">
                      {(wpResult.failedMedia ?? 0) > 0 ? "失敗画像を再試行" : "画像保存を再開"}
                    </button>
                  )}
                  {wpResult.warnings?.map((warning) => <span key={warning}> {warning}</span>)}
                </div>
              )}
              {wpVisualQaBusy && (
                <div className="visual-qa-progress" role="status">
                  <span className="spinner" /> 実際のElementor下書きをPC／スマホで再描画し、Figmaと比較しています…
                </div>
              )}
              {wpVisualQaError && (
                <div className="alert alert--error" role="alert">
                  下書きは作成済みですが、実ページVisual QAを完了できませんでした。{wpVisualQaError}
                </div>
              )}
              {wpVisualQaResults.length > 0 && !wpVisualQaBusy && (
                <div className="visual-qa-correction-summary" role="status">
                  <strong>
                    ✓ 実ElementorページのPC／スマホ再検証が完了しました
                  </strong>
                  <div>
                    {wpVisualQaResults.map((result) => (
                      <span key={result.variant}>
                        <b>{result.variant === "desktop" ? "PC" : "スマホ"}</b>
                        score {result.score}
                        <em>差分面積 {result.changedPixelRatio}%</em>
                      </span>
                    ))}
                  </div>
                  <div className="actual-visual-qa-details">
                    {wpVisualQaResults.map((result) => (
                      <details className="visual-qa-diff" key={result.variant}>
                        <summary>
                          {result.variant === "desktop" ? "PC" : "スマホ"}実ページの差分内訳
                        </summary>
                        <dl className="visual-qa-metrics">
                          <div><dt>差分面積</dt><dd>{result.changedPixelRatio}%</dd></div>
                          <div><dt>平均色差</dt><dd>{result.meanColorError}</dd></div>
                          <div><dt>全体高差</dt><dd>{result.heightDifferenceRatio}%</dd></div>
                          <div><dt>測定寸法</dt><dd>{result.width}×{result.height}</dd></div>
                        </dl>
                        <ul>
                          {result.recommendations.map((recommendation) => (
                            <li key={recommendation}>{recommendation}</li>
                          ))}
                        </ul>
                        {/* Generated in-browser as a data URL; Next Image cannot optimize it. */}
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          alt={`${result.variant === "desktop" ? "PC" : "スマホ"}実Elementorページの視覚差分ヒートマップ`}
                          src={result.diffImageUrl}
                        />
                      </details>
                    ))}
                  </div>
                  {(wpVisualCorrections.wholePage.length > 0 || wpVisualCorrections.sections.length > 0 || wpVisualCorrections.textGeometry.length > 0 || wpVisualCorrections.mediaGeometry.length > 0 || wpVisualCorrections.decorationGeometry.length > 0) && (
                    <small>
                      実測で改善した補正だけを下書きへ再保存しました。全体補正 {wpVisualCorrections.wholePage.length}件／セクション補正 {wpVisualCorrections.sections.length}件／文字寸法補正 {wpVisualCorrections.textGeometry.length}件／画像補正 {wpVisualCorrections.mediaGeometry.length}件／背景・枠補正 {wpVisualCorrections.decorationGeometry.length}件。
                    </small>
                  )}
                  {wpVisualCorrections.rolledBack && (
                    <small>
                      改善しなかった候補は自動的に元のElementorデータへ戻しました。更新前のWordPressリビジョンも保持しています。
                    </small>
                  )}
                  {!wpVisualCorrections.rolledBack && wpVisualCorrections.wholePage.length === 0 && wpVisualCorrections.sections.length === 0 && wpVisualCorrections.textGeometry.length === 0 && wpVisualCorrections.mediaGeometry.length === 0 && wpVisualCorrections.decorationGeometry.length === 0 && (
                    <small>安全に適用できる追加の位置・文字・画像・背景寸法補正はありませんでした。Elementor下書きは変更していません。</small>
                  )}
                </div>
              )}
              <div className="wp-footer">
                <span>常に <code>status: draft</code></span>
                <button
                  className="button button--dark"
                  disabled={!confirmed || wpBusy || visualQaBlocksDraft || !wpStatus || !wpStatus.connectorInstalled || !wpStatus.canEditPages || (wpTarget === "elementor" && (!wpStatus.elementor.active || !connectorSupportsInteractions || (visualQaReferenceCount > 0 && !connectorSupportsActualVisualQa)))}
                  type="submit"
                >
                  {wpBusy
                    ? wpMediaBusy
                      ? "画像保存中…"
                      : wpVisualQaBusy
                      ? "実ページ検証中…"
                      : "作成中…"
                    : `${wpTarget === "elementor" ? "Elementor" : "Gutenberg"}下書きを作成 →`}
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
            <h3>ワンクリック接続</h3>
            <p>WordPressの「ツール → FigmaPress接続」からこの画面を開けば、以後のApplication Password入力は不要です。</p>
            <a href="/downloads/figmapress-block-theme.zip" download>Theme ZIP（任意）をダウンロード ↓</a>
          </article>
        </div>
      </section>

      <section className="scope-strip">
        <div><span>READY</span><strong>Gutenberg blocks</strong><p>編集可能な6セクション</p></div>
        <div><span>READY</span><strong>Elementor documents</strong><p>機能Widget化・画像永続化</p></div>
        <div><span>SECURITY</span><strong>Scoped connections</strong><p>権限限定・暗号化・いつでも失効</p></div>
      </section>

      <footer>
        <div className="brand brand--footer"><span className="brand__mark">F</span><span>FigmaPress</span></div>
        <p>Figmaから、運用できるWordPressへ。</p>
        <div><a href="#convert">変換する</a><a href="#setup">導入方法</a><a href="/privacy">プライバシー</a><a href="/security">セキュリティ</a><span>v0.25.16</span></div>
      </footer>
    </main>
  );
}
