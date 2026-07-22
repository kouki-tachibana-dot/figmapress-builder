export interface BrowserWordPressConfig {
  baseUrl: string;
  username: string;
  applicationPassword: string;
}

export interface BrowserWordPressStatus {
  authenticated: true;
  user: { id: number; name: string };
  connectorInstalled: boolean;
  connectorVersion?: string;
  wordpressVersion?: string;
  elementor: { active: boolean; version?: string };
  canEditPages: boolean;
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
  warnings?: string[];
}

interface BrowserElementorTemplate {
  title: string;
  type: "page";
  version: "0.4";
  page_settings: Record<string, unknown>;
  content: unknown[];
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

async function directFetch(
  config: BrowserWordPressConfig,
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const method = (init.method ?? "GET").toUpperCase();
  const timeoutMs = method === "GET" || method === "HEAD" ? 20_000 : 120_000;
  const headers = new Headers(init.headers);
  headers.set("Accept", "application/json");
  const authorization = basicAuthorization(config.username, config.applicationPassword);
  headers.set("Authorization", authorization);
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");

  try {
    // `cache: "no-store"` makes Chrome add Cache-Control and Pragma to the
    // CORS preflight, which WordPress does not allow by default.
    const url = `${normalizedBaseUrl(config.baseUrl)}/wp-json${path}`;
    const requestInit: RequestInit = {
      ...init,
      credentials: "omit",
      headers,
      mode: "cors",
      redirect: "error",
      signal: init.signal ?? AbortSignal.timeout(timeoutMs),
    };
    const response = await fetch(url, requestInit);
    if (response.status !== 401) {
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

async function failureMessage(response: Response): Promise<WordPressDirectError> {
  if (response.status === 401) {
    return new WordPressDirectError(
      "WordPressのユーザー名またはApplication Passwordが無効です。",
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

async function responseJson<T>(response: Response): Promise<T> {
  if (!response.ok) throw await failureMessage(response);
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
    elementor?: { active?: unknown; version?: unknown };
  }>(response);
  return {
    authenticated: true,
    user: { id: 0, name: config.username },
    connectorInstalled: true,
    connectorVersion: typeof status.connectorVersion === "string" ? status.connectorVersion : undefined,
    wordpressVersion: typeof status.wordpressVersion === "string" ? status.wordpressVersion : undefined,
    elementor: {
      active: status.elementor?.active === true,
      version: typeof status.elementor?.version === "string" ? status.elementor.version : undefined,
    },
    canEditPages: status.canEditPages === true,
  };
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
          pageTemplate: input.pageTemplate,
          template: input.template,
        }),
      }),
    );
    if (result.status !== "draft") {
      throw new WordPressDirectError("WordPressが下書き以外の状態を返しました。", "request");
    }
    return { ...result, target: "elementor" };
  }

  const result = await responseJson<{ id: number; slug: string; status: string; link?: string }>(
    await directFetch(config, "/wp/v2/pages", {
      method: "POST",
      body: JSON.stringify({
        title: input.title,
        slug,
        status: "draft",
        content: input.content,
      }),
    }),
  );
  if (result.status !== "draft") {
    throw new WordPressDirectError("WordPressが下書き以外の状態を返しました。", "request");
  }
  const baseUrl = normalizedBaseUrl(config.baseUrl);
  return {
    id: result.id,
    slug: result.slug,
    status: result.status,
    editLink: `${baseUrl}/wp-admin/post.php?post=${result.id}&action=edit`,
    previewLink: result.link
      ? `${result.link}${result.link.includes("?") ? "&" : "?"}preview=true`
      : undefined,
    rawLink: result.link,
    target: "gutenberg",
  };
}
