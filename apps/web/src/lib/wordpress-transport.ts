// Shared WordPress hosts commonly terminate long browser-originated writes
// once a complex Elementor document reaches roughly half a megabyte.
export const LARGE_ELEMENTOR_PAYLOAD_BYTES = 450_000;

export function shouldProxyWordPressDraft(
  transport: "direct" | "proxy" | null,
  target: "gutenberg" | "elementor",
  payloadBytes: number,
  directLargeElementorUploads = false,
): boolean {
  if (transport !== "direct") return true;
  if (target === "elementor" && directLargeElementorUploads) return false;
  return target === "elementor" && payloadBytes >= LARGE_ELEMENTOR_PAYLOAD_BYTES;
}
