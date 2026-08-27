(function () {
    "use strict";

    function correctPhoneticAutocomplete() {
        document.querySelectorAll(".figmapress-native-form input, .figmapress-native-form textarea").forEach(function (field) {
            var hint = [field.id, field.name, field.placeholder]
                .filter(Boolean)
                .join(" ")
                .toLowerCase();
            if (!/(?:^|[_-])kana(?:$|[_-])|カナ|かな|ふりがな|フリガナ/.test(hint)) return;
            var autocomplete = field.getAttribute("autocomplete");
            if (autocomplete === "organization" || autocomplete === "name") {
                field.removeAttribute("autocomplete");
            }
        });
    }

    function boot() {
        correctPhoneticAutocomplete();
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
