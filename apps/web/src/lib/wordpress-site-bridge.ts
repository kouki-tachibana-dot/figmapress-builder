export type WordPressSiteBridge = {
  prepare<T>(connectorToken: string, payload: unknown): Promise<T>;
  close(): void;
};

type BridgeMessage = {
  type?: unknown;
  requestId?: unknown;
  ok?: unknown;
  status?: unknown;
  result?: unknown;
  error?: unknown;
};

const BRIDGE_READY_TIMEOUT_MS = 20_000;
const BRIDGE_REQUEST_TIMEOUT_MS = 120_000;

function isBridgeMessage(value: unknown): value is BridgeMessage {
  return typeof value === "object" && value !== null;
}

function timeoutAfter(ms: number, message: string): Promise<never> {
  return new Promise((_, reject) => {
    window.setTimeout(() => reject(new Error(message)), ms);
  });
}

export function buildWordPressSiteBridgeUrl(baseUrl: string): string {
  const url = new URL(baseUrl);
  if (url.protocol !== "https:") {
    throw new Error("WordPress安全接続にはHTTPS URLが必要です。");
  }
  if (!url.pathname.endsWith("/")) url.pathname += "/";
  url.search = "";
  url.hash = "";
  url.searchParams.set("figmapress_bridge", "1");
  return url.toString();
}

/**
 * Open a target-origin helper while the submit click still has popup
 * permission. The helper relays only the scoped site-preparation request and
 * returns its JSON response through an origin-checked postMessage channel.
 */
export function openWordPressSiteBridge(baseUrl: string): WordPressSiteBridge | null {
  const bridgeUrl = buildWordPressSiteBridgeUrl(baseUrl);
  const targetOrigin = new URL(bridgeUrl).origin;
  const popup = window.open(
    bridgeUrl,
    "figmapress-site-bridge",
    "popup,width=560,height=720",
  );
  if (!popup) return null;

  let closed = false;
  let resolveReady: (() => void) | null = null;
  const ready = new Promise<void>((resolve) => {
    resolveReady = resolve;
  });
  const onReady = (event: MessageEvent<unknown>) => {
    if (event.origin !== targetOrigin || event.source !== popup || !isBridgeMessage(event.data)) return;
    if (event.data.type === "figmapress:bridge-ready") resolveReady?.();
  };
  window.addEventListener("message", onReady);

  const close = () => {
    if (closed) return;
    closed = true;
    window.removeEventListener("message", onReady);
    try {
      popup.close();
    } catch {
      // Cross-origin popups can already be closed by the user.
    }
  };

  return {
    async prepare<T>(connectorToken: string, payload: unknown): Promise<T> {
      if (closed) throw new Error("WordPress安全接続が閉じられました。");
      await Promise.race([
        ready,
        timeoutAfter(
          BRIDGE_READY_TIMEOUT_MS,
          "WordPress安全接続を開始できませんでした。ポップアップの許可を確認してください。",
        ),
      ]);
      const requestId = crypto.randomUUID();
      const response = new Promise<T>((resolve, reject) => {
        const onResult = (event: MessageEvent<unknown>) => {
          if (event.origin !== targetOrigin || event.source !== popup || !isBridgeMessage(event.data)) return;
          if (
            event.data.type !== "figmapress:site-prepared" ||
            event.data.requestId !== requestId
          ) return;
          window.removeEventListener("message", onResult);
          if (event.data.ok === true) {
            resolve(event.data.result as T);
            return;
          }
          const message = typeof event.data.error === "string"
            ? event.data.error
            : "WordPress安全接続で下書き準備を完了できませんでした。";
          reject(new Error(
            typeof event.data.status === "number"
              ? `${message}（HTTP ${event.data.status}）`
              : message,
          ));
        };
        window.addEventListener("message", onResult);
        popup.postMessage({
          type: "figmapress:prepare-site",
          requestId,
          connectorToken,
          payload,
        }, targetOrigin);
      });
      return await Promise.race([
        response,
        timeoutAfter(
          BRIDGE_REQUEST_TIMEOUT_MS,
          "WordPress安全接続がタイムアウトしました。下書き一覧を確認してください。",
        ),
      ]);
    },
    close,
  };
}
