export const WORDPRESS_PROFILES_KEY = "figmapress:wordpress-profiles:v1";
const CONNECTOR_TOKEN_PATTERN =
  /^fp1\.[1-9][0-9]{0,19}\.[A-Za-z0-9_-]{32,128}$/;

export interface WordPressConnectionProfile {
  baseUrl: string;
  username: string;
  connectorToken?: string;
  expiresAt?: number;
  updatedAt: number;
}

function normalizeProfile(
  input: Partial<WordPressConnectionProfile>,
  now = Date.now(),
): WordPressConnectionProfile | null {
  let url: URL;
  try {
    url = new URL(String(input.baseUrl ?? ""));
  } catch {
    return null;
  }
  if (
    url.protocol !== "https:"
    || url.username
    || url.password
    || url.search
    || url.hash
  ) {
    return null;
  }
  const username = String(input.username ?? "").trim().slice(0, 160);
  const connectorToken = String(input.connectorToken ?? "").trim();
  const expiresAt = Number(input.expiresAt ?? 0);
  if (
    connectorToken
    && (
      !CONNECTOR_TOKEN_PATTERN.test(connectorToken)
      || !Number.isFinite(expiresAt)
      || expiresAt <= now
      || expiresAt > now + 366 * 24 * 60 * 60 * 1_000
    )
  ) {
    return null;
  }
  if (!username) return null;
  return {
    baseUrl: url.toString().replace(/\/+$/, ""),
    username,
    ...(connectorToken ? { connectorToken, expiresAt } : {}),
    updatedAt: Number.isFinite(input.updatedAt)
      ? Number(input.updatedAt)
      : now,
  };
}

function decodeBase64Url(value: string): string {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(
    normalized.length + ((4 - normalized.length % 4) % 4),
    "=",
  );
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (character) =>
    character.charCodeAt(0)
  );
  return new TextDecoder().decode(bytes);
}

export function decodeWordPressPairingFragment(
  hash: string,
  now = Date.now(),
): WordPressConnectionProfile | null {
  const prefix = "#figmapress-connect=";
  if (!hash.startsWith(prefix)) return null;
  try {
    const encoded = decodeURIComponent(hash.slice(prefix.length));
    const parsed = JSON.parse(decodeBase64Url(encoded)) as {
      version?: unknown;
      baseUrl?: unknown;
      username?: unknown;
      connectorToken?: unknown;
      expiresAt?: unknown;
    };
    if (parsed.version !== 1) return null;
    return normalizeProfile({
      baseUrl: String(parsed.baseUrl ?? ""),
      username: String(parsed.username ?? ""),
      connectorToken: String(parsed.connectorToken ?? ""),
      expiresAt: Number(parsed.expiresAt ?? 0),
      updatedAt: now,
    }, now);
  } catch {
    return null;
  }
}

export function readWordPressProfiles(
  storage: Pick<Storage, "getItem">,
  now = Date.now(),
): WordPressConnectionProfile[] {
  try {
    const parsed = JSON.parse(
      storage.getItem(WORDPRESS_PROFILES_KEY) ?? "[]",
    ) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((profile) =>
        typeof profile === "object" && profile !== null
          ? normalizeProfile(
              profile as Partial<WordPressConnectionProfile>,
              now,
            )
          : null
      )
      .filter(
        (profile): profile is WordPressConnectionProfile => profile !== null,
      )
      .sort((left, right) => right.updatedAt - left.updatedAt)
      .slice(0, 8);
  } catch {
    return [];
  }
}

export function pruneWordPressProfiles(
  storage: Pick<Storage, "getItem" | "setItem">,
  now = Date.now(),
): WordPressConnectionProfile[] {
  const profiles = readWordPressProfiles(storage, now);
  storage.setItem(WORDPRESS_PROFILES_KEY, JSON.stringify(profiles));
  return profiles;
}

export function saveWordPressProfile(
  storage: Pick<Storage, "getItem" | "setItem">,
  profile: WordPressConnectionProfile,
  now = Date.now(),
): WordPressConnectionProfile[] {
  const normalized = normalizeProfile(
    { ...profile, updatedAt: now },
    now,
  );
  if (!normalized) return readWordPressProfiles(storage, now);
  const profiles = [
    normalized,
    ...readWordPressProfiles(storage, now).filter(
      (saved) => saved.baseUrl !== normalized.baseUrl,
    ),
  ].slice(0, 8);
  storage.setItem(WORDPRESS_PROFILES_KEY, JSON.stringify(profiles));
  return profiles;
}

export function removeWordPressProfile(
  storage: Pick<Storage, "getItem" | "setItem">,
  baseUrl: string,
  now = Date.now(),
): WordPressConnectionProfile[] {
  const profiles = readWordPressProfiles(storage, now).filter(
    (profile) => profile.baseUrl !== baseUrl,
  );
  storage.setItem(WORDPRESS_PROFILES_KEY, JSON.stringify(profiles));
  return profiles;
}
