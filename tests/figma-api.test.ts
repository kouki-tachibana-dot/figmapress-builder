import assert from "node:assert/strict";
import test from "node:test";
import { collectRenderedNodeIds, fetchFigmaFile } from "../apps/web/src/lib/figma-api.ts";

test("real Figma file shape is normalized into parser tokens", async (context) => {
  const requested: string[] = [];
  context.mock.method(globalThis, "fetch", async (input) => {
    const url = String(input);
    requested.push(url);
    if (url.includes("/v1/images/")) {
      return Response.json({
        images: { "2:2": "https://s3-alpha-sig.figma.com/reference.png" },
      });
    }
    if (url.includes("/images")) {
      return Response.json({ images: { heroFill: "https://s3-alpha.figma.com/example.png" } });
    }
    return Response.json({
      name: "Live Figma File",
      styles: {
        fillStyle: { name: "Brand / Primary", styleType: "FILL" },
        textStyle: { name: "Heading / XL", styleType: "TEXT" },
      },
      document: {
        id: "0:0",
        name: "Document",
        type: "DOCUMENT",
        children: [{
          id: "1:1",
          name: "Page",
          type: "CANVAS",
          children: [{
            id: "2:2",
            name: "section/hero",
            type: "FRAME",
            itemSpacing: 24,
            absoluteBoundingBox: { x: 0, y: 0, width: 1440, height: 900 },
            fills: [{ type: "SOLID", color: { r: 0.1, g: 0.2, b: 0.9 } }],
            styles: { fill: "fillStyle" },
            children: [{
              id: "3:3",
              name: "headline",
              type: "TEXT",
              characters: "Live headline",
              style: { fontFamily: "Inter", fontSize: 64, fontWeight: 700 },
              styles: { text: "textStyle" },
            }],
          }],
        }],
      },
    });
  });

  const result = await fetchFigmaFile(
    "https://www.figma.com/design/AbCdEf123456/Live?node-id=2-2",
    "figd_test_token_value",
  );

  assert.equal(result.fileName, "Live Figma File");
  assert.equal(result.file.styles?.colors?.[0]?.name, "Brand / Primary");
  assert.equal(result.file.styles?.colors?.[0]?.value, "#1A33E6");
  assert.equal(result.file.styles?.typography?.[0]?.fontFamily, "Inter");
  assert.equal(result.file.styles?.spacing?.[0]?.size, "24px");
  assert.equal(result.visualReferences.desktop?.nodeId, "2:2");
  assert.equal(result.visualReferences.desktop?.url, "https://s3-alpha-sig.figma.com/reference.png");
  assert.match(requested[0] ?? "", /ids=2%3A2/);
});

test("selected responsive page frame also fetches its device companion", async (context) => {
  const requested: string[] = [];
  const frame = (id: string, name: string, width: number, height: number) => ({
    id,
    name,
    type: "FRAME",
    absoluteBoundingBox: { x: 0, y: 0, width, height },
    children: [{
      id: `${id}:text`,
      name: "Heading",
      type: "TEXT",
      characters: name,
      absoluteBoundingBox: { x: 0, y: 0, width: Math.min(width, 300), height: 40 },
      style: { fontSize: 24 },
    }],
  });
  context.mock.method(globalThis, "fetch", async (input) => {
    const url = String(input);
    requested.push(url);
    if (url.includes("/v1/images/")) {
      return Response.json({
        images: {
          "46:12": "https://s3-alpha-sig.figma.com/desktop.png",
          "46:210": "https://s3-alpha-sig.figma.com/mobile.png",
        },
      });
    }
    if (url.includes("/images")) return Response.json({ images: {} });
    const selectedOnly = url.includes("ids=46%3A12");
    return Response.json({
      name: "Responsive Figma File",
      document: {
        id: "0:0",
        name: "Document",
        type: "DOCUMENT",
        children: [{
          id: "1:1",
          name: "Page",
          type: "CANVAS",
          children: selectedOnly
            ? [frame("46:12", "PC-page", 1920, 1600)]
            : [
                frame("46:12", "PC-page", 1920, 1600),
                frame("46:210", "SP-page", 440, 1200),
                frame("60:0", "SP_Comp/Carousel", 1172, 440),
              ],
        }],
      },
    });
  });

  const result = await fetchFigmaFile(
    "https://www.figma.com/design/AbCdEf123456/Live?node-id=46-12",
    "figd_test_token_value",
  );
  const roots = result.file.document.children?.[0]?.children ?? [];
  assert.deepEqual(roots.map((node) => node.name), ["PC-page", "SP-page", "SP_Comp/Carousel"]);
  assert.match(requested[0] ?? "", /ids=46%3A12/);
  assert.ok(requested.some((url) =>
    /\/files\/AbCdEf123456\?depth=12$/.test(url),
  ));
  assert.ok(result.warnings.some((warning) => warning.includes("PC版とスマホ版")));
  assert.equal(result.visualReferences.desktop?.nodeId, "46:12");
  assert.equal(result.visualReferences.mobile?.nodeId, "46:210");
});

test("complex visual groups are rendered once while editable text stays native", () => {
  const ids = collectRenderedNodeIds({
    id: "0:0",
    name: "Document",
    type: "DOCUMENT",
    children: [{
      id: "1:0",
      name: "Artwork",
      type: "GROUP",
      absoluteBoundingBox: { x: 0, y: 0, width: 300, height: 200 },
      children: [{
        id: "2:0",
        name: "Vector",
        type: "VECTOR",
        absoluteBoundingBox: { x: 0, y: 0, width: 300, height: 200 },
      }],
    }, {
      id: "1:1",
      name: "Text group",
      type: "GROUP",
      absoluteBoundingBox: { x: 0, y: 220, width: 300, height: 100 },
      children: [{
        id: "2:1",
        name: "Editable",
        type: "TEXT",
        characters: "編集できる文字",
        absoluteBoundingBox: { x: 0, y: 220, width: 300, height: 50 },
      }],
    }],
  });

  assert.deepEqual(ids, ["1:0"]);
});

test("rendered responsive assets are budgeted across desktop and mobile roots", () => {
  const visualChildren = (prefix: string, count: number) =>
    Array.from({ length: count }, (_, index) => ({
      id: `${prefix}:${index}`,
      name: `${prefix} ${index}`,
      type: "VECTOR",
      absoluteBoundingBox: { x: index * 2, y: 0, width: 1, height: 1 },
    }));
  const ids = collectRenderedNodeIds({
    id: "0:0",
    name: "Document",
    type: "DOCUMENT",
    children: [{
      id: "1:0",
      name: "Page",
      type: "CANVAS",
      children: [{
        id: "2:0",
        name: "PC-page",
        type: "FRAME",
        absoluteBoundingBox: { x: 0, y: 0, width: 1920, height: 1000 },
        children: [{
          id: "desktop:text",
          name: "Heading",
          type: "TEXT",
          characters: "Desktop",
          absoluteBoundingBox: { x: 0, y: 0, width: 100, height: 20 },
        }, ...visualChildren("desktop", 80)],
      }, {
        id: "3:0",
        name: "SP-page",
        type: "FRAME",
        absoluteBoundingBox: { x: 2000, y: 0, width: 440, height: 1000 },
        children: [{
          id: "mobile:text",
          name: "Heading",
          type: "TEXT",
          characters: "Mobile",
          absoluteBoundingBox: { x: 2000, y: 0, width: 100, height: 20 },
        }, ...visualChildren("mobile", 80)],
      }],
    }],
  });

  assert.equal(ids.length, 120);
  assert.equal(ids.filter((id) => id.startsWith("desktop:")).length, 60);
  assert.equal(ids.filter((id) => id.startsWith("mobile:")).length, 60);
});
