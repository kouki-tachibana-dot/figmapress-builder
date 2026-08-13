export interface BrowserWordPressConfig {
  baseUrl: string;
  username: string;
  applicationPassword: string;
  connectorToken?: string;
}

export interface BrowserWordPressStatus {
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
  siteBuild?: {
    pages: boolean;
    menus: boolean;
    bridge?: boolean;
  };
  canEditPages: boolean;
  pairing?: {
    supported: boolean;
    active: boolean;
  };
}

export interface BrowserWordPressResult {
  id: number;
  slug: string;
  status: string;
  editLink?: string;
  previewLink?: string;
  rawLink?: string;
  target?: "gutenberg" | "elementor";
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

export interface BrowserElementorMediaProgress {
  postId: number;
  status: "draft";
  importedMedia: number;
  savedMedia: number;
  totalMedia: number;
  remainingMedia: number;
  failedMedia: number;
  mediaComplete: boolean;
  storedElements: number;
  warnings?: string[];
}

export interface BrowserElementorTemplate {
  title: string;
  type: "page";
  version: "0.4";
  page_settings: Record<string, unknown>;
  content: unknown[];
}

export interface BrowserElementorSnapshot {
  postId: number;
  html: string;
  styles: string;
  storedElements: number;
  embeddedAssetsBytes?: number;
  embeddedAssetsCount?: number;
  omittedAssetsCount?: number;
  webfonts?: string[];
  generatedAt: string;
}

export interface BrowserElementorDocumentResult {
  postId: number;
  status: "draft";
  storedElements: number;
  revisionId?: number | null;
}

export type BrowserSitePageKey = "home" | "thoughts" | "policies" | "activities" | "profile" | "contact";

export interface BrowserSitePrepareInput {
  siteKey: string;
  title: string;
  menuName: string;
  pages: Array<{
    key: BrowserSitePageKey;
    title: string;
    slug: string;
    sourceKey: string;
  }>;
}

export interface BrowserPreparedSitePage extends BrowserWordPressResult {
  key: BrowserSitePageKey;
  title: string;
  sourceKey: string;
  created: boolean;
  updated: boolean;
}

export interface BrowserPreparedSiteResult {
  siteKey: string;
  title: string;
  status: "draft";
  pages: BrowserPreparedSitePage[];
  menu: null | {
    id: number;
    name: string;
    editLink: string;
    assigned: boolean;
    assignedLocations: string[];
    items: Array<{
      id: number;
      pageId: number;
      key: BrowserSitePageKey;
      title: string;
      rawLink: string;
    }>;
  };
  warnings: string[];
}

export type BrowserDraftInput =
  | {
      target: "gutenberg";
      title: string;
      slug: string;
      content: string;
    }
  | {
      target: "elementor";
      title: string;
      slug: string;
      template: BrowserElementorTemplate;
      pageTemplate: "elementor_canvas" | "elementor_header_footer" | "default";
      requestId: string;
      sourceKey?: string;
    };

export class WordPressDirectError extends Error {
  constructor(
    message: string,
    public readonly kind: "network" | "auth" | "request",
    public readonly status?: number,
  ) {
    super(message);
  }
}

function normalizedBaseUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new WordPressDirectError("WordPress URLを正しく入力してください。", "request");
  }
  if (url.protocol !== "https:") {
    throw new WordPressDirectError("HTTPSのWordPress URLを入力してください。", "request");
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new WordPressDirectError("WordPress URLにはドメインだけを入力してください。", "request");
  }
  return url.toString().replace(/\/+$/, "");
}

function basicAuthorization(username: string, applicationPassword: string): string {
  const bytes = new TextEncoder().encode(`${username}:${applicationPassword}`);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `Basic ${btoa(binary)}`;
}

function hexEncodePairingToken(value: string): string {
  return Array.from(
    new TextEncoder().encode(value),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
}

async function directFetch(
  config: BrowserWordPressConfig,
  path: string,
  init: RequestInit = {},
  pairingBody?: Record<string, string | number>,
  pairingTokenTransport: "plain" | "hex" = "plain",
): Promise<Response> {
  const method = (init.method ?? "GET").toUpperCase();
  const timeoutMs = method === "GET" || method === "HEAD" ? 20_000 : 120_000;
  const headers = new Headers(init.headers);
  headers.set("Accept", "application/json");
  const connectorToken = config.connectorToken?.trim();
  const usePairingBody = Boolean(connectorToken && pairingBody);
  const authorization = connectorToken
    ? ""
    : basicAuthorization(config.username, config.applicationPassword);
  if (connectorToken && !usePairingBody) {
    headers.set("X-FigmaPress-Token", connectorToken);
  } else {
    if (!connectorToken) headers.set("Authorization", authorization);
  }
  let effectiveBody = init.body;
  if (usePairingBody && connectorToken && pairingBody) {
    const form = new URLSearchParams();
    form.set(
      pairingTokenTransport === "hex"
        ? "figmapress_token_hex"
        : "figmapress_token",
      pairingTokenTransport === "hex"
        ? hexEncodePairingToken(connectorToken)
        : connectorToken,
    );
    for (const [key, value] of Object.entries(pairingBody)) {
      form.set(key, String(value));
    }
    effectiveBody = form;
  } else if (effectiveBody && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  try {
    // `cache: "no-store"` makes Chrome add Cache-Control and Pragma to the
    // CORS preflight, which WordPress does not allow by default.
    const url = `${normalizedBaseUrl(config.baseUrl)}/wp-json${path}`;
    const requestInit: RequestInit = {
      ...init,
      body: effectiveBody,
      credentials: "omit",
      headers,
      mode: "cors",
      redirect: "error",
      signal: init.signal ?? AbortSignal.timeout(timeoutMs),
    };
    const response = await fetch(url, requestInit);
    if (response.status !== 401 || connectorToken) {
      if (!response.ok) {
        console.warn("[wordpress-direct] WordPress request rejected", {
          path,
          method,
          status: response.status,
          fallbackAuth: false,
        });
      }
      return response;
    }

    // Some shared hosts remove the standard Authorization header before PHP.
    // The Connector accepts the same Basic value in a namespaced fallback
    // header. Give the retry a fresh timeout: the authenticated POST can spend
    // considerably longer importing media than the rejected first attempt.
    const fallbackHeaders = new Headers(headers);
    fallbackHeaders.set("X-FigmaPress-Authorization", authorization);
    try {
      const fallbackResponse = await fetch(url, {
        ...requestInit,
        headers: fallbackHeaders,
        signal: init.signal ?? AbortSignal.timeout(timeoutMs),
      });
      if (!fallbackResponse.ok) {
        console.warn("[wordpress-direct] WordPress request rejected", {
          path,
          method,
          status: fallbackResponse.status,
          fallbackAuth: true,
        });
      }
      return fallbackResponse;
    } catch (error) {
      const errorName = error instanceof Error ? error.name : "UnknownError";
      console.warn("[wordpress-direct] Fallback authentication request failed", {
        path,
        method,
        errorName,
      });
      throw error;
    }
  } catch (error) {
    const errorName = error instanceof Error ? error.name : "UnknownError";
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`[wordpress-direct] Browser request failed: ${errorName}: ${errorMessage}`);
    throw new WordPressDirectError(
      errorName === "TimeoutError" && method !== "GET" && method !== "HEAD"
        ? "WordPressの下書き作成がタイムアウトしました。処理が継続している場合があるため、WordPressの下書き一覧を確認してください。"
        : "ブラウザからWordPressへ直接接続できませんでした。",
      "network",
    );
  }
}

async function failureMessage(
  response: Response,
  connectorToken?: string,
): Promise<WordPressDirectError> {
  if (response.status === 401) {
    return new WordPressDirectError(
      connectorToken
        ? "WordPress接続が無効または期限切れです。Connectorから再接続してください。"
        : "WordPressのユーザー名またはApplication Passwordが無効です。",
      "auth",
      401,
    );
  }

  let message = "WordPressがリクエストを受け付けませんでした。";
  try {
    const parsed = JSON.parse(await response.text()) as { message?: unknown };
    if (typeof parsed.message === "string") message = parsed.message.slice(0, 300);
  } catch {
    // Do not expose HTML error pages returned by a hosting WAF.
  }
  return new WordPressDirectError(`${message}（HTTP ${response.status}）`, "request", response.status);
}

async function responseJson<T>(
  response: Response,
  connectorToken?: string,
): Promise<T> {
  if (!response.ok) {
    throw await failureMessage(response, connectorToken);
  }
  try {
    return await response.json() as T;
  } catch {
    throw new WordPressDirectError("WordPressの応答形式を確認できませんでした。", "request", response.status);
  }
}

export async function probeWordPressDirect(
  config: BrowserWordPressConfig,
): Promise<BrowserWordPressStatus> {
  const response = await directFetch(config, "/figmapress/v1/status");
  if (response.status === 404) {
    const user = await responseJson<{ id?: unknown; name?: unknown }>(
      await directFetch(config, "/wp/v2/users/me"),
      config.connectorToken,
    );
    return {
      authenticated: true,
      user: {
        id: typeof user.id === "number" ? user.id : 0,
        name: typeof user.name === "string" ? user.name : config.username,
      },
      connectorInstalled: false,
      elementor: { active: false },
      canEditPages: false,
    };
  }

  const status = await responseJson<{
    connectorVersion?: unknown;
    wordpressVersion?: unknown;
    canEditPages?: unknown;
    user?: { id?: unknown; name?: unknown };
    pairing?: { supported?: unknown; active?: unknown };
    elementor?: { active?: unknown; version?: unknown };
    functionalWidgets?: {
      navigation?: unknown;
      links?: unknown;
      carousel?: unknown;
      contactForm?: unknown;
      accordion?: unknown;
    };
    visualQa?: {
      snapshot?: unknown;
      documentUpdate?: unknown;
      revisions?: unknown;
      webfonts?: unknown;
      gradients?: unknown;
      effects?: unknown;
      imageTransforms?: unknown;
      mediaPersistence?: unknown;
    };
    siteBuild?: { pages?: unknown; menus?: unknown; bridge?: unknown };
  }>(response, config.connectorToken);
  return {
    authenticated: true,
    user: {
      id: typeof status.user?.id === "number" ? status.user.id : 0,
      name: typeof status.user?.name === "string"
        ? status.user.name
        : config.username,
    },
    connectorInstalled: true,
    connectorVersion: typeof status.connectorVersion === "string" ? status.connectorVersion : undefined,
    wordpressVersion: typeof status.wordpressVersion === "string" ? status.wordpressVersion : undefined,
    elementor: {
      active: status.elementor?.active === true,
      version: typeof status.elementor?.version === "string" ? status.elementor.version : undefined,
    },
    functionalWidgets: status.functionalWidgets ? {
      navigation: status.functionalWidgets.navigation === true,
      ...(status.functionalWidgets.links !== undefined
        ? { links: status.functionalWidgets.links === true }
        : {}),
      ...(status.functionalWidgets.carousel !== undefined
        ? { carousel: status.functionalWidgets.carousel === true }
        : {}),
      contactForm: status.functionalWidgets.contactForm === true,
      accordion: status.functionalWidgets.accordion === true,
    } : undefined,
    visualQa: status.visualQa ? {
      snapshot: status.visualQa.snapshot === true,
      documentUpdate: status.visualQa.documentUpdate === true,
      revisions: status.visualQa.revisions === true,
      webfonts: status.visualQa.webfonts === true,
      gradients: status.visualQa.gradients === true,
      effects: status.visualQa.effects === true,
      imageTransforms: status.visualQa.imageTransforms === true,
      ...(status.visualQa.mediaPersistence !== undefined
        ? { mediaPersistence: status.visualQa.mediaPersistence === true }
        : {}),
    } : undefined,
    siteBuild: status.siteBuild ? {
      pages: status.siteBuild.pages === true,
      menus: status.siteBuild.menus === true,
      ...(status.siteBuild.bridge !== undefined
        ? { bridge: status.siteBuild.bridge === true }
        : {}),
    } : undefined,
    canEditPages: status.canEditPages === true,
    pairing: status.pairing ? {
      supported: status.pairing.supported === true,
      active: status.pairing.active === true,
    } : undefined,
  };
}

export async function prepareWordPressSiteDirect(
  config: BrowserWordPressConfig,
  input: BrowserSitePrepareInput,
): Promise<BrowserPreparedSiteResult> {
  const payload = JSON.stringify({
    ...input,
    pages: input.pages.map((page) => ({
      ...page,
      slug: normalizeSlug(page.slug),
    })),
  });
  const result = await responseJson<BrowserPreparedSiteResult>(
    await directFetch(config, "/figmapress/v1/elementor/site-prepare", {
      method: "POST",
      body: config.connectorToken ? undefined : payload,
    }, config.connectorToken ? { payload } : undefined, "hex"),
    config.connectorToken,
  );
  if (result.status !== "draft" || result.pages.some((page) => page.status !== "draft")) {
    throw new WordPressDirectError("WordPressが下書き以外のページ状態を返しました。", "request");
  }
  return result;
}

function normalizeSlug(value: string): string {
  if (!value || value === "/") return "home";
  return value.replace(/^\/+|\/+$/g, "").replace(/\//g, "-") || "home";
}

export async function createWordPressDraftDirect(
  config: BrowserWordPressConfig,
  input: BrowserDraftInput,
): Promise<BrowserWordPressResult> {
  // WordPress is authoritative for slug uniqueness. A preflight pages query can
  // reject otherwise valid status filters on hosts with restricted REST schemas.
  const slug = normalizeSlug(input.slug);
  if (input.target === "elementor") {
    const result = await responseJson<BrowserWordPressResult>(
      await directFetch(config, "/figmapress/v1/elementor/pages", {
        method: "POST",
        body: JSON.stringify({
          title: input.title,
          slug,
          status: "draft",
          requestId: input.requestId,
          sourceKey: input.sourceKey,
          pageTemplate: input.pageTemplate,
          template: input.template,
        }),
      }),
      config.connectorToken,
    );
    if (result.status !== "draft") {
      throw new WordPressDirectError("WordPressが下書き以外の状態を返しました。", "request");
    }
    return { ...result, target: "elementor" };
  }

  const result = await responseJson<{
    id: number;
    slug: string;
    status: string;
    link?: string;
    editLink?: string;
    previewLink?: string;
    rawLink?: string;
  }>(
    await directFetch(
      config,
      config.connectorToken
        ? "/figmapress/v1/gutenberg/pages"
        : "/wp/v2/pages",
      {
      method: "POST",
      body: JSON.stringify({
        title: input.title,
        slug,
        status: "draft",
        content: input.content,
      }),
      },
    ),
    config.connectorToken,
  );
  if (result.status !== "draft") {
    throw new WordPressDirectError("WordPressが下書き以外の状態を返しました。", "request");
  }
  const baseUrl = normalizedBaseUrl(config.baseUrl);
  return {
    id: result.id,
    slug: result.slug,
    status: result.status,
    editLink: result.editLink
      ?? `${baseUrl}/wp-admin/post.php?post=${result.id}&action=edit`,
    previewLink: result.previewLink
      ?? (
        result.link
          ? `${result.link}${result.link.includes("?") ? "&" : "?"}preview=true`
          : undefined
      ),
    rawLink: result.rawLink ?? result.link,
    target: "gutenberg",
  };
}

function base64Bytes(bytes: Uint8Array): string {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 8_192) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 8_192));
  }
  return btoa(binary);
}

function splitUtf8Bytes(bytes: Uint8Array, maxBytes: number): Uint8Array[] {
  const chunks: Uint8Array[] = [];
  let start = 0;
  while (start < bytes.byteLength) {
    let end = Math.min(start + maxBytes, bytes.byteLength);
    // A MySQL TEXT column validates each append independently. Never end a
    // request inside a multi-byte UTF-8 sequence, otherwise Japanese content
    // can be rejected even though the reconstructed JSON would be valid.
    while (end < bytes.byteLength && (bytes[end] & 0xc0) === 0x80) {
      end -= 1;
    }
    if (end <= start) {
      throw new WordPressDirectError(
        "Elementorデータを安全な文字境界で分割できませんでした。",
        "request",
        422,
      );
    }
    chunks.push(bytes.subarray(start, end));
    start = end;
  }
  return chunks;
}

function waitForRetry(delayMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

function isRetryableChunkUploadError(error: unknown): boolean {
  return error instanceof WordPressDirectError
    && (error.kind === "network" || error.status === 409);
}

export async function createWordPressDraftChunkedDirect(
  config: BrowserWordPressConfig,
  input: Extract<BrowserDraftInput, { target: "elementor" }>,
  options: { chunkBytes?: number; maxChunks?: number; interChunkDelayMs?: number } = {},
): Promise<BrowserWordPressResult> {
  const body = JSON.stringify({
    title: input.title,
    slug: normalizeSlug(input.slug),
    status: "draft",
    requestId: input.requestId,
    sourceKey: input.sourceKey,
    pageTemplate: input.pageTemplate,
    template: input.template,
  });
  const bytes = new TextEncoder().encode(body);
  const chunkBytes = options.chunkBytes ?? 72_000;
  const maxChunks = options.maxChunks ?? 32;
  const interChunkDelayMs = options.interChunkDelayMs ?? 0;
  const chunks = splitUtf8Bytes(bytes, chunkBytes);
  const total = chunks.length;
  if (total > maxChunks) {
    throw new WordPressDirectError(
      "Elementorデータが大きすぎるため、変換対象を分割してください。",
      "request",
      413,
    );
  }

  // A shared host can finish storing the final chunk after the browser-side
  // connection has already been closed. Replaying the same request ID is safe:
  // every chunk replaces its own index and the Connector serializes the final
  // document write. Retry an interrupted upload as a whole so a lone final
  // chunk can never leave an incomplete transient behind.
  const retryDelays = [1_000, 2_500, 5_000, 10_000, 20_000, 30_000];
  for (let round = 0; round <= retryDelays.length; round += 1) {
    try {
      let result: BrowserWordPressResult | null = null;
      for (let index = 0; index < total; index += 1) {
        const chunkPayload = {
          index,
          total,
          chunk: base64Bytes(chunks[index]),
        };
        const chunkBody = JSON.stringify(chunkPayload);
        let response: Response | null = null;
        const chunkAttempts = index === total - 1 ? 1 : 3;
        for (let attempt = 0; attempt < chunkAttempts; attempt += 1) {
          try {
            response = await directFetch(
              config,
              `/figmapress/v1/elementor/uploads/${input.requestId}`,
              { method: "POST", body: chunkBody },
              chunkPayload,
            );
            break;
          } catch (error) {
            console.warn(
              `[wordpress-direct] Elementor chunk attempt failed index=${index + 1}/${total} attempt=${attempt + 1} round=${round + 1}`,
            );
            if (
              !(error instanceof WordPressDirectError)
              || error.kind !== "network"
              || attempt === chunkAttempts - 1
            ) {
              throw error;
            }
            await waitForRetry(250 * (attempt + 1));
          }
        }
        if (!response) {
          throw new WordPressDirectError(
            "WordPressへの分割送信を再開できませんでした。",
            "network",
          );
        }
        const data = await responseJson<BrowserWordPressResult & { complete?: boolean }>(
          response,
          config.connectorToken,
        );
        if (data.status === "draft") {
          result = data;
          break;
        }
        if (data.complete !== false) {
          throw new WordPressDirectError(
            "WordPressの分割受信状態を確認できませんでした。",
            "request",
          );
        }
        if (index === total - 1) {
          throw new WordPressDirectError(
            "WordPressが下書きを保存中です。",
            "request",
            409,
          );
        }
        if (interChunkDelayMs > 0) {
          await waitForRetry(interChunkDelayMs);
        }
      }
      if (!result || result.status !== "draft") {
        throw new WordPressDirectError("WordPressが下書き以外の状態を返しました。", "request");
      }
      return { ...result, target: "elementor" };
    } catch (error) {
      if (!isRetryableChunkUploadError(error) || round === retryDelays.length) {
        throw error;
      }
      await waitForRetry(retryDelays[round] ?? 6_000);
    }
  }
  throw new WordPressDirectError("WordPressへの分割送信を完了できませんでした。", "network");
}

export async function localizeWordPressElementorMediaDirect(
  config: BrowserWordPressConfig,
  postId: number,
  requestId: string,
  retryFailed = false,
): Promise<BrowserElementorMediaProgress> {
  return responseJson<BrowserElementorMediaProgress>(
    await directFetch(config, `/figmapress/v1/elementor/pages/${postId}/media`, {
      method: "POST",
      body: JSON.stringify({ requestId, retryFailed }),
    }),
    config.connectorToken,
  );
}

export async function fetchWordPressElementorSnapshotDirect(
  config: BrowserWordPressConfig,
  postId: number,
  requestId: string,
): Promise<BrowserElementorSnapshot> {
  return responseJson<BrowserElementorSnapshot>(
    await directFetch(config, `/figmapress/v1/elementor/pages/${postId}/snapshot`, {
      method: "POST",
      body: JSON.stringify({ requestId }),
    }),
    config.connectorToken,
  );
}

export async function updateWordPressElementorDocumentDirect(
  config: BrowserWordPressConfig,
  input: {
    postId: number;
    requestId: string;
    template: BrowserElementorTemplate;
    pageTemplate: "elementor_canvas" | "elementor_header_footer" | "default";
  },
): Promise<BrowserElementorDocumentResult> {
  return responseJson<BrowserElementorDocumentResult>(
    await directFetch(
      config,
      `/figmapress/v1/elementor/pages/${input.postId}/document`,
      {
        method: "PUT",
        body: JSON.stringify({
          requestId: input.requestId,
          template: input.template,
          pageTemplate: input.pageTemplate,
        }),
      },
    ),
    config.connectorToken,
  );
}
