export type WordPressSiteBridge = {
  prepare<T>(connectorToken: string, payload: unknown): Promise<T>;
  saveElementor<T>(connectorToken: string, payload: unknown): Promise<T>;
  confirmElementor<T>(connectorToken: string, payload: unknown): Promise<T>;
  localizeMedia<T>(connectorToken: string, payload: unknown): Promise<T>;
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
const BRIDGE_ELEMENTOR_TIMEOUT_MS = 180_000;
export const WORDPRESS_SITE_BRIDGE_FRAME_ID = "figmapress-site-bridge-frame";

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
 * Reuse the target-origin iframe when available, with a popup fallback for
 * older Connector versions. The helper relays only the scoped site-preparation
 * request and returns its JSON response through an origin-checked postMessage
 * channel.
 */
export function openWordPressSiteBridge(baseUrl: string): WordPressSiteBridge | null {
  const bridgeUrl = buildWordPressSiteBridgeUrl(baseUrl);
  const targetOrigin = new URL(bridgeUrl).origin;
  const frame = document.getElementById(WORDPRESS_SITE_BRIDGE_FRAME_ID);
  const embeddedWindow = frame instanceof HTMLIFrameElement
    && frame.contentWindow
    && frame.src === bridgeUrl
    ? frame.contentWindow
    : null;
  const popup = embeddedWindow
    ? null
    : window.open(
        bridgeUrl,
        "figmapress-site-bridge",
        "popup,width=560,height=720",
      );
  const bridgeWindow = embeddedWindow ?? popup;
  if (!bridgeWindow) return null;
  const activeBridgeWindow = bridgeWindow;

  let closed = false;
  let resolveReady: (() => void) | null = null;
  const ready = new Promise<void>((resolve) => {
    resolveReady = resolve;
  });
  const onReady = (event: MessageEvent<unknown>) => {
    if (event.origin !== targetOrigin || event.source !== activeBridgeWindow || !isBridgeMessage(event.data)) return;
    if (event.data.type === "figmapress:bridge-ready") resolveReady?.();
  };
  window.addEventListener("message", onReady);

  const close = () => {
    if (closed) return;
    closed = true;
    window.removeEventListener("message", onReady);
    if (popup) {
      try {
        popup.close();
      } catch {
        // Cross-origin popups can already be closed by the user.
      }
    }
  };

  return {
    async prepare<T>(connectorToken: string, payload: unknown): Promise<T> {
      return request<T>(
        "figmapress:prepare-site",
        "figmapress:site-prepared",
        connectorToken,
        payload,
        BRIDGE_REQUEST_TIMEOUT_MS,
        "WordPress安全接続がタイムアウトしました。下書き一覧を確認してください。",
      );
    },
    async saveElementor<T>(connectorToken: string, payload: unknown): Promise<T> {
      return request<T>(
        "figmapress:save-elementor",
        "figmapress:elementor-saved",
        connectorToken,
        payload,
        BRIDGE_ELEMENTOR_TIMEOUT_MS,
        "WordPress安全接続でElementorデータの保存がタイムアウトしました。下書き一覧を確認してください。",
      );
    },
    async confirmElementor<T>(connectorToken: string, payload: unknown): Promise<T> {
      return request<T>(
        "figmapress:confirm-elementor",
        "figmapress:elementor-confirmed",
        connectorToken,
        payload,
        BRIDGE_REQUEST_TIMEOUT_MS,
        "WordPress安全接続でElementor保存を確認できませんでした。",
      );
    },
    async localizeMedia<T>(connectorToken: string, payload: unknown): Promise<T> {
      return request<T>(
        "figmapress:localize-media",
        "figmapress:elementor-media",
        connectorToken,
        payload,
        BRIDGE_REQUEST_TIMEOUT_MS,
        "WordPress安全接続で画像保存がタイムアウトしました。下書き一覧を確認してください。",
      );
    },
    close,
  };

  async function request<T>(
    requestType: string,
    responseType: string,
    connectorToken: string,
    payload: unknown,
    timeoutMs: number,
    timeoutMessage: string,
  ): Promise<T> {
      if (closed) throw new Error("WordPress安全接続が閉じられました。");
      await Promise.race([
        ready,
        timeoutAfter(
          BRIDGE_READY_TIMEOUT_MS,
          "WordPress安全接続を開始できませんでした。接続画面の読み込みを確認してください。",
        ),
      ]);
      const requestId = crypto.randomUUID();
      const response = new Promise<T>((resolve, reject) => {
        const onResult = (event: MessageEvent<unknown>) => {
          if (event.origin !== targetOrigin || event.source !== activeBridgeWindow || !isBridgeMessage(event.data)) return;
          if (
            event.data.type !== responseType ||
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
        activeBridgeWindow.postMessage({
          type: requestType,
          requestId,
          connectorToken,
          payload,
        }, targetOrigin);
      });
      return await Promise.race([
        response,
        timeoutAfter(timeoutMs, timeoutMessage),
      ]);
  }
}
