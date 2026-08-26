(function () {
    "use strict";

    function roots(scope, selector) {
        var root = scope && scope.querySelectorAll ? scope : document;
        var matches = [];
        if (root.matches && root.matches(selector)) matches.push(root);
        return matches.concat(Array.prototype.slice.call(root.querySelectorAll(selector)));
    }

    function initNativeNavigation(scope) {
        roots(scope, ".figmapress-native-nav-menu").forEach(function (widget) {
            var toggle = widget.querySelector(".elementor-menu-toggle");
            var dropdown = widget.querySelector(".elementor-nav-menu--dropdown");
            if (!toggle || !dropdown) return;

            var widgetId = (widget.getAttribute("data-id") || "menu").replace(/[^a-zA-Z0-9_-]/g, "");
            if (!dropdown.id) dropdown.id = "figmapress-menu-" + widgetId;
            toggle.setAttribute("aria-controls", dropdown.id);

            var syncLabel = function () {
                var open = toggle.getAttribute("aria-expanded") === "true";
                toggle.setAttribute("aria-label", open ? "メニューを閉じる" : "メニューを開く");
            };
            syncLabel();

            if (toggle.dataset.figmapressUxReady !== "true") {
                toggle.dataset.figmapressUxReady = "true";
                new MutationObserver(syncLabel).observe(toggle, {
                    attributes: true,
                    attributeFilter: ["aria-expanded"]
                });
                toggle.addEventListener("keydown", function (event) {
                    if (event.key !== "Escape" || toggle.getAttribute("aria-expanded") !== "true") return;
                    event.preventDefault();
                    toggle.click();
                    toggle.focus();
                });
            }

            widget.querySelectorAll(".current-menu-item > a, .current_page_item > a").forEach(function (link) {
                link.setAttribute("aria-current", "page");
            });
            widget.dataset.figmapressUxReady = "true";
        });
    }

    function inferredAutocomplete(field, form) {
        var customId = (field.id || "").replace(/^form-field-/, "").replace(/-\d+$/, "");
        var label = field.id ? form.querySelector('label[for="' + CSS.escape(field.id) + '"]') : null;
        var hint = [customId, field.name, field.placeholder, label && label.textContent]
            .filter(Boolean)
            .join(" ")
            .toLowerCase();
        if (/(company|organization|会社|法人)/.test(hint)) return "organization";
        if (/(name|氏名|お名前|担当者)/.test(hint)) return "name";
        if (/(address|住所|所在地)/.test(hint)) return "street-address";
        if (/(phone|tel|電話)/.test(hint)) return "tel";
        if (/(email|mail|メール)/.test(hint)) return "email";
        return "";
    }

    function initNativeForms(scope) {
        roots(scope, ".figmapress-native-form form").forEach(function (form) {
            if (!form.getAttribute("aria-label")) {
                form.setAttribute("aria-label", form.getAttribute("name") || "お問い合わせフォーム");
            }
            form.querySelectorAll("input, select, textarea").forEach(function (field) {
                var autocomplete = inferredAutocomplete(field, form);
                if (!field.getAttribute("autocomplete") && autocomplete) {
                    field.setAttribute("autocomplete", autocomplete);
                }
                if (field.required) field.setAttribute("aria-required", "true");
                if (autocomplete === "tel" && !field.getAttribute("inputmode")) field.setAttribute("inputmode", "tel");
                if (autocomplete === "email" && !field.getAttribute("inputmode")) field.setAttribute("inputmode", "email");
            });

            if (form.dataset.figmapressUxReady !== "true") {
                form.dataset.figmapressUxReady = "true";
                new MutationObserver(function (records) {
                    records.forEach(function (record) {
                        Array.prototype.forEach.call(record.addedNodes, function (node) {
                            if (!(node instanceof Element)) return;
                            var messages = node.matches(".elementor-message")
                                ? [node]
                                : Array.prototype.slice.call(node.querySelectorAll(".elementor-message"));
                            messages.forEach(function (message) {
                                var error = message.classList.contains("elementor-message-danger");
                                message.setAttribute("role", error ? "alert" : "status");
                                message.setAttribute("aria-live", error ? "assertive" : "polite");
                            });
                        });
                    });
                }).observe(form, { childList: true, subtree: true });
            }
        });
    }

    function init(scope) {
        initNativeNavigation(scope);
        initNativeForms(scope);
    }

    function registerElementorHooks() {
        if (!window.elementorFrontend || !window.elementorFrontend.hooks) return;
        if (document.documentElement.dataset.figmapressUxHooks === "true") return;
        document.documentElement.dataset.figmapressUxHooks = "true";
        ["nav-menu", "form", "nested-accordion"].forEach(function (name) {
            window.elementorFrontend.hooks.addAction("frontend/element_ready/" + name + ".default", function (element) {
                init(element && element[0] ? element[0] : document);
            });
        });
    }

    function boot() {
        init(document);
        registerElementorHooks();
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", boot);
    } else {
        boot();
    }
    window.addEventListener("load", boot);
    window.addEventListener("elementor/frontend/init", boot);
    [250, 750, 1500, 3000].forEach(function (delay) {
        window.setTimeout(boot, delay);
    });
}());
