import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
export const ROOT_DIR = path.resolve(path.dirname(__filename), "..");
export const EXAMPLES_DIR = path.join(ROOT_DIR, "examples");
export const OUTPUT_DIR = path.join(EXAMPLES_DIR, "output");
export const MOCK_FIGMA_PATH = path.join(EXAMPLES_DIR, "mock-figma.json");
export const BLUEPRINT_PATH = path.join(OUTPUT_DIR, "site.blueprint.json");
export const PAGE_HTML_PATH = path.join(OUTPUT_DIR, "page-content.html");
export const THEME_JSON_PATH = path.join(OUTPUT_DIR, "theme.json");
export const THEME_DIR = path.join(
  ROOT_DIR,
  "wordpress-theme",
  "figmapress-block-theme",
);
