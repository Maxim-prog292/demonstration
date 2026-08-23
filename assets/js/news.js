(() => {
    "use strict";

    const setupNavigation = () => {
        const toggle = document.querySelector(".nav-toggle");
        const nav = document.querySelector("#siteNav");
        if (!toggle || !nav) return;

        const setOpen = (open, restoreFocus = false) => {
            toggle.setAttribute("aria-expanded", String(open));
            toggle.setAttribute("aria-label", open ? "Закрыть меню" : "Открыть меню");
            nav.classList.toggle("is-open", open);
            if (!open && restoreFocus) toggle.focus();
        };

        toggle?.addEventListener("click", () => {
            const open = toggle.getAttribute("aria-expanded") === "true";
            setOpen(!open);
        });
        nav?.addEventListener("click", (event) => {
            if (!event.target.closest("a")) return;
            setOpen(false);
        });
        document.addEventListener("keydown", (event) => {
            if (event.key === "Escape" && toggle.getAttribute("aria-expanded") === "true") {
                setOpen(false, true);
            }
        });
    };

    const setupGallery = (gallery) => {
        const slides = [...gallery.querySelectorAll("[data-news-slide]")];
        if (slides.length < 2) return;
        const current = gallery.querySelector("[data-news-current]");
        let activeIndex = 0;

        const show = (nextIndex) => {
            slides[activeIndex].querySelector("video")?.pause();
            activeIndex = (nextIndex + slides.length) % slides.length;
            slides.forEach((slide, index) => {
                slide.hidden = index !== activeIndex;
            });
            if (current) current.textContent = String(activeIndex + 1);
        };

        gallery.querySelector("[data-news-prev]")?.addEventListener("click", () => show(activeIndex - 1));
        gallery.querySelector("[data-news-next]")?.addEventListener("click", () => show(activeIndex + 1));

        let touchStartX = null;
        gallery.addEventListener("touchstart", (event) => {
            touchStartX = event.changedTouches[0]?.clientX ?? null;
        }, { passive: true });
        gallery.addEventListener("touchend", (event) => {
            if (touchStartX === null) return;
            const endX = event.changedTouches[0]?.clientX ?? touchStartX;
            const delta = endX - touchStartX;
            touchStartX = null;
            if (Math.abs(delta) < 45) return;
            show(activeIndex + (delta < 0 ? 1 : -1));
        }, { passive: true });

        gallery.addEventListener("keydown", (event) => {
            if (event.key === "ArrowLeft") {
                event.preventDefault();
                show(activeIndex - 1);
            }
            if (event.key === "ArrowRight") {
                event.preventDefault();
                show(activeIndex + 1);
            }
        });
    };

    const copyUrl = async (url) => {
        if (navigator.clipboard?.writeText) {
            await navigator.clipboard.writeText(url);
            return;
        }
        const field = document.createElement("textarea");
        field.value = url;
        field.setAttribute("readonly", "");
        field.style.position = "fixed";
        field.style.opacity = "0";
        document.body.append(field);
        field.select();
        const copied = document.execCommand("copy");
        field.remove();
        if (!copied) throw new Error("copy failed");
    };

    const shareNews = async (button) => {
        const status = button.closest(".news-share")?.querySelector("[data-share-status]");
        const title = button.dataset.shareTitle || document.title;
        const url = window.location.href;
        try {
            if (navigator.share) {
                await navigator.share({
                    title,
                    text: title,
                    url,
                });
                if (status) status.textContent = "Меню «Поделиться» открыто";
            } else {
                await copyUrl(url);
                if (status) status.textContent = "Ссылка скопирована";
                button.classList.add("is-copied");
            }
            window.setTimeout(() => {
                if (status) status.textContent = "";
                button.classList.remove("is-copied");
            }, 3000);
        } catch (error) {
            if (error?.name === "AbortError") {
                if (status) status.textContent = "";
                return;
            }
            if (status) status.textContent = "Не удалось поделиться ссылкой";
        }
    };

    const setupLightbox = () => {
        const dialog = document.querySelector("[data-news-lightbox]");
        const image = dialog?.querySelector("[data-lightbox-image]");
        const source = dialog?.querySelector("[data-lightbox-source]");
        if (!dialog || !image || !source) return;
        let opener = null;

        const close = () => {
            if (typeof dialog.close === "function" && dialog.open) {
                dialog.close();
            } else {
                dialog.removeAttribute("open");
            }
            document.body.classList.remove("has-lightbox");
            opener?.focus();
        };

        document.querySelectorAll("[data-lightbox-open]").forEach((button) => {
            button.addEventListener("click", () => {
                opener = button;
                image.src = button.dataset.lightboxSrc || "";
                image.alt = button.dataset.lightboxAlt || "";
                source.textContent = button.dataset.lightboxSource || "не указан";
                if (typeof dialog.showModal === "function") {
                    dialog.showModal();
                } else {
                    dialog.setAttribute("open", "");
                }
                document.body.classList.add("has-lightbox");
                dialog.querySelector("[data-lightbox-close]")?.focus();
            });
        });
        dialog.querySelector("[data-lightbox-close]")?.addEventListener("click", close);
        dialog.addEventListener("click", (event) => {
            if (event.target === dialog) close();
        });
        dialog.addEventListener("cancel", (event) => {
            event.preventDefault();
            close();
        });
    };

    setupNavigation();
    document.querySelectorAll("[data-news-gallery]").forEach(setupGallery);
    document.querySelector("[data-share-news]")?.addEventListener("click", (event) => {
        shareNews(event.currentTarget);
    });
    setupLightbox();
})();
