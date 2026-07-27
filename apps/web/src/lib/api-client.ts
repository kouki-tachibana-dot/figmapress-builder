export async function readApi<T>(response: Response): Promise<T> {
  const raw = await response.text();
  let data: { ok?: boolean; error?: string } & T;
  try {
    data = JSON.parse(raw) as { ok?: boolean; error?: string } & T;
  } catch {
    if (response.status === 504) {
      throw new Error(
        "Figmaファイルの読込に時間がかかっています。対象フレームのURLを指定して、もう一度お試しください。",
      );
    }
    throw new Error(
      response.ok
        ? "サーバーから正しい応答を受け取れませんでした。"
        : `処理に失敗しました（HTTP ${response.status}）。`,
    );
  }
  if (!response.ok || data.ok === false) {
    throw new Error(data.error || "処理に失敗しました。");
  }
  return data;
}
