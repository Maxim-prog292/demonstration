(() => {
    "use strict";

    const loader = document.currentScript;
    const bviScriptUrl = loader?.dataset.bviScript || "/assets/vendor/bvi/js/bvi.js";
    const bviStyleUrl = loader?.dataset.bviStyle || "/assets/vendor/bvi/css/bvi.css";
    let loadPromise = null;
    let initialized = false;

    const loadModule = () => {
        if (loadPromise) return loadPromise;
        loadPromise = new Promise((resolve, reject) => {
            if (!document.querySelector('link[data-bvi-lazy-style]')) {
                const style = document.createElement("link");
                style.rel = "stylesheet";
                style.href = bviStyleUrl;
                style.dataset.bviLazyStyle = "";
                document.head.append(style);
            }

            if (typeof window.isvek?.Bvi === "function") {
                resolve();
                return;
            }
            const script = document.createElement("script");
            script.src = bviScriptUrl;
            script.dataset.bviLazyScript = "";
            script.onload = resolve;
            script.onerror = () => reject(new Error("Модуль BVI не загрузился."));
            document.head.append(script);
        });
        return loadPromise;
    };

    const initializeModule = () => {
        if (initialized) return;
        const Bvi = window.isvek?.Bvi;
        if (typeof Bvi !== "function") {
            throw new Error("Модуль BVI недоступен.");
        }
        new Bvi({
            target: ".bvi-open",
            fontSize: 18,
            theme: "white",
            images: true,
            letterSpacing: "normal",
            lineHeight: "normal",
            speech: true,
            fontFamily: "arial",
            builtElements: true,
            panelFixed: true,
            panelHide: false,
            reload: false,
            lang: "ru-RU",
        });
        initialized = true;
    };

    const init = () => {
        const buttons = [...document.querySelectorAll(".bvi-open")];
        if (!buttons.length) return;

        buttons.forEach((button) => {
            button.addEventListener("click", async (event) => {
                if (initialized) return;
                event.preventDefault();
                event.stopImmediatePropagation();
                button.disabled = true;
                button.setAttribute("aria-busy", "true");
                try {
                    await loadModule();
                    initializeModule();
                    button.disabled = false;
                    button.removeAttribute("aria-busy");
                    button.click();
                } catch (error) {
                    button.disabled = false;
                    button.removeAttribute("aria-busy");
                    console.error("Версия для слабовидящих недоступна:", error);
                }
            }, { capture: true });
        });

        const hasSavedPreferences = document.cookie
            .split(";")
            .some((cookie) => {
                const [name, value = ""] = cookie.trim().split("=", 2);
                return name === "bvi_panelActive" && decodeURIComponent(value) === "true";
            });
        if (hasSavedPreferences) {
            loadModule().then(initializeModule).catch((error) => {
                console.error("Не удалось восстановить версию для слабовидящих:", error);
            });
        }
    };

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", init, { once: true });
    } else {
        init();
    }
})();
