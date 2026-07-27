export interface WordPressCredentials {
  baseUrl: string;
  username: string;
  applicationPassword: string;
  connectorToken?: string;
}

export function readWordPressCredentials(
  data: FormData | null,
  fallback: WordPressCredentials,
): WordPressCredentials {
  if (!data) return fallback;
  const connectorToken = String(
    data.get("connectorToken") ?? fallback.connectorToken ?? "",
  ).trim();
  return {
    baseUrl: String(data.get("baseUrl") ?? fallback.baseUrl).trim(),
    username: String(data.get("username") ?? fallback.username).trim(),
    applicationPassword: String(data.get("applicationPassword") ?? fallback.applicationPassword),
    ...(connectorToken ? { connectorToken } : {}),
  };
}
