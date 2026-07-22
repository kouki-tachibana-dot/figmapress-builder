/**
 * WordPress REST client for Gutenberg and Elementor draft creation.
 *
 * Auth: Application Passwords (Basic). Never `publish` — spec §5-4.
 * Slug normalization: Blueprint may use "/" for root; WordPress can't
 * accept that as a slug, so we map it to "home" (or `home-figmapress` on
 * conflict — see §5-6).
 */

export interface WpConfig {
  baseUrl: string;
  username: string;
  applicationPassword: string;
}

export interface CreateDraftInput {
  title: string;
  /** Blueprint-style slug, may be "/" — will be normalized. */
  slug: string;
  /** Gutenberg block-comment HTML. */
  content: string;
}

export interface CreateDraftResult {
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

export interface ElementorTemplateInput {
  title: string;
  type: "page";
  version: "0.4";
  page_settings: Record<string, unknown>;
  content: unknown[];
}

export interface CreateElementorDraftInput {
  title: string;
  slug: string;
  template: ElementorTemplateInput;
  pageTemplate?: "elementor_canvas" | "elementor_header_footer" | "default";
}

export interface WordPressConnectionStatus {
  authenticated: true;
  user: { id: number; name: string };
  connectorInstalled: boolean;
  connectorVersion?: string;
  wordpressVersion?: string;
  elementor: { active: boolean; version?: string };
  canEditPages: boolean;
}

export class WpAuthError extends Error {}
export class WpRequestError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body: string,
  ) {
    super(message);
  }
}

export function loadWpConfigFromEnv(env: NodeJS.ProcessEnv = process.env): WpConfig {
  const baseUrl = (env.WORDPRESS_BASE_URL ?? "").trim().replace(/\/+$/, "");
  const username = (env.WORDPRESS_USERNAME ?? "").trim();
  const applicationPassword = (env.WORDPRESS_APPLICATION_PASSWORD ?? "").trim();
  if (!baseUrl || !username || !applicationPassword) {
    throw new Error(
      "Missing WordPress credentials. Set WORDPRESS_BASE_URL, WORDPRESS_USERNAME, WORDPRESS_APPLICATION_PASSWORD in .env",
    );
  }
  return { baseUrl, username, applicationPassword };
}

export function normalizeSlug(blueprintSlug: string): string {
  if (!blueprintSlug || blueprintSlug === "/") return "home";
  return blueprintSlug.replace(/^\/+|\/+$/g, "").replace(/\//g, "-") || "home";
}

const PAGE_STATUS_FILTER = "publish,future,draft,pending,private";

function authHeader(cfg: WpConfig): string {
  const raw = `${cfg.username}:${cfg.applicationPassword}`;
  return `Basic ${Buffer.from(raw, "utf-8").toString("base64")}`;
}

async function wpFetch(
  cfg: WpConfig,
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const url = `${cfg.baseUrl}/wp-json${path}`;
  const headers = new Headers(init.headers);
  const authorization = authHeader(cfg);
  headers.set("Authorization", authorization);
  headers.set("Accept", "application/json");
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const requestInit: RequestInit = {
    ...init,
    headers,
    redirect: "error",
    signal: init.signal ?? AbortSignal.timeout(15_000),
  };
  let res = await fetch(url, requestInit);
  if (res.status === 401) {
    const fallbackHeaders = new Headers(headers);
    fallbackHeaders.set("X-FigmaPress-Authorization", authorization);
    res = await fetch(url, { ...requestInit, headers: fallbackHeaders });
  }
  if (res.status === 401) {
    const body = await res.text();
    throw new WpAuthError(
      `WordPress authentication failed (${res.status}). Verify WORDPRESS_USERNAME and WORDPRESS_APPLICATION_PASSWORD.\n${body}`,
    );
  }
  return res;
}

export async function probeWordPressConnection(
  cfg: WpConfig,
): Promise<WordPressConnectionStatus> {
  // The Connector status route already proves authentication and reports the
  // capability needed by FigmaPress. Probe it first so REST-hardening plugins
  // that block the core users endpoint do not break an otherwise valid setup.
  const statusResponse = await wpFetch(cfg, "/figmapress/v1/status");
  if (statusResponse.status === 404) {
    // A missing Connector route cannot prove that the supplied credentials are
    // valid, so fall back to the least-privileged current-user context.
    const userResponse = await wpFetch(cfg, "/wp/v2/users/me");
    const userText = await userResponse.text();
    if (!userResponse.ok) {
      throw new WpRequestError(
        `Failed to inspect WordPress user (HTTP ${userResponse.status})`,
        userResponse.status,
        userText,
      );
    }
    const user = JSON.parse(userText) as { id?: unknown; name?: unknown };
    return {
      authenticated: true,
      user: {
        id: typeof user.id === "number" ? user.id : 0,
        name: typeof user.name === "string" ? user.name : cfg.username,
      },
      connectorInstalled: false,
      elementor: { active: false },
      canEditPages: false,
    };
  }

  const statusText = await statusResponse.text();
  if (!statusResponse.ok) {
    throw new WpRequestError(
      `Failed to inspect FigmaPress Connector (HTTP ${statusResponse.status})`,
      statusResponse.status,
      statusText,
    );
  }
  const status = JSON.parse(statusText) as {
    connectorVersion?: unknown;
    wordpressVersion?: unknown;
    canEditPages?: unknown;
    elementor?: { active?: unknown; version?: unknown };
  };
  return {
    authenticated: true,
    user: {
      id: 0,
      name: cfg.username,
    },
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

async function slugExists(cfg: WpConfig, slug: string): Promise<boolean> {
  const res = await wpFetch(
    cfg,
    `/wp/v2/pages?slug=${encodeURIComponent(slug)}&status=${encodeURIComponent(PAGE_STATUS_FILTER)}&per_page=1&context=edit`,
  );
  if (!res.ok) return false;
  const data = (await res.json()) as unknown[];
  return Array.isArray(data) && data.length > 0;
}

async function pickAvailableSlug(cfg: WpConfig, desired: string): Promise<string> {
  if (!(await slugExists(cfg, desired))) return desired;
  const fallback = `${desired}-figmapress`;
  if (!(await slugExists(cfg, fallback))) return fallback;
  return `${fallback}-${Date.now()}`;
}

export async function createDraftPage(
  cfg: WpConfig,
  input: CreateDraftInput,
): Promise<CreateDraftResult> {
  const desiredSlug = normalizeSlug(input.slug);
  const slug = await pickAvailableSlug(cfg, desiredSlug);

  const res = await wpFetch(cfg, "/wp/v2/pages", {
    method: "POST",
    body: JSON.stringify({
      title: input.title,
      slug,
      status: "draft",
      content: input.content,
    }),
  });

  const text = await res.text();
  if (!res.ok) {
    throw new WpRequestError(
      `Failed to create draft page (HTTP ${res.status})`,
      res.status,
      text,
    );
  }
  const data = JSON.parse(text) as {
    id: number;
    slug: string;
    status: string;
    link?: string;
  };

  if (data.status !== "draft") {
    throw new WpRequestError(
      `WordPress returned an unexpected page status: ${data.status}`,
      502,
      text,
    );
  }

  const editLink = `${cfg.baseUrl}/wp-admin/post.php?post=${data.id}&action=edit`;
  const previewLink = data.link ? `${data.link}${data.link.includes("?") ? "&" : "?"}preview=true` : undefined;

  return {
    id: data.id,
    slug: data.slug,
    status: data.status,
    editLink,
    previewLink,
    rawLink: data.link,
    target: "gutenberg",
  };
}

export async function createElementorDraftPage(
  cfg: WpConfig,
  input: CreateElementorDraftInput,
): Promise<CreateDraftResult> {
  const desiredSlug = normalizeSlug(input.slug);
  const slug = await pickAvailableSlug(cfg, desiredSlug);
  const res = await wpFetch(cfg, "/figmapress/v1/elementor/pages", {
    method: "POST",
    body: JSON.stringify({
      title: input.title,
      slug,
      status: "draft",
      pageTemplate: input.pageTemplate ?? "elementor_canvas",
      template: input.template,
    }),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new WpRequestError(
      `Failed to create Elementor draft (HTTP ${res.status})`,
      res.status,
      text,
    );
  }
  const data = JSON.parse(text) as CreateDraftResult;
  if (data.status !== "draft") {
    throw new WpRequestError(
      `WordPress returned an unexpected page status: ${data.status}`,
      502,
      text,
    );
  }
  return { ...data, target: "elementor" };
}
