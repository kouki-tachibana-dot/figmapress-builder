// Shared WordPress hosts commonly terminate long browser-originated writes
// once a complex Elementor document reaches roughly half a megabyte.
export const LARGE_ELEMENTOR_PAYLOAD_BYTES = 450_000;

export type WordPressTransport = "direct" | "proxy" | null;

/**
 * Keep browser-direct writes as the fast path, but retry through the server
 * when a shared host terminates only the cross-origin POST. Authentication and
 * WordPress validation failures must remain visible and never trigger the
 * fallback.
 */
export async function runWordPressWriteWithNetworkFallback<T>(
  transport: WordPressTransport,
  directWrite: () => Promise<T>,
  proxyWrite: () => Promise<T>,
  isNetworkFailure: (error: unknown) => boolean,
): Promise<T> {
  if (transport !== "direct") return proxyWrite();
  try {
    return await directWrite();
  } catch (error) {
    if (!isNetworkFailure(error)) throw error;
    return proxyWrite();
  }
}

export function shouldProxyWordPressDraft(
  transport: WordPressTransport,
  target: "gutenberg" | "elementor",
  payloadBytes: number,
  directLargeElementorUploads = false,
): boolean {
  if (transport !== "direct") return true;
  if (target === "elementor" && directLargeElementorUploads) return false;
  return target === "elementor" && payloadBytes >= LARGE_ELEMENTOR_PAYLOAD_BYTES;
}
