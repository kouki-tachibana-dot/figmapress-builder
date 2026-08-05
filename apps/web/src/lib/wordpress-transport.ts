export const LARGE_ELEMENTOR_PAYLOAD_BYTES = 750_000;

export function shouldProxyWordPressDraft(
  transport: "direct" | "proxy" | null,
  target: "gutenberg" | "elementor",
  payloadBytes: number,
): boolean {
  if (transport !== "direct") return true;
  return target === "elementor" && payloadBytes >= LARGE_ELEMENTOR_PAYLOAD_BYTES;
}
