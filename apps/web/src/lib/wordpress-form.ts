export interface WordPressCredentials {
  baseUrl: string;
  username: string;
  applicationPassword: string;
}

export function readWordPressCredentials(
  data: FormData | null,
  fallback: WordPressCredentials,
): WordPressCredentials {
  if (!data) return fallback;
  return {
    baseUrl: String(data.get("baseUrl") ?? fallback.baseUrl).trim(),
    username: String(data.get("username") ?? fallback.username).trim(),
    applicationPassword: String(data.get("applicationPassword") ?? fallback.applicationPassword),
  };
}
