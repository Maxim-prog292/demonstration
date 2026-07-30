(() => {
    "use strict";

    const $ = (selector, root = document) => root.querySelector(selector);
    const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
    let lastFocused = null;

    const navToggle = $(".nav-toggle");
    const nav = $("#siteNav");
    const dedicatedNewsScript = $('script[src$="/news.js"]');
    if (!dedicatedNewsScript) {
        navToggle?.addEventListener("click", () => {
            const open = nav?.classList.toggle("is-open") || false;
            navToggle.setAttribute("aria-expanded", String(open));
            navToggle.setAttribute("aria-label", open ? "Закрыть меню" : "Открыть меню");
        });
    }

    $$("[data-reveal]").forEach((element) => element.classList.add("is-visible"));

    $$("[data-people-tab]").forEach((button) => {
        button.addEventListener("click", () => {
            const target = button.dataset.peopleTab;
            $$("[data-people-tab]").forEach((tab) => tab.setAttribute("aria-pressed", String(tab === button)));
            $$("[data-people-group]").forEach((group) => {
                group.hidden = group.dataset.peopleGroup !== target;
            });
        });
    });

    $$("[data-show-people]").forEach((button) => {
        button.addEventListener("click", () => {
            const group = button.closest("[data-people-group]");
            $$(".person-card--extra", group).forEach((card) => {
                card.hidden = false;
            });
            button.remove();
        }, { once: true });
    });

    const detailModal = $("#detailModal");
    const closeModal = (modal) => {
        if (!modal) return;
        modal.hidden = true;
        document.body.classList.remove("modal-open");
        lastFocused?.focus?.();
    };
    $$("[data-detail-target]").forEach((button) => {
        button.addEventListener("click", () => {
            const template = document.getElementById(button.dataset.detailTarget);
            const content = $("[data-detail-content]", detailModal);
            if (!template || !content) return;
            content.replaceChildren(template.content.cloneNode(true));
            lastFocused = button;
            detailModal.hidden = false;
            document.body.classList.add("modal-open");
            $(".modal__close", detailModal)?.focus();
        });
    });
    $$("[data-close-modal]").forEach((button) => {
        button.addEventListener("click", () => closeModal(button.closest(".modal")));
    });
    document.addEventListener("keydown", (event) => {
        if (event.key === "Escape") {
            const open = $(".modal:not([hidden])");
            if (open) closeModal(open);
        }
    });

    const selected = () => $$('input[name="candidate[]"]:checked');
    const updateVote = () => {
        const checked = selected();
        const limit = checked.length >= 5;
        $$('input[name="candidate[]"]').forEach((input) => {
            input.disabled = !input.checked && limit;
            const choose = input.closest(".candidate-card__select")?.querySelector(".candidate-card__choose");
            if (choose) {
                choose.textContent = input.checked
                    ? "В выборе — нажмите, чтобы убрать"
                    : limit
                        ? "Сначала уберите одного из пяти"
                        : "Добавить в мой выбор";
            }
        });
        const list = $("[data-selected-list]");
        if (list) {
            list.replaceChildren();
            if (!checked.length) {
                const item = document.createElement("li");
                item.className = "is-placeholder";
                item.textContent = "Выберите пять кандидатов";
                list.append(item);
            } else {
                checked.forEach((input) => {
                    const item = document.createElement("li");
                    item.textContent = input.dataset.candidateName;
                    list.append(item);
                });
            }
        }
        const count = $("[data-selected-count]");
        if (count) count.textContent = String(checked.length);
        const rules = $("[data-vote-rules]");
        if (rules) {
            rules.textContent = checked.length === 5
                ? "Пять кандидатов выбраны. Откройте демонстрационное подтверждение."
                : `Осталось выбрать ${5 - checked.length}.`;
        }
        const submit = $("[data-demo-vote-submit]");
        if (submit) {
            submit.disabled = checked.length !== 5;
            submit.textContent = checked.length === 5 ? "Продолжить" : `Выберите ещё ${5 - checked.length}`;
        }
        $("#demoVotePanel")?.classList.toggle("has-selection", checked.length > 0);
        $("#demoVotePanel")?.classList.toggle("is-complete", checked.length === 5);
    };
    $$('input[name="candidate[]"]').forEach((input) => input.addEventListener("change", updateVote));
    updateVote();

    $("#demoVoteForm")?.addEventListener("submit", (event) => {
        event.preventDefault();
        const checked = selected();
        const result = $("[data-demo-vote-result]");
        if (checked.length !== 5) {
            if (result) result.textContent = "Выберите ровно пять кандидатов.";
            return;
        }
        const modal = $("#demoVoteModal");
        const list = $("[data-demo-modal-selection]", modal);
        list?.replaceChildren(...checked.map((input) => {
            const item = document.createElement("li");
            item.textContent = input.dataset.candidateName;
            return item;
        }));
        const success = $("[data-demo-success]", modal);
        if (success) success.hidden = true;
        lastFocused = $("[data-demo-vote-submit]");
        modal.hidden = false;
        document.body.classList.add("modal-open");
        $(".modal__close", modal)?.focus();
    });
    $("[data-demo-finish]")?.addEventListener("click", (event) => {
        const modal = event.currentTarget.closest(".modal");
        const success = $("[data-demo-success]", modal);
        if (success) {
            success.hidden = false;
            success.focus();
        }
    });

    $("[data-news-expand]")?.addEventListener("click", (event) => {
        $$(".news-card--extra").forEach((card) => {
            card.hidden = false;
        });
        const button = event.currentTarget;
        button.textContent = "Все новости";
        button.addEventListener("click", () => {
            location.href = "./news/";
        }, { once: true });
    }, { once: true });

    const search = $("[data-news-search]");
    search?.addEventListener("input", () => {
        const query = search.value.trim().toLocaleLowerCase("ru");
        let visible = 0;
        $$("[data-news-record]").forEach((card) => {
            const matches = !query || (card.dataset.searchText || "").includes(query);
            card.hidden = !matches;
            if (matches) visible += 1;
        });
        const count = $("[data-news-count]");
        if (count) count.textContent = String(visible);
        const empty = $("[data-news-empty]");
        if (empty) empty.hidden = visible !== 0;
    });

    const formatDate = (value) => new Intl.DateTimeFormat("ru-RU", {
        day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit"
    }).format(value);
    const updateTimers = () => {
        const main = $("#main");
        if (!main?.dataset.votingStart || !main?.dataset.votingEnd) return;
        const now = new Date();
        const start = new Date(main.dataset.votingStart);
        const end = new Date(main.dataset.votingEnd);
        const target = now < start ? start : end;
        const finished = now >= end;
        const diff = Math.max(0, target.getTime() - now.getTime());
        const days = Math.floor(diff / 86400000);
        const hours = Math.floor((diff / 3600000) % 24);
        const minutes = Math.floor((diff / 60000) % 60);
        const seconds = Math.floor((diff / 1000) % 60);
        $$("[data-demo-timer]").forEach((timer) => {
            $("[data-timer-label]", timer).textContent = finished
                ? "Голосование завершено"
                : now < start ? "До начала голосования:" : "До конца голосования:";
            $("[data-timer-days]", timer).textContent = String(days);
            $("[data-timer-hours]", timer).textContent = String(hours).padStart(2, "0");
            $("[data-timer-minutes]", timer).textContent = String(minutes).padStart(2, "0");
            $("[data-timer-seconds]", timer).textContent = String(seconds).padStart(2, "0");
            $("[data-timer-date]", timer).textContent = formatDate(target);
        });
        $$("[data-demo-status]").forEach((node) => {
            node.textContent = finished ? "Голосование завершено" : now < start ? "Голосование не началось" : "Голосование открыто";
        });
    };
    updateTimers();
    setInterval(updateTimers, 1000);
})();