import assert from "node:assert/strict";
import test from "node:test";
import mockFigma from "../examples/mock-figma.json";
import { convertFile } from "../apps/web/src/lib/converter.ts";
import { applyExactVisualPresentation } from "../apps/web/src/lib/exact-visual.ts";
import {
  figmaRotationShouldApply,
  figmaTextShouldWrap,
} from "../packages/elementor-renderer/src/figma-exporter.ts";
import type { FigmaNode, MockFigmaFile } from "@figmapress/figma-parser";

test("single-line fixed Figma headings do not wrap into adjacent text", () => {
  const heading: FigmaNode = {
    id: "hero-line-2",
    name: "0からの挑戦、確かな実績",
    type: "TEXT",
    characters: "0からの挑戦、確かな実績",
    textAutoResize: "NONE",
    absoluteBoundingBox: { x: 20, y: 538, width: 387, height: 68 },
    style: {
      fontFamily: "Noto Serif JP",
      fontSize: 32,
      fontWeight: 400,
      lineHeightPx: 46,
    },
    characterStyleOverrides: [1, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2],
    styleOverrideTable: {
      "1": { fontSize: 48 },
      "2": { fontSize: 28 },
    },
  };

  for (const textAutoResize of ["NONE", "HEIGHT", "WIDTH_AND_HEIGHT"] as const) {
    assert.equal(figmaTextShouldWrap({ ...heading, textAutoResize }), false);
  }
  assert.equal(
    figmaTextShouldWrap({
      ...heading,
      id: "paragraph",
      name: "Fixed paragraph",
      absoluteBoundingBox: { x: 20, y: 700, width: 387, height: 140 },
    }),
    true,
  );
});

test("full-bleed rotated section backgrounds do not rotate their bounding box twice", () => {
  const sectionBackground: FigmaNode = {
    id: "topics-bg",
    name: "Rectangle 47",
    type: "RECTANGLE",
    rotation: 3.142,
    absoluteBoundingBox: { x: 0, y: 696, width: 440, height: 605 },
    fills: [{ type: "SOLID", color: { r: 0.173, g: 0.173, b: 0.173 } }],
  };
  const pageBounds = { x: 0, y: 0, width: 440, height: 5390 };

  assert.equal(figmaRotationShouldApply(sectionBackground, pageBounds), false);
  assert.equal(
    figmaRotationShouldApply({
      ...sectionBackground,
      id: "accent",
      absoluteBoundingBox: { x: 40, y: 696, width: 220, height: 80 },
    }, pageBounds),
    true,
  );
});

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
                  id: "3:6",
                  name: "Measured wrapped paragraph",
                  characters: "Figmaの実測高が複数行なら、幅と高さの自動調整指定でも折り返します。",
                  type: "TEXT",
                  textAutoResize: "WIDTH_AND_HEIGHT",
                  absoluteBoundingBox: { x: 620, y: 470, width: 420, height: 120 },
                  style: { fontFamily: "Noto Sans JP", fontSize: 20, lineHeightPx: 40 },
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
  const measuredWrappedParagraph = elements.find((element) => String(element.settings.editor).includes("実測高が複数行"));
  const portrait = elements.find((element) => element.widgetType === "image");
  assert.match(String(heading?.settings.editor), /white-space:pre/);
  assert.match(String(heading?.settings.editor), /writing-mode:horizontal-tb/);
  assert.match(String(heading?.settings.editor), /line-break:strict/);
  assert.equal(heading?.settings.css_classes, "figmapress-text figmapress-text--horizontal");
  assert.deepEqual(heading?.settings.typography_font_size, { unit: "vw", size: 3.333, sizes: [] });
  assert.equal(punctuation?.settings._transform_rotate_popover, "transform");
  assert.deepEqual(punctuation?.settings._transform_rotateZ_effect, { unit: "deg", size: 7.54, sizes: [] });
  assert.deepEqual(mixedHeading?.settings.typography_font_size, { unit: "vw", size: 4.375, sizes: [] });
  assert.match(String(mixedHeading?.settings.editor), /<span style="display:block;font-size:0;line-height:0;max-width:100%"><span/);
  assert.match(String(mixedHeading?.settings.editor), /font-size:3\.75vw/);
  assert.match(String(mixedHeading?.settings.editor), /font-size:4\.375vw/);
  assert.match(String(fixedParagraph?.settings.editor), /white-space:pre-wrap/);
  assert.match(String(fixedParagraph?.settings.editor), /height:5\.208vw/);
  assert.match(String(fixedParagraph?.settings.editor), /overflow:visible/);
  assert.match(String(truncatedNotice?.settings.editor), /white-space:pre-wrap/);
  assert.match(String(truncatedNotice?.settings.editor), /height:3\.125vw/);
  assert.match(String(truncatedNotice?.settings.editor), /overflow:hidden/);
  assert.match(String(measuredWrappedParagraph?.settings.editor), /white-space:pre-wrap/);
  assert.match(String(measuredWrappedParagraph?.settings.editor), /overflow-wrap:anywhere/);
  assert.match(String(measuredWrappedParagraph?.settings.editor), /word-break:break-word/);
  assert.equal((portrait?.settings.image as { url?: string })?.url, "https://images.example/portrait-rendered.png");
  assert.deepEqual(portrait?.settings.height, { unit: "vw", size: 36.458, sizes: [] });
  assert.equal(portrait?.settings._position, "absolute");
  assert.match(result.previewHtml, /明石をずーっと元気なまちに/);
  assert.match(
    result.previewHtml,
    /font-size:0;line-height:0;max-width:100%"><span style="[^\"]*font-size:3\.333vw/,
  );
  assert.match(result.previewHtml, /data-figmapress-node-name="Main heading"/);
  assert.match(result.previewHtml, /data-figmapress-kind="text"/);
  assert.match(result.previewHtml, /writing-mode:horizontal-tb/);
  assert.match(
    result.previewHtml,
    /transform:var\(--figmapress-qa-global-transform\) var\(--figmapress-qa-runtime-global-transform\) var\(--figmapress-qa-local-transform\) var\(--figmapress-qa-runtime-local-transform\) var\(--figmapress-qa-geometry-transform\) var\(--figmapress-qa-runtime-geometry-transform\) rotate\(7\.54deg\)/,
  );
  assert.match(result.previewHtml, /portrait-rendered\.png/);
  assert.deepEqual(result.qualityReport?.metrics.typography, {
    horizontalTextNodes: 6,
    wrappingTextNodes: 3,
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

test("rich text font-size overrides preserve the base line-height ratio", async () => {
  const file: MockFigmaFile = {
    document: {
      id: "0:0",
      name: "Mobile rich text",
      type: "DOCUMENT",
      children: [{
        id: "1:0",
        name: "Page",
        type: "CANVAS",
        children: [{
          id: "46:210",
          name: "SP-page",
          type: "FRAME",
          absoluteBoundingBox: { x: 0, y: 0, width: 440, height: 707 },
          children: [{
            id: "2023:563",
            name: "Mobile heading",
            type: "TEXT",
            characters: "明石\n元気",
            textAutoResize: "WIDTH_AND_HEIGHT",
            absoluteBoundingBox: { x: 30, y: 78, width: 349, height: 125 },
            style: {
              fontFamily: "Inter",
              fontSize: 84,
              fontWeight: 700,
              lineHeightPx: 101.64,
            },
            characterStyleOverrides: [1, 1, 1, 2, 2],
            styleOverrideTable: {
              "1": { fontSize: 48 },
              "2": { fontSize: 54 },
            },
          }],
        }],
      }],
    },
  };

  const result = await convertFile(file);
  const heading = result.elementorTemplate.content[0]?.elements[0];
  const editor = String(heading?.settings.editor);

  assert.match(editor, /font-size:10\.909vw/);
  assert.match(editor, /font-size:12\.273vw/);
  assert.match(editor, /line-height:1\.21/);
  assert.doesNotMatch(editor, /line-height:2\.118/);
  assert.match(editor, /display:block;font-size:0;line-height:0;max-width:100%/);
  assert.match(result.previewHtml, /line-height:1\.21/);
  assert.doesNotMatch(result.previewHtml, /line-height:2\.118/);
  assert.match(result.previewHtml, /display:block;font-size:0;line-height:0;max-width:100%/);
});

test("larger mixed-size runs keep Figma's common absolute line box", async () => {
  const file: MockFigmaFile = {
    document: {
      id: "0:0",
      name: "Desktop mixed-size heading",
      type: "DOCUMENT",
      children: [{
        id: "1:0",
        name: "Page",
        type: "CANVAS",
        children: [{
          id: "46:12",
          name: "PC-page",
          type: "FRAME",
          absoluteBoundingBox: { x: 0, y: 0, width: 1440, height: 900 },
          children: [{
            id: "192:180",
            name: "Hero heading",
            type: "TEXT",
            characters: "1からはじまる信頼の道\n0からの挑戦",
            textAutoResize: "WIDTH_AND_HEIGHT",
            absoluteBoundingBox: { x: 119, y: 470, width: 832, height: 324 },
            style: {
              fontFamily: "Noto Serif JP",
              fontSize: 64,
              fontWeight: 400,
              lineHeightPx: 108,
            },
            characterStyleOverrides: [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0],
            styleOverrideTable: {
              "1": { fontSize: 96 },
            },
          }],
        }],
      }],
    },
  };

  const result = await convertFile(file);
  const heading = result.elementorTemplate.content[0]?.elements[0];
  const editor = String(heading?.settings.editor);

  assert.match(editor, /font-size:6\.667vw[^>]*line-height:1\.125/);
  assert.match(editor, /font-size:4\.444vw[^>]*line-height:1\.688/);
  assert.doesNotMatch(editor, /font-size:6\.667vw[^>]*line-height:1\.688/);
  assert.match(result.previewHtml, /font-size:6\.667vw[^>]*line-height:1\.125/);
});

test("exact presentation keeps responsive snapshots and native Elementor editing", () => {
  const output: Awaited<ReturnType<typeof convertFile>> = {
    blueprint: {
      site: { name: "Exact", type: "landing_page", language: "ja" },
      tokens: { colors: [], typography: [], spacing: [] },
      pages: [],
      warnings: [],
    },
    pageContent: "",
    elementorTemplate: {
      title: "Exact",
      type: "page",
      version: "0.4",
      page_settings: {},
      content: [
        { id: "native1", elType: "container", isInner: false, settings: { css_classes: "figmapress-layout figmapress-layout--desktop" }, elements: [] },
        { id: "native2", elType: "container", isInner: false, settings: { css_classes: "figmapress-layout figmapress-layout--mobile" }, elements: [] },
      ],
    },
    previewHtml: '<div class="figmapress-figma-preview figmapress-figma-preview--desktop" data-figmapress-layout="desktop"><div data-figmapress-kind="text">編集文字</div></div>',
    qualityReport: {} as NonNullable<Awaited<ReturnType<typeof convertFile>>["qualityReport"]>,
    multiPagePlan: null,
    themeJson: {},
    warnings: [],
    summary: { pageTitle: "Exact", sectionCount: 1, sectionTypes: ["figma"] },
  };

  const exact = applyExactVisualPresentation(output, {
    desktop: {
      nodeId: "10:1",
      name: "PC",
      url: "https://images.example/exact-pc.jpg",
      width: 800,
      height: 4477,
      sourceWidth: 1440,
      sourceHeight: 8058,
      format: "jpg",
    },
    mobile: {
      nodeId: "10:2",
      name: "SP",
      url: "https://images.example/exact-mobile.jpg",
      width: 440,
      height: 5390,
      sourceWidth: 440,
      sourceHeight: 5390,
      format: "jpg",
    },
  });

  assert.match(exact.previewHtml, /figmapress-exact-preview/);
  assert.match(exact.previewHtml, /data-figmapress-reference-node-id="10:1"/);
  assert.match(exact.previewHtml, /exact-pc\.jpg/);
  assert.match(exact.previewHtml, /exact-mobile\.jpg/);
  assert.match(exact.previewHtml, /figmapress-exact-interaction-layer[^>]*>.*編集文字/);
  assert.doesNotMatch(exact.previewHtml, /figmapress-exact-interaction-layer" aria-hidden/);
  assert.equal(exact.elementorTemplate.page_settings.figmapress_exact_visual, "yes");
  assert.equal(exact.elementorTemplate.content.length, 1);
  const stack = exact.elementorTemplate.content[0];
  assert.match(String(stack?.settings.css_classes), /figmapress-exact-stack/);
  assert.equal(stack?.elements.length, 4);
  assert.match(String(stack?.elements[0]?.settings.css_classes), /figmapress-exact-layout--desktop/);
  assert.match(String(stack?.elements[1]?.settings.css_classes), /figmapress-exact-layout--mobile/);
  assert.match(String(stack?.elements[2]?.settings.css_classes), /figmapress-native-layout/);
  assert.match(String(stack?.elements[3]?.settings.css_classes), /figmapress-native-layout/);
  assert.ok(exact.warnings.some((warning) => warning.includes("精密表示レイヤー")));
});

test("mobile containers preserve their Figma width across Elementor breakpoints", async () => {
  const file: MockFigmaFile = {
    document: {
      id: "0:0",
      name: "Mobile container width",
      type: "DOCUMENT",
      children: [{
        id: "1:0",
        name: "Page",
        type: "CANVAS",
        children: [{
          id: "46:210",
          name: "SP-page",
          type: "FRAME",
          absoluteBoundingBox: { x: 0, y: 0, width: 440, height: 600 },
          children: [{
            id: "2023:900",
            name: "Footer button outline",
            type: "FRAME",
            absoluteBoundingBox: { x: 30, y: 100, width: 380, height: 48 },
            fills: [{ type: "SOLID", color: { r: 1, g: 1, b: 1 }, opacity: 0 }],
            strokes: [{ type: "SOLID", color: { r: 1, g: 1, b: 1 } }],
            strokeWeight: 1,
          }],
        }],
      }],
    },
  };

  const result = await convertFile(file);
  const outlinedContainer = result.elementorTemplate.content[0]?.elements[0];
  assert.equal(outlinedContainer?.elType, "container");
  assert.deepEqual(outlinedContainer?.settings.width, { unit: "%", size: 86.364, sizes: [] });
  assert.deepEqual(outlinedContainer?.settings.width_tablet, outlinedContainer?.settings.width);
  assert.deepEqual(outlinedContainer?.settings.width_mobile, outlinedContainer?.settings.width);
  assert.equal(outlinedContainer?.settings.z_index, 1);
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

test("Figma image fit modes use exact renders first and safe native fallbacks", async () => {
  const file: MockFigmaFile = {
    document: {
      id: "0:0",
      name: "Image fidelity",
      type: "DOCUMENT",
      children: [{
        id: "1:0",
        name: "Page",
        type: "CANVAS",
        children: [{
          id: "2:0",
          name: "PC-page",
          type: "FRAME",
          absoluteBoundingBox: { x: 0, y: 0, width: 1200, height: 800 },
          children: [{
            id: "3:0",
            name: "Fit image",
            type: "RECTANGLE",
            absoluteBoundingBox: { x: 40, y: 40, width: 300, height: 200 },
            fills: [{ type: "IMAGE", imageRef: "fit-ref", scaleMode: "FIT" }],
          }, {
            id: "3:1",
            name: "Fill image",
            type: "RECTANGLE",
            absoluteBoundingBox: { x: 360, y: 40, width: 300, height: 200 },
            fills: [{ type: "IMAGE", imageRef: "fill-ref", scaleMode: "FILL" }],
          }, {
            id: "3:2",
            name: "Adjusted crop",
            type: "RECTANGLE",
            absoluteBoundingBox: { x: 680, y: 40, width: 300, height: 200 },
            fills: [{
              type: "IMAGE",
              imageRef: "crop-ref",
              scaleMode: "STRETCH",
              imageTransform: [[1.5, 0, -0.2], [0, 1.5, -0.1]],
            }],
          }, {
            id: "3:3",
            name: "Tiled texture",
            type: "RECTANGLE",
            absoluteBoundingBox: { x: 40, y: 280, width: 300, height: 200 },
            fills: [{
              type: "IMAGE",
              imageRef: "tile-ref",
              scaleMode: "TILE",
              scalingFactor: 0.5,
            }],
          }, {
            id: "3:4",
            name: "Editable adjusted crop",
            type: "RECTANGLE",
            absoluteBoundingBox: { x: 360, y: 280, width: 300, height: 200 },
            fills: [{
              type: "IMAGE",
              imageRef: "editable-crop-ref",
              scaleMode: "STRETCH",
              imageTransform: [[1.25, 0.1, -0.15], [-0.05, 1.4, -0.2]],
              rotation: 7.5,
              filters: { exposure: 0.5, contrast: 0.2, saturation: -0.25 },
            }],
          }],
        }],
      }],
    },
  };

  const result = await convertFile(
    file,
    {},
    {
      "fit-ref": "https://images.example/fit.png",
      "fill-ref": "https://images.example/fill.png",
      "crop-ref": "https://images.example/crop.png",
      "tile-ref": "https://images.example/tile.png",
      "editable-crop-ref": "https://images.example/editable-crop.png",
    },
    [],
    { "3:2": "https://images.example/crop-rendered.png" },
  );
  const imageWidgets = result.elementorTemplate.content[0]?.elements
    .filter((element) => element.widgetType === "image") ?? [];
  const byNodeId = new Map(imageWidgets.map((element) => [
    element.settings.figmapress_node_id,
    element.settings,
  ]));

  assert.equal(byNodeId.get("3:0")?.["object-fit"], "contain");
  assert.equal(byNodeId.get("3:1")?.["object-fit"], "cover");
  assert.equal(byNodeId.get("3:2")?.["object-fit"], "fill");
  assert.equal(
    (byNodeId.get("3:2")?.image as { url?: string })?.url,
    "https://images.example/crop-rendered.png",
  );
  assert.deepEqual(byNodeId.get("3:3")?.figmapress_image, {
    mode: "tile",
    scalingFactor: 0.5,
  });
  assert.deepEqual(byNodeId.get("3:4")?.figmapress_image, {
    mode: "stretch",
    transform: {
      a: 1.25,
      b: 0.1,
      c: -0.05,
      d: 1.4,
      tx: -0.15,
      ty: -0.2,
    },
    rotation: 7.5,
    filters: { exposure: 0.5, contrast: 0.2, saturation: -0.25 },
  });
  assert.match(result.previewHtml, /data-figmapress-image-source="native"[^>]+object-fit:contain/);
  assert.match(result.previewHtml, /data-figmapress-image-source="rendered"[^>]+crop-rendered\.png/);
  assert.match(result.previewHtml, /data-figmapress-image-mode="tile"/);
  assert.match(result.previewHtml, /background-size:50% auto/);
  assert.match(result.previewHtml, /data-figmapress-image-mode="stretch"/);
  assert.match(result.previewHtml, /translate:-15% -20%/);
  assert.match(result.previewHtml, /matrix\(1\.25,-0\.05,0\.1,1\.4,0,0\) rotate\(7\.5deg\)/);
  assert.match(result.previewHtml, /brightness\(1\.414\) contrast\(1\.2\) saturate\(0\.75\)/);
  assert.deepEqual(result.qualityReport?.metrics.images, {
    visible: 5,
    mapped: 5,
    exactRendered: 1,
    nativeFit: 2,
    structuredAdjusted: 2,
    adjusted: 3,
    masks: 0,
  });
  assert.equal(
    result.qualityReport?.checks.find((check) => check.id === "images")?.status,
    "pass",
  );
});

test("Figma gradients keep their handles and all color stops in Elementor", async () => {
  const file: MockFigmaFile = {
    document: {
      id: "0:0",
      name: "Gradient campaign",
      type: "DOCUMENT",
      children: [{
        id: "1:0",
        name: "Page",
        type: "CANVAS",
        children: [{
          id: "2:0",
          name: "PC-page",
          type: "FRAME",
          absoluteBoundingBox: { x: 0, y: 0, width: 400, height: 200 },
          children: [{
            id: "3:0",
            name: "Campaign fade",
            type: "RECTANGLE",
            absoluteBoundingBox: { x: 0, y: 0, width: 400, height: 200 },
            fills: [{
              type: "GRADIENT_LINEAR",
              gradientHandlePositions: [
                { x: 0, y: 0 },
                { x: 1, y: 1 },
                { x: 0, y: 1 },
              ],
              gradientStops: [
                { position: 0, color: { r: 1, g: 0, b: 0 } },
                { position: 0.5, color: { r: 0, g: 1, b: 0, a: 0.5 } },
                { position: 1, color: { r: 0, g: 0, b: 1 } },
              ],
            }],
          }],
        }],
      }],
    },
  };

  const result = await convertFile(file);
  const gradient = result.elementorTemplate.content[0]?.elements[0]?.settings;
  assert.equal(gradient?.background_background, "gradient");
  assert.equal(gradient?.background_color, "#FF0000");
  assert.equal(gradient?.background_color_b, "#0000FF");
  assert.deepEqual(gradient?.background_gradient_angle, {
    unit: "deg",
    size: 116.565,
    sizes: [],
  });
  assert.deepEqual(gradient?.figmapress_gradient, {
    type: "linear",
    angle: 116.565,
    stops: [
      {
        color: { red: 255, green: 0, blue: 0, alpha: 1 },
        position: 0,
      },
      {
        color: { red: 0, green: 255, blue: 0, alpha: 0.5 },
        position: 50,
      },
      {
        color: { red: 0, green: 0, blue: 255, alpha: 1 },
        position: 100,
      },
    ],
  });
  assert.match(
    result.previewHtml,
    /linear-gradient\(116\.565deg, #FF0000 0%, rgba\(0, 255, 0, 0\.5\) 50%, #0000FF 100%\)/,
  );
  assert.deepEqual(result.qualityReport?.metrics.gradients, {
    visible: 1,
    mapped: 1,
    multiStop: 1,
  });
  assert.equal(
    result.qualityReport?.checks.find((check) => check.id === "gradients")?.status,
    "pass",
  );
});

test("Figma radial gradients keep their center and ellipse radii", async () => {
  const file: MockFigmaFile = {
    document: {
      id: "0:0",
      name: "Radial campaign",
      type: "DOCUMENT",
      children: [{
        id: "1:0",
        name: "Page",
        type: "CANVAS",
        children: [{
          id: "2:0",
          name: "PC-page",
          type: "FRAME",
          absoluteBoundingBox: { x: 0, y: 0, width: 200, height: 100 },
          children: [{
            id: "3:0",
            name: "Radial glow",
            type: "RECTANGLE",
            absoluteBoundingBox: { x: 0, y: 0, width: 200, height: 100 },
            fills: [{
              type: "GRADIENT_RADIAL",
              gradientHandlePositions: [
                { x: 0.5, y: 0.5 },
                { x: 1, y: 0.5 },
                { x: 0.5, y: 1 },
              ],
              gradientStops: [
                { position: 0, color: { r: 1, g: 1, b: 1 } },
                { position: 1, color: { r: 1, g: 0.8, b: 0.8 } },
              ],
            }],
          }],
        }],
      }],
    },
  };

  const result = await convertFile(file);
  const gradient = result.elementorTemplate.content[0]?.elements[0]?.settings;
  assert.equal(gradient?.background_gradient_type, "radial");
  assert.equal(gradient?.background_gradient_position, "center center");
  assert.deepEqual(gradient?.figmapress_gradient, {
    type: "radial",
    center: { x: 50, y: 50 },
    radius: { x: 50, y: 50 },
    stops: [
      {
        color: { red: 255, green: 255, blue: 255, alpha: 1 },
        position: 0,
      },
      {
        color: { red: 255, green: 204, blue: 204, alpha: 1 },
        position: 100,
      },
    ],
  });
  assert.match(
    result.previewHtml,
    /radial-gradient\(ellipse 50% 50% at 50% 50%, #FFFFFF 0%, #FFCCCC 100%\)/,
  );
});

test("Figma opacity, multiple shadows, and blur effects stay aligned in preview and Elementor", async () => {
  const file: MockFigmaFile = {
    document: {
      id: "0:0",
      name: "Effects campaign",
      type: "DOCUMENT",
      children: [{
        id: "1:0",
        name: "Page",
        type: "CANVAS",
        children: [{
          id: "2:0",
          name: "PC-page",
          type: "FRAME",
          absoluteBoundingBox: { x: 0, y: 0, width: 400, height: 240 },
          children: [{
            id: "3:0",
            name: "Translucent campaign card",
            type: "RECTANGLE",
            opacity: 0.65,
            absoluteBoundingBox: { x: 40, y: 30, width: 320, height: 180 },
            fills: [{ type: "SOLID", color: { r: 1, g: 1, b: 1 } }],
            effects: [
              {
                type: "DROP_SHADOW",
                color: { r: 0.82, g: 0.04, b: 0.17, a: 0.5 },
                offset: { x: 0, y: 8 },
                radius: 24,
                spread: 2,
              },
              {
                type: "INNER_SHADOW",
                color: { r: 1, g: 1, b: 1, a: 0.7 },
                offset: { x: 0, y: 1 },
                radius: 4,
                spread: 0,
              },
              { type: "LAYER_BLUR", radius: 3 },
              { type: "BACKGROUND_BLUR", radius: 12 },
            ],
          }],
        }],
      }],
    },
  };

  const result = await convertFile(file);
  const settings = result.elementorTemplate.content[0]?.elements[0]?.settings;
  assert.deepEqual(settings?.figmapress_effects, {
    opacity: 0.65,
    shadows: [
      {
        type: "drop",
        x: 0,
        y: 8,
        blur: 24,
        spread: 2,
        color: { red: 209, green: 10, blue: 43, alpha: 0.5 },
      },
      {
        type: "inner",
        x: 0,
        y: 1,
        blur: 4,
        spread: 0,
        color: { red: 255, green: 255, blue: 255, alpha: 0.7 },
      },
    ],
    blur: 3,
    backgroundBlur: 12,
  });
  assert.equal(settings?.box_shadow_box_shadow_type, "yes");
  assert.deepEqual(settings?.box_shadow_box_shadow, {
    horizontal: 0,
    vertical: 8,
    blur: 24,
    spread: 2,
    color: "rgba(209, 10, 43, 0.5)",
  });
  assert.match(result.previewHtml, /opacity:0\.65/);
  assert.match(
    result.previewHtml,
    /box-shadow:0px 8px 24px 2px rgba\(209, 10, 43, 0\.5\),0px 1px 4px 0px rgba\(255, 255, 255, 0\.7\) inset/,
  );
  assert.match(result.previewHtml, /filter:blur\(3px\)/);
  assert.match(result.previewHtml, /backdrop-filter:blur\(12px\)/);
  assert.deepEqual(result.qualityReport?.metrics.effects, {
    visible: 5,
    mapped: 5,
    opacityNodes: 1,
    shadowEffects: 2,
    blurEffects: 2,
    multiShadowNodes: 1,
  });
  assert.equal(
    result.qualityReport?.checks.find((check) => check.id === "effects")?.status,
    "pass",
  );
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
                  {
                    id: "50:logo",
                    name: "{acf:section_image}",
                    type: "RECTANGLE",
                    absoluteBoundingBox: { x: 2130, y: 15, width: 79, height: 28 },
                    fills: [{ type: "IMAGE", imageRef: "mobile-logo", scaleMode: "FILL" }],
                  },
                  {
                    id: "50:cta-bg",
                    name: "Comp/Button-HeaderCTA/bg",
                    type: "RECTANGLE",
                    absoluteBoundingBox: { x: 2423, y: 8, width: 117, height: 45 },
                    fills: [{ type: "SOLID", color: { r: 0.82, g: 0.04, b: 0.17 } }],
                  },
                  text("50:1", "Comp/Button-HeaderCTA/text", "ご相談はこちら", 2423, 20, 100, 20, 10),
                  {
                    id: "50:cta-icon",
                    name: "{acf:section_image}",
                    type: "RECTANGLE",
                    absoluteBoundingBox: { x: 2468, y: 12, width: 28, height: 20 },
                    fills: [{ type: "IMAGE", imageRef: "mobile-envelope", scaleMode: "FIT" }],
                  },
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

  const result = await convertFile(file, {}, {
    "mobile-logo": "https://images.example/mobile-logo.png",
    "mobile-envelope": "https://images.example/mobile-envelope.png",
  });
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
  assert.equal((mobileNav?.settings.cta_url as { url: string }).url, "#contact-mobile");
  assert.equal(
    (mobileNav?.settings.logo as { url: string }).url,
    "https://images.example/mobile-logo.png",
  );
  assert.equal(
    (mobileNav?.settings.cta_icon as { url: string }).url,
    "https://images.example/mobile-envelope.png",
  );
  assert.deepEqual(
    JSON.parse(String(mobileNav?.settings.design_geometry)).ctaIcon,
    { x: 83.636, y: 22.642, width: 6.364, height: 37.736 },
  );
  assert.ok(mobileElements.some((element) => element.settings._element_id === "policies-mobile"));
  const mobileAnchorIds = mobileElements
    .map((element) => element.settings._element_id)
    .filter((id): id is string => typeof id === "string" && id.length > 0);
  assert.equal(new Set(mobileAnchorIds).size, mobileAnchorIds.length);
  assert.equal(mobileAnchorIds.filter((id) => id === "thoughts-mobile").length, 1);
  assert.equal(result.qualityReport?.metrics.navigationIntegrity.duplicateAnchors, 0);
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
              id: "35:0",
              name: "Sec/Results Sec",
              type: "FRAME",
              absoluteBoundingBox: { x: 0, y: 1100, width: 1920, height: 300 },
              children: [
                text("35:1", "Filter label", "市民相談", 300, 1200, 180),
              ],
            },
            {
              id: "40:0",
              name: "Comp/Button-CTA",
              type: "FRAME",
              absoluteBoundingBox: { x: 0, y: 1515, width: 1920, height: 900 },
              children: [{
                id: "40:group",
                name: "Comp/Button-CTA",
                type: "FRAME",
                absoluteBoundingBox: { x: 300, y: 1560, width: 1320, height: 760 },
                children: [
                  text("40:1", "Heading", "あなたの声を聞かせてください。", 600, 1580, 700, 50),
                  text("40:2", "Label", "お名前", 430, 1700),
                  text("40:3", "Label", "メールアドレス", 430, 1780, 180),
                  text("40:4", "Label", "お住まいの地域", 430, 1860, 180),
                  text("40:5", "Label", "ご相談・ご意見の内容", 430, 1940, 220),
                  text("40:6", "Button", "相談・意見を送る →", 800, 2200, 260),
                ],
              }],
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
  assert.equal(elements.filter((element) => element.settings._element_id === "contact").length, 1);
  assert.notEqual(
    elements.find((element) => element.settings.figmapress_node_id === "35:0")?.settings._element_id,
    "contact",
  );
  assert.equal(result.qualityReport?.metrics.expectedFunctionalWidgets.contactForm, 1);
  assert.equal(result.qualityReport?.metrics.functionalWidgets.contactForm, 1);
  assert.deepEqual(
    JSON.parse(String(navigation?.settings.design_geometry)).root,
    { width: 1920, height: 115 },
  );
  assert.deepEqual(
    JSON.parse(String(form?.settings.design_geometry)).root,
    { width: 1920, height: 900 },
  );
  assert.equal(
    result.qualityReport?.checks.find((check) => check.id === "component-geometry")?.status,
    "warning",
  );
  assert.ok(JSON.parse(String(accordion?.settings.design_geometry)).root.height > 0);
  assert.ok(elements.some((element) => element.settings._element_id === "thoughts"));
});

test("stacked mobile contact fields preserve each Figma control box", async () => {
  const fieldText = (
    id: string,
    characters: string,
    x: number,
    y: number,
    width: number,
    height = 19,
    fontSize = 16,
  ) => ({
    id,
    name: "Label",
    type: "TEXT",
    characters,
    absoluteBoundingBox: { x, y, width, height },
    style: { fontSize, fontWeight: 600 },
  });
  const box = (
    id: string,
    x: number,
    y: number,
    width: number,
    height: number,
    color = { r: 1, g: 1, b: 1 },
  ) => ({
    id,
    name: "Comp/Button-CTA/bg",
    type: "RECTANGLE",
    absoluteBoundingBox: { x, y, width, height },
    fills: [{ type: "SOLID", color }],
  });
  const file: MockFigmaFile = {
    document: {
      id: "0:0",
      name: "Stacked mobile form",
      type: "DOCUMENT",
      children: [{
        id: "1:0",
        name: "Page",
        type: "CANVAS",
        children: [{
          id: "46:210",
          name: "SP-page",
          type: "FRAME",
          absoluteBoundingBox: { x: 0, y: 0, width: 440, height: 785 },
          children: [{
            id: "2027:1064",
            name: "Comp/Button-CTA",
            type: "FRAME",
            absoluteBoundingBox: { x: 0, y: 0, width: 440, height: 785 },
            children: [
              box("panel", 30, 119, 380, 588, { r: 1, g: 0.886, b: 0.91 }),
              fieldText("title", "あなたの声を聞かせてください。", 32, 76, 377, 29, 24),
              fieldText("name-label", "お名前", 63, 160, 48),
              box("name-control", 63, 179, 315, 35),
              fieldText("email-label", "メールアドレス", 63, 236, 112),
              box("email-control", 63, 261, 315, 35),
              fieldText("region-label", "お住まいの地域", 63, 312, 112),
              box("region-control", 63, 337, 315, 35),
              fieldText("message-label", "ご相談・ご意見の内容", 63, 394, 160),
              box("message-control", 63, 419, 315, 100),
              fieldText("reply-label", "返信希望", 63, 546, 64),
              fieldText("reply-yes", "希望する", 87, 576, 56, 17, 14),
              fieldText("reply-no", "希望しない", 202, 576, 70, 17, 14),
              box("button-bg", 63, 621, 315, 46, { r: 0.725, g: 0.039, b: 0.137 }),
              fieldText("button-text", "相談・意見を送る →", 143, 635, 155, 19, 16),
            ],
          }],
        }],
      }],
    },
  };

  const result = await convertFile(file);
  const form = result.elementorTemplate.content[0]?.elements.find((element) =>
    element.widgetType === "figmapress-contact-form"
  );
  const geometry = JSON.parse(String(form?.settings.design_geometry));

  assert.deepEqual(geometry.fields.name.control, {
    x: 14.318,
    y: 22.803,
    width: 71.591,
    height: 4.459,
  });
  assert.deepEqual(geometry.fields.email.control, {
    x: 14.318,
    y: 33.248,
    width: 71.591,
    height: 4.459,
  });
  assert.deepEqual(geometry.fields.region.control, {
    x: 14.318,
    y: 42.93,
    width: 71.591,
    height: 4.459,
  });
  assert.deepEqual(geometry.fields.message.control, {
    x: 14.318,
    y: 53.376,
    width: 71.591,
    height: 12.739,
  });
  assert.equal(
    result.qualityReport?.checks.find((check) => check.id === "component-geometry")?.status,
    "pass",
  );
});

test("Figma carousel and prototype actions become editable functional widgets", async () => {
  const slide = (
    id: string,
    x: number,
    title: string,
    imageRef: string,
    url?: string,
  ) => ({
    id,
    name: "Comp/Carousel-Item",
    type: "FRAME",
    absoluteBoundingBox: { x, y: 300, width: 480, height: 360 },
    interactions: url ? [{
      actions: [{ type: "URL", url, openInNewTab: true }],
    }] : undefined,
    children: [
      {
        id: `${id}:image`,
        name: `${title} image`,
        type: "RECTANGLE",
        absoluteBoundingBox: { x, y: 300, width: 480, height: 300 },
        fills: [{ type: "IMAGE", imageRef, scaleMode: "FILL" }],
      },
      {
        id: `${id}:title`,
        name: "Title",
        type: "TEXT",
        characters: title,
        absoluteBoundingBox: { x: x + 20, y: 620, width: 440, height: 28 },
        style: { fontSize: 18, fontWeight: 600 },
      },
    ],
  });
  const file: MockFigmaFile = {
    document: {
      id: "0:0",
      name: "Functional carousel",
      type: "DOCUMENT",
      children: [{
        id: "1:0",
        name: "Page",
        type: "CANVAS",
        children: [{
          id: "46:12",
          name: "PC-page",
          type: "FRAME",
          absoluteBoundingBox: { x: 0, y: 0, width: 1920, height: 1800 },
          children: [
            {
              id: "20:0",
              name: "Comp/Carousel",
              type: "FRAME",
              absoluteBoundingBox: { x: 150, y: 260, width: 1620, height: 460 },
              children: [
                slide("20:1", 190, "活動報告1", "slide-1", "https://example.com/report-1"),
                slide("20:2", 710, "活動報告2", "slide-2"),
                slide("20:3", 1230, "活動報告3", "slide-3"),
                {
                  id: "20:4",
                  name: "Comp/Carousel-Prev",
                  type: "RECTANGLE",
                  absoluteBoundingBox: { x: 150, y: 440, width: 28, height: 44 },
                  fills: [{ type: "IMAGE", imageRef: "arrow-prev", scaleMode: "FIT" }],
                },
                {
                  id: "20:5",
                  name: "Comp/Carousel-Next",
                  type: "RECTANGLE",
                  absoluteBoundingBox: { x: 1742, y: 440, width: 28, height: 44 },
                  fills: [{ type: "IMAGE", imageRef: "arrow-next", scaleMode: "FIT" }],
                },
              ],
            },
            {
              id: "30:0",
              name: "Consultation Button Background",
              type: "RECTANGLE",
              absoluteBoundingBox: { x: 150, y: 800, width: 350, height: 84 },
              fills: [{ type: "SOLID", color: { r: 0.82, g: 0.04, b: 0.17 } }],
              interactions: [{
                actions: [{ type: "NODE", destinationId: "40:0", navigation: "NAVIGATE" }],
              }],
            },
            {
              id: "31:0",
              name: "Email",
              type: "TEXT",
              characters: "hello@example.com",
              absoluteBoundingBox: { x: 150, y: 920, width: 240, height: 30 },
              style: { fontSize: 18, fontWeight: 500 },
            },
            {
              id: "32:0",
              name: "Section heading",
              type: "TEXT",
              characters: "活動報告",
              absoluteBoundingBox: { x: 700, y: 920, width: 240, height: 40 },
              style: { fontSize: 32, fontWeight: 700 },
            },
            {
              id: "40:0",
              name: "Sec/Contact",
              type: "FRAME",
              absoluteBoundingBox: { x: 0, y: 1100, width: 1920, height: 600 },
              fills: [{ type: "SOLID", color: { r: 1, g: 0.9, b: 0.92 } }],
            },
          ],
        }],
      }],
    },
  };
  const result = await convertFile(file, {}, {
    "slide-1": "https://images.example/slide-1.jpg",
    "slide-2": "https://images.example/slide-2.jpg",
    "slide-3": "https://images.example/slide-3.jpg",
    "arrow-prev": "https://images.example/arrow-prev.svg",
    "arrow-next": "https://images.example/arrow-next.svg",
  });
  const elements: typeof result.elementorTemplate.content = [];
  const visit = (items: typeof result.elementorTemplate.content): void => {
    for (const item of items) {
      elements.push(item);
      visit(item.elements);
    }
  };
  visit(result.elementorTemplate.content);

  const carousel = elements.find((element) => element.widgetType === "figmapress-carousel");
  const link = elements.find((element) => element.widgetType === "figmapress-link");
  const email = elements.find((element) =>
    element.widgetType === "text-editor"
    && String(element.settings.editor).includes("hello@example.com"),
  );
  const plainHeading = elements.find((element) =>
    element.widgetType === "text-editor"
    && String(element.settings.editor).includes(">活動報告<"),
  );
  const items = carousel?.settings.items as Array<{
    title: string;
    url: { url: string; is_external: string };
  }>;
  assert.equal(items.length, 3);
  assert.equal(items[0]?.title, "活動報告1");
  assert.equal(items[0]?.url.url, "https://example.com/report-1");
  assert.equal(items[0]?.url.is_external, "on");
  assert.equal(carousel?.settings.items_per_view, 3);
  assert.equal((link?.settings.link_url as { url: string }).url, "#contact");
  assert.match(String(email?.settings.editor), /href="mailto:hello@example\.com"/);
  assert.doesNotMatch(String(plainHeading?.settings.editor), /data-figmapress-functional-link/);
  assert.equal(result.qualityReport?.metrics.functionalWidgets.carousel, 1);
  assert.equal(result.qualityReport?.metrics.functionalWidgets.links, 2);
  assert.equal(result.qualityReport?.metrics.expectedFunctionalWidgets.carousel, 1);
  assert.equal(
    result.qualityReport?.checks.find((check) => check.id === "interactions")?.status,
    "pass",
  );
  assert.equal(result.qualityReport?.metrics.navigationIntegrity.duplicateAnchors, 0);
});

test("quality gate warns when a Figma carousel loses its functional widget", async () => {
  const item = (id: string, x: number) => ({
    id,
    name: `Comp/Carousel-Item ${id}`,
    type: "FRAME",
    absoluteBoundingBox: { x, y: 100, width: 280, height: 180 },
    children: [{
      id: `${id}:visual`,
      name: "Slide visual",
      type: "RECTANGLE",
      absoluteBoundingBox: { x, y: 100, width: 280, height: 180 },
      fills: [{ type: "IMAGE", imageRef: `${id}:missing`, scaleMode: "FILL" }],
    }],
  });
  const file: MockFigmaFile = {
    document: {
      id: "0:0",
      name: "Missing carousel assets",
      type: "DOCUMENT",
      children: [{
        id: "1:0",
        name: "Page",
        type: "CANVAS",
        children: [{
          id: "2:0",
          name: "PC-page",
          type: "FRAME",
          absoluteBoundingBox: { x: 0, y: 0, width: 1200, height: 600 },
          children: [{
            id: "3:0",
            name: "Comp/Carousel",
            type: "FRAME",
            absoluteBoundingBox: { x: 100, y: 100, width: 1000, height: 180 },
            children: [item("slide-1", 100), item("slide-2", 400), item("slide-3", 700)],
          }],
        }],
      }],
    },
  };

  const result = await convertFile(file);

  assert.equal(result.qualityReport?.metrics.expectedFunctionalWidgets.carousel, 1);
  assert.equal(result.qualityReport?.metrics.functionalWidgets.carousel, 0);
  assert.equal(
    result.qualityReport?.checks.find((check) => check.id === "interactions")?.status,
    "warning",
  );
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

test("business-site menu labels become editable page links", async () => {
  const file: MockFigmaFile = {
    document: {
      id: "0:0",
      name: "Corporate site",
      type: "DOCUMENT",
      children: [{
        id: "1:0",
        name: "Page",
        type: "CANVAS",
        children: [{
          id: "2:0",
          name: "PC-page",
          type: "FRAME",
          absoluteBoundingBox: { x: 0, y: 0, width: 1440, height: 900 },
          children: [{
            id: "3:0",
            name: "会社案内",
            type: "TEXT",
            characters: "会社案内",
            absoluteBoundingBox: { x: 1100, y: 40, width: 120, height: 28 },
            style: { fontSize: 16, fontWeight: 600 },
          }],
        }],
      }],
    },
  };
  const result = await convertFile(file);
  const menuText = result.elementorTemplate.content[0]?.elements.find(
    (element) => element.settings.figmapress_node_id === "3:0",
  );
  assert.match(String(menuText?.settings.editor), /href="#company"/);
  assert.equal(result.qualityReport?.metrics.functionalWidgets.links, 1);
  assert.equal(result.qualityReport?.metrics.navigationIntegrity.navigationLinks, 1);
});

test("cross-page Figma prototype links survive page pruning in Elementor and preview", async () => {
  const actionRoot = (
    id: string,
    width: number,
    destinationId: string,
  ): FigmaNode => ({
    id,
    name: width < 768 ? "SP ホーム" : "PC ホーム",
    type: "FRAME",
    absoluteBoundingBox: { x: 0, y: 0, width, height: 900 },
    children: [{
      id: `${id}:company-link`,
      name: "Header/Menu-Item Company",
      type: "FRAME",
      absoluteBoundingBox: { x: width - 180, y: 30, width: 150, height: 50 },
      interactions: [{
        actions: [{ type: "NODE", navigation: "NAVIGATE", destinationId }],
      }],
      children: [{
        id: `${id}:company-label`,
        name: "Company label",
        type: "TEXT",
        characters: "会社案内",
        absoluteBoundingBox: { x: width - 165, y: 40, width: 120, height: 28 },
        style: { fontSize: 16, fontWeight: 600 },
      }],
    }],
  });
  const file: MockFigmaFile = {
    document: {
      id: "0:0",
      name: "Pruned corporate page",
      type: "DOCUMENT",
      children: [{
        id: "1:0",
        name: "Page",
        type: "CANVAS",
        children: [
          actionRoot("10:1", 1440, "20:1"),
          actionRoot("10:2", 440, "20:2"),
        ],
      }],
    },
  };
  const candidate = (id: string, title: string) => ({
    id: `${id}:1`,
    title,
    confidence: "content" as const,
    desktop: {
      id: `${id}:1`, name: `PC ${title}`, label: title,
      width: 1440, height: 900, variant: "desktop" as const,
    },
    mobile: {
      id: `${id}:2`, name: `SP ${title}`, label: title,
      width: 440, height: 900, variant: "mobile" as const,
    },
  });
  const result = await convertFile(file, {}, {}, [], {}, {
    candidates: [candidate("10", "ホーム"), candidate("20", "会社案内")],
    selectedFrameId: "10:1",
    siteTitle: "建工101",
  });
  const elements: typeof result.elementorTemplate.content = [];
  const visit = (items: typeof result.elementorTemplate.content): void => {
    for (const item of items) {
      elements.push(item);
      visit(item.elements);
    }
  };
  visit(result.elementorTemplate.content);
  const pageLinks = elements.filter((element) =>
    element.widgetType === "figmapress-link"
    && (element.settings.link_url as { url?: string })?.url === "#figmapress-page-company"
  );
  assert.equal(pageLinks.length, 2);
  assert.match(result.previewHtml, /data-figmapress-preview-link/);
  assert.match(result.previewHtml, /href="#figmapress-page-company"/);
  assert.equal(result.qualityReport?.metrics.navigationIntegrity.missingTargets, 0);
});
