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
