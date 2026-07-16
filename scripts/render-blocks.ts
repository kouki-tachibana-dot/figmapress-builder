import fs from "node:fs/promises";
import path from "node:path";
import { assertBlueprint } from "@figmapress/blueprint";
import { GutenbergExporter } from "@figmapress/block-renderer";
import {
  BLUEPRINT_PATH,
  OUTPUT_DIR,
  PAGE_HTML_PATH,
} from "./_paths.js";

async function main() {
  const raw = await fs.readFile(BLUEPRINT_PATH, "utf-8").catch(() => {
    throw new Error(
      `Blueprint not found at ${BLUEPRINT_PATH}. Run \`npm run generate:blueprint\` first.`,
    );
  });
  const blueprint = assertBlueprint(JSON.parse(raw));

  const exporter = new GutenbergExporter();
  const result = await exporter.export(blueprint);

  for (const w of result.warnings) console.warn(`[figmapress] warning: ${w}`);

  await fs.mkdir(OUTPUT_DIR, { recursive: true });
  await fs.writeFile(PAGE_HTML_PATH, result.pageContent ?? "", "utf-8");
  console.log(`[figmapress] generated block html: ${path.relative(process.cwd(), PAGE_HTML_PATH)}`);
}

main().catch((err) => {
  console.error("[figmapress] render-blocks failed:");
  console.error(err);
  process.exit(1);
});
