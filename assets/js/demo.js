(() => {
    "use strict";

    const candidateCards = Array.from(document.querySelectorAll("[data-candidate-card]"));
    const selected = new Set();
    const maximumSelection = 5;
    const initialVisible = 4;
    let generatedCode = "";
    let submitted = false;

    const byId = (id) => document.getElementById(id);
    const selectionCount = byId("selectionCount");
    const selectionHint = byId("selectionHint");
    const selectedNames = byId("selectedNames");
    const stickyVote = byId("stickyVote");
    const stickyCount = byId("stickyCount");
    const voteButtons = Array.from(document.querySelectorAll("[data-open-vote]"));
    const resetButtons = Array.from(document.querySelectorAll("[data-reset-selection]"));
    const loadMoreButton = byId("loadMoreCandidates");
    const searchInput = byId("candidateSearch");
    const categoryFilter = byId("candidateCategory");
    const emptyCandidates = byId("emptyCandidates");
    const voteModal = byId("voteModal");
    const detailModal = byId("detailModal");
    const voteForm = byId("voteForm");
    const sendCodeButton = byId("sendDemoCode");
    const codeBox = byId("codeBox");
    const codeValue = byId("demoCodeValue");
    const codeInput = byId("verificationCode");
    const formStatus = byId("formStatus");
    const successCard = byId("voteSuccess");
    const formFields = byId("voteFormFields");
    const toast = byId("toast");
    const menuButton = byId("menuButton");
    const siteNav = byId("siteNav");
    const accessibilityButton = byId("accessibilityToggle");

    const showToast = (message) => {
        if (!toast) return;
        toast.textContent = message;
        toast.classList.add("is-visible");
        window.clearTimeout(showToast.timer);
        showToast.timer = window.setTimeout(() => toast.classList.remove("is-visible"), 2600);
    };

    const normalize = (value) => String(value || "").trim().toLocaleLowerCase("ru-RU");

    const initials = (name) => name
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map((part) => part.charAt(0).toLocaleUpperCase("ru-RU"))
        .join("");

    const visibleCards = () => candidateCards.filter((card) => (
        !card.classList.contains("is-filtered") && !card.classList.contains("is-collapsed")
    ));

    const updateSelection = () => {
        const count = selected.size;
        if (selectionCount) selectionCount.textContent = String(count);
        if (stickyCount) stickyCount.textContent = `${count} из ${maximumSelection}`;
        if (selectionHint) {
            selectionHint.textContent = count === maximumSelection
                ? "Пятёрка собрана — можно перейти к форме."
                : `Выберите ещё ${maximumSelection - count}.`;
        }
        if (stickyVote) stickyVote.hidden = count === 0;
        voteButtons.forEach((button) => {
            button.disabled = count !== maximumSelection;
        });

        if (selectedNames) {
            selectedNames.replaceChildren();
            candidateCards
                .filter((card) => selected.has(card.dataset.id || ""))
                .forEach((card) => {
                    const item = document.createElement("li");
                    item.textContent = card.dataset.name || "Кандидат";
                    selectedNames.append(item);
                });
        }

        candidateCards.forEach((card) => {
            const id = card.dataset.id || "";
            const active = selected.has(id);
            card.classList.toggle("is-selected", active);
            const button = card.querySelector("[data-select-candidate]");
            if (button) {
                button.setAttribute("aria-pressed", active ? "true" : "false");
                button.textContent = active ? "Выбран" : "Выбрать";
                button.disabled = !active && count >= maximumSelection;
            }
        });
    };

    const toggleCandidate = (card) => {
        const id = card.dataset.id || "";
        if (selected.has(id)) {
            selected.delete(id);
        } else if (selected.size < maximumSelection) {
            selected.add(id);
        } else {
            showToast("Можно выбрать ровно пять кандидатов. Снимите один выбор, чтобы заменить его.");
            return;
        }
        updateSelection();
    };

    const resetSelection = () => {
        selected.clear();
        generatedCode = "";
        submitted = false;
        if (voteForm) voteForm.reset();
        if (codeBox) codeBox.hidden = true;
        if (successCard) successCard.hidden = true;
        if (formFields) formFields.hidden = false;
        updateSelection();
        showToast("Список выбранных кандидатов очищен.");
    };

    const filterCandidates = () => {
        const query = normalize(searchInput?.value);
        const category = categoryFilter?.value || "";
        const filtering = query !== "" || category !== "";
        let matches = 0;

        candidateCards.forEach((card, index) => {
            const haystack = normalize([
                card.dataset.name,
                card.dataset.category,
                card.dataset.region,
                card.dataset.years,
            ].join(" "));
            const match = (!query || haystack.includes(query))
                && (!category || card.dataset.category === category);
            card.classList.toggle("is-filtered", !match);
            card.classList.toggle("is-collapsed", !filtering && index >= initialVisible && loadMoreButton?.dataset.expanded !== "true");
            if (match) matches += 1;
        });

        if (loadMoreButton) loadMoreButton.hidden = filtering || candidateCards.length <= initialVisible;
        if (emptyCandidates) emptyCandidates.hidden = matches !== 0;
    };

    const openModal = (modal) => {
        if (!modal) return;
        modal.hidden = false;
        document.body.classList.add("is-locked");
        const focusTarget = modal.querySelector("button, input, select, textarea, a[href]");
        if (focusTarget instanceof HTMLElement) focusTarget.focus();
    };

    const closeModal = (modal, force = false) => {
        if (!modal) return;
        if (
            modal === voteModal
            && !force
            && !submitted
            && voteForm
            && Array.from(new FormData(voteForm).values()).some((value) => String(value).trim() !== "")
            && !window.confirm("Данные формы не отправлены. Закрыть форму и оставить выбранную пятёрку?")
        ) {
            return;
        }
        modal.hidden = true;
        if (!document.querySelector(".modal:not([hidden])")) document.body.classList.remove("is-locked");
    };

    const openDetails = (card) => {
        if (!detailModal) return;
        const name = card.dataset.name || "Кандидат";
        const image = card.querySelector("img");
        const media = byId("detailMedia");
        if (media) {
            media.replaceChildren();
            if (image instanceof HTMLImageElement) {
                const copy = document.createElement("img");
                copy.src = image.src;
                copy.alt = image.alt;
                media.append(copy);
            } else {
                const placeholder = document.createElement("span");
                placeholder.textContent = initials(name);
                media.append(placeholder);
            }
        }
        const values = {
            detailName: name,
            detailMeta: [card.dataset.years, card.dataset.category, card.dataset.region].filter(Boolean).join(" · "),
            detailDescription: card.dataset.description || "Описание будет добавлено.",
            detailBiography: card.dataset.biography || card.dataset.description || "Биография будет добавлена.",
        };
        Object.entries(values).forEach(([id, value]) => {
            const element = byId(id);
            if (element) element.textContent = value;
        });
        const detailSelect = byId("detailSelect");
        if (detailSelect) {
            const active = selected.has(card.dataset.id || "");
            detailSelect.textContent = active ? "Убрать из списка" : "Выбрать кандидата";
            detailSelect.disabled = !active && selected.size >= maximumSelection;
            detailSelect.onclick = () => {
                toggleCandidate(card);
                closeModal(detailModal, true);
            };
        }
        openModal(detailModal);
    };

    const clearErrors = () => {
        document.querySelectorAll("[data-error-for]").forEach((element) => {
            element.textContent = "";
        });
        if (formStatus) {
            formStatus.textContent = "";
            formStatus.className = "form-status";
        }
    };

    const setError = (name, message) => {
        const error = document.querySelector(`[data-error-for="${name}"]`);
        if (error) error.textContent = message;
    };

    const contactData = () => ({
        name: String(byId("voterName")?.value || "").trim(),
        email: normalize(byId("voterEmail")?.value),
        phone: String(byId("voterPhone")?.value || "").replace(/[^\d+]/g, ""),
        message: String(byId("voterMessage")?.value || "").trim(),
    });

    const validateContacts = () => {
        clearErrors();
        const data = contactData();
        let valid = true;
        if (data.name.length < 2 || data.name.length > 120) {
            setError("name", "Укажите имя длиной от 2 до 120 символов.");
            valid = false;
        }
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) {
            setError("email", "Проверьте адрес электронной почты.");
            valid = false;
        } else if (/@(?:gmail|googlemail)\.com$/i.test(data.email)) {
            setError("email", "В рабочей версии адреса Gmail и Googlemail не принимаются.");
            valid = false;
        }
        const digits = data.phone.replace(/\D/g, "");
        if (!(digits.length === 11 && /^[78]/.test(digits))) {
            setError("phone", "Введите российский номер из 11 цифр.");
            valid = false;
        }
        if (data.message.length > 1000) {
            setError("message", "Сообщение не должно превышать 1000 символов.");
            valid = false;
        }
        return valid;
    };

    const generateDemoCode = () => {
        if (!validateContacts()) {
            if (formStatus) {
                formStatus.textContent = "Проверьте выделенные поля — демонстрационный код пока не создан.";
                formStatus.className = "form-status is-error";
            }
            return;
        }
        generatedCode = String(Math.floor(100000 + Math.random() * 900000));
        if (codeValue) codeValue.textContent = generatedCode;
        if (codeInput) {
            codeInput.value = "";
            codeInput.focus();
        }
        if (codeBox) codeBox.hidden = false;
        if (formStatus) {
            formStatus.textContent = "Код показан прямо в форме: в статической демо-версии письмо не отправляется.";
            formStatus.className = "form-status is-success";
        }
    };

    const saveDemoBallot = () => {
        const ballot = {
            selectedCandidateIds: Array.from(selected),
            createdAt: new Date().toISOString(),
            mode: "github-pages-demo",
        };
        try {
            const stored = JSON.parse(localStorage.getItem("narodnoeVecheDemoBallots") || "[]");
            const ballots = Array.isArray(stored) ? stored.slice(-19) : [];
            ballots.push(ballot);
            localStorage.setItem("narodnoeVecheDemoBallots", JSON.stringify(ballots));
        } catch (_) {
            // The success flow remains available when storage is blocked.
        }
    };

    const submitDemoVote = (event) => {
        event.preventDefault();
        if (selected.size !== maximumSelection) {
            closeModal(voteModal, true);
            showToast("Для отправки нужно выбрать ровно пять кандидатов.");
            return;
        }
        if (!validateContacts()) return;
        if (!generatedCode) {
            if (formStatus) {
                formStatus.textContent = "Сначала нажмите «Получить демонстрационный код».";
                formStatus.className = "form-status is-error";
            }
            return;
        }
        if (String(codeInput?.value || "").trim() !== generatedCode) {
            setError("code", "Код не совпадает с показанным выше.");
            return;
        }
        if (!(byId("dataConsent") instanceof HTMLInputElement) || !byId("dataConsent").checked) {
            setError("consent", "Для демонстрации отметьте согласие.");
            return;
        }

        saveDemoBallot();
        submitted = true;
        if (formFields) formFields.hidden = true;
        if (successCard) successCard.hidden = false;
        if (formStatus) formStatus.textContent = "";
        const receipt = byId("demoReceipt");
        if (receipt) receipt.textContent = `DEMO-${Date.now().toString().slice(-8)}`;
    };

    candidateCards.forEach((card, index) => {
        card.classList.toggle("is-collapsed", index >= initialVisible);
        card.querySelector("[data-select-candidate]")?.addEventListener("click", () => toggleCandidate(card));
        card.querySelector("[data-candidate-details]")?.addEventListener("click", () => openDetails(card));
    });

    loadMoreButton?.addEventListener("click", () => {
        loadMoreButton.dataset.expanded = "true";
        loadMoreButton.hidden = true;
        candidateCards.forEach((card) => card.classList.remove("is-collapsed"));
    });
    searchInput?.addEventListener("input", filterCandidates);
    categoryFilter?.addEventListener("change", filterCandidates);
    byId("resetFilters")?.addEventListener("click", () => {
        if (searchInput) searchInput.value = "";
        if (categoryFilter) categoryFilter.value = "";
        filterCandidates();
    });
    resetButtons.forEach((button) => button.addEventListener("click", resetSelection));
    voteButtons.forEach((button) => button.addEventListener("click", () => {
        if (selected.size !== maximumSelection) return;
        submitted = false;
        if (successCard) successCard.hidden = true;
        if (formFields) formFields.hidden = false;
        openModal(voteModal);
    }));
    document.querySelectorAll("[data-close-modal]").forEach((button) => {
        button.addEventListener("click", () => closeModal(button.closest(".modal")));
    });
    document.querySelectorAll(".modal").forEach((modal) => {
        modal.addEventListener("mousedown", (event) => {
            if (event.target === modal) closeModal(modal);
        });
    });
    document.addEventListener("keydown", (event) => {
        if (event.key === "Escape") {
            const modal = document.querySelector(".modal:not([hidden])");
            if (modal) closeModal(modal);
        }
    });
    sendCodeButton?.addEventListener("click", generateDemoCode);
    voteForm?.addEventListener("submit", submitDemoVote);
    byId("closeSuccess")?.addEventListener("click", () => {
        closeModal(voteModal, true);
        resetSelection();
    });

    menuButton?.addEventListener("click", () => {
        const open = siteNav?.classList.toggle("is-open") || false;
        menuButton.setAttribute("aria-expanded", open ? "true" : "false");
    });
    siteNav?.querySelectorAll("a").forEach((link) => link.addEventListener("click", () => {
        siteNav.classList.remove("is-open");
        menuButton?.setAttribute("aria-expanded", "false");
    }));

    accessibilityButton?.addEventListener("click", () => {
        const active = document.documentElement.classList.toggle("accessibility-mode");
        accessibilityButton.setAttribute("aria-pressed", active ? "true" : "false");
        showToast(active ? "Режим повышенной читаемости включён." : "Обычный режим включён.");
    });

    updateSelection();
    filterCandidates();
})();
