import assert from "node:assert/strict";
import test from "node:test";
import {
  collectUncoveredVisibleImageRefs,
  collectVisibleImageRefs,
  collectRenderedNodeIds,
  fetchFigmaFile,
  FigmaFrameSelectionRequired,
} from "../apps/web/src/lib/figma-api.ts";

test("visible Figma image refs exclude hidden artwork and remove duplicates", () => {
  assert.deepEqual(collectVisibleImageRefs({
    id: "0:0",
    name: "Document",
    type: "DOCUMENT",
    children: [{
      id: "1:1",
      name: "Visible",
      type: "RECTANGLE",
      fills: [
        { type: "IMAGE", imageRef: "hero", visible: true },
        { type: "IMAGE", imageRef: "hero" },
      ],
    }, {
      id: "1:2",
      name: "Hidden",
      type: "FRAME",
      visible: false,
      fills: [{ type: "IMAGE", imageRef: "hidden" }],
      children: [{
        id: "1:3",
        name: "Hidden child",
        type: "RECTANGLE",
        fills: [{ type: "IMAGE", imageRef: "also-hidden" }],
      }],
    }],
  }), ["hero"]);
});

test("rendered ancestors cover every visible image fill in their subtree", () => {
  const document = {
    id: "0:0",
    name: "Document",
    type: "DOCUMENT" as const,
    children: [{
      id: "1:1",
      name: "Rendered group",
      type: "GROUP" as const,
      children: [{
        id: "2:1",
        name: "Photo",
        type: "RECTANGLE" as const,
        absoluteBoundingBox: { x: 0, y: 0, width: 300, height: 200 },
        fills: [{ type: "IMAGE" as const, imageRef: "photo" }],
      }],
    }],
  };
  assert.deepEqual(collectUncoveredVisibleImageRefs(document, {}, { "1:1": "rendered" }), []);
  assert.deepEqual(collectUncoveredVisibleImageRefs(document, {}, {}), ["photo"]);
  assert.deepEqual(
    collectUncoveredVisibleImageRefs(document, { photo: "original" }, {}),
    [],
  );
});

test("non-painting image refs do not block an otherwise complete page", () => {
  const document = {
    id: "0:0",
    name: "Document",
    type: "DOCUMENT" as const,
    children: [{
      id: "1:1",
      name: "Definition without bounds",
      type: "RECTANGLE" as const,
      fills: [{ type: "IMAGE" as const, imageRef: "definition" }],
      children: [{
        id: "2:1",
        name: "Visible child",
        type: "RECTANGLE" as const,
        absoluteBoundingBox: { x: 0, y: 0, width: 300, height: 200 },
        fills: [{ type: "IMAGE" as const, imageRef: "visible" }],
      }],
    }, {
      id: "1:2",
      name: "Transparent artwork",
      type: "RECTANGLE" as const,
      opacity: 0,
      absoluteBoundingBox: { x: 0, y: 0, width: 300, height: 200 },
      fills: [{ type: "IMAGE" as const, imageRef: "transparent" }],
    }],
  };

  assert.deepEqual(collectUncoveredVisibleImageRefs(document, {}, {}), ["visible"]);
});

test("Figma image URLs retry and never accept a page with missing visible images", async (context) => {
  let imageUrlRequests = 0;
  context.mock.method(globalThis, "fetch", async (input) => {
    const url = String(input);
    if (url.includes("/v1/images/")) {
      const ids = new URL(url).searchParams.get("ids")?.split(",") ?? [];
      return Response.json({
        images: Object.fromEntries(ids.map((id) => [id, `https://images.example/${id}.png`])),
      });
    }
    if (url.endsWith("/images")) {
      imageUrlRequests += 1;
      if (imageUrlRequests < 3) return new Response(null, { status: 503 });
      return Response.json({ images: { hero: "https://s3-alpha.figma.com/hero.png" } });
    }
    return Response.json({
      name: "Image retry",
      document: {
        id: "0:0",
        name: "Document",
        type: "DOCUMENT",
        children: Array.from({ length: 121 }, (_, index) => ({
          id: `1:${index}`,
          name: `Hero ${index}`,
          type: "RECTANGLE",
          fills: [{ type: "IMAGE", imageRef: "hero" }],
          absoluteBoundingBox: { x: 0, y: index * 10, width: 100, height: 10 },
        })),
      },
    });
  });

  const result = await fetchFigmaFile(
    "https://www.figma.com/design/AbCdEf123456/Images",
    "figd_test_token_value",
    "pat",
    undefined,
    { includeVisualReferences: false },
  );

  assert.equal(imageUrlRequests, 3);
  assert.equal(result.imageUrls.hero, "https://s3-alpha.figma.com/hero.png");
});

test("Figma conversion fails instead of silently dropping visible images", async (context) => {
  context.mock.method(globalThis, "fetch", async (input) => {
    const url = String(input);
    if (url.includes("/v1/images/")) {
      const ids = new URL(url).searchParams.get("ids")?.split(",") ?? [];
      return Response.json({
        images: Object.fromEntries(ids.map((id) => [id, `https://images.example/${id}.png`])),
      });
    }
    if (url.endsWith("/images")) return Response.json({ images: {} });
    return Response.json({
      name: "Missing image",
      document: {
        id: "0:0",
        name: "Document",
        type: "DOCUMENT",
        children: Array.from({ length: 121 }, (_, index) => ({
          id: `1:${index}`,
          name: `Hero ${index}`,
          type: "RECTANGLE",
          fills: [{ type: "IMAGE", imageRef: "hero" }],
          absoluteBoundingBox: { x: 0, y: index * 10, width: 100, height: 10 },
        })),
      },
    });
  });

  await assert.rejects(
    fetchFigmaFile(
      "https://www.figma.com/design/AbCdEf123456/Missing",
      "figd_test_token_value",
      "pat",
      undefined,
      { includeVisualReferences: false },
    ),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /1件不足/);
      assert.equal((error as { status?: number }).status, 502);
      return true;
    },
  );
});

test("selected-page renders replace a slow whole-file image-fill request", async (context) => {
  let wholeFileImageRequests = 0;
  context.mock.method(globalThis, "fetch", async (input) => {
    const url = String(input);
    if (url.includes("/v1/images/")) {
      return Response.json({ images: { "1:1": "https://s3-alpha-sig.figma.com/hero.png" } });
    }
    if (url.endsWith("/images")) {
      wholeFileImageRequests += 1;
      return new Response(null, { status: 503 });
    }
    return Response.json({
      name: "Rendered image fallback",
      document: {
        id: "0:0",
        name: "Document",
        type: "DOCUMENT",
        children: [{
          id: "1:1",
          name: "Hero",
          type: "RECTANGLE",
          fills: [{ type: "IMAGE", imageRef: "hero" }],
          absoluteBoundingBox: { x: 0, y: 0, width: 1440, height: 900 },
        }],
      },
    });
  });

  const result = await fetchFigmaFile(
    "https://www.figma.com/design/AbCdEf123456/Rendered",
    "figd_test_token_value",
    "pat",
    undefined,
    { includeVisualReferences: false },
  );

  assert.equal(wholeFileImageRequests, 0);
  assert.equal(result.renderedNodeUrls["1:1"], "https://s3-alpha-sig.figma.com/hero.png");
  assert.deepEqual(
    collectUncoveredVisibleImageRefs(result.file.document, result.imageUrls, result.renderedNodeUrls),
    [],
  );
});

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
  assert.equal(result.visualReferences.desktop?.format, "png");
  assert.match(requested[0] ?? "", /ids=2%3A2/);
  assert.ok(requested.some((url) =>
    url.includes("/v1/images/")
    && url.includes("format=png")
    && url.includes("scale=0.556"),
  ));
});

test("Figma OAuth uses Bearer auth without exposing the token as a PAT header", async (context) => {
  const requestedHeaders: Headers[] = [];
  context.mock.method(globalThis, "fetch", async (_input, init) => {
    requestedHeaders.push(new Headers(init?.headers));
    return Response.json({
      name: "OAuth Figma File",
      document: {
        id: "0:0",
        name: "Document",
        type: "DOCUMENT",
        children: [],
      },
      images: {},
    });
  });

  await fetchFigmaFile(
    "https://www.figma.com/design/AbCdEf123456/OAuth",
    "oauth_access_token_value",
    "oauth",
  );

  assert.ok(requestedHeaders.length >= 1);
  for (const headers of requestedHeaders) {
    assert.equal(
      headers.get("Authorization"),
      "Bearer oauth_access_token_value",
    );
    assert.equal(headers.get("X-Figma-Token"), null);
  }
});

test("long visual references skip lossless renders that exceed Figma's edge limit", async (context) => {
  const requested: string[] = [];
  context.mock.method(globalThis, "fetch", async (input) => {
    const url = String(input);
    requested.push(url);
    if (url.includes("/v1/images/")) {
      return Response.json({
        images: { "2:2": "https://s3-alpha-sig.figma.com/long-reference.png" },
      });
    }
    if (url.includes("/images")) return Response.json({ images: {} });
    return Response.json({
      name: "Long page",
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
            name: "PC-page",
            type: "FRAME",
            absoluteBoundingBox: { x: 0, y: 0, width: 1440, height: 8058 },
            children: [],
          }],
        }],
      },
    });
  });

  const result = await fetchFigmaFile(
    "https://www.figma.com/design/AbCdEf123456/Long?node-id=2-2",
    "figd_test_token_value",
  );

  assert.equal(result.visualReferences.desktop?.height, 5372);
  assert.equal(result.visualReferences.desktop?.sourceWidth, 1440);
  assert.equal(result.visualReferences.desktop?.sourceHeight, 8058);
  assert.equal(result.visualReferences.desktop?.format, "jpg");
  assert.ok(!requested.some((url) =>
    url.includes("/v1/images/") && url.includes("format=png"),
  ));
  assert.ok(requested.some((url) =>
    url.includes("/v1/images/")
    && url.includes("format=jpg")
    && url.includes("scale=0.667"),
  ));
});

test("visual references fall back to JPEG when Figma rejects PNG", async (context) => {
  const requested: string[] = [];
  context.mock.method(globalThis, "fetch", async (input) => {
    const url = String(input);
    requested.push(url);
    if (url.includes("/v1/images/")) {
      if (url.includes("format=png")) return new Response(null, { status: 400 });
      return Response.json({
        images: { "2:2": "https://s3-alpha-sig.figma.com/reference.jpg" },
      });
    }
    if (url.includes("/images")) return Response.json({ images: {} });
    return Response.json({
      name: "Fallback page",
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
            name: "PC-page",
            type: "FRAME",
            absoluteBoundingBox: { x: 0, y: 0, width: 1440, height: 900 },
            children: [],
          }],
        }],
      },
    });
  });

  const result = await fetchFigmaFile(
    "https://www.figma.com/design/AbCdEf123456/Fallback?node-id=2-2",
    "figd_test_token_value",
  );

  assert.equal(result.visualReferences.desktop?.url, "https://s3-alpha-sig.figma.com/reference.jpg");
  assert.equal(result.visualReferences.desktop?.format, "jpg");
  assert.ok(requested.some((url) => url.includes("format=png")));
  assert.ok(requested.some((url) => url.includes("format=jpg")));
});

test("Figma authentication errors distinguish OAuth draft state from PAT permissions", async (context) => {
  context.mock.method(globalThis, "fetch", async (_input, init) => {
    const headers = new Headers(init?.headers);
    if (headers.has("Authorization")) {
      const token = headers.get("Authorization") ?? "";
      const status = token.includes("forbidden") ? 403 : 401;
      return Response.json(
        { status, err: status === 403 ? "Forbidden" : "Unauthorized" },
        { status },
      );
    }
    return Response.json({ status: 403, err: "Forbidden" }, { status: 403 });
  });

  await assert.rejects(
    fetchFigmaFile(
      "https://www.figma.com/design/AbCdEf123456/OAuth",
      "oauth_access_token_value",
      "oauth",
    ),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /未公開（ドラフト）/);
      assert.equal((error as { status?: number }).status, 401);
      return true;
    },
  );

  await assert.rejects(
    fetchFigmaFile(
      "https://www.figma.com/design/AbCdEf123456/OAuthForbidden",
      "oauth_forbidden_access_token",
      "oauth",
    ),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /審査未承認/);
      assert.equal((error as { status?: number }).status, 403);
      return true;
    },
  );

  await assert.rejects(
    fetchFigmaFile(
      "https://www.figma.com/design/AbCdEf123456/Pat",
      "figd_personal_access_token",
      "pat",
    ),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /Personal Access Token/);
      assert.equal((error as { status?: number }).status, 403);
      return true;
    },
  );
});

test("Figma render and visual reference requests start concurrently", async (context) => {
  const waitingResponses: Array<(response: Response) => void> = [];
  const secondaryRequests: string[] = [];
  context.mock.method(globalThis, "fetch", async (input) => {
    const url = String(input);
    if (/\/files\/AbCdEf123456\?depth=12$/.test(url)) {
      return Response.json({
        name: "Concurrent Figma File",
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
              name: "Desktop",
              type: "FRAME",
              absoluteBoundingBox: { x: 0, y: 0, width: 1440, height: 900 },
              children: [{
                id: "3:3",
                name: "Artwork",
                type: "VECTOR",
                absoluteBoundingBox: { x: 0, y: 0, width: 400, height: 300 },
              }],
            }],
          }],
        },
      });
    }
    secondaryRequests.push(url);
    if (url.includes("format=jpg")) {
      return Response.json({ images: {} });
    }
    return await new Promise<Response>((resolve) => {
      waitingResponses.push(resolve);
    });
  });

  const resultPromise = fetchFigmaFile(
    "https://www.figma.com/design/AbCdEf123456/Concurrent",
    "figd_test_token_value",
  );
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(secondaryRequests.length, 2);
  for (const resolve of waitingResponses) {
    resolve(Response.json({
      images: {
        "2:2": "https://s3-alpha-sig.figma.com/page.png",
        "3:3": "https://s3-alpha-sig.figma.com/artwork.png",
      },
    }));
  }
  await resultPromise;
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

test("whole Figma canvases require a page choice and then fetch only that PC/SP pair", async (context) => {
  const frame = (
    id: string,
    name: string,
    x: number,
    width: number,
    height: number,
    heading: string,
  ) => ({
    id,
    name,
    type: "FRAME",
    absoluteBoundingBox: { x, y: 0, width, height },
    children: [{
      id: `${id}:heading`,
      name: "Heading",
      type: "TEXT",
      characters: heading,
      absoluteBoundingBox: { x: x + 80, y: 180, width: Math.min(width - 120, 700), height: 70 },
      style: { fontSize: width <= 768 ? 30 : 52 },
    }],
  });
  context.mock.method(globalThis, "fetch", async (input) => {
    const url = String(input);
    if (url.includes("/v1/images/")) {
      return Response.json({
        images: {
          "20:1": "https://s3-alpha-sig.figma.com/company-desktop.png",
          "20:2": "https://s3-alpha-sig.figma.com/company-mobile.png",
        },
      });
    }
    if (url.endsWith("/images")) return Response.json({ images: {} });
    return Response.json({
      name: "株式会社建工101",
      document: {
        id: "0:0",
        name: "Document",
        type: "DOCUMENT",
        children: [{
          id: "0:1",
          name: "Web",
          type: "CANVAS",
          children: [
            frame("10:1", "PC-page", 0, 1440, 5200, "トップページ"),
            frame("10:2", "SP-page", 1540, 390, 4600, "トップページ"),
            frame("20:1", "PC-page", 2200, 1440, 4200, "会社案内"),
            frame("20:2", "SP-page", 3740, 390, 3800, "会社案内"),
          ],
        }],
      },
    });
  });

  await assert.rejects(
    fetchFigmaFile(
      "https://www.figma.com/design/AbCdEf123456/Kenko?node-id=0-1",
      "figd_test_token_value",
    ),
    (error) => {
      assert.ok(error instanceof FigmaFrameSelectionRequired);
      assert.deepEqual(error.candidates.map((candidate) => candidate.title), ["トップページ", "会社案内"]);
      return true;
    },
  );

  const selected = await fetchFigmaFile(
    "https://www.figma.com/design/AbCdEf123456/Kenko?node-id=0-1",
    "figd_test_token_value",
    "pat",
    "20:1",
  );
  assert.equal(selected.pageTitle, "会社案内");
  assert.deepEqual(
    selected.file.document.children?.[0]?.children?.map((node) => node.id),
    ["20:1", "20:2"],
  );
  assert.equal(selected.visualReferences.desktop?.nodeId, "20:1");
  assert.equal(selected.visualReferences.mobile?.nodeId, "20:2");
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

test("functional carousel visuals outrank decorative assets in the render budget", () => {
  const decorations = Array.from({ length: 125 }, (_, index) => ({
    id: `decorative:${index}`,
    name: `Decoration ${index}`,
    type: "VECTOR",
    absoluteBoundingBox: { x: index * 2, y: 100, width: 1, height: 1 },
  }));
  const slides = Array.from({ length: 3 }, (_, index) => ({
    id: `slide:${index}`,
    name: `Comp/Carousel-Item ${index + 1}`,
    type: "FRAME",
    absoluteBoundingBox: { x: index * 300, y: 400, width: 280, height: 180 },
    children: [{
      id: `slide-vector:${index}`,
      name: `Slide artwork ${index + 1}`,
      type: "VECTOR",
      absoluteBoundingBox: { x: index * 300, y: 400, width: 280, height: 180 },
    }],
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
          id: "page:text",
          name: "Heading",
          type: "TEXT",
          characters: "活動報告",
          absoluteBoundingBox: { x: 0, y: 0, width: 200, height: 40 },
        }, ...decorations, {
          id: "carousel:0",
          name: "Comp/Carousel",
          type: "FRAME",
          absoluteBoundingBox: { x: 100, y: 350, width: 1000, height: 300 },
          children: slides,
        }],
      }],
    }],
  });

  assert.equal(ids.length, 120);
  assert.ok(!ids.includes("carousel:0"));
  assert.ok(slides.every((slide) => ids.includes(slide.id)));
  assert.ok(!ids.includes("decorative:124"));
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
        }, ...visualChildren("desktop", 80), {
          id: "desktop:mask",
          name: "Mask group",
          type: "GROUP",
          absoluteBoundingBox: { x: 100, y: 100, width: 640, height: 480 },
          children: [{
            id: "desktop:image",
            name: "Adjusted hero",
            type: "RECTANGLE",
            absoluteBoundingBox: { x: 100, y: 100, width: 640, height: 480 },
            fills: [{
              type: "IMAGE",
              imageRef: "desktop-hero",
              scaleMode: "STRETCH",
              imageTransform: [[1.5, 0, -0.2], [0, 1.5, -0.1]],
            }],
          }],
        }],
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
        }, ...visualChildren("mobile", 80), {
          id: "mobile:mask",
          name: "Mask group",
          type: "GROUP",
          absoluteBoundingBox: { x: 2050, y: 100, width: 340, height: 240 },
          children: [{
            id: "mobile:image",
            name: "Adjusted hero",
            type: "RECTANGLE",
            absoluteBoundingBox: { x: 2050, y: 100, width: 340, height: 240 },
            fills: [{
              type: "IMAGE",
              imageRef: "mobile-hero",
              scaleMode: "STRETCH",
              imageTransform: [[1.5, 0, -0.2], [0, 1.5, -0.1]],
            }],
          }],
        }],
      }],
    }],
  });

  assert.equal(ids.length, 120);
  assert.equal(ids.filter((id) => id.startsWith("desktop:")).length, 60);
  assert.equal(ids.filter((id) => id.startsWith("mobile:")).length, 60);
  assert.ok(ids.includes("desktop:mask"));
  assert.ok(ids.includes("mobile:mask"));
});

test("unused mobile render capacity is reassigned to a denser desktop page", () => {
  const visualChildren = (prefix: string, count: number) =>
    Array.from({ length: count }, (_, index) => ({
      id: `${prefix}:${index}`,
      name: `${prefix} ${index}`,
      type: "VECTOR",
      absoluteBoundingBox: { x: index * 2, y: 40, width: 1, height: 1 },
    }));
  const responsiveRoot = (
    id: string,
    name: string,
    width: number,
    visuals: ReturnType<typeof visualChildren>,
  ) => ({
    id,
    name,
    type: "FRAME",
    absoluteBoundingBox: { x: 0, y: 0, width, height: 1000 },
    children: [{
      id: `${id}:text`,
      name: "Heading",
      type: "TEXT",
      characters: name,
      absoluteBoundingBox: { x: 0, y: 0, width: 100, height: 20 },
    }, ...visuals],
  });
  const ids = collectRenderedNodeIds({
    id: "0:0",
    name: "Document",
    type: "DOCUMENT",
    children: [{
      id: "1:0",
      name: "Page",
      type: "CANVAS",
      children: [
        responsiveRoot("2:0", "PC-page", 1440, visualChildren("desktop", 100)),
        responsiveRoot("3:0", "SP-page", 440, visualChildren("mobile", 20)),
      ],
    }],
  });

  assert.equal(ids.length, 120);
  assert.equal(ids.filter((id) => id.startsWith("desktop:")).length, 100);
  assert.equal(ids.filter((id) => id.startsWith("mobile:")).length, 20);
});
