=== FigmaPress Connector ===
Contributors: figmapress
Tags: blocks, figma, gutenberg, elementor
Requires at least: 6.4
Requires PHP: 7.4
Stable tag: 0.4.4
License: GPLv2 or later

Connects FigmaPress output to editable Gutenberg blocks and Elementor pages.

== Installation ==
1. Upload the figmapress-connector folder to /wp-content/plugins/.
2. Activate the plugin via Plugins > Installed Plugins.
3. Open the FigmaPress web app or run `npm run wp:create-draft` locally to
   create a draft page containing figmapress/* blocks.

== Changelog ==
= 0.4.4 =
* Save generated pages through Elementor's document API for Elementor 4.x compatibility.
* Verify the stored Elementor document before importing images and remove failed empty drafts.

= 0.4.3 =
* Save Elementor content before downloading images so interrupted imports never leave an empty page.
* Limit synchronous Media Library imports to a safe time budget and preserve remote images that cannot be localized in time.

= 0.4.2 =
* Retry Application Password authentication through a namespaced HTTPS header when a host strips standard HTTP Basic Authorization.
* Add a credential-free diagnostic endpoint that reports whether authentication headers reach WordPress.

= 0.4.1 =
* Preserve responsive Figma typography, explicit line wrapping, mixed text sizes, and rotations in Elementor pages.
* Keep the inline layout styles required by editable Figma text during REST sanitization.

= 0.4.0 =
* Adds high-fidelity Figma layout conversion for Elementor.
* Keeps text editable while localizing rendered vectors, masks, and images.
* Raises the safe image import limit for image-rich pages.
* Allows authenticated connection diagnostics to report missing edit_pages capability correctly.

= 0.3.0 =
* Adds authenticated connection diagnostics.
* Adds native Elementor document creation and Media Library image imports.
* Keeps all remote page creation draft-only.

= 0.2.0 =
* First public beta release.
* Adds six server-rendered Gutenberg blocks.
