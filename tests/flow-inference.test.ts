import assert from "node:assert/strict";
import test from "node:test";
import type { FigmaNode } from "@figmapress/figma-parser";
import { inferFigmaVerticalFlow } from "../packages/elementor-renderer/src/flow-inference";
import { FigmaElementorExporter } from "../packages/elementor-renderer/src/figma-exporter";

function stack(): FigmaNode {
  return { id: "stack", type: "FRAME", name: "説明文の列", absoluteBoundingBox: { x: 100, y: 200, width: 600, height: 400 },
    children: [0, 1, 2].map(index => ({ id: `text${index}`, name: `段落${index}`, type: "TEXT", characters: `段落${index}`, style: { fontSize: 20 }, absoluteBoundingBox: { x: 140, y: 240 + index * 100, width: 520, height: 80 } })),
  };
}

test("exact vertical stacks gain native flex flow without mutating the Figma source", () => {
  const input = stack(); const before = JSON.stringify(input);
  const result = inferFigmaVerticalFlow(input)!;
  assert.equal(result.layoutMode, "VERTICAL");
  assert.equal(result.itemSpacing, 20);
  assert.deepEqual([result.paddingTop, result.paddingRight, result.paddingBottom, result.paddingLeft], [40, 40, 80, 40]);
  assert.equal(result.children?.[0]?.layoutSizingHorizontal, "FILL");
  assert.equal(JSON.stringify(input), before);
});

test("overlaps, uneven spacing, changed reading order, clipped and decorative layouts are not guessed", () => {
  for (const change of [
    (node: FigmaNode) => { node.children![1]!.absoluteBoundingBox!.y = 280; },
    (node: FigmaNode) => { node.children![1]!.absoluteBoundingBox!.y += 12; },
    (node: FigmaNode) => { node.children!.reverse(); },
    (node: FigmaNode) => { node.clipsContent = true; },
    (node: FigmaNode) => { node.children![0]!.type = "RECTANGLE"; },
    (node: FigmaNode) => { node.children![0]!.rotation = 3; },
    (node: FigmaNode) => { node.children![0]!.layoutPositioning = "ABSOLUTE"; },
  ]) { const input = stack(); change(input); assert.equal(inferFigmaVerticalFlow(input), null); }
});

test("native text boxes retain minimum-height containers and no absolute child positions", () => {
  const result = new FigmaElementorExporter().toTemplate({ document: {
    id: "doc", type: "DOCUMENT", name: "test", children: [{ id: "canvas", type: "CANVAS", name: "Web", children: [{
      id: "root", name: "PC-page", type: "FRAME", absoluteBoundingBox: { x: 0, y: 0, width: 1440, height: 1000 }, children: [stack()],
    }] }],
  } }, "test");
  const parent = result.content[0]!.elements[0]!;
  assert.equal(parent.settings.figmapress_inferred_flow, "vertical-equal-gap");
  assert.equal(parent.settings.flex_direction, "column");
  for (const box of parent.elements) {
    assert.equal(box.elType, "container");
    assert.equal(box.settings.figmapress_flow_item, "yes");
    assert.equal(box.settings.position, undefined);
    assert.equal(box.elements[0]!.settings._position, undefined);
    assert.equal((box.elements[0]!.settings._element_custom_width as {size:number}).size, 100);
  }
});
