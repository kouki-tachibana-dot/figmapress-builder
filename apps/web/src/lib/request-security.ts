import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

const buckets = new Map<string, { count: number; resetAt: number }>();

export class RequestError extends Error {
  constructor(
    message: string,
    public readonly status = 400,
  ) {
    super(message);
  }
}

export function clientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || request.headers.get("x-real-ip") || "unknown";
}

export function enforceSameOrigin(request: Request): void {
  const origin = request.headers.get("origin");
  if (!origin) return;

  const requestHost =
    request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  let originHost = "";
  try {
    originHost = new URL(origin).host;
  } catch {
    throw new RequestError("不正なリクエスト元です。", 403);
  }
  if (!requestHost || originHost !== requestHost) {
    throw new RequestError("別のサイトからのAPI呼び出しは許可されていません。", 403);
  }
}

export function enforceRateLimit(
  scope: string,
  ip: string,
  limit: number,
  windowMs: number,
): void {
  const now = Date.now();
  const key = `${scope}:${ip}`;
  const current = buckets.get(key);

  if (!current || current.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return;
  }

  if (current.count >= limit) {
    throw new RequestError(
      "短時間にリクエストが集中しています。少し待ってから再試行してください。",
      429,
    );
  }
  current.count += 1;

  if (buckets.size > 2_000) {
    for (const [bucketKey, bucket] of buckets) {
      if (bucket.resetAt <= now) buckets.delete(bucketKey);
    }
  }
}

export async function readJsonBody(
  request: Request,
  maxBytes = 1_500_000,
): Promise<unknown> {
  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (declaredLength > maxBytes) {
    throw new RequestError("送信データが大きすぎます。", 413);
  }

  const raw = await request.text();
  if (Buffer.byteLength(raw, "utf8") > maxBytes) {
    throw new RequestError("送信データが大きすぎます。", 413);
  }

  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw new RequestError("JSONの形式が正しくありません。");
  }
}

export function isPrivateOrReservedIp(address: string): boolean {
  const version = isIP(address);
  if (version === 4) {
    const octets = address.split(".").map(Number);
    const [a, b] = octets;
    if (octets.length !== 4 || octets.some((part) => part < 0 || part > 255)) {
      return true;
    }
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 0) ||
      (a === 192 && b === 168) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224
    );
  }

  if (version === 6) {
    const value = address.toLowerCase();
    if (value.startsWith("::ffff:")) {
      return isPrivateOrReservedIp(value.slice(7));
    }
    return (
      value === "::" ||
      value === "::1" ||
      value.startsWith("fc") ||
      value.startsWith("fd") ||
      /^fe[89ab]/.test(value) ||
      value.startsWith("ff")
    );
  }

  return true;
}

export async function assertSafeWordPressUrl(input: string): Promise<string> {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new RequestError("WordPress URLを正しく入力してください。");
  }

  if (url.protocol !== "https:") {
    throw new RequestError("公開版ではHTTPSのWordPressサイトのみ接続できます。");
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new RequestError("WordPress URLに認証情報・クエリ・ハッシュは含められません。");
  }

  let addresses: Array<{ address: string }>;
  try {
    addresses = await lookup(url.hostname, { all: true, verbatim: true });
  } catch {
    throw new RequestError("WordPressサイトのホスト名を確認できませんでした。", 502);
  }
  if (!addresses.length || addresses.some(({ address }) => isPrivateOrReservedIp(address))) {
    throw new RequestError("ローカルネットワークや内部IPには接続できません。", 403);
  }

  return url.toString().replace(/\/+$/, "");
}

export function jsonResponse(body: unknown, status = 200): Response {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store, max-age=0",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export function errorResponse(error: unknown): Response {
  if (error instanceof RequestError) {
    return jsonResponse({ ok: false, error: error.message }, error.status);
  }
  return jsonResponse(
    { ok: false, error: "処理に失敗しました。時間をおいて再試行してください。" },
    500,
  );
}
