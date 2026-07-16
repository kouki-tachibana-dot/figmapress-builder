/**
 * Minimal WordPress REST client for the MVP path:
 *   POST /wp-json/wp/v2/pages  (status: draft)
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
  headers.set("Authorization", authHeader(cfg));
  headers.set("Accept", "application/json");
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const res = await fetch(url, {
    ...init,
    headers,
    redirect: "error",
    signal: init.signal ?? AbortSignal.timeout(15_000),
  });
  if (res.status === 401 || res.status === 403) {
    const body = await res.text();
    throw new WpAuthError(
      `WordPress authentication failed (${res.status}). Verify WORDPRESS_USERNAME and WORDPRESS_APPLICATION_PASSWORD.\n${body}`,
    );
  }
  return res;
}

async function slugExists(cfg: WpConfig, slug: string): Promise<boolean> {
  const res = await wpFetch(
    cfg,
    `/wp/v2/pages?slug=${encodeURIComponent(slug)}&status=any&per_page=1&context=edit`,
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
  };
}
