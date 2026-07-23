import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import mockFigma from "../examples/mock-figma.json";
import { convertFile } from "../apps/web/src/lib/converter";
import {
  createElementorDraftPage,
  probeWordPressConnection,
  type WpConfig,
} from "@figmapress/wp-connector";
import type { MockFigmaFile } from "@figmapress/figma-parser";

const wpPath = process.env.WP_E2E_PATH;
const wpCli = process.env.WP_E2E_CLI || "wp";
const baseUrl = process.env.WP_E2E_URL || "http://localhost:8080";
const username = process.env.WP_E2E_USER || "admin";

if (!wpPath) throw new Error("Set WP_E2E_PATH to a disposable WordPress installation.");

function wp(args: string[]): string {
  const output = execFileSync(wpCli, [...args, `--path=${wpPath}`, "--quiet"], {
    encoding: "utf8",
    env: { ...process.env, WP_CLI_PHP_ARGS: "-d error_reporting=E_ERROR" },
    stdio: ["ignore", "pipe", "ignore"],
  });
  return output
    .split(/\r?\n/)
    .filter((line) => !/^(PHP )?Deprecated:/.test(line.trim()))
    .join("\n")
    .trim();
}

function findPassword(output: string): string {
  const line = output
    .split(/\r?\n/)
    .map((value) => value.trim())
    .reverse()
    .find((value) => /^[A-Za-z0-9 ]{20,40}$/.test(value));
  if (!line) throw new Error("WP-CLI did not return an Application Password.");
  return line;
}

let pageId: number | undefined;
let credentialUuid: string | undefined;
let mediaIds: number[] = [];

function credentials(): Array<{ uuid: string; name: string }> {
  return JSON.parse(
    wp(["user", "application-password", "list", username, "--format=json"]),
  ) as Array<{ uuid: string; name: string }>;
}

function removeStaleCredentials(): void {
  for (const item of credentials()) {
    if (item.name === "FigmaPress E2E") {
      wp(["user", "application-password", "delete", username, item.uuid]);
    }
  }
}

type ElementorNode = {
  elements?: ElementorNode[];
  settings?: { image?: { id?: number; url?: string } };
};

function findElementorImage(nodes: ElementorNode[]): { id?: number; url?: string } | undefined {
  for (const node of nodes) {
    if (node.settings?.image?.url) return node.settings.image;
    const nested = findElementorImage(node.elements ?? []);
    if (nested) return nested;
  }
  return undefined;
}

async function main(): Promise<void> {
try {
  removeStaleCredentials();
  const password = findPassword(
    wp(["user", "application-password", "create", username, "FigmaPress E2E", "--porcelain"]),
  );
  credentialUuid = credentials().find((item) => item.name === "FigmaPress E2E")?.uuid;

  const config: WpConfig = { baseUrl, username, applicationPassword: password };
  const status = await probeWordPressConnection(config);
  assert.equal(status.connectorInstalled, true);
  assert.equal(status.elementor.active, true);
  assert.equal(status.canEditPages, true);

  const conversion = await convertFile(
    mockFigma as MockFigmaFile,
    {},
    { "hero-001": "https://s.w.org/style/images/about/WordPress-logotype-wmark.png" },
  );
  const page = conversion.blueprint.pages[0];
  assert.ok(page);
  const result = await createElementorDraftPage(config, {
    requestId: crypto.randomUUID(),
    title: `FigmaPress E2E ${Date.now()}`,
    slug: `figmapress-e2e-${Date.now()}`,
    template: conversion.elementorTemplate,
  });
  pageId = result.id;
  assert.equal(result.status, "draft");
  assert.match(result.editLink ?? "", /action=elementor/);
  assert.equal(result.importedMedia, 1);
  mediaIds = wp(["post", "list", "--post_type=attachment", `--post_parent=${pageId}`, "--format=ids"])
    .split(/\s+/)
    .filter(Boolean)
    .map(Number);

  const editMode = wp(["post", "meta", "get", String(pageId), "_elementor_edit_mode"]);
  const rawData = wp(["post", "meta", "get", String(pageId), "_elementor_data"]);
  const elementorData = JSON.parse(rawData) as ElementorNode[];
  const importedImage = findElementorImage(elementorData);
  assert.equal(editMode, "builder");
  assert.equal(elementorData.length, 6);
  assert.ok(importedImage?.url);
  assert.match(importedImage.url, /\/wp-content\/uploads\//);
  assert.ok(Number.isInteger(importedImage.id) && (importedImage.id ?? 0) > 0);
  assert.match(rawData, /"isLinked"/);
  assert.doesNotMatch(rawData, /"islinked"/);

  process.stdout.write(JSON.stringify({
    ok: true,
    wordpressVersion: status.wordpressVersion,
    elementorVersion: status.elementor.version,
    connectorVersion: status.connectorVersion,
    pageStatus: result.status,
    elementorSections: elementorData.length,
    importedMedia: result.importedMedia,
  }));
} finally {
  for (const mediaId of mediaIds) wp(["post", "delete", String(mediaId), "--force"]);
  if (pageId) wp(["post", "delete", String(pageId), "--force"]);
  if (credentialUuid) {
    wp(["user", "application-password", "delete", username, credentialUuid]);
  } else {
    removeStaleCredentials();
  }
}
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
