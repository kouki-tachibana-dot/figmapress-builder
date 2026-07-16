import fs from "node:fs/promises";
import path from "node:path";
import { mapFigmaToBlueprint } from "@figmapress/figma-parser";
import { validateBlueprint } from "@figmapress/blueprint";
import {
  BLUEPRINT_PATH,
  MOCK_FIGMA_PATH,
  OUTPUT_DIR,
} from "./_paths.js";

async function main() {
  console.log("[figmapress] loaded mock figma json");
  const raw = await fs.readFile(MOCK_FIGMA_PATH, "utf-8");
  const mockFigma = JSON.parse(raw);

  const { blueprint, warnings } = mapFigmaToBlueprint(mockFigma);
  const detected = blueprint.pages[0]?.sections.map((s) =>
    s.type.replace("section/", ""),
  ) ?? [];
  console.log(`[figmapress] detected sections: ${detected.join(", ")}`);

  for (const w of warnings) console.warn(`[figmapress] warning: ${w}`);

  const check = validateBlueprint(blueprint);
  if (!check.ok) {
    console.error("[figmapress] blueprint validation failed:");
    for (const err of check.errors) console.error("  - " + err);
    process.exit(1);
  }

  await fs.mkdir(OUTPUT_DIR, { recursive: true });
  await fs.writeFile(BLUEPRINT_PATH, JSON.stringify(blueprint, null, 2) + "\n", "utf-8");
  console.log(`[figmapress] generated blueprint: ${path.relative(process.cwd(), BLUEPRINT_PATH)}`);
}

main().catch((err) => {
  console.error("[figmapress] generate-blueprint failed:");
  console.error(err);
  process.exit(1);
});
