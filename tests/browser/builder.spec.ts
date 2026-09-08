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
  // Site mode uses the selected pages' QA, not the unrelated single preview.
  await expect(page.getByText("Figma基準画像が不足しています", { exact: true })).toHaveCount(0);
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

test("nine-page proxy input reaches the URL safety gate while foreign page identities are rejected earlier", async ({ request }) => {
  const siteKey = "figma:FixtureOnly123:root";
  const data = {
    target: "site", baseUrl: "http://127.0.0.1", username: "fixture", applicationPassword: "not-a-real-password",
    siteKey, title: "Fixture", menuName: "Unassigned",
    pages: ["home", "company", "reasons", "services", "works", "demolition", "news", "contact", "officers"].map(key => ({
      key, title: key, slug: key, sourceKey: key === "home" ? siteKey : `${siteKey}:page:${key}`,
    })),
  };
  const response = await request.post("/api/wordpress", { headers: { Origin: "http://127.0.0.1:3031" }, data });
  expect(response.status()).toBe(400);
  expect(JSON.stringify(await response.json())).toContain("HTTPS");
  data.pages[1].sourceKey = "figma:OtherFile123:root:page:company";
  const invalid = await request.post("/api/wordpress", { headers: { Origin: "http://127.0.0.1:3031" }, data });
  expect(invalid.status()).toBe(422);
});

test("read-only page lookup needs confirmed selection, never writes, and discards stale responses", async ({ page }) => {
  const errors: string[] = [];
  const reads: string[] = [];
  const writes: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  await page.route("**/api/wordpress**", route => { writes.push(route.request().url()); return route.abort(); });
  await page.setViewportSize({ width: 390, height: 900 });
  await page.goto("/");
  await page.getByRole("button", { name: "サンプルで試す" }).click();
  const converted = page.waitForResponse(response => response.url().endsWith("/api/convert") && response.request().method() === "POST");
  await page.getByRole("button", { name: "WordPress用に変換" }).click();
  const fixture = await (await converted).json();
  await expect(page.getByRole("heading", { name: "変換データを生成しました" })).toBeVisible();
  fixture.multiPagePlan = { title: "照会テスト", menuName: "未割り当て", pages: ["home", "company", "contact"].map((key, i) => ({
    key, title: key, slug: key, frameId: `${i+1}:1`, hasDesktop: true, hasMobile: true, hasTablet: false,
  })) };
  fixture.visualReferences = {};
  await page.route("**/api/convert", route => route.fulfill({ json: fixture }));
  await page.getByRole("tab", { name: "Figmaから読み込む" }).click();
  await page.getByRole("textbox", { name: "FigmaファイルURL またはファイルキー" }).fill("https://www.figma.com/design/FixtureOnly123/Test?node-id=1-1");
  await page.getByRole("textbox", { name: "Figma Personal Access Token", exact: true }).fill("figd_test_fixture_never_sent");
  await page.getByRole("button", { name: "WordPress用に変換" }).click();
  const lookup = page.getByRole("button", { name: "既存ページの対応表を取得（変更なし）" });
  await expect(lookup).toBeDisabled();
  for (const [key, id] of [["home", 1], ["company", 2]]) {
    await page.getByRole("checkbox", { name: `採用: ${key} (${id}:1)`, exact: true }).check();
  }
  await page.getByRole("button", { name: "選択した2ページで構成を確定", exact: true }).click();
  let resolveDelayed: () => void = () => {};
  let hold = false;
  let conflict = false;
  await page.route("https://wp.example/**", async route => {
    const url = route.request().url();
    if (url.endsWith("/figmapress/v1/status")) return route.fulfill({ json: {
      user: { id: 7, name: "Test Editor" }, canEditPages: true, connectorVersion: "0.19.10",
      elementor: { active: true }, siteBuild: { pages: true, menus: true, bridge: true },
    } });
    if (!url.endsWith("/figmapress/v1/sites/lookup")) { writes.push(url); return route.abort(); }
    reads.push(url);
    const input = route.request().postDataJSON();
    if (hold) await new Promise<void>(resolve => { resolveDelayed = resolve; });
    return route.fulfill({ json: { siteKey: input.siteKey, readOnly: true, status: conflict ? "unresolved" : "ready",
      unresolved: conflict ? [{ key: "home", reason: "duplicate" }] : [],
      pages: input.pages.filter((p: { key: string }) => !conflict || p.key !== "home").map((p: { key: string; sourceKey: string }, i: number) => ({
        ...p, id: 41+i, title: p.key, slug: p.key, status: "draft", created: false, updated: false,
        previewLink: `https://wp.example/?page_id=${41+i}&preview=true`,
      })),
    } });
  });
  await page.getByRole("textbox", { name: "WordPress URL", exact: true }).fill("https://wp.example");
  await page.getByRole("textbox", { name: "ユーザー名", exact: true }).fill("fixture");
  await page.getByLabel("Application Password", { exact: true }).fill("test-only-password");
  await page.getByRole("button", { name: "接続を診断", exact: true }).click();
  await expect(lookup).toBeEnabled();
  await lookup.click();
  await expect(page.getByText("✓ 2ページの下書きIDを確認しました。", { exact: true })).toBeVisible();
  hold = true;
  await lookup.click();
  await expect.poll(() => reads.length).toBe(2);
  await page.getByRole("checkbox", { name: "採用: contact (3:1)", exact: true }).check();
  resolveDelayed();
  await expect(lookup).toBeDisabled();
  await expect(page.getByText("✓ 2ページの下書きIDを確認しました。", { exact: true })).toHaveCount(0);
  hold = false; conflict = true;
  await page.getByRole("button", { name: "選択した3ページで構成を確定", exact: true }).click();
  await expect(lookup).toBeEnabled();
  await lookup.click();
  await expect(page.getByText("未解決 1ページ。自動作成・更新はしていません。", { exact: true })).toBeVisible();
  await expect(page.getByText("home：同じ識別子のページが複数存在", { exact: true })).toBeVisible();
  const mapPanel = page.getByText("既存ページの確認（読み取り専用）", { exact: true }).locator("..");
  await mapPanel.screenshot({ path: test.info().outputPath("readonly-site-map-390.png") });
  const geometry = await page.evaluate(() => ({ width: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
  expect(geometry.scroll).toBeLessThanOrEqual(geometry.width);
  expect(writes).toEqual([]);
  expect(errors).toEqual([]);
});

test("read-only proxy input validates identities and origin before any external lookup", async ({ request }) => {
  const siteKey = "figma:FixtureOnly123:root";
  const data = { target: "site-map", baseUrl: "http://127.0.0.1", username: "fixture", applicationPassword: "test-only-password", siteKey,
    pages: ["home", "company"].map(key => ({ key, sourceKey: key === "home" ? siteKey : `${siteKey}:page:${key}` })),
  };
  const send = (body: unknown, origin = "http://127.0.0.1:3031") => request.post("/api/wordpress", { headers: { Origin: origin }, data: body });
  expect((await send(data)).status()).toBe(400);
  expect((await send({ ...data, pages: [...data.pages, data.pages[0]] })).status()).toBe(422);
  expect((await send({ ...data, title: "must-not-rename" })).status()).toBe(422);
  expect((await send(data, "https://foreign.example")).status()).toBe(403);
});
