import assert from "node:assert/strict";
import test from "node:test";
import type { FigmaNode } from "@figmapress/figma-parser";
import {
  discoverFigmaPageCandidates,
  pruneFigmaDocumentToFrames,
  selectedFigmaFrameIds,
} from "../apps/web/src/lib/figma-frame-selection";

function text(
  id: string,
  characters: string,
  x: number,
  y: number,
  fontSize = 48,
): FigmaNode {
  return {
    id,
    name: characters,
    type: "TEXT",
    characters,
    absoluteBoundingBox: { x, y, width: 480, height: 64 },
    style: { fontSize },
  };
}

function frame(
  id: string,
  name: string,
  x: number,
  y: number,
  width: number,
  height: number,
  heading: string,
): FigmaNode {
  return {
    id,
    name,
    type: "FRAME",
    absoluteBoundingBox: { x, y, width, height },
    children: [text(`${id}:heading`, heading, x + 80, y + 180)],
  };
}

function document(children: FigmaNode[]): FigmaNode {
  return {
    id: "0:0",
    name: "株式会社建工101",
    type: "DOCUMENT",
    children: [{ id: "0:1", name: "Web design", type: "CANVAS", children }],
  };
}

test("pairs responsive frames by page content instead of globally largest PC and SP roots", () => {
  const input = document([
    frame("10:1", "PC-page", 0, 0, 1440, 7200, "1からはじまる信頼の道"),
    frame("10:2", "SP-page", 1540, 0, 390, 6100, "1からはじまる信頼の道"),
    frame("20:1", "PC-page", 2200, 0, 1440, 5400, "会社案内"),
    frame("20:2", "SP-page", 3740, 0, 390, 5000, "会社案内"),
  ]);

  const pages = discoverFigmaPageCandidates(input);
  assert.equal(pages.length, 2);
  assert.equal(pages[0]?.title, "1からはじまる信頼の道");
  assert.equal(pages[0]?.desktop?.id, "10:1");
  assert.equal(pages[0]?.mobile?.id, "10:2");
  assert.equal(pages[1]?.desktop?.id, "20:1");
  assert.equal(pages[1]?.mobile?.id, "20:2");
  assert.deepEqual(selectedFigmaFrameIds(pages, "20:2"), ["20:1", "20:2"]);
});

test("does not join an unrelated nearby mobile frame when headings disagree", () => {
  const input = document([
    frame("10:1", "PC-page", 0, 0, 1440, 7200, "トップページ"),
    frame("20:2", "SP-page", 1540, 0, 390, 4800, "会社案内"),
  ]);

  const pages = discoverFigmaPageCandidates(input);
  assert.equal(pages.length, 2);
  assert.equal(pages[0]?.mobile, undefined);
  assert.equal(pages[1]?.desktop, undefined);
});

test("prunes the Figma canvas to the selected responsive page only", () => {
  const sharedComponent: FigmaNode = {
    id: "90:1",
    name: "SP_Comp/Carousel",
    type: "FRAME",
    absoluteBoundingBox: { x: 0, y: 8000, width: 1172, height: 440 },
  };
  const input = document([
    frame("10:1", "PC-page", 0, 0, 1440, 7200, "トップページ"),
    frame("10:2", "SP-page", 1540, 0, 390, 6100, "トップページ"),
    frame("20:1", "PC-page", 2200, 0, 1440, 5400, "会社案内"),
    sharedComponent,
  ]);
  const pruned = pruneFigmaDocumentToFrames(input, ["10:1", "10:2"]);
  assert.deepEqual(
    pruned.children?.[0]?.children?.map((node) => node.id),
    ["10:1", "10:2", "90:1"],
  );
});
