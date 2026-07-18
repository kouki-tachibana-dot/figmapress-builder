import assert from "node:assert/strict";
import test from "node:test";
import { fetchFigmaFile } from "../apps/web/src/lib/figma-api.ts";

test("real Figma file shape is normalized into parser tokens", async (context) => {
  const requested: string[] = [];
  context.mock.method(globalThis, "fetch", async (input) => {
    const url = String(input);
    requested.push(url);
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
  assert.match(requested[0] ?? "", /ids=2%3A2/);
});
