(function () {
    "use strict";

    function initNavigation(scope) {
        scope.querySelectorAll(".figmapress-nav:not([data-figmapress-ready])").forEach(function (nav) {
            nav.dataset.figmapressReady = "true";
            var toggle = nav.querySelector(".figmapress-nav__toggle");
            if (!toggle) return;
            var toggleLabel = toggle.querySelector(".screen-reader-text");
            function setOpen(open, restoreFocus) {
                nav.classList.toggle("is-open", open);
                toggle.setAttribute("aria-expanded", open ? "true" : "false");
                if (toggleLabel) toggleLabel.textContent = open ? "メニューを閉じる" : "メニューを開く";
                if (restoreFocus) toggle.focus();
            }
            toggle.addEventListener("click", function () {
                setOpen(!nav.classList.contains("is-open"), false);
            });
            nav.querySelectorAll("a").forEach(function (link) {
                link.addEventListener("click", function () {
                    setOpen(false, false);
                });
            });
            document.addEventListener("click", function (event) {
                if (nav.classList.contains("is-open") && !nav.contains(event.target)) {
                    setOpen(false, false);
                }
            });
            document.addEventListener("keydown", function (event) {
                if (event.key === "Escape" && nav.classList.contains("is-open")) {
                    setOpen(false, true);
                }
            });
            window.addEventListener("resize", function () {
                if (window.matchMedia("(min-width: 768px)").matches) setOpen(false, false);
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
                form.setAttribute("aria-busy", "true");
                var controller = typeof AbortController === "function" ? new AbortController() : null;
                var timeout = controller ? window.setTimeout(function () { controller.abort(); }, 30000) : null;
                try {
                    var response = await fetch(form.dataset.endpoint, {
                        method: "POST",
                        body: new URLSearchParams(new FormData(form)),
                        credentials: "same-origin",
                        headers: { "Accept": "application/json" },
                        signal: controller ? controller.signal : undefined
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
                    status.textContent = error && error.name === "AbortError"
                        ? "送信確認がタイムアウトしました。重複送信せず、サイト管理者へお問い合わせください。"
                        : error instanceof Error ? error.message : "送信できませんでした。";
                } finally {
                    if (timeout) window.clearTimeout(timeout);
                    form.removeAttribute("aria-busy");
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
