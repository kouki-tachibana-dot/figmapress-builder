import { test, expect } from "@playwright/test";

// Playwright's trace snapshot injection is rejected by our no-scripts iframe.
// Keep the product sandbox intact and capture screenshots instead; console
// errors are still asserted without filtering or suppressing any messages.
test.use({ trace: "off", screenshot: "only-on-failure" });

for (const width of [1440, 390]) {
  test(`builder converts JSON through the real API and shows editable text at ${width}px`, async ({ page }) => {
    const errors: string[] = [];
    const wordpressRequests: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
    await page.route("**/api/wordpress**", route => {
      wordpressRequests.push(route.request().url());
      return route.abort();
    });
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");
    await page.getByRole("button", { name: "サンプルで試す" }).click();
    const responsePromise = page.waitForResponse(response => response.url().endsWith("/api/convert") && response.request().method() === "POST");
    await page.getByRole("button", { name: "WordPress用に変換" }).click();
    const response = await responsePromise;
    expect(response.status()).toBe(200);
    const result = await response.json();
    expect(result.ok).toBe(true);
    expect(result.elementorTemplate.content.length).toBeGreaterThan(0);
    await expect(page.getByRole("heading", { name: "変換データを生成しました" })).toBeVisible();
    await expect(page.getByText("生成完了は品質検査の合格ではありません。", { exact: false })).toBeVisible();
    await expect(page.locator(".preview-release-notice")).toHaveCount(0);
    const preview = page.frameLocator('iframe[title="生成ページのプレビュー"]');
    await expect(preview.getByRole("heading", { name: "Figma から始まる WordPress 制作" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Elementor下書きを作成" })).toBeDisabled();
    for (const frame of page.frames()) {
      const geometry = await frame.evaluate(() => ({ width: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
      expect(geometry.scroll).toBeLessThanOrEqual(geometry.width);
    }
    expect(await page.locator("[data-nextjs-dialog], .vite-error-overlay").count()).toBe(0);
    expect(wordpressRequests).toEqual([]);
    expect(errors).toEqual([]);
    await page.locator("#result").screenshot({ path: test.info().outputPath(`builder-converted-${width}.png`) });
  });
}

test("invalid JSON shows an actionable error and never claims conversion success", async ({ page }) => {
  let apiRequests = 0;
  page.on("request", request => { if (request.url().endsWith("/api/convert")) apiRequests += 1; });
  await page.goto("/");
  await page.getByRole("tab", { name: "JSONを使う" }).click();
  await page.getByRole("textbox", { name: "Figma JSON" }).fill("{broken");
  await page.getByRole("button", { name: "WordPress用に変換" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "貼り付けたJSONの形式" })).toHaveText("貼り付けたJSONの形式を確認してください。");
  await expect(page.getByRole("heading", { name: "変換データを生成しました" })).toHaveCount(0);
  expect(apiRequests).toBe(0);
});

test("missing PC reference is visible and blocks a real-Figma-mode draft", async ({ page }) => {
  const wordpressRequests: string[] = [];
  await page.route("**/api/wordpress**", route => {
    wordpressRequests.push(route.request().url());
    return route.abort();
  });
  await page.route("https://api.figma.com/**", route => route.abort());
  await page.goto("/");
  await page.getByRole("button", { name: "サンプルで試す" }).click();
  const responsePromise = page.waitForResponse(response => response.url().endsWith("/api/convert") && response.request().method() === "POST");
  await page.getByRole("button", { name: "WordPress用に変換" }).click();
  const fixture = await (await responsePromise).json();
  await expect(page.getByRole("heading", { name: "変換データを生成しました" })).toBeVisible();
  fixture.elementorTemplate.content[0].settings.css_classes = "figmapress-layout figmapress-layout--desktop";
  fixture.elementorTemplate.content[1].settings.css_classes = "figmapress-layout figmapress-layout--mobile";
  fixture.multiPagePlan = null;
  fixture.visualReferences = { mobile: {
    nodeId: "2:2", width: 440, height: 900, format: "png",
    url: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=",
  } };
  await page.route("**/api/convert", route => route.fulfill({ json: fixture }));
  await page.getByRole("tab", { name: "Figmaから読み込む" }).click();
  await page.getByRole("textbox", { name: "FigmaファイルURL またはファイルキー" }).fill("https://www.figma.com/design/FixtureOnly123/Test?node-id=2-1");
  await page.getByRole("textbox", { name: "Figma Personal Access Token", exact: true }).fill("figd_test_fixture_never_sent");
  await page.getByRole("button", { name: "WordPress用に変換" }).click();
  await expect(page.getByText("Figma基準画像が不足しています", { exact: true })).toBeVisible();
  await expect(page.getByText("PCの基準画像を取得できていません。", { exact: false })).toBeVisible();
  await expect(page.getByText("✓ 視覚品質チェック完了", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Elementor下書きを作成" })).toBeDisabled();
  expect(wordpressRequests).toEqual([]);
});

test("only explicitly confirmed pages are fetched and changing selection invalidates the complete cache", async ({ page }) => {
  const wordpressRequests: string[] = [];
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  await page.route("**/api/wordpress**", route => { wordpressRequests.push(route.request().url()); return route.abort(); });
  await page.setViewportSize({ width: 390, height: 900 });
  await page.goto("/");
  await page.getByRole("button", { name: "サンプルで試す" }).click();
  const responsePromise = page.waitForResponse(response => response.url().endsWith("/api/convert") && response.request().method() === "POST");
  await page.getByRole("button", { name: "WordPress用に変換" }).click();
  const fixture = await (await responsePromise).json();
  await expect(page.getByRole("heading", { name: "変換データを生成しました" })).toBeVisible();
  const keys = ["home", "company", "reasons", "services", "works", "demolition", "news", "contact", "officers", ...Array.from({ length: 10 }, (_, index) => `old-${index}`)];
  const candidates = keys.map((key, index) => ({ key, title: key, slug: key, frameId: `${index + 1}:1`, hasDesktop: true, hasTablet: false, hasMobile: true }));
  fixture.multiPagePlan = { title: "選択テスト", menuName: "未割り当て", pages: candidates };
  fixture.visualReferences = {};
  await page.route("**/api/convert", route => route.fulfill({ json: fixture }));
  const batches: Array<{ candidatePages: typeof candidates; sitePages: typeof candidates }> = [];
  await page.route("**/api/convert/page", route => {
    const body = route.request().postDataJSON();
    batches.push(body);
    return route.fulfill({ json: { ok: true, pages: body.candidatePages.map((candidate: typeof candidates[number]) => ({
      page: candidate, elementorTemplate: fixture.elementorTemplate, previewHtml: fixture.previewHtml, visualReferences: {},
    })) } });
  });
  await page.getByRole("tab", { name: "Figmaから読み込む" }).click();
  await page.getByRole("textbox", { name: "FigmaファイルURL またはファイルキー" }).fill("https://www.figma.com/design/FixtureOnly123/Test?node-id=1-1");
  await page.getByRole("textbox", { name: "Figma Personal Access Token", exact: true }).fill("figd_test_fixture_never_sent");
  await page.getByRole("button", { name: "WordPress用に変換" }).click();
  await expect(page.getByText("採用ページを選択（候補19ページ）", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "採用0ページを事前検証", exact: true })).toBeDisabled();
  expect(batches).toHaveLength(0);
  for (const candidate of candidates.slice(0, 9)) {
    await page.getByRole("checkbox", { name: `採用: ${candidate.title} (${candidate.frameId})`, exact: true }).check();
  }
  await page.getByRole("button", { name: "選択した9ページで構成を確定", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "採用9ページを確定しました。除外10ページ。" })).toBeVisible();
  await page.getByRole("button", { name: "採用9ページを事前検証", exact: true }).click();
  await expect(page.getByRole("button", { name: "採用9ページを事前検証", exact: true })).toBeEnabled();
  expect(batches.map(batch => batch.candidatePages[0].key)).toEqual(keys.slice(0, 9));
  expect(batches.every(batch => JSON.stringify(batch.sitePages) === JSON.stringify(candidates.slice(0, 9)))).toBe(true);
  // Even the currently previewed Home must have been fetched against the new plan.
  await page.getByRole("checkbox", { name: "採用: old-0 (10:1)", exact: true }).check();
  await expect(page.getByRole("button", { name: "採用0ページを事前検証", exact: true })).toBeDisabled();
  await expect(page.getByRole("status").filter({ hasText: "採用9ページを確定しました" })).toHaveCount(0);
  await page.getByRole("button", { name: "選択した10ページで構成を確定", exact: true }).click();
  await page.getByRole("button", { name: "採用10ページを事前検証", exact: true }).click();
  await expect(page.getByRole("button", { name: "採用10ページを事前検証", exact: true })).toBeEnabled();
  expect(batches.slice(9).map(batch => batch.candidatePages[0].key)).toEqual(keys.slice(0, 10));
  const geometry = await page.evaluate(() => ({ width: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
  expect(geometry.scroll).toBeLessThanOrEqual(geometry.width);
  await page.locator(".site-build-plan").screenshot({ path: test.info().outputPath("explicit-page-selection-390.png") });
  expect(wordpressRequests).toEqual([]);
  expect(errors).toEqual([]);
});

test("page conversion API rejects missing selection and mismatched frame identities before Figma access", async ({ request }) => {
  const home = { key: "home", title: "Home", slug: "home", frameId: "1:1", hasDesktop: true, hasMobile: true };
  const company = { ...home, key: "company", title: "Company", slug: "company", frameId: "2:1" };
  for (const body of [
    { candidatePages: [home] },
    { candidatePages: [{ ...home, frameId: "99:1" }], sitePages: [home, company] },
    { candidatePages: [home], sitePages: [home, { ...company, frameId: home.frameId }] },
  ]) {
    const response = await request.post("/api/convert/page", {
      headers: { Origin: "http://127.0.0.1:3031" },
      data: { mode: "figma", fileKeyOrUrl: "FixtureOnly123", token: "figd_test_fixture_never_sent", ...body },
    });
    expect(response.status()).toBe(422);
  }
});
