(function () {
    "use strict";

    function initNavigation(scope) {
        scope.querySelectorAll(".figmapress-nav:not([data-figmapress-ready])").forEach(function (nav) {
            nav.dataset.figmapressReady = "true";
            var toggle = nav.querySelector(".figmapress-nav__toggle");
            if (!toggle) return;
            toggle.addEventListener("click", function () {
                var open = nav.classList.toggle("is-open");
                toggle.setAttribute("aria-expanded", open ? "true" : "false");
            });
            nav.querySelectorAll("a").forEach(function (link) {
                link.addEventListener("click", function () {
                    nav.classList.remove("is-open");
                    toggle.setAttribute("aria-expanded", "false");
                });
            });
        });
    }

    function initAccordions(scope) {
        scope.querySelectorAll(".figmapress-accordion:not([data-figmapress-ready])").forEach(function (accordion) {
            accordion.dataset.figmapressReady = "true";
            if (accordion.dataset.multiple === "true") return;
            accordion.querySelectorAll("details").forEach(function (details) {
                details.addEventListener("toggle", function () {
                    if (!details.open) return;
                    accordion.querySelectorAll("details[open]").forEach(function (other) {
                        if (other !== details) other.open = false;
                    });
                });
            });
        });
    }

    function initForms(scope) {
        scope.querySelectorAll(".figmapress-contact__form:not([data-figmapress-ready])").forEach(function (form) {
            form.dataset.figmapressReady = "true";
            form.addEventListener("submit", async function (event) {
                event.preventDefault();
                var status = form.querySelector(".figmapress-contact__status");
                var button = form.querySelector('button[type="submit"]');
                if (!form.reportValidity() || !status || !button) return;
                status.textContent = "送信中…";
                status.classList.remove("is-error");
                button.disabled = true;
                try {
                    var response = await fetch(form.dataset.endpoint, {
                        method: "POST",
                        body: new URLSearchParams(new FormData(form)),
                        credentials: "same-origin",
                        headers: { "Accept": "application/json" }
                    });
                    var data = await response.json().catch(function () { return {}; });
                    if (!response.ok) throw new Error(data.message || "送信できませんでした。時間をおいて再度お試しください。");
                    var preserved = ["page_id", "widget_id", "rendered_at", "form_token"];
                    form.reset();
                    preserved.forEach(function (name) {
                        var input = form.elements.namedItem(name);
                        if (input && data[name]) input.value = data[name];
                    });
                    status.textContent = status.dataset.success || data.message || "送信しました。";
                } catch (error) {
                    status.classList.add("is-error");
                    status.textContent = error instanceof Error ? error.message : "送信できませんでした。";
                } finally {
                    button.disabled = false;
                }
            });
        });
    }

    function init(scope) {
        var root = scope && scope.querySelectorAll ? scope : document;
        initNavigation(root);
        initAccordions(root);
        initForms(root);
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", function () { init(document); });
    } else {
        init(document);
    }

    window.addEventListener("elementor/frontend/init", function () {
        if (!window.elementorFrontend || !window.elementorFrontend.hooks) return;
        ["figmapress-nav", "figmapress-contact-form", "figmapress-accordion"].forEach(function (name) {
            window.elementorFrontend.hooks.addAction("frontend/element_ready/" + name + ".default", function (element) {
                init(element && element[0] ? element[0] : document);
            });
        });
    });
}());
