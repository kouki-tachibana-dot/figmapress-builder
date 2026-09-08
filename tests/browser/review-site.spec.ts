import { test, expect } from "@playwright/test";
import { createHash } from "node:crypto";
import sharp from "sharp";

test.use({ trace: "off" }); // sandboxed comparison frames intentionally reject tracing injection

test("review copies keep pending PDFs, reject original IDs, use isolated links and retain retry identity", async ({ page }) => {
  test.setTimeout(90_000);
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  const prepares: Array<Record<string, any>> = [];
  const saves: Array<Record<string, any>> = [];
  const chunks = new Map<string, Buffer[]>();
  let returnOriginal = true;
  await page.setViewportSize({ width: 390, height: 900 });
  await page.goto("/");
  await page.getByRole("button", { name: "サンプルで試す" }).click();
  const converted = page.waitForResponse(response => response.url().endsWith("/api/convert") && response.request().method() === "POST");
  await page.getByRole("button", { name: "WordPress用に変換" }).click();
  const fixture = await (await converted).json();
  const candidates = ["home", "company"].map((key, i) => ({ key, title: key, slug: key, frameId: `${i + 1}:1`, hasDesktop: true, hasTablet: false, hasMobile: false }));
  const template = (key: string) => ({ title: key, type: "page", version: "0.4", page_settings: {
    figmapress_native_layout: "yes", figmapress_native_layout_version: "1", figmapress_reference_desktop_node_id: key === "home" ? "1:1" : "2:1",
  }, content: [{ id: `${key}-root`, elType: "container", isInner: false, settings: { html_tag: "main", css_classes: "figmapress-layout figmapress-layout--desktop" }, elements: [
    { id: `${key}-nav`, elType: "widget", widgetType: "figmapress-nav", isInner: false, settings: { layout_variant: "desktop",
      items: candidates.map((p, i) => ({ _id: `${i}`, label: p.key, url: { url: `#figmapress-page-${p.key}` } })) }, elements: [] },
    { id: `${key}-text`, elType: "widget", widgetType: "text-editor", isInner: false, settings: { editor: `<h1>${key}</h1>` }, elements: [] },
    ...candidates.map(p => ({ id: `${key}-link-${p.key}`, elType: "widget", widgetType: "button", isInner: false,
      settings: { text: p.title, link: { url: `#figmapress-page-${p.key}`, is_external: "", nofollow: "", custom_attributes: "" } }, elements: [] })),
    ...(key === "company" ? [{ id: "pending-pdf", elType: "widget", widgetType: "button", isInner: false, settings: { text: "資料ダウンロード", link: { url: "" } }, elements: [] }] : []),
    { id: `${key}-footer`, elType: "container", isInner: true, settings: { html_tag: "footer" }, elements: [] },
  ] }] });
  // A synthetic white reference isolates transport/gating. This is not Figma fidelity evidence.
  const png = await sharp({ create: { width: 1440, height: 300, channels: 4, background: "#fff" } }).png().toBuffer();
  const refs = { desktop: { nodeId: "1:1", name: "Synthetic white transport fixture", width: 1440, height: 300, sourceWidth: 1440, sourceHeight: 300,
    format: "png", url: `data:image/png;base64,${png.toString("base64")}` } };
  const preview = '<main class="figmapress-layout figmapress-layout--desktop" style="width:100%;height:300px;background:#fff"></main>';
  fixture.multiPagePlan = { title: "検証コピー試験", menuName: "Test", pages: candidates };
  fixture.elementorTemplate = template("home"); fixture.previewHtml = preview; fixture.visualReferences = refs;
  await page.route("**/api/convert", route => route.fulfill({ json: fixture }));
  await page.route("**/api/convert/page", route => {
    const input = route.request().postDataJSON();
    return route.fulfill({ json: { ok: true, pages: input.candidatePages.map((p: typeof candidates[number]) => ({
      page: p, elementorTemplate: template(p.key), previewHtml: preview, visualReferences: { desktop: { ...refs.desktop, nodeId: p.frameId } },
    })) } });
  });
  await page.route("**/api/wordpress**", route => { throw new Error(`Unexpected Builder proxy write: ${route.request().url()}`); });
  await page.route("https://wp.example/**", route => {
    const url = route.request().url();
    if (url.endsWith("/status")) return route.fulfill({ json: { user: { id: 7, name: "Fixture" }, canEditPages: true, connectorVersion: "0.19.11",
      elementor: { active: true }, elementorPro: { active: true }, nativeWidgets: { accordion: true, form: true, navMenu: true, imageCarousel: true },
      siteBuild: { pages: true, menus: true, bridge: true } } });
    let input = route.request().postDataJSON();
    if (url.includes("/elementor/uploads/")) {
      const parts = input.index === 0 ? [] : chunks.get(url) ?? [];
      parts[input.index] = Buffer.from(input.chunk, "base64"); chunks.set(url, parts);
      if (input.index !== input.total - 1) return route.fulfill({ json: { complete: false } });
      input = JSON.parse(Buffer.concat(parts).toString("utf8"));
    }
    if (url.endsWith("/sites/lookup")) return route.fulfill({ json: { siteKey: input.siteKey, readOnly: true, status: "ready", unresolved: [],
      pages: input.pages.map((p: { key: string; sourceKey: string }, i: number) => ({ ...p, id: i + 41, title: p.key, slug: p.key,
        status: "draft", created: false, updated: false, previewLink: `https://wp.example/?page_id=${i + 41}&preview=true` })) } });
    if (url.endsWith("/sites/review-prepare")) {
      prepares.push(input);
      const siteKey = `figma:review-${createHash("sha256").update(`${input.siteKey}|${input.reviewId}`).digest("hex").slice(0, 40)}:root`;
      const pages = input.pages.map((p: { key: string; originalId: number }, i: number) => {
        const id = returnOriginal && i === 0 ? 41 : 101 + i;
        const sourceKey = p.key === "home" ? siteKey : `${siteKey}:page:${p.key}`;
        return { ...p, id, sourceKey, title: `[検証 ${input.reviewId.slice(0, 8)}] ${p.key}`, slug: `${p.key}-review`, status: "draft", created: true, updated: false,
          requestId: createHash("sha256").update(sourceKey).digest("hex").slice(0, 32), previewLink: `https://wp.example/?page_id=${id}&preview=true` };
      });
      return route.fulfill({ json: { review: true, reviewId: input.reviewId, originalSiteKey: input.siteKey, siteKey, title: input.title, status: "draft", pages,
        menu: { id: 110, name: "Fixture review menu", editLink: "https://wp.example/wp-admin/nav-menus.php?menu=110", assigned: false, assignedLocations: [],
          items: pages.map((p: { id: number; key: string; title: string; previewLink: string }, i: number) => ({ id: 111 + i, pageId: p.id, key: p.key, title: p.title, rawLink: p.previewLink })) }, warnings: [] } });
    }
    if (url.endsWith("/elementor/pages") || url.includes("/elementor/uploads/")) {
      saves.push(input);
      const id = input.sourceKey.endsWith(":page:company") ? 102 : 101;
      return route.fulfill({ json: { id, title: input.title, slug: input.slug, status: "draft", updated: saves.length <= 2,
        target: "elementor", storedElements: 1, remainingMedia: 0, totalMedia: 0, savedMedia: 0, failedMedia: 0, mediaComplete: true,
        previewLink: `https://wp.example/?page_id=${id}&preview=true` } });
    }
    throw new Error(`Unexpected WordPress mutation ${url}`);
  });
  await page.getByRole("tab", { name: "Figmaから読み込む" }).click();
  await page.getByRole("textbox", { name: "FigmaファイルURL またはファイルキー" }).fill("https://www.figma.com/design/FixtureOnly123/Test?node-id=1-1");
  await page.getByRole("textbox", { name: "Figma Personal Access Token", exact: true }).fill("figd_test_fixture_never_sent");
  await page.getByRole("button", { name: "WordPress用に変換" }).click();
  for (const p of candidates) await page.getByRole("checkbox", { name: `採用: ${p.title} (${p.frameId})`, exact: true }).check();
  await page.getByRole("button", { name: "選択した2ページで構成を確定" }).click();
  const review = page.getByRole("checkbox", { name: "既存ページを変更せず、採用ページ一式の検証コピーを作成" });
  await review.check();
  const submit = page.getByRole("button", { name: "2ページの検証コピーを構築 →", exact: true });
  await expect(submit).toBeDisabled();
  await page.getByRole("textbox", { name: "WordPress URL", exact: true }).fill("https://wp.example");
  await page.getByRole("textbox", { name: "ユーザー名", exact: true }).fill("fixture");
  await page.getByLabel("Application Password", { exact: true }).fill("test-only-password");
  await page.getByRole("button", { name: "接続を診断", exact: true }).click();
  await page.getByRole("button", { name: "既存ページの対応表を取得（変更なし）" }).click();
  await page.locator(".consent input").check();
  await expect(submit).toBeDisabled(); // The review switch must not skip QA.
  await page.getByRole("button", { name: "採用2ページを事前検証", exact: true }).click();
  await expect(page.getByText("端末別画素比較 2/2画面合格", { exact: false })).toBeVisible({ timeout: 30000 });
  await expect(page.getByText("資料リンク 1件は未接続です（未完了）", { exact: true })).toBeVisible();
  await expect(submit).toBeEnabled();
  await submit.click();
  await expect(page.getByRole("alert").filter({ hasText: "既存ページの上書きを中止" })).toBeVisible();
  expect(saves).toHaveLength(0);
  returnOriginal = false;
  await submit.click();
  await expect(page.getByText("検証コピー2ページの本文保存が完了しました。", { exact: false })).toBeVisible();
  expect(saves).toHaveLength(2);
  expect(prepares[0].reviewId).toBe(prepares[1].reviewId);
  for (const saved of saves) {
    expect(saved.sourceKey).toMatch(/^figma:review-/);
    expect(saved.title).toMatch(/^\[検証 /);
    expect(JSON.stringify(saved.template)).not.toContain("#figmapress-page-");
    expect(JSON.stringify(saved.template)).not.toContain("page_id=41");
    expect(JSON.stringify(saved.template)).toContain("page_id=101");
    expect(JSON.stringify(saved.template)).toContain("page_id=102");
    expect(JSON.stringify(saved.template)).toContain('"menu":"110"');
  }
  await review.uncheck();
  await expect(page.getByRole("button", { name: "2ページ＋メニューを下書き構築 →", exact: true })).toBeDisabled();
  await review.check();
  // Credentials are cleared after success; refill and re-diagnose before replay.
  await page.getByLabel("Application Password", { exact: true }).fill("test-only-password");
  await page.getByRole("button", { name: "接続を診断", exact: true }).click();
  await page.getByRole("button", { name: "既存ページの対応表を取得（変更なし）" }).click();
  await submit.click();
  await expect.poll(() => saves.length).toBe(4);
  expect(prepares[2].reviewId).toBe(prepares[1].reviewId);
  expect(saves[2].requestId).toBe(saves[0].requestId);
  expect(saves[3].requestId).toBe(saves[1].requestId);
  await expect(page.getByText("検証コピー2ページの本文保存が完了しました。", { exact: false })).toBeVisible();
  await page.locator('.site-build-result[role="status"]').screenshot({ path: test.info().outputPath("review-copies-390.png") });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  expect(errors).toEqual([]);
});

test("review API rejects mixed identities, injected status and foreign origins before WordPress access", async ({ request }) => {
  const data = { target: "review-site", baseUrl: "http://127.0.0.1", username: "fixture", applicationPassword: "test-only-password",
    siteKey: "figma:FixtureOnly123:root", reviewId: "a".repeat(32), title: "Review",
    pages: ["home", "company"].map((key, i) => ({ key, title: key, slug: key, originalId: 41 + i })) };
  const send = (body: unknown, origin = "http://127.0.0.1:3031") => request.post("/api/wordpress", { headers: { Origin: origin }, data: body });
  expect((await send(data)).status()).toBe(400);
  expect((await send({ ...data, status: "publish" })).status()).toBe(422);
  expect((await send({ ...data, pages: data.pages.map(p => ({ ...p, originalId: 41 })) })).status()).toBe(422);
  expect((await send(data, "https://foreign.example")).status()).toBe(403);
});
