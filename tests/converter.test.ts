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
                  absoluteBoundingBox: { x: 180, y: 220, width: 850, height: 90 },
                  style: { fontFamily: "Noto Sans JP", fontSize: 64, fontWeight: 800, lineHeightPx: 86 },
                  fills: [{ type: "SOLID", color: { r: 0.82, g: 0.04, b: 0.17 } }],
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
  assert.equal((root?.settings.min_height as { size?: number })?.size, 1600);

  const elements: typeof result.elementorTemplate.content = [];
  const visit = (items: typeof result.elementorTemplate.content): void => {
    for (const item of items) {
      elements.push(item);
      visit(item.elements);
    }
  };
  visit(result.elementorTemplate.content);
  const heading = elements.find((element) => element.widgetType === "heading");
  const portrait = elements.find((element) => element.widgetType === "image");
  assert.equal(heading?.settings.title, "明石をずーっと元気なまちに！");
  assert.equal(heading?.settings.typography_font_size && (heading.settings.typography_font_size as { size: number }).size, 64);
  assert.equal((portrait?.settings.image as { url?: string })?.url, "https://images.example/portrait-rendered.png");
  assert.equal(portrait?.settings._position, "absolute");
  assert.match(result.previewHtml, /明石をずーっと元気なまちに/);
  assert.match(result.previewHtml, /portrait-rendered\.png/);
  assert.ok(result.warnings.some((warning) => warning.includes("高忠実度モード")));
});
