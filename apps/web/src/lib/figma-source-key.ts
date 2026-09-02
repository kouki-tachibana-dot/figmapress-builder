interface FigmaSourceIdentity {
  fileKey: string;
  nodeId: string;
}

function parseFigmaSourceIdentity(input: string): FigmaSourceIdentity | null {
  const value = input.trim();
  let fileKey = "";
  let nodeId = "root";
  if (/^[A-Za-z0-9_-]{6,160}$/.test(value)) {
    fileKey = value;
  } else {
    try {
      const url = new URL(value);
      if (!/(^|\.)figma\.com$/i.test(url.hostname)) return null;
      const parts = url.pathname.split("/").filter(Boolean);
      const typeIndex = parts.findIndex((part) =>
        ["design", "file", "proto", "board"].includes(part),
      );
      const candidate = typeIndex >= 0 ? parts[typeIndex + 1] ?? "" : "";
      if (!/^[A-Za-z0-9_-]{6,160}$/.test(candidate)) return null;
      fileKey = candidate;
      const rawNodeId = url.searchParams.get("node-id")?.trim() ?? "";
      if (/^[0-9]+(?::|-)[0-9]+$/.test(rawNodeId)) {
        nodeId = rawNodeId.replace("-", ":");
      }
    } catch {
      return null;
    }
  }
  return { fileKey, nodeId };
}

/** Stable identity for one selected Figma page conversion. */
export function figmaSourceKey(
  input: string,
  selectedFrameId?: string,
): string | undefined {
  const identity = parseFigmaSourceIdentity(input);
  if (!identity) return undefined;
  return `figma:${identity.fileKey}:${selectedFrameId || identity.nodeId}`;
}

/**
 * Creates an isolated identity for a review draft without changing the stable
 * identity used by the production draft. Reusing the same request id remains
 * idempotent while a fresh conversion creates a new review copy.
 */
export function figmaReviewSourceKey(
  sourceKey: string | undefined,
  requestId: string,
): string | undefined {
  if (!sourceKey) return undefined;
  const baseKey = sourceKey.replace(/:page:[a-z0-9-]{1,80}$/i, "");
  if (!/^figma:[A-Za-z0-9_-]{6,160}:(?:root|[0-9]+:[0-9]+)$/.test(baseKey)) {
    return undefined;
  }
  const reviewId = requestId.replace(/[^a-f0-9]/gi, "").toLowerCase().slice(0, 16);
  if (reviewId.length < 8) return undefined;
  return `${baseKey}:page:review-${reviewId}`;
}

/** Node id carried by a focused Figma URL, when it names a real frame. */
export function figmaFrameId(input: string): string | undefined {
  const identity = parseFigmaSourceIdentity(input);
  return identity && identity.nodeId !== "root" ? identity.nodeId : undefined;
}

/** Stable identity for a complete multi-page site, independent of preview selection. */
export function figmaSiteSourceKey(input: string): string | undefined {
  const identity = parseFigmaSourceIdentity(input);
  if (!identity) return undefined;
  return `figma:${identity.fileKey}:root`;
}
