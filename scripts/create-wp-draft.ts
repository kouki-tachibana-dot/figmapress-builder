import fs from "node:fs/promises";
import dotenv from "dotenv";
import { assertBlueprint } from "@figmapress/blueprint";
import {
  WpAuthError,
  WpRequestError,
  createDraftPage,
  loadWpConfigFromEnv,
} from "@figmapress/wp-connector";
import { BLUEPRINT_PATH, PAGE_HTML_PATH } from "./_paths.js";

dotenv.config();

async function main() {
  let cfg;
  try {
    cfg = loadWpConfigFromEnv();
  } catch (err) {
    console.error(`[figmapress] ${(err as Error).message}`);
    process.exit(1);
    return;
  }

  const blueprintRaw = await fs.readFile(BLUEPRINT_PATH, "utf-8").catch(() => {
    throw new Error(
      `Blueprint not found at ${BLUEPRINT_PATH}. Run \`npm run generate:blueprint\` first.`,
    );
  });
  const blueprint = assertBlueprint(JSON.parse(blueprintRaw));
  const page = blueprint.pages[0];
  if (!page) {
    console.error("[figmapress] blueprint has no pages");
    process.exit(1);
    return;
  }

  const content = await fs.readFile(PAGE_HTML_PATH, "utf-8").catch(() => {
    throw new Error(
      `Block HTML not found at ${PAGE_HTML_PATH}. Run \`npm run render:blocks\` first.`,
    );
  });

  try {
    const result = await createDraftPage(cfg, {
      title: page.title,
      slug: page.slug,
      content,
    });
    console.log(`[figmapress] created WordPress draft page: ID ${result.id}`);
    console.log(`  status:  ${result.status}`);
    console.log(`  slug:    ${result.slug}`);
    if (result.editLink) console.log(`  edit:    ${result.editLink}`);
    if (result.previewLink) console.log(`  preview: ${result.previewLink}`);
  } catch (err) {
    if (err instanceof WpAuthError) {
      console.error(`[figmapress] auth error: ${err.message}`);
    } else if (err instanceof WpRequestError) {
      console.error(`[figmapress] WordPress responded ${err.status}:`);
      console.error(err.body);
    } else {
      console.error("[figmapress] create-wp-draft failed:");
      console.error(err);
    }
    process.exit(1);
  }
}

main();
