(function () {
    "use strict";

    function setNavigationOpen(nav, open, restoreFocus) {
        var toggle = nav.querySelector(".figmapress-nav__toggle");
        var state = nav.querySelector(".figmapress-nav__state");
        if (!toggle) return;
        var toggleLabel = toggle.querySelector(".screen-reader-text");
        nav.classList.toggle("is-open", open);
        if (state) state.checked = open;
        toggle.setAttribute("aria-expanded", open ? "true" : "false");
        if (toggleLabel) toggleLabel.textContent = open ? "メニューを閉じる" : "メニューを開く";
        if (restoreFocus) toggle.focus();
    }

    function initNavigation(scope) {
        scope.querySelectorAll(".figmapress-nav").forEach(function (nav) {
            var toggle = nav.querySelector(".figmapress-nav__toggle");
            var state = nav.querySelector(".figmapress-nav__state");
            if (!toggle) return;
            if (state && state.dataset.figmapressBound !== "true") {
                state.dataset.figmapressBound = "true";
                state.addEventListener("change", function () {
                    setNavigationOpen(nav, state.checked, false);
                });
            }
            toggle.setAttribute("aria-expanded", state && state.checked ? "true" : "false");
            nav.dataset.figmapressReady = "true";
        });
    }

    window.addEventListener("click", function (event) {
        var target = event.target instanceof Element ? event.target : null;
        if (!target) return;
        var toggle = target.closest(".figmapress-nav__toggle");
        if (toggle) {
            var nativeState = toggle.previousElementSibling;
            if (nativeState && nativeState.classList.contains("figmapress-nav__state")) return;
            event.preventDefault();
            event.stopPropagation();
            var owner = toggle.closest(".figmapress-nav");
            if (owner) setNavigationOpen(owner, !owner.classList.contains("is-open"), false);
            return;
        }
        document.querySelectorAll(".figmapress-nav.is-open").forEach(function (nav) {
            if (!nav.contains(target) || target.closest("a")) setNavigationOpen(nav, false, false);
        });
    }, true);

    document.addEventListener("keydown", function (event) {
        if (event.key === "Escape") {
            document.querySelectorAll(".figmapress-nav.is-open").forEach(function (nav) {
                setNavigationOpen(nav, false, true);
            });
        }
    });

    window.addEventListener("resize", function () {
        if (!window.matchMedia("(min-width: 768px)").matches) return;
        document.querySelectorAll(".figmapress-nav.is-open").forEach(function (nav) {
            setNavigationOpen(nav, false, false);
        });
    });

    function initAccordions(scope) {
        scope.querySelectorAll(".figmapress-accordion:not([data-figmapress-ready])").forEach(function (accordion) {
            accordion.dataset.figmapressReady = "true";
            accordion.querySelectorAll("details").forEach(function (details) {
                var summary = details.querySelector("summary");
                if (details.dataset.hasContent !== "true") {
                    details.open = false;
                    if (summary) {
                        summary.setAttribute("aria-disabled", "true");
                        summary.setAttribute("tabindex", "-1");
                        summary.addEventListener("click", function (event) {
                            event.preventDefault();
                        });
                        summary.addEventListener("keydown", function (event) {
                            if (event.key === "Enter" || event.key === " ") event.preventDefault();
                        });
                    }
                    details.addEventListener("toggle", function () {
                        if (details.open) details.open = false;
                    });
                    return;
                }
                if (accordion.dataset.multiple === "true") return;
                details.addEventListener("toggle", function () {
                    if (!details.open) return;
                    accordion.querySelectorAll("details[open]").forEach(function (other) {
                        if (other !== details && other.dataset.hasContent === "true") other.open = false;
                    });
                });
            });
        });
    }

    function initCarousels(scope) {
        scope.querySelectorAll(".figmapress-carousel:not([data-figmapress-ready])").forEach(function (carousel) {
            carousel.dataset.figmapressReady = "true";
            var viewport = carousel.querySelector(".figmapress-carousel__viewport");
            var track = carousel.querySelector(".figmapress-carousel__track");
            var slides = Array.prototype.slice.call(carousel.querySelectorAll(".figmapress-carousel__slide"));
            var previous = carousel.querySelector(".figmapress-carousel__button--previous");
            var next = carousel.querySelector(".figmapress-carousel__button--next");
            var dots = carousel.querySelector(".figmapress-carousel__dots");
            var status = carousel.querySelector(".figmapress-carousel__status");
            if (!viewport || !track || !previous || !next || !slides.length) return;

            var index = 0;
            var pointerStart = null;
            var autoplayTimer = null;
            var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
            var loop = carousel.dataset.loop === "true";
            var autoplay = carousel.dataset.autoplay === "true";

            function perView() {
                var configured = window.matchMedia("(max-width: 767px)").matches
                    ? Number(carousel.dataset.mobilePerView || 1)
                    : Number(carousel.dataset.perView || 3);
                return Math.max(1, Math.min(slides.length, Number.isFinite(configured) ? Math.round(configured) : 1));
            }

            function lastIndex() {
                return Math.max(0, slides.length - perView());
            }

            function rebuildDots(maximum) {
                if (!dots) return;
                if (dots.children.length === maximum + 1) return;
                dots.textContent = "";
                for (var dotIndex = 0; dotIndex <= maximum; dotIndex += 1) {
                    var dot = document.createElement("button");
                    dot.type = "button";
                    dot.className = "figmapress-carousel__dot";
                    dot.dataset.index = String(dotIndex);
                    dot.setAttribute("aria-label", String(dotIndex + 1) + "番目のスライドへ");
                    dot.addEventListener("click", function (event) {
                        var target = event.currentTarget;
                        goTo(Number(target.dataset.index || 0), true);
                    });
                    dots.appendChild(dot);
                }
            }

            function update(announce) {
                var visible = perView();
                var maximum = lastIndex();
                index = Math.max(0, Math.min(index, maximum));
                carousel.style.setProperty("--figmapress-per-view", String(visible));
                track.style.transform = "translate3d(-" + (index * 100 / visible) + "%,0,0)";
                slides.forEach(function (slide, slideIndex) {
                    var shown = slideIndex >= index && slideIndex < index + visible;
                    slide.setAttribute("aria-hidden", shown ? "false" : "true");
                    slide.querySelectorAll("a,button,input,select,textarea").forEach(function (control) {
                        if (shown) control.removeAttribute("tabindex");
                        else control.setAttribute("tabindex", "-1");
                    });
                });
                previous.disabled = maximum === 0 || (!loop && index === 0);
                next.disabled = maximum === 0 || (!loop && index === maximum);
                rebuildDots(maximum);
                if (dots) {
                    dots.querySelectorAll(".figmapress-carousel__dot").forEach(function (dot, dotIndex) {
                        var current = dotIndex === index;
                        dot.classList.toggle("is-active", current);
                        if (current) dot.setAttribute("aria-current", "true");
                        else dot.removeAttribute("aria-current");
                    });
                }
                if (announce && status) {
                    status.textContent = (index + 1) + "枚目から" + Math.min(slides.length, index + visible) + "枚目を表示中";
                }
            }

            function goTo(nextIndex, announce) {
                var maximum = lastIndex();
                if (loop && maximum > 0) {
                    if (nextIndex < 0) nextIndex = maximum;
                    if (nextIndex > maximum) nextIndex = 0;
                }
                index = Math.max(0, Math.min(nextIndex, maximum));
                update(announce);
            }

            function stopAutoplay() {
                if (autoplayTimer) window.clearInterval(autoplayTimer);
                autoplayTimer = null;
            }

            function startAutoplay() {
                stopAutoplay();
                if (!autoplay || reduceMotion.matches || lastIndex() === 0 || document.hidden) return;
                autoplayTimer = window.setInterval(function () { goTo(index + 1, false); }, 5000);
            }

            previous.addEventListener("click", function () { goTo(index - 1, true); });
            next.addEventListener("click", function () { goTo(index + 1, true); });
            carousel.addEventListener("keydown", function (event) {
                if (event.key === "ArrowLeft") {
                    event.preventDefault();
                    goTo(index - 1, true);
                }
                if (event.key === "ArrowRight") {
                    event.preventDefault();
                    goTo(index + 1, true);
                }
            });
            viewport.addEventListener("pointerdown", function (event) {
                if (event.pointerType === "mouse" && event.button !== 0) return;
                pointerStart = event.clientX;
            });
            viewport.addEventListener("pointerup", function (event) {
                if (pointerStart === null) return;
                var distance = event.clientX - pointerStart;
                pointerStart = null;
                if (Math.abs(distance) < 40) return;
                goTo(index + (distance < 0 ? 1 : -1), true);
            });
            viewport.addEventListener("pointercancel", function () { pointerStart = null; });
            carousel.addEventListener("mouseenter", stopAutoplay);
            carousel.addEventListener("mouseleave", startAutoplay);
            carousel.addEventListener("focusin", stopAutoplay);
            carousel.addEventListener("focusout", startAutoplay);
            window.addEventListener("resize", function () { update(false); });
            document.addEventListener("visibilitychange", startAutoplay);
            if (typeof reduceMotion.addEventListener === "function") {
                reduceMotion.addEventListener("change", startAutoplay);
            }
            update(false);
            startAutoplay();
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
        initCarousels(root);
        initForms(root);
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", function () { init(document); });
    } else {
        init(document);
    }

    window.addEventListener("elementor/frontend/init", function () {
        if (!window.elementorFrontend || !window.elementorFrontend.hooks) return;
        ["figmapress-nav", "figmapress-link", "figmapress-carousel", "figmapress-contact-form", "figmapress-accordion"].forEach(function (name) {
            window.elementorFrontend.hooks.addAction("frontend/element_ready/" + name + ".default", function (element) {
                init(element && element[0] ? element[0] : document);
            });
        });
    });
}());
