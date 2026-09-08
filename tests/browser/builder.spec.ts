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
