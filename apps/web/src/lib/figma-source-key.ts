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

/** Stable identity for a complete multi-page site, independent of preview selection. */
export function figmaSiteSourceKey(input: string): string | undefined {
  const identity = parseFigmaSourceIdentity(input);
  if (!identity) return undefined;
  return `figma:${identity.fileKey}:root`;
}
