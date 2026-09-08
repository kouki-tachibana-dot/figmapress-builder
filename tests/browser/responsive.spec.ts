import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { inspectResponsiveIntegrity, type ResponsiveVariant } from "../../apps/web/src/lib/responsive-integrity";
import { FigmaElementorExporter } from "../../packages/elementor-renderer/src/figma-exporter";

const css = readFileSync("wordpress-plugin/figmapress-connector/assets/elementor-responsive-0198.css", "utf8");
const variants = ["desktop", "tablet", "mobile"] as const;
const sizes = { desktop: 1440, tablet: 834, mobile: 440 };
const names = { desktop: "PC-page", tablet: "Tablet-page", mobile: "SP-page" };

function roots(selected: ResponsiveVariant[]): string {
  const template = new FigmaElementorExporter().toTemplate({ document: {
    id: "0:0", name: "Audit", type: "DOCUMENT", children: [{
      id: "0:1", name: "Web", type: "CANVAS",
      children: selected.map((variant, index) => ({
        id: `10:${index}`, name: names[variant], type: "FRAME",
        absoluteBoundingBox: { x: index * 1600, y: 0, width: sizes[variant], height: 1000 },
        children: [{ id: `10:${index}:text`, name: "会社案内", characters: "会社案内", type: "TEXT",
          absoluteBoundingBox: { x: index * 1600 + 40, y: 120, width: 300, height: 50 }, style: { fontSize: 32 } }],
      })),
    }],
  } }, "Audit");
  return template.content.map((root) => `<section class="${root.settings.css_classes}" style="min-height:600px"><h1>${root.settings.css_classes}</h1><div class="nested" style="display:grid"><p>編集可能な本文</p></div></section>`).join("");
}

async function inspect(page: Page, variant: ResponsiveVariant) {
  return page.evaluate(({ source, variant }) => {
    const before = document.body.innerHTML;
    const inspect = new Function("document", "variant", `return (${source})(document, variant)`);
    return { ...inspect(document, variant), mutated: before !== document.body.innerHTML };
  }, { source: inspectResponsiveIntegrity.toString(), variant });
}

async function mount(page: Page, body: string, style = css) {
  await page.setContent(`<html><head><style>body{margin:0}.elementor{width:100%}*{box-sizing:border-box}${style}</style></head><body><main class="elementor">${body}</main></body></html>`);
}

for (const selected of [["desktop"], ["desktop", "mobile"], ["desktop", "tablet"], [...variants]] as ResponsiveVariant[][]) {
  test(`generated ${selected.join("+")} remains visible at every boundary`, async ({ page }) => {
    for (const width of [320, 390, 440, 767, 768, 834, 1024, 1025, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await mount(page, roots(selected));
      const variant = width <= 767 ? "mobile" : width <= 1024 ? "tablet" : "desktop";
      const result = await inspect(page, variant);
      expect(result.valid, `${selected} at ${width}: ${result.reason}`).toBe(true);
      expect(result.mutated).toBe(false);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
      expect(await page.locator(".nested:visible").evaluate(el => getComputedStyle(el).display)).toBe("grid");
    }
  });
}

for (const [name, style, expected] of [
  ["missing CSS shows all variants", "", 3],
  ["wrong desktop at mobile width", ".figmapress-layout--tablet,.figmapress-layout--mobile{display:none}", 1],
  ["all roots hidden", ".figmapress-layout{display:none}", 0],
  ["invisible root", ".figmapress-layout--desktop,.figmapress-layout--tablet{display:none}.figmapress-layout--mobile{opacity:0}", 0],
] as const) {
  test(`QA rejects ${name} without repairing it`, async ({ page }) => {
    await page.setViewportSize({ width: 440, height: 900 });
    await mount(page, roots([...variants]), style);
    const result = await inspect(page, "mobile");
    expect(result.valid).toBe(false);
    expect(result.visibleVariants).toHaveLength(expected);
    expect(result.mutated).toBe(false);
  });
}

test("custom Elementor breakpoint values are used by the actual PHP stylesheet", async ({ page }) => {
  const dir = resolve("wordpress-plugin/figmapress-connector").replaceAll("\\", "/");
  const php = `namespace Elementor { class Plugin { public static $instance; } }
    namespace { define('ABSPATH', '/'); define('FIGMAPRESS_CONNECTOR_DIR', ${JSON.stringify(`${dir}/`)});
    \\Elementor\\Plugin::$instance = (object) ['breakpoints' => new class {
      function get_active_breakpoints() { return ['mobile' => new class { function get_value() { return 600; } }, 'tablet' => new class { function get_value() { return 900; } }]; }
    }]; require FIGMAPRESS_CONNECTOR_DIR . 'includes/responsive.php'; echo figmapress_connector_responsive_css(); }`;
  const customCss = execFileSync("php", ["-r", php], { encoding: "utf8" });
  for (const [width, variant] of [[600, "mobile"], [601, "tablet"], [767, "tablet"], [900, "tablet"], [901, "desktop"], [1024, "desktop"]] as const) {
    await page.setViewportSize({ width, height: 900 });
    await mount(page, roots([...variants]), customCss);
    expect((await inspect(page, variant)).valid).toBe(true);
  }
});
