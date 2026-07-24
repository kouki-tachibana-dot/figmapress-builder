import assert from "node:assert/strict";
import test from "node:test";
import mockFigma from "../examples/mock-figma.json";
import { convertFile } from "../apps/web/src/lib/converter.ts";
import type { MockFigmaFile } from "@figmapress/figma-parser";

test("mock Figma JSON converts into six Gutenberg blocks", async () => {
  const result = await convertFile(mockFigma as MockFigmaFile);

  assert.equal(result.summary.sectionCount, 6);
  assert.match(result.pageContent, /wp:figmapress\/hero .* \/-->/);
  assert.match(result.pageContent, /wp:figmapress\/contact .* \/-->/);
  assert.doesNotMatch(result.pageContent, /<section/);
  assert.match(result.previewHtml, /<section/);
  assert.doesNotMatch(result.pageContent, /section\/pricing/);
  assert.doesNotMatch(result.pageContent, /figma:\/\/image/);
  assert.ok(result.warnings.some((warning) => warning.includes("section/pricing")));
});

test("theme generation preserves tokens", async () => {
  const result = await convertFile(mockFigma as MockFigmaFile);
  assert.equal(result.themeJson.version, 2);
  assert.ok(result.themeJson.settings.color.palette.length >= 3);
  assert.ok(result.themeJson.settings.spacing.spacingSizes.length >= 3);
});

test("Elementor export uses portable 0.4 containers and core widgets", async () => {
  const result = await convertFile(
    mockFigma as MockFigmaFile,
    {},
    { "hero-001": "https://images.example/hero.png" },
  );
  const template = result.elementorTemplate;
  assert.equal(template.version, "0.4");
  assert.equal(template.type, "page");
  assert.equal(template.content.length, 6);

  const ids = new Set<string>();
  const widgetTypes = new Set<string>();
  const visit = (elements: typeof template.content): void => {
    for (const element of elements) {
      assert.match(element.id, /^[a-f0-9]{8}$/);
      assert.equal(ids.has(element.id), false, `duplicate Elementor id: ${element.id}`);
      ids.add(element.id);
      if (element.widgetType) widgetTypes.add(element.widgetType);
      visit(element.elements);
    }
  };
  visit(template.content);
  for (const type of ["heading", "text-editor", "button", "image"]) {
    assert.equal(widgetTypes.has(type), true, type);
  }
});

test("semantic Figma layer names work without section prefixes", async () => {
  const semanticFile: MockFigmaFile = {
    document: {
      id: "0:0",
      name: "Semantic LP",
      type: "DOCUMENT",
      children: [{
        id: "1:0",
        name: "Page",
        type: "CANVAS",
        children: [{
          id: "2:0",
          name: "Hero / Desktop",
          type: "FRAME",
          children: [
            { id: "3:0", name: "Title", type: "TEXT", characters: "実運用のヒーロー" },
            { id: "3:1", name: "Description", type: "TEXT", characters: "命名規則なしでも抽出" },
            { id: "3:2", name: "CTA Button", type: "TEXT", characters: "始める" },
          ],
        }],
      }],
    },
  };
  const result = await convertFile(semanticFile);
  assert.equal(result.summary.sectionCount, 1);
  assert.equal(result.summary.sectionTypes[0], "section/hero");
  assert.match(result.pageContent, /実運用のヒーロー/);
});

test("explicit and Japanese semantic sections can be mixed with safe token slugs", async () => {
  const mixedFile: MockFigmaFile = {
    document: {
      id: "0:0",
      name: "Mixed LP",
      type: "DOCUMENT",
      children: [{
        id: "1:0",
        name: "Page",
        type: "CANVAS",
        children: [
          {
            id: "2:0",
            name: "section/hero",
            type: "FRAME",
            children: [{ id: "3:0", name: "headline", type: "TEXT", characters: "Hero" }],
          },
          {
            id: "2:1",
            name: "サービス紹介",
            type: "FRAME",
            children: [
              { id: "4:0", name: "Title", type: "TEXT", characters: "サービス" },
              {
                id: "4:1",
                name: "Card 1",
                type: "FRAME",
                children: [
                  { id: "5:0", name: "Title", type: "TEXT", characters: "制作" },
                  { id: "5:1", name: "Description", type: "TEXT", characters: "サイトを制作します" },
                ],
              },
            ],
          },
        ],
      }],
    },
    styles: {
      colors: [
        { name: "ブランド", value: "#123456" },
        { name: "背景", value: "#FFFFFF" },
      ],
      typography: [{ name: "本文", fontFamily: "Noto Sans JP" }],
      spacing: [{ name: "余白", size: "24px" }],
    },
  };

  const result = await convertFile(mixedFile);
  assert.deepEqual(result.summary.sectionTypes, ["section/hero", "section/service"]);
  assert.deepEqual(result.blueprint.tokens.colors.map((token) => token.slug), ["color-1", "color-2"]);
  assert.equal(result.blueprint.tokens.typography[0]?.slug, "font-1");
  assert.equal(result.blueprint.tokens.spacing[0]?.slug, "spacing-1");
});

test("real Figma bounds produce a high-fidelity editable Elementor document", async () => {
  const file: MockFigmaFile = {
    document: {
      id: "0:0",
      name: "Campaign",
      type: "DOCUMENT",
      children: [{
        id: "1:0",
        name: "Page",
        type: "CANVAS",
        children: [{
          id: "46:12",
          name: "PC-page",
          type: "FRAME",
          absoluteBoundingBox: { x: 0, y: 0, width: 1920, height: 1600 },
          fills: [{ type: "SOLID", color: { r: 1, g: 1, b: 1 } }],
          clipsContent: true,
          children: [
            {
              id: "2:0",
              name: "FV/Hero Sec",
              type: "FRAME",
              absoluteBoundingBox: { x: 0, y: 0, width: 1920, height: 900 },
              fills: [{ type: "SOLID", color: { r: 0.99, g: 0.96, b: 0.97 } }],
              children: [
                {
                  id: "3:0",
                  name: "Main heading",
                  type: "TEXT",
                  characters: "明石をずーっと元気なまちに！",
                  textAutoResize: "WIDTH_AND_HEIGHT",
                  absoluteBoundingBox: { x: 180, y: 220, width: 850, height: 90 },
                  style: { fontFamily: "Noto Sans JP", fontSize: 64, fontWeight: 800, lineHeightPx: 86 },
                  fills: [{ type: "SOLID", color: { r: 0.82, g: 0.04, b: 0.17 } }],
                },
                {
                  id: "3:2",
                  name: "Rotated punctuation",
                  type: "TEXT",
                  characters: "！",
                  rotation: 7.54,
                  textAutoResize: "WIDTH_AND_HEIGHT",
                  absoluteBoundingBox: { x: 1030, y: 220, width: 90, height: 100 },
                  style: { fontFamily: "Noto Sans JP", fontSize: 84, fontWeight: 800, lineHeightPx: 100 },
                },
                {
                  id: "3:3",
                  name: "Mixed-size heading",
                  type: "TEXT",
                  characters: "明石を元気",
                  textAutoResize: "WIDTH_AND_HEIGHT",
                  absoluteBoundingBox: { x: 180, y: 340, width: 480, height: 100 },
                  style: { fontFamily: "Noto Sans JP", fontSize: 0, fontWeight: 800 },
                  characterStyleOverrides: [1, 1, 1, 2, 2],
                  styleOverrideTable: {
                    "1": { fontSize: 72, lineHeightPx: 90 },
                    "2": {
                      fontSize: 84,
                      lineHeightPx: 100,
                      fills: [{ type: "SOLID", color: { r: 0.95, g: 0, b: 0.11 } }],
                    },
                  },
                },
                {
                  id: "3:4",
                  name: "Fixed paragraph",
                  type: "TEXT",
                  characters: "固定幅の文章はFigmaと同じ幅で折り返します。",
                  textAutoResize: "NONE",
                  absoluteBoundingBox: { x: 180, y: 470, width: 420, height: 100 },
                  style: { fontFamily: "Noto Sans JP", fontSize: 24, lineHeightPx: 38 },
                },
                {
                  id: "3:5",
                  name: "Truncated notice",
                  type: "TEXT",
                  characters: "長い文章を固定高で安全に省略します。",
                  textAutoResize: "TRUNCATE",
                  absoluteBoundingBox: { x: 180, y: 590, width: 420, height: 60 },
                  style: { fontFamily: "Noto Sans JP", fontSize: 20, lineHeightPx: 30 },
                },
                {
                  id: "3:1",
                  name: "Portrait",
                  type: "RECTANGLE",
                  absoluteBoundingBox: { x: 1160, y: 120, width: 560, height: 700 },
                  fills: [{ type: "IMAGE", imageRef: "portrait-ref" }],
                  cornerRadius: 24,
                },
              ],
            },
            {
              id: "2:1",
              name: "Footer/Footer Sec",
              type: "FRAME",
              absoluteBoundingBox: { x: 0, y: 1300, width: 1920, height: 300 },
              fills: [{ type: "SOLID", color: { r: 0.82, g: 0.04, b: 0.17 } }],
            },
          ],
        }],
      }],
    },
  };

  const result = await convertFile(
    file,
    { pageTitle: "竹内きよ子様" },
    { "portrait-ref": "https://images.example/portrait-original.png" },
    [],
    { "3:1": "https://images.example/portrait-rendered.png" },
  );

  assert.equal(result.summary.sectionCount, 2);
  assert.deepEqual(result.summary.sectionTypes, ["figma/FV/Hero Sec", "figma/Footer/Footer Sec"]);
  assert.equal(result.elementorTemplate.content.length, 1);
  const root = result.elementorTemplate.content[0];
  assert.equal(root?.elType, "container");
  assert.deepEqual(root?.settings.min_height, { unit: "vw", size: 83.333, sizes: [] });
  assert.deepEqual(result.elementorTemplate.page_settings.figmapress_webfonts, [
    {
      family: "Noto Sans JP",
      provider: "google",
      weights: [400, 800],
    },
  ]);

  const elements: typeof result.elementorTemplate.content = [];
  const visit = (items: typeof result.elementorTemplate.content): void => {
    for (const item of items) {
      elements.push(item);
      visit(item.elements);
    }
  };
  visit(result.elementorTemplate.content);
  const heading = elements.find((element) =>
    element.widgetType === "text-editor" && String(element.settings.editor).includes("明石をずーっと"),
  );
  const punctuation = elements.find((element) => element.settings._transform_rotateZ_effect);
  const mixedHeading = elements.find((element) =>
    String(element.settings.editor).includes("font-size:3.75vw"),
  );
  const fixedParagraph = elements.find((element) => String(element.settings.editor).includes("固定幅の文章"));
  const truncatedNotice = elements.find((element) => String(element.settings.editor).includes("固定高で安全"));
  const portrait = elements.find((element) => element.widgetType === "image");
  assert.match(String(heading?.settings.editor), /white-space:pre/);
  assert.match(String(heading?.settings.editor), /writing-mode:horizontal-tb/);
  assert.match(String(heading?.settings.editor), /line-break:strict/);
  assert.equal(heading?.settings.css_classes, "figmapress-text figmapress-text--horizontal");
  assert.deepEqual(heading?.settings.typography_font_size, { unit: "vw", size: 3.333, sizes: [] });
  assert.equal(punctuation?.settings._transform_rotate_popover, "transform");
  assert.deepEqual(punctuation?.settings._transform_rotateZ_effect, { unit: "deg", size: 7.54, sizes: [] });
  assert.deepEqual(mixedHeading?.settings.typography_font_size, { unit: "vw", size: 4.375, sizes: [] });
  assert.match(String(mixedHeading?.settings.editor), /<span style="display:block;max-width:100%"><span/);
  assert.match(String(mixedHeading?.settings.editor), /font-size:3\.75vw/);
  assert.match(String(mixedHeading?.settings.editor), /font-size:4\.375vw/);
  assert.match(String(fixedParagraph?.settings.editor), /white-space:pre-wrap/);
  assert.match(String(fixedParagraph?.settings.editor), /height:5\.208vw/);
  assert.match(String(fixedParagraph?.settings.editor), /overflow:visible/);
  assert.match(String(truncatedNotice?.settings.editor), /white-space:pre-wrap/);
  assert.match(String(truncatedNotice?.settings.editor), /height:3\.125vw/);
  assert.match(String(truncatedNotice?.settings.editor), /overflow:hidden/);
  assert.equal((portrait?.settings.image as { url?: string })?.url, "https://images.example/portrait-rendered.png");
  assert.deepEqual(portrait?.settings.height, { unit: "vw", size: 36.458, sizes: [] });
  assert.equal(portrait?.settings._position, "absolute");
  assert.match(result.previewHtml, /明石をずーっと元気なまちに/);
  assert.match(result.previewHtml, /data-figmapress-node-name="Main heading"/);
  assert.match(result.previewHtml, /data-figmapress-kind="text"/);
  assert.match(result.previewHtml, /writing-mode:horizontal-tb/);
  assert.match(
    result.previewHtml,
    /transform:var\(--figmapress-qa-global-transform\) var\(--figmapress-qa-runtime-global-transform\) var\(--figmapress-qa-local-transform\) var\(--figmapress-qa-runtime-local-transform\) rotate\(7\.54deg\)/,
  );
  assert.match(result.previewHtml, /portrait-rendered\.png/);
  assert.deepEqual(result.qualityReport?.metrics.typography, {
    horizontalTextNodes: 5,
    wrappingTextNodes: 2,
    explicitLineBreakTextNodes: 0,
    mixedStyleTextNodes: 1,
    truncatedTextNodes: 1,
  });
  assert.equal(
    result.qualityReport?.checks.find((check) => check.id === "typography")?.status,
    "pass",
  );
  assert.ok(result.warnings.some((warning) => warning.includes("高忠実度モード")));
});

test("Japanese Figma text records its webfont and deterministic glyph fallback", async () => {
  const file: MockFigmaFile = {
    document: {
      id: "0:0",
      name: "Webfont campaign",
      type: "DOCUMENT",
      children: [{
        id: "1:0",
        name: "Page",
        type: "CANVAS",
        children: [{
          id: "46:12",
          name: "PC-page",
          type: "FRAME",
          absoluteBoundingBox: { x: 0, y: 0, width: 1920, height: 600 },
          children: [{
            id: "46:17",
            name: "Hero title",
            type: "TEXT",
            characters: "明石をずーっと元気なまちに！",
            absoluteBoundingBox: { x: 150, y: 180, width: 900, height: 100 },
            style: {
              fontFamily: "Inter",
              fontSize: 72,
              fontWeight: 700,
              lineHeightPx: 90,
            },
          }],
        }],
      }],
    },
  };

  const result = await convertFile(file);
  assert.deepEqual(result.elementorTemplate.page_settings.figmapress_webfonts, [
    { family: "Inter", provider: "google", weights: [700] },
    { family: "Noto Sans JP", provider: "google", weights: [700] },
  ]);
  assert.match(result.previewHtml, /font-family:Inter,&#039;Noto Sans JP&#039;/);
});

test("paired PC and SP frames become device-specific Elementor layouts", async () => {
  const text = (
    id: string,
    name: string,
    characters: string,
    x: number,
    y: number,
    width = 120,
    height = 28,
    fontSize = 18,
  ) => ({
    id,
    name,
    type: "TEXT",
    characters,
    absoluteBoundingBox: { x, y, width, height },
    style: { fontSize, fontWeight: 700 },
  });
  const file: MockFigmaFile = {
    document: {
      id: "0:0",
      name: "Responsive campaign",
      type: "DOCUMENT",
      children: [{
        id: "1:0",
        name: "Page",
        type: "CANVAS",
        children: [
          {
            id: "46:12",
            name: "PC-page",
            type: "FRAME",
            absoluteBoundingBox: { x: 0, y: 0, width: 1920, height: 1600 },
            children: [
              {
                id: "10:0",
                name: "Header/Header Sec",
                type: "FRAME",
                absoluteBoundingBox: { x: 0, y: 0, width: 1920, height: 100 },
                children: [
                  text("10:1", "Header/Menu-Item", "想い", 1000, 40),
                  text("10:2", "Header/Menu-Item", "政策", 1160, 40),
                  text("10:3", "Header/Menu-Item", "活動報告", 1320, 40),
                  text("10:4", "Header/Menu-Item", "プロフィール", 1500, 40),
                  text("10:5", "Comp/Button-HeaderCTA/text", "ご相談はこちら", 1700, 40, 160),
                ],
              },
              {
                id: "20:0",
                name: "Sec/Thoughts Sec",
                type: "FRAME",
                absoluteBoundingBox: { x: 0, y: 100, width: 1920, height: 600 },
                children: [text("20:1", "Heading", "PCの想い", 120, 180, 500, 80, 64)],
              },
            ],
          },
          {
            id: "46:210",
            name: "SP-page",
            type: "FRAME",
            absoluteBoundingBox: { x: 2100, y: 0, width: 440, height: 1000 },
            children: [
              {
                id: "50:0",
                name: "Header/Header Sec",
                type: "FRAME",
                absoluteBoundingBox: { x: 2100, y: 0, width: 440, height: 53 },
                children: [
                  text("50:1", "Comp/Button-HeaderCTA/text", "ご相談はこちら", 2423, 20, 100, 20, 10),
                ],
              },
              {
                id: "60:0",
                name: "SP/Voice",
                type: "FRAME",
                absoluteBoundingBox: { x: 2100, y: 53, width: 440, height: 447 },
                children: [text("60:1", "Heading", "スマホの想い", 2130, 100, 380, 50, 24)],
              },
              {
                id: "65:0",
                name: "Group 131",
                type: "FRAME",
                absoluteBoundingBox: { x: 2100, y: 500, width: 440, height: 500 },
                children: [text("65:1", "Heading", "明石市をもっと元気なまちにする政策", 2130, 540, 380, 50, 24)],
              },
            ],
          },
          {
            id: "70:0",
            name: "SP_Comp/Carousel",
            type: "FRAME",
            absoluteBoundingBox: { x: 2700, y: 0, width: 1172, height: 440 },
          },
        ],
      }],
    },
  };

  const result = await convertFile(file);
  assert.equal(result.elementorTemplate.content.length, 2);
  const [desktopRoot, mobileRoot] = result.elementorTemplate.content;
  assert.equal(desktopRoot?.settings.hide_mobile, "hidden-mobile");
  assert.equal(desktopRoot?.settings.figmapress_node_id, "46:12");
  assert.equal(desktopRoot?.settings._element_id, "top-desktop");
  assert.equal(mobileRoot?.settings.hide_desktop, "hidden-desktop");
  assert.equal(mobileRoot?.settings.hide_tablet, "hidden-tablet");
  assert.equal(mobileRoot?.settings._element_id, "top-mobile");
  assert.deepEqual(mobileRoot?.settings.min_height, { unit: "vw", size: 227.273, sizes: [] });

  const flatten = (root: typeof desktopRoot): NonNullable<typeof desktopRoot>[] => {
    const elements: NonNullable<typeof desktopRoot>[] = [];
    const visit = (items: NonNullable<typeof desktopRoot>[]) => {
      for (const item of items) {
        elements.push(item);
        visit(item.elements);
      }
    };
    if (root) visit(root.elements);
    return elements;
  };
  const desktopElements = flatten(desktopRoot);
  const mobileElements = flatten(mobileRoot);
  const desktopNav = desktopElements.find((element) => element.widgetType === "figmapress-nav");
  const mobileNav = mobileElements.find((element) => element.widgetType === "figmapress-nav");
  const mobileHeading = mobileElements.find((element) =>
    String(element.settings.editor).includes("スマホの想い"),
  );
  assert.equal(desktopNav?.settings.layout_variant, "desktop");
  assert.equal(desktopNav?.settings.figmapress_node_id, "10:0");
  assert.equal(desktopNav?.settings.figmapress_section, "yes");
  assert.equal(mobileNav?.settings.layout_variant, "mobile");
  assert.equal((desktopNav?.settings.items as Array<{ url: { url: string } }>)[0]?.url.url, "#thoughts-desktop");
  assert.equal((mobileNav?.settings.items as Array<{ url: { url: string } }>)[0]?.url.url, "#thoughts-mobile");
  assert.equal((mobileNav?.settings.home_url as { url: string }).url, "#top-mobile");
  assert.ok(mobileElements.some((element) => element.settings._element_id === "policies-mobile"));
  assert.deepEqual(mobileHeading?.settings.typography_font_size, { unit: "vw", size: 5.455, sizes: [] });
  assert.match(result.previewHtml, /figmapress-figma-preview--desktop/);
  assert.match(result.previewHtml, /figmapress-figma-preview--mobile/);
  assert.ok(result.warnings.some((warning) => warning.includes("PC版とスマホ版")));
});

test("Figma interaction layers become functional Elementor widgets", async () => {
  const text = (id: string, name: string, characters: string, x: number, y: number, width = 120, height = 28) => ({
    id,
    name,
    type: "TEXT",
    characters,
    absoluteBoundingBox: { x, y, width, height },
    style: { fontSize: 18, fontWeight: 600 },
  });
  const file: MockFigmaFile = {
    document: {
      id: "0:0",
      name: "Functional campaign",
      type: "DOCUMENT",
      children: [{
        id: "1:0",
        name: "Page",
        type: "CANVAS",
        children: [{
          id: "46:12",
          name: "PC-page",
          type: "FRAME",
          absoluteBoundingBox: { x: 0, y: 0, width: 1920, height: 2600 },
          children: [
            {
              id: "10:0",
              name: "Header/Header Sec",
              type: "FRAME",
              absoluteBoundingBox: { x: 0, y: 0, width: 1920, height: 115 },
              children: [
                text("10:1", "Header/Menu-Item", "想い", 1000, 50),
                text("10:2", "Header/Menu-Item", "政策", 1160, 50),
                text("10:3", "Header/Menu-Item", "活動報告", 1320, 50),
                text("10:4", "Header/Menu-Item", "プロフィール", 1500, 50),
                text("10:5", "Comp/Button-HeaderCTA/text", "ご相談はこちら", 1700, 50, 160),
              ],
            },
            {
              id: "20:0",
              name: "Sec/Thoughts Sec",
              type: "FRAME",
              absoluteBoundingBox: { x: 0, y: 115, width: 1920, height: 400 },
              fills: [{ type: "SOLID", color: { r: 1, g: 1, b: 1 } }],
            },
            {
              id: "30:0",
              name: "Sec/Profile Sec",
              type: "FRAME",
              absoluteBoundingBox: { x: 0, y: 515, width: 1920, height: 1000 },
              children: [
                text("30:1", "{acf:section_heading}", "2019年度", 360, 700),
                text("30:2", "{acf:section_heading}", "活動内容", 360, 750, 400, 40),
                text("30:3", "{acf:section_heading}", "2020年度", 360, 830),
                text("30:4", "{acf:section_heading}", "2021年度", 360, 910),
                text("30:5", "{acf:section_heading}", "2022年度", 360, 990),
                { id: "30:6", name: "Divider", type: "LINE", absoluteBoundingBox: { x: 266, y: 810, width: 1389, height: 1 } },
              ],
            },
            {
              id: "40:0",
              name: "Comp/Button-CTA",
              type: "FRAME",
              absoluteBoundingBox: { x: 0, y: 1515, width: 1920, height: 900 },
              children: [
                text("40:1", "Heading", "あなたの声を聞かせてください。", 600, 1580, 700, 50),
                text("40:2", "Label", "お名前", 430, 1700),
                text("40:3", "Label", "メールアドレス", 430, 1780, 180),
                text("40:4", "Label", "お住まいの地域", 430, 1860, 180),
                text("40:5", "Label", "ご相談・ご意見の内容", 430, 1940, 220),
                text("40:6", "Button", "相談・意見を送る →", 800, 2200, 260),
              ],
            },
          ],
        }],
      }],
    },
  };

  const result = await convertFile(file);
  const elements: typeof result.elementorTemplate.content = [];
  const visit = (items: typeof result.elementorTemplate.content): void => {
    for (const item of items) {
      elements.push(item);
      visit(item.elements);
    }
  };
  visit(result.elementorTemplate.content);

  const navigation = elements.find((element) => element.widgetType === "figmapress-nav");
  const accordion = elements.find((element) => element.widgetType === "figmapress-accordion");
  const form = elements.find((element) => element.widgetType === "figmapress-contact-form");
  assert.equal((navigation?.settings.items as Array<{ label: string }>).length, 4);
  assert.equal((navigation?.settings.items as Array<{ url: { url: string } }>)[0]?.url.url, "#thoughts");
  assert.equal((accordion?.settings.items as Array<{ title: string }>).length, 4);
  assert.equal((accordion?.settings.items as Array<{ content: string }>)[0]?.content, "活動内容");
  assert.equal(form?.settings._element_id, "contact");
  assert.ok(elements.some((element) => element.settings._element_id === "thoughts"));
});

test("Figma Auto Layout becomes normal-flow Elementor Flexbox with a quality report", async () => {
  const file: MockFigmaFile = {
    document: {
      id: "0:0",
      name: "Auto Layout campaign",
      type: "DOCUMENT",
      children: [{
        id: "1:0",
        name: "Page",
        type: "CANVAS",
        children: [{
          id: "2:0",
          name: "PC-page",
          type: "FRAME",
          layoutMode: "VERTICAL",
          primaryAxisAlignItems: "MIN",
          counterAxisAlignItems: "CENTER",
          itemSpacing: 24,
          paddingTop: 40,
          paddingRight: 40,
          paddingBottom: 40,
          paddingLeft: 40,
          absoluteBoundingBox: { x: 0, y: 0, width: 1200, height: 800 },
          children: [{
            id: "3:0",
            name: "Feature row",
            type: "FRAME",
            layoutMode: "HORIZONTAL",
            primaryAxisAlignItems: "SPACE_BETWEEN",
            counterAxisAlignItems: "CENTER",
            layoutAlign: "STRETCH",
            layoutSizingHorizontal: "FILL",
            itemSpacing: 20,
            absoluteBoundingBox: { x: 40, y: 40, width: 1120, height: 120 },
            children: [
              {
                id: "4:0",
                name: "Title",
                type: "TEXT",
                characters: "Auto Layout見出し",
                absoluteBoundingBox: { x: 40, y: 80, width: 360, height: 44 },
                style: { fontSize: 32, fontWeight: 700, lineHeightPx: 44 },
              },
              {
                id: "4:1",
                name: "Description",
                type: "TEXT",
                characters: "通常フローで配置",
                layoutGrow: 1,
                absoluteBoundingBox: { x: 420, y: 84, width: 740, height: 36 },
                style: { fontSize: 22, fontWeight: 400, lineHeightPx: 36 },
              },
            ],
          }],
        }],
      }],
    },
  };

  const result = await convertFile(file);
  const root = result.elementorTemplate.content[0];
  const row = root?.elements[0];
  const [title, description] = row?.elements ?? [];

  assert.equal(root?.settings.flex_direction, "column");
  assert.deepEqual(root?.settings.flex_gap, {
    column: "2",
    row: "2",
    isLinked: true,
    unit: "vw",
    size: 2,
  });
  assert.deepEqual(root?.settings.padding, {
    unit: "vw",
    top: "3.333",
    right: "3.333",
    bottom: "3.333",
    left: "3.333",
    isLinked: true,
  });
  assert.equal(row?.settings.position, undefined);
  assert.equal(row?.settings.flex_direction, "row");
  assert.equal(row?.settings.flex_justify_content, "space-between");
  assert.equal(row?.settings.flex_align_items, "center");
  assert.equal(title?.settings._position, undefined);
  assert.equal(description?.settings._position, undefined);
  assert.equal(description?.settings._flex_grow, "1");
  assert.match(result.previewHtml, /display:flex;flex-direction:column/);
  assert.match(result.previewHtml, /position:relative/);
  assert.doesNotMatch(result.previewHtml, /Auto Layout見出し[^]*position:absolute/);

  assert.equal(result.qualityReport?.score, 100);
  assert.equal(result.qualityReport?.grade, "A");
  assert.equal(result.qualityReport?.readyForDraft, true);
  assert.equal(result.qualityReport?.metrics.autoLayoutFrames, 2);
  assert.equal(result.qualityReport?.metrics.mappedAutoLayoutFrames, 2);
  assert.equal(result.qualityReport?.metrics.editableTextNodes, 2);
  assert.equal(
    result.qualityReport?.checks.find((check) => check.id === "auto-layout")?.status,
    "pass",
  );
});
