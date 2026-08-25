import assert from "node:assert/strict";
import test from "node:test";
import { inspectRenderedLinkIntegrity } from "../apps/web/src/lib/rendered-link-integrity";

test("rendered link audit accepts real local anchors and normal URLs", () => {
  const audit = inspectRenderedLinkIntegrity(`
    <main id="top-mobile">
      <a href="#contact-mobile">お問い合わせ</a>
      <a href="https://example.com/company/">会社案内</a>
      <section id="contact-mobile"></section>
    </main>
  `);
  assert.equal(audit.valid, true);
  assert.equal(audit.links, 2);
  assert.equal(audit.anchors, 2);
  assert.deepEqual(audit.duplicateAnchors, []);
  assert.deepEqual(audit.missingAnchors, []);
});

test("rendered link audit rejects placeholders, missing IDs, and script URLs", () => {
  const audit = inspectRenderedLinkIntegrity(`
    <nav id="site-navigation-mobile">
      <a href="#figmapress-page-company">会社案内</a>
      <a href="&#35;contact-mobile">お問い合わせ</a>
      <a href="javascript:alert(1)">unsafe</a>
    </nav>
  `);
  assert.equal(audit.valid, false);
  assert.deepEqual(audit.unresolvedPlaceholders, ["#figmapress-page-company"]);
  assert.deepEqual(audit.missingAnchors, ["contact-mobile"]);
  assert.deepEqual(audit.unsafe, ["javascript:alert(1)"]);
});

test("rendered link audit rejects duplicate destination IDs", () => {
  const audit = inspectRenderedLinkIntegrity(`
    <a href="#contact">お問い合わせ</a>
    <section id="contact"></section>
    <footer id="contact"></footer>
  `);
  assert.equal(audit.valid, false);
  assert.deepEqual(audit.duplicateAnchors, ["contact"]);
});
