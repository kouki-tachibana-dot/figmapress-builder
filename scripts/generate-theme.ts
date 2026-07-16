import fs from "node:fs/promises";
import path from "node:path";
import { assertBlueprint } from "@figmapress/blueprint";
import { tokensToThemeJson } from "@figmapress/token-pipeline";
import {
  BLUEPRINT_PATH,
  OUTPUT_DIR,
  THEME_DIR,
  THEME_JSON_PATH,
} from "./_paths.js";

async function main() {
  const raw = await fs.readFile(BLUEPRINT_PATH, "utf-8").catch(() => {
    throw new Error(
      `Blueprint not found at ${BLUEPRINT_PATH}. Run \`npm run generate:blueprint\` first.`,
    );
  });
  const blueprint = assertBlueprint(JSON.parse(raw));

  const themeJson = tokensToThemeJson(blueprint.tokens);
  const serialized = JSON.stringify(themeJson, null, 2) + "\n";

  await fs.mkdir(OUTPUT_DIR, { recursive: true });
  await fs.writeFile(THEME_JSON_PATH, serialized, "utf-8");
  console.log(`[figmapress] generated theme.json: ${path.relative(process.cwd(), THEME_JSON_PATH)}`);

  // Mirror into the block theme so the running WordPress site picks it up.
  const themeTarget = path.join(THEME_DIR, "theme.json");
  await fs.mkdir(THEME_DIR, { recursive: true });
  await fs.writeFile(themeTarget, serialized, "utf-8");
  console.log(`[figmapress] mirrored to theme: ${path.relative(process.cwd(), themeTarget)}`);
}

main().catch((err) => {
  console.error("[figmapress] generate-theme failed:");
  console.error(err);
  process.exit(1);
});
