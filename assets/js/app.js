(() => {
    "use strict";

    const state = {
        blocks: new Map(),
        candidates: [],
        voteStatus: null,
        selectionCount: 1,
        hasPrivacyConsent: false,
        selectedCandidates: [],
        birthDate: null,
        voteNonce: null,
        emailVerification: {
            challenge: null,
            token: null,
            email: "",
            deliveryStatus: null,
            maskedEmail: "",
            expiresAt: 0,
            retryUntil: 0,
            retryMessage: "",
        },
        voteRulesText: "",
        serverOffset: 0,
        lastFocused: null,
        countdownTimer: null,
        statusTimer: null,
        resultsTimer: null,
        resultsVisible: false,
        resultsLoaded: false,
        statusUpdatedAt: 0,
        resultsUpdatedAt: 0,
        modalScrollY: 0,
        voteSubmitting: false,
    };

    const STATUS_POLL_INTERVAL = 60000;
    const RESULTS_POLL_INTERVAL = 60000;

    const $ = (selector, root = document) => root.querySelector(selector);
    const scrollToCurrentHash = ({ behavior = "auto" } = {}) => {
        const rawHash = window.location.hash.slice(1);
        if (!rawHash) return false;

        let targetId = rawHash;
        try {
            targetId = decodeURIComponent(rawHash);
        } catch {
            // Keep the original fragment when it is not valid percent-encoding.
        }

        const target = document.getElementById(targetId);
        if (!target) return false;
        target.scrollIntoView({ block: "start", behavior });
        return true;
    };

    const restoreInitialHashPosition = () => {
        if (!window.location.hash) return;

        window.requestAnimationFrame(() => {
            window.requestAnimationFrame(() => scrollToCurrentHash());
        });
        // Dynamic fonts, images and the preloader transition can still change the
        // layout after the first frame, so confirm the final anchor position once.
        window.setTimeout(() => scrollToCurrentHash(), 500);
    };

    window.addEventListener("hashchange", () => {
        window.requestAnimationFrame(() => scrollToCurrentHash());
    });
    const sitePreloaderStartedAt = performance.now();
    let sitePreloaderHideTimer = 0;
    let sitePreloaderFailsafeTimer = 0;
    let sitePreloaderHidden = false;

    const hideSitePreloader = ({ immediate = false } = {}) => {
        if (sitePreloaderHidden || sitePreloaderHideTimer) return;
        const elapsed = performance.now() - sitePreloaderStartedAt;
        const delay = immediate ? 0 : Math.max(0, 450 - elapsed);
        sitePreloaderHideTimer = window.setTimeout(() => {
            sitePreloaderHideTimer = 0;
            if (sitePreloaderHidden) return;
            sitePreloaderHidden = true;
            window.clearTimeout(sitePreloaderFailsafeTimer);
            document.body?.setAttribute("aria-busy", "false");
            const preloader = $("#sitePreloader");
            if (!preloader) return;
            preloader.classList.add("is-hidden");
            preloader.setAttribute("aria-hidden", "true");
            window.setTimeout(() => preloader.remove(), 650);
        }, delay);
    };

    sitePreloaderFailsafeTimer = window.setTimeout(
        () => hideSitePreloader({ immediate: true }),
        10000,
    );

    const empty = (element) => {
        while (element?.firstChild) {
            element.removeChild(element.firstChild);
        }
    };

    const api = async (url, options = {}) => {
        const response = await fetch(url, {
            credentials: "same-origin",
            headers: { Accept: "application/json", ...(options.headers || {}) },
            ...options,
        });
        const payload = await response.json().catch(() => null);
        if (!response.ok || !payload?.ok) {
            const error = new Error(payload?.error?.message || "Не удалось загрузить данные.");
            error.code = payload?.error?.code || "SERVER_ERROR";
            error.status = response.status;
            error.details = payload?.error?.details || {};
            error.retryAfter = Number(error.details.retryAfter || 0);
            throw error;
        }
        return payload.data;
    };

    const DISALLOWED_EMAIL_DOMAINS = new Set(["gmail.com", "googlemail.com"]);
    const GOOGLE_EMAIL_MESSAGE = "Адреса Gmail и Google Mail не принимаются. Используйте электронную почту другого сервиса.";
    const PHONE_MESSAGE = "Укажите российский номер телефона в формате +7 (999) 123-45-67.";
    const EMAIL_MESSAGE = "Проверьте адрес электронной почты.";
    const EMAIL_DOMAIN_TYPOS = new Map([
        ["mai.ru", "mail.ru"], ["maill.ru", "mail.ru"], ["mal.ru", "mail.ru"],
        ["mil.ru", "mail.ru"], ["meil.ru", "mail.ru"], ["mail.ry", "mail.ru"],
        ["yndex.ru", "yandex.ru"], ["yadnex.ru", "yandex.ru"], ["yaandex.ru", "yandex.ru"],
        ["yandex.ry", "yandex.ru"], ["yandexru", "yandex.ru"],
        ["ramber.ru", "rambler.ru"], ["rambelr.ru", "rambler.ru"], ["rambler.ry", "rambler.ru"],
        ["outlok.com", "outlook.com"], ["outllok.com", "outlook.com"],
        ["hotmal.com", "hotmail.com"], ["hotmai.com", "hotmail.com"],
        ["iclod.com", "icloud.com"], ["protonmai.com", "protonmail.com"],
        ["gmial.com", "gmail.com"], ["gmai.com", "gmail.com"], ["gmail.con", "gmail.com"],
        ["googlemai.com", "googlemail.com"],
    ]);
    const EMAIL_VERIFICATION_STORAGE_KEY = "veche2026.pendingEmailVerification.v1";
    let emailRetryTimer = 0;
    let emailRequestInFlight = false;

    const normalizedEmail = (value) => String(value || "").trim().toLowerCase();

    const isDisallowedEmail = (value) => {
        const email = normalizedEmail(value);
        const separator = email.lastIndexOf("@");
        return separator >= 0 && DISALLOWED_EMAIL_DOMAINS.has(email.slice(separator + 1));
    };

    const emailDomainSuggestion = (value) => {
        const email = normalizedEmail(value);
        const separator = email.lastIndexOf("@");
        if (separator < 1) return null;
        return EMAIL_DOMAIN_TYPOS.get(email.slice(separator + 1)) || null;
    };

    const renderEmailDomainSuggestion = (input) => {
        const hint = $("#voteField-email-suggestion");
        if (!hint) return;
        const suggestion = emailDomainSuggestion(input?.value);
        if (!suggestion) {
            hint.textContent = "";
            hint.hidden = true;
            return;
        }
        const gmailNote = DISALLOWED_EMAIL_DOMAINS.has(suggestion)
            ? " Этот почтовый сервис в голосовании не принимается."
            : " Исправьте адрес вручную, если это опечатка.";
        hint.textContent = `Проверьте домен: возможно, вы имели в виду @${suggestion}.${gmailNote}`;
        hint.hidden = false;
    };

    const renderFieldError = (input, message, force = false) => {
        if (!input) return;
        const error = $(`#${input.id}-error`);
        const show = Boolean(message) && (force || Boolean(String(input.value || "").trim()));
        input.classList.toggle("is-invalid", show);
        input.setAttribute("aria-invalid", show ? "true" : "false");
        if (error) {
            error.textContent = show ? message : "";
            error.hidden = !show;
        }
    };

    const validateEmailInput = (input, { show = false } = {}) => {
        if (!input) return false;
        renderEmailDomainSuggestion(input);
        input.setCustomValidity("");
        const value = normalizedEmail(input.value);
        let message = "";
        if (isDisallowedEmail(value)) {
            message = GOOGLE_EMAIL_MESSAGE;
        } else if (value && !input.checkValidity()) {
            message = EMAIL_MESSAGE;
        } else if (!value && input.required) {
            message = "Укажите электронную почту.";
        }
        input.setCustomValidity(message);
        renderFieldError(input, message, show);
        return input.checkValidity();
    };

    const normalizeRussianPhone = (value) => {
        const phone = String(value || "").trim();
        if (!phone || !/^[+0-9()\s.\-]+$/.test(phone)) return null;
        let digits = phone.replace(/\D+/g, "");
        if (digits.length === 10) digits = `7${digits}`;
        if (digits.length === 11 && digits.startsWith("8")) digits = `7${digits.slice(1)}`;
        return digits.length === 11 && /^7[3489]/.test(digits) ? `+${digits}` : null;
    };

    const formatRussianPhone = (canonical) => canonical
        ? `+7 (${canonical.slice(2, 5)}) ${canonical.slice(5, 8)}-${canonical.slice(8, 10)}-${canonical.slice(10, 12)}`
        : "";

    const validatePhoneInput = (input, { show = false } = {}) => {
        if (!input) return true;
        const isEmptyOptional = !input.required && !String(input.value || "").trim();
        const message = isEmptyOptional || normalizeRussianPhone(input.value) ? "" : PHONE_MESSAGE;
        input.setCustomValidity(message);
        renderFieldError(input, message, show);
        return input.checkValidity();
    };

    const validateContactInputs = ({ show = false } = {}) => {
        const emailValid = validateEmailInput($("#voteField-email"), { show });
        const phoneValid = validatePhoneInput($("#voteField-phone"), { show });
        return emailValid && phoneValid;
    };

    const initials = (name = "") => name
        .trim()
        .split(/\s+/)
        .filter(Boolean)
        .slice(-2)
        .map((part) => part[0]?.toUpperCase() || "")
        .join("");

    const fairOrder = (records) => {
        const ordered = [...records];
        if (!globalThis.crypto?.getRandomValues) {
            return ordered;
        }
        for (let index = ordered.length - 1; index > 0; index -= 1) {
            const value = new Uint32Array(1);
            crypto.getRandomValues(value);
            const target = value[0] % (index + 1);
            [ordered[index], ordered[target]] = [ordered[target], ordered[index]];
        }
        return ordered;
    };

    const cleanPublicText = (value) => {
        const text = String(value || "").trim();
        if (!text) return "";
        if (/(?:будет добавлен|уточняется|ожидает редакционной|черновой текст|подлеж\p{L}*\s+редакционн\p{L}*\s+проверк)/iu.test(text)) {
            return "";
        }
        return text
            .replace(/(?:[.;]\s*)?(?:требуется|требует|подлежит|подлежат)\s+(?:редакционн\p{L}*\s+)?(?:сверк\p{L}*|проверк\p{L}*|согласован\p{L}*).*$/iu, "")
            .trim();
    };

    const portrait = (record, className = "portrait") => {
        const node = document.createElement("div");
        node.className = className;
        if (record.image_path) {
            const image = document.createElement("img");
            image.src = record.image_path;
            image.alt = record.image_alt || `Портрет: ${record.full_name}`;
            image.loading = "lazy";
            image.decoding = "async";
            node.append(image);
        } else {
            node.textContent = initials(record.full_name);
            node.setAttribute("aria-hidden", "true");
        }
        return node;
    };

    const setText = (selector, value) => {
        const element = $(selector);
        if (element && value !== null && value !== undefined) {
            element.textContent = String(value);
        }
    };

    const block = (key) => state.blocks.get(key) || {};

    const blockValue = (record, path) => path
        .split(".")
        .reduce((value, key) => (value !== null && value !== undefined ? value[key] : undefined), record);

    const renderFinalTitle = (element, text) => {
        const lines = String(text)
            .split(/\r?\n/)
            .map((line) => line.trim())
            .filter(Boolean);
        empty(element);
        lines.forEach((line, index) => {
            const item = document.createElement("span");
            item.className = "final-title__line";
            if (index === 0 || index === lines.length - 1) {
                item.classList.add("final-title__accent");
            }
            item.textContent = line;
            element.append(item);
        });
    };

    const applyBlocks = () => {
        document.querySelectorAll("[data-content-block][data-content-field]").forEach((element) => {
            const value = blockValue(block(element.dataset.contentBlock), element.dataset.contentField);
            if (value === null || value === undefined) return;
            const text = String(value);
            if (element.dataset.contentPresentation === "final-title") {
                renderFinalTitle(element, text);
            } else {
                element.textContent = text;
            }
            if (element.hasAttribute("data-content-hide-empty")) {
                element.hidden = text.trim() === "";
            }
        });

        state.voteRulesText = block("voting_intro").extra?.rules
            || "Выберите одного кандидата из пяти финалистов.";
    };

    const renderRegionStats = (items) => {
        const list = $("#regionStats");
        if (!list || !Array.isArray(items) || items.length === 0) return;
        empty(list);
        items.forEach((record, index) => {
            const item = document.createElement("article");
            item.className = "stat-card";

            const marker = document.createElement("span");
            marker.className = "stat-card__marker";
            marker.textContent = String(index + 1).padStart(2, "0");

            const value = document.createElement("div");
            value.className = "stat-card__value";
            const mainValue = document.createElement("b");
            mainValue.textContent = record.value_text || "";
            value.append(mainValue);
            if (record.unit_text) {
                const unit = document.createElement("span");
                unit.textContent = record.unit_text;
                value.append(unit);
            }

            const description = document.createElement("p");
            description.textContent = record.description || "";
            item.append(marker, value, description);
            list.append(item);
        });
    };

    const renderTimeline = (items) => {
        const list = $("#timeline");
        empty(list);
        items.forEach((record, index) => {
            const item = document.createElement("li");
            item.className = "timeline__item";
            item.dataset.reveal = "";
            const indexNode = document.createElement("span");
            indexNode.className = "timeline__index";
            indexNode.textContent = String(index + 1).padStart(2, "0");
            const year = document.createElement("div");
            year.className = "timeline__year";
            year.textContent = record.period_text;
            const title = document.createElement("h3");
            title.textContent = record.title;
            const description = document.createElement("p");
            description.textContent = record.description;
            item.append(indexNode, year, title, description);
            list.append(item);
        });
    };

    const renderCandidates = () => {
        const grid = $("#candidateGrid");
        empty(grid);
        state.candidates.forEach((candidate) => {
            const card = document.createElement("article");
            card.className = "candidate-card";
            card.dataset.reveal = "";
            if (document.documentElement.classList.contains("reveal-ready")) {
                card.classList.add("is-visible");
            }

            const label = document.createElement("label");
            label.className = "candidate-card__select";
            label.setAttribute("aria-label", `Добавить в мой выбор: ${candidate.full_name}`);
            const checkbox = document.createElement("input");
            checkbox.type = "checkbox";
            checkbox.name = "candidate[]";
            checkbox.value = String(candidate.id);
            const votingOpen = state.hasPrivacyConsent
                && candidate.canVote
                && state.voteStatus?.status === "active"
                && !cooldownIsActive();
            const selected = state.selectedCandidates.some((record) => record.id === candidate.id);
            checkbox.disabled = !votingOpen || (!selected && state.selectedCandidates.length >= state.selectionCount);
            checkbox.checked = selected;
            checkbox.addEventListener("change", () => toggleCandidate(candidate, checkbox.checked));
            const image = portrait(candidate);
            const body = document.createElement("div");
            body.className = "candidate-card__body";
            const category = document.createElement("p");
            category.className = "candidate-card__cat";
            category.textContent = candidate.category_title;
            const name = document.createElement("h3");
            name.textContent = candidate.full_name;
            const years = document.createElement("p");
            years.className = "candidate-card__years";
            years.textContent = candidate.life_years || "";
            const region = document.createElement("p");
            region.className = "candidate-card__region";
            region.textContent = candidate.region_connection || "";
            const choose = document.createElement("span");
            choose.className = "candidate-card__choose";
            choose.textContent = cooldownIsActive()
                ? "Голос уже отдан"
                : (votingOpen ? "Добавить в мой выбор" : "Кандидат голосования");
            body.append(name);
            if (years.textContent) body.append(years);
            if (category.textContent) body.append(category);
            if (region.textContent) body.append(region);
            body.append(choose);
            label.append(checkbox, image, body);

            const more = document.createElement("button");
            more.type = "button";
            more.className = "candidate-card__more";
            more.textContent = "История и вклад";
            more.setAttribute("aria-label", `История и вклад: ${candidate.full_name}`);
            more.addEventListener("click", () => openModal(candidate));
            card.append(label, more);
            grid.append(card);
        });
        updateCandidateControls();
    };

    const toggleCandidate = (candidate, shouldSelect) => {
        const alreadySelected = state.selectedCandidates.some((record) => record.id === candidate.id);
        if (shouldSelect && !alreadySelected && state.selectedCandidates.length < state.selectionCount) {
            state.selectedCandidates.push(candidate);
        } else if (!shouldSelect && alreadySelected) {
            state.selectedCandidates = state.selectedCandidates.filter((record) => record.id !== candidate.id);
        }
        renderSelectionSummary();
        updateCandidateControls();
    };

    const updateCandidateControls = () => {
        const votingOpen = state.hasPrivacyConsent
            && state.voteStatus?.status === "active"
            && !cooldownIsActive();
        const limitReached = state.selectedCandidates.length >= state.selectionCount;
        document.querySelectorAll('#candidateGrid input[name="candidate[]"]').forEach((checkbox) => {
            const candidateId = Number(checkbox.value);
            const candidate = state.candidates.find((record) => record.id === candidateId);
            if (!candidate) return;
            const selected = state.selectedCandidates.some((record) => record.id === candidateId);
            const available = votingOpen && candidate.canVote;
            checkbox.checked = selected;
            checkbox.disabled = !available || (!selected && limitReached);

            const label = checkbox.closest(".candidate-card__select");
            const choose = label?.querySelector(".candidate-card__choose");
            if (label) {
                label.setAttribute(
                    "aria-label",
                    selected
                        ? `Убрать из моего выбора: ${candidate.full_name}`
                        : `Добавить в мой выбор: ${candidate.full_name}`
                );
            }
            if (choose) {
                choose.textContent = cooldownIsActive()
                    ? "Бюллетень уже отправлен"
                    : !available
                        ? "Кандидат голосования"
                        : selected
                            ? "В выборе — нажмите, чтобы убрать"
                            : limitReached
                                ? "Сначала уберите выбранного кандидата"
                                : "Добавить в мой выбор";
            }
        });
        updateVoteButton();
    };

    const renderSelectionSummary = () => {
        const list = $("#selectedCandidates");
        const reset = $("#resetSelectedCandidates");
        empty(list);
        setText("#selectedCount", state.selectedCandidates.length);
        if (reset) reset.hidden = state.selectedCandidates.length === 0;
        if (!state.selectedCandidates.length) {
            const placeholder = document.createElement("li");
            placeholder.className = "is-placeholder";
            placeholder.textContent = "Выберите одного кандидата";
            list.append(placeholder);
        } else {
            state.selectedCandidates.forEach((candidate) => {
                const item = document.createElement("li");
                item.textContent = candidate.full_name;
                list.append(item);
            });
        }
        $("#votePanel")?.classList.toggle("has-selection", state.selectedCandidates.length > 0);
        $("#voteForm")?.classList.toggle("has-selection", state.selectedCandidates.length > 0);
        updateMobileVoteIndicator();
        setText(
            "#voteRules",
            state.selectedCandidates.length === state.selectionCount
                ? "Кандидат выбран. Перейдите к подтверждению бюллетеня."
                : "Выберите одного кандидата."
        );
        updateVoteButton();
    };

    const updateMobileVoteIndicator = () => {
        const indicator = $("#mobileVoteIndicator");
        const panel = $("#votePanel");
        if (!indicator || !panel) return;

        const selected = state.selectedCandidates.length;
        const panelRect = panel.getBoundingClientRect();
        const panelIsVisible = panelRect.bottom > 0 && panelRect.top < window.innerHeight;
        const isMobile = window.matchMedia("(max-width: 860px)").matches;
        const shouldShow = isMobile && selected > 0 && !panelIsVisible && !cooldownIsActive();
        const remaining = Math.max(0, state.selectionCount - selected);

        setText("#mobileSelectedCount", selected);
        setText(
            "#mobileVoteIndicatorHint",
            remaining === 0 ? "Перейти к голосованию" : `Осталось выбрать ${remaining}`
        );
        indicator.classList.toggle("is-visible", shouldShow);
        indicator.classList.toggle("is-complete", selected === state.selectionCount);
        indicator.setAttribute("aria-hidden", shouldShow ? "false" : "true");
        indicator.setAttribute(
            "aria-label",
            selected === state.selectionCount
                ? "Кандидат выбран. Перейти к голосованию"
                : `Выбрано ${selected} из ${state.selectionCount}. Осталось выбрать ${remaining}`
        );
        indicator.tabIndex = shouldShow ? 0 : -1;
    };

    const setupMobileVoteIndicator = () => {
        const indicator = $("#mobileVoteIndicator");
        const panel = $("#votePanel");
        if (!indicator || !panel) return;

        indicator.addEventListener("click", () => {
            panel.scrollIntoView({
                behavior: document.hidden || window.matchMedia("(prefers-reduced-motion: reduce)").matches
                    ? "auto"
                    : "smooth",
                block: "center",
            });
        });

        if ("IntersectionObserver" in window) {
            const observer = new IntersectionObserver(updateMobileVoteIndicator, { threshold: [0, 0.05] });
            observer.observe(panel);
        } else {
            window.addEventListener("scroll", updateMobileVoteIndicator, { passive: true });
        }
        window.addEventListener("resize", updateMobileVoteIndicator, { passive: true });
        updateMobileVoteIndicator();
    };

    const cooldownRemaining = () => {
        const nextAllowedAt = state.voteStatus?.cooldown?.nextAllowedAt;
        if (!state.voteStatus?.cooldown?.active || !nextAllowedAt) return 0;
        const timestamp = Date.parse(nextAllowedAt);
        return Number.isFinite(timestamp)
            ? Math.max(0, timestamp - (Date.now() + state.serverOffset))
            : 0;
    };

    const cooldownIsActive = () => Boolean(
        state.voteStatus?.cooldown?.active
        && (state.voteStatus.cooldown.permanent || cooldownRemaining() > 0)
    );

    const plural = (value, one, few, many) => {
        const absolute = Math.abs(value) % 100;
        const last = absolute % 10;
        if (absolute > 10 && absolute < 20) return many;
        if (last === 1) return one;
        if (last >= 2 && last <= 4) return few;
        return many;
    };

    const formatCooldownDuration = (milliseconds) => {
        const totalMinutes = Math.max(1, Math.ceil(milliseconds / 60000));
        const hours = Math.floor(totalMinutes / 60);
        const minutes = totalMinutes % 60;
        const parts = [];
        if (hours > 0) {
            parts.push(`${hours} ${plural(hours, "час", "часа", "часов")}`);
        }
        if (minutes > 0) {
            parts.push(`${minutes} ${plural(minutes, "минуту", "минуты", "минут")}`);
        }
        return parts.join(" ");
    };

    const cooldownMessage = () => {
        if (state.voteStatus?.cooldown?.active && state.voteStatus.cooldown.permanent) {
            return "Ваш бюллетень уже принят. Повторное голосование не предусмотрено.";
        }
        const remaining = cooldownRemaining();
        return remaining > 0
            ? `Вы проголосовали, следующий голос вы сможете отдать через ${formatCooldownDuration(remaining)}`
            : "";
    };

    const renderCooldownStatus = () => {
        const message = cooldownMessage();
        const panel = $("#votePanel");
        const form = $("#voteForm");
        if (message) {
            state.selectedCandidates = [];
            setText("#selectedCount", String(state.selectionCount));
            empty($("#selectedCandidates"));
            const accepted = document.createElement("li");
            accepted.textContent = "Бюллетень уже принят";
            $("#selectedCandidates")?.append(accepted);
            setText("#voteRules", message);
            panel?.classList.remove("has-selection");
            panel?.classList.add("is-complete");
            form?.classList.remove("has-selection");
            updateMobileVoteIndicator();
            return;
        }

        panel?.classList.remove("is-complete");
        if (!state.selectedCandidates.length) {
            setText("#selectedCount", "0");
            setText("#voteRules", state.voteRulesText);
            panel?.classList.remove("has-selection");
            form?.classList.remove("has-selection");
        }
        updateMobileVoteIndicator();
    };

    const updateVoteButton = () => {
        const button = $("#voteButton");
        if (!button) return;
        const captchaConfigured = document.body.dataset.captchaEnabled !== "true"
            || Boolean(document.body.dataset.captchaKey);
        const status = state.voteStatus?.status;

        if (!status) {
            button.textContent = "Примите условия голосования";
            button.disabled = true;
            return;
        }
        if (status === "scheduled") {
            button.textContent = "Голосование не началось";
            button.disabled = true;
            return;
        }
        if (status === "finished") {
            button.textContent = "Голосование завершено";
            button.disabled = true;
            return;
        }
        if (status === "paused") {
            button.textContent = "Голосование приостановлено";
            button.disabled = true;
            return;
        }
        if (status === "maintenance") {
            button.textContent = "Техническое обслуживание";
            button.disabled = true;
            return;
        }
        if (!state.hasPrivacyConsent) {
            button.textContent = "Примите условия голосования";
            button.disabled = true;
            return;
        }
        const message = cooldownMessage();
        if (message) {
            button.textContent = message;
            button.disabled = true;
            return;
        }
        if (!captchaConfigured) {
            button.textContent = "Голосование временно недоступно";
            button.disabled = true;
            return;
        }

        const missing = Math.max(0, state.selectionCount - state.selectedCandidates.length);
        button.textContent = missing === 0 ? "Продолжить" : "Выберите кандидата";
        button.disabled = missing !== 0;
    };

    const renderStatus = (status) => {
        state.voteStatus = status;
        state.selectionCount = Math.max(1, Number(status.selectionCount || 1));
        state.serverOffset = Date.parse(status.serverTime) - Date.now();
        document.body.dataset.votingStatus = status.status;
        const labels = {
            scheduled: "Голосование не началось",
            active: "Голосование открыто",
            paused: "Голосование приостановлено",
            finished: "Голосование завершено",
            maintenance: "Техническое обслуживание",
        };
        const statusLabel = labels[status.status] || "Статус неизвестен";
        setText("#statusText", statusLabel);
        setText("#headerStatusText", statusLabel);
        setText("#heroStatusText", statusLabel);
        const countdownLabels = {
            scheduled: "До начала второго этапа:",
            active: "До конца второго этапа:",
            paused: "До конца периода голосования:",
            maintenance: "До конца периода голосования:",
            finished: "Голосование завершено",
        };
        const countdownLabel = countdownLabels[status.status] || "Период голосования:";
        setText("#countdownLabel", countdownLabel);
        setText("#heroTimerLabel", countdownLabel);
        setText("#finalTimerLabel", countdownLabel);
        $("#countdown")?.setAttribute("aria-label", countdownLabel.replace(/:$/, ""));
        $("#heroTimer")?.setAttribute("aria-label", countdownLabel.replace(/:$/, ""));
        $("#finalTimer")?.setAttribute("aria-label", countdownLabel.replace(/:$/, ""));

        const hidePreStageCountdown = status.status === "scheduled";
        ["#countdown", "#heroTimer", "#finalTimer"].forEach((selector) => {
            const timer = $(selector);
            if (timer) timer.hidden = hidePreStageCountdown;
        });

        const targetDate = status.status === "scheduled"
            ? status.votingStartAt
            : status.votingEndAt;
        const targetTimestamp = Date.parse(targetDate);
        if (Number.isFinite(targetTimestamp)) {
            const formattedTarget = new Intl.DateTimeFormat("ru-RU", {
                day: "numeric",
                month: "long",
                year: "numeric",
                hour: "2-digit",
                minute: "2-digit",
                timeZone: "Europe/Moscow",
            }).format(targetTimestamp);
            ["#heroTimerDate", "#finalTimerDate"].forEach((selector) => {
                const timerDate = $(selector);
                if (!timerDate) return;
                timerDate.dateTime = new Date(targetTimestamp).toISOString();
                timerDate.textContent = formattedTarget;
            });
        }
        document.querySelectorAll(".status-icon").forEach((icon) => {
            icon.classList.toggle("is-active", status.status === "active");
            icon.classList.toggle("is-closed", ["finished", "paused", "maintenance"].includes(status.status));
        });
        renderCooldownStatus();
        startCountdown();
        renderCandidates();
    };

    const startCountdown = () => {
        clearInterval(state.countdownTimer);
        let controlRefreshTick = 0;
        const tick = () => {
            if (!state.voteStatus) return;
            const previousStatus = state.voteStatus.status;
            refreshPublicVotingStatus();
            if (state.voteStatus.status !== previousStatus) return;
            const now = Date.now() + state.serverOffset;
            const end = Date.parse(state.voteStatus.votingEndAt);
            const start = Date.parse(state.voteStatus.votingStartAt);
            const target = state.voteStatus.status === "scheduled" ? start : end;
            let difference = state.voteStatus.status === "finished"
                ? 0
                : Math.max(0, target - now);
            const days = Math.floor(difference / 86400000);
            difference -= days * 86400000;
            const hours = Math.floor(difference / 3600000);
            difference -= hours * 3600000;
            const minutes = Math.floor(difference / 60000);
            difference -= minutes * 60000;
            const seconds = Math.floor(difference / 1000);
            setText("#countDays", days);
            setText("#countHours", hours);
            setText("#countMinutes", minutes);
            setText("#heroCountDays", days);
            setText("#heroCountHours", String(hours).padStart(2, "0"));
            setText("#heroCountMinutes", String(minutes).padStart(2, "0"));
            setText("#heroCountSeconds", String(seconds).padStart(2, "0"));
            setText("#finalCountDays", days);
            setText("#finalCountHours", String(hours).padStart(2, "0"));
            setText("#finalCountMinutes", String(minutes).padStart(2, "0"));
            setText("#finalCountSeconds", String(seconds).padStart(2, "0"));
            if (controlRefreshTick % 30 === 0) {
                renderCooldownStatus();
                updateCandidateControls();
            }
            controlRefreshTick += 1;
        };
        tick();
        state.countdownTimer = window.setInterval(tick, 1000);
    };

    const refreshVotingStatus = async () => {
        try {
            const nextStatus = await api("/api/vote-status.php");
            state.statusUpdatedAt = Date.now();
            const previousStatus = state.voteStatus?.status;
            if (
                !state.voteStatus
                || nextStatus.status !== previousStatus
                || nextStatus.votingStartAt !== state.voteStatus.votingStartAt
                || nextStatus.votingEndAt !== state.voteStatus.votingEndAt
                || nextStatus.cooldown?.active !== state.voteStatus.cooldown?.active
                || nextStatus.cooldown?.nextAllowedAt !== state.voteStatus.cooldown?.nextAllowedAt
            ) {
                renderStatus(nextStatus);
                return;
            }
            state.voteStatus = nextStatus;
            state.serverOffset = Date.parse(nextStatus.serverTime) - Date.now();
        } catch {
            // Сохраняем последнее известное состояние и повторяем проверку по таймеру.
        }
    };

    const publicVotingStatus = () => ({
        status: document.body.dataset.votingStatus || "scheduled",
        serverTime: document.body.dataset.votingServerTime || new Date().toISOString(),
        votingStartAt: document.body.dataset.votingStartAt || new Date().toISOString(),
        votingEndAt: document.body.dataset.votingEndAt || new Date().toISOString(),
        nonce: null,
        cooldownHours: 24,
        cooldown: {
            active: false,
            hours: 24,
            lastVotedAt: null,
            nextAllowedAt: null,
            remainingSeconds: 0,
        },
        captcha: {
            enabled: document.body.dataset.captchaEnabled === "true",
            clientKey: document.body.dataset.captchaKey || "",
        },
    });

    const refreshPublicVotingStatus = () => {
        if (!state.voteStatus || document.body.dataset.votingMode !== "automatic") return;
        const now = Date.now() + state.serverOffset;
        const start = Date.parse(state.voteStatus.votingStartAt);
        const end = Date.parse(state.voteStatus.votingEndAt);
        const nextStatus = now < start ? "scheduled" : (now > end ? "finished" : "active");
        if (nextStatus !== state.voteStatus.status) {
            renderStatus({
                ...state.voteStatus,
                status: nextStatus,
                serverTime: new Date(now).toISOString(),
            });
        }
    };

    const renderResults = (results) => {
        const grid = $("#leaderGrid");
        const status = $("#resultsStatus");
        empty(grid);
        if (results.mode === "hidden") {
            const item = document.createElement("li");
            item.className = "empty-state";
            item.textContent = "Оргкомитет решил пока не показывать текущие результаты.";
            grid.append(item);
            if (status) {
                status.textContent = "Текущие результаты скрыты до установленного этапа.";
            }
            return;
        }
        if (!results.leaders.length) {
            const item = document.createElement("li");
            item.className = "empty-state";
            item.textContent = "Первые лидеры появятся после начала голосования.";
            grid.append(item);
            if (status) {
                status.textContent = "Первые лидеры появятся после начала голосования.";
            }
            return;
        }
        if (status) {
            status.textContent = results.finalistsStatus === "final"
                ? "Второй онлайн-этап завершён, итоговый рейтинг сформирован."
                : "Показаны текущие результаты второго этапа; они обновляются по мере поступления голосов.";
        }
        results.leaders.forEach((leader, index) => {
            const item = document.createElement("li");
            item.className = "leader-card";
            const rank = document.createElement("span");
            rank.className = "leader-card__rank";
            // Public numbering is sequential; the API keeps the official tie-aware rank.
            rank.textContent = String(index + 1);
            const image = portrait(leader);
            const name = document.createElement("h3");
            name.textContent = leader.full_name;
            const category = document.createElement("p");
            category.textContent = leader.category_title;
            item.append(rank, image, name, category);
            if (Object.hasOwn(leader, "vote_count")) {
                const votes = document.createElement("p");
                const number = document.createElement("b");
                number.textContent = String(leader.vote_count);
                votes.append(number, document.createTextNode(" голосов"));
                item.append(votes);
            }
            grid.append(item);
        });
    };

    const refreshResults = async () => {
        try {
            renderResults(await api("/api/results.php"));
            state.resultsLoaded = true;
            state.resultsUpdatedAt = Date.now();
        } catch {
            if (!state.resultsLoaded) {
                const grid = $("#leaderGrid");
                empty(grid);
                const item = document.createElement("li");
                item.className = "empty-state";
                item.textContent = "Не удалось обновить результаты. Повторим автоматически.";
                grid.append(item);
            }
        }
    };

    const clearPublicPollingTimers = () => {
        window.clearTimeout(state.statusTimer);
        window.clearTimeout(state.resultsTimer);
        state.statusTimer = null;
        state.resultsTimer = null;
    };

    const canPoll = () => !document.hidden && navigator.onLine !== false;

    const scheduleStatusPoll = (delay = STATUS_POLL_INTERVAL) => {
        window.clearTimeout(state.statusTimer);
        state.statusTimer = null;
        if (!state.hasPrivacyConsent || !canPoll()) return;
        state.statusTimer = window.setTimeout(async () => {
            await refreshVotingStatus();
            scheduleStatusPoll();
        }, Math.max(0, delay));
    };

    const scheduleResultsPoll = (delay = RESULTS_POLL_INTERVAL) => {
        window.clearTimeout(state.resultsTimer);
        state.resultsTimer = null;
        if (!state.resultsVisible || !canPoll()) return;
        state.resultsTimer = window.setTimeout(async () => {
            await refreshResults();
            scheduleResultsPoll();
        }, Math.max(0, delay));
    };

    const resumePublicPolling = () => {
        if (!canPoll()) return;
        if (state.hasPrivacyConsent) {
            const statusAge = Date.now() - state.statusUpdatedAt;
            scheduleStatusPoll(statusAge >= STATUS_POLL_INTERVAL ? 0 : STATUS_POLL_INTERVAL - statusAge);
        }
        if (state.resultsVisible) {
            const resultsAge = Date.now() - state.resultsUpdatedAt;
            scheduleResultsPoll(
                !state.resultsLoaded || resultsAge >= RESULTS_POLL_INTERVAL
                    ? 0
                    : RESULTS_POLL_INTERVAL - resultsAge
            );
        }
    };

    const setupPublicPolling = () => {
        const resultsSection = $("#results");
        if (resultsSection && "IntersectionObserver" in window) {
            const observer = new IntersectionObserver((entries) => {
                const entry = entries.find((item) => item.target === resultsSection);
                if (!entry) return;
                state.resultsVisible = entry.isIntersecting;
                if (state.resultsVisible) {
                    resumePublicPolling();
                } else {
                    window.clearTimeout(state.resultsTimer);
                    state.resultsTimer = null;
                }
            }, { rootMargin: "400px 0px", threshold: 0 });
            observer.observe(resultsSection);
        } else if (resultsSection) {
            state.resultsVisible = true;
        }

        document.addEventListener("visibilitychange", () => {
            if (document.hidden) {
                clearPublicPollingTimers();
            } else {
                resumePublicPolling();
            }
        });
        window.addEventListener("online", resumePublicPolling);
        window.addEventListener("offline", clearPublicPollingTimers);
        resumePublicPolling();
    };

    const lockPageScroll = () => {
        if (document.body.classList.contains("modal-open")) return;
        state.modalScrollY = Math.max(0, window.scrollY || window.pageYOffset || 0);
        const scrollbarWidth = Math.max(0, window.innerWidth - document.documentElement.clientWidth);
        document.documentElement.style.setProperty("--modal-scrollbar-width", `${scrollbarWidth}px`);
        document.body.style.top = `-${state.modalScrollY}px`;
        document.documentElement.classList.add("modal-open");
        document.body.classList.add("modal-open");
    };

    const unlockPageScroll = () => {
        if (!document.body.classList.contains("modal-open")) return;
        const scrollY = state.modalScrollY;
        const previousScrollBehavior = document.documentElement.style.scrollBehavior;
        document.documentElement.classList.remove("modal-open");
        document.body.classList.remove("modal-open");
        document.body.style.removeProperty("top");
        document.documentElement.style.removeProperty("--modal-scrollbar-width");
        document.documentElement.style.scrollBehavior = "auto";
        window.scrollTo(0, scrollY);
        document.documentElement.style.scrollBehavior = previousScrollBehavior;
        state.modalScrollY = 0;
    };

    const openModal = (record) => {
        state.lastFocused = document.activeElement;
        const modal = $("#detailModal");
        const modalPortrait = $("#modalPortrait");
        empty(modalPortrait);
        const builtPortrait = portrait(record, "portrait portrait--modal");
        while (builtPortrait.firstChild) {
            modalPortrait.append(builtPortrait.firstChild);
        }
        if (!record.image_path) {
            modalPortrait.textContent = initials(record.full_name);
        }
        setText("#modalTitle", record.full_name);
        setText("#modalYears", record.life_years || "");
        modalField("#modalBioSection", "#modalBio", record.biography);
        modalField("#modalRegionSection", "#modalRegion", record.region_connection);
        modalField("#modalContributionSection", "#modalContribution", record.contribution || record.short_description);

        const sourceSection = $("#modalSourcesSection");
        const sourceList = $("#modalSources");
        empty(sourceList);
        const sources = Array.isArray(record.sources) ? record.sources : [];
        sourceSection.hidden = sources.length === 0;
        sources.forEach((source) => {
            const item = document.createElement("li");
            if (typeof source === "object" && source?.url) {
                const link = document.createElement("a");
                link.href = source.url;
                link.rel = "noopener noreferrer";
                link.target = "_blank";
                link.textContent = source.title || source.url;
                item.append(link);
            } else {
                item.textContent = String(source);
            }
            sourceList.append(item);
        });

        modal.hidden = false;
        lockPageScroll();
        $(".modal__close", modal)?.focus();
    };

    const modalField = (sectionSelector, valueSelector, value) => {
        const section = $(sectionSelector);
        const element = $(valueSelector);
        const text = cleanPublicText(value);
        section.hidden = !text;
        element.textContent = text;
    };

    const activeModal = () => document.querySelector(".modal:not([hidden])");

    const closeModalImmediately = (modal = activeModal(), restoreFocus = true) => {
        if (!modal) return;
        modal.hidden = true;
        modal.classList.remove("is-confirming-exit");
        const modalTitles = {
            voteModal: "voteModalTitle",
            ageGateModal: "ageGateTitle",
            detailModal: "modalTitle",
        };
        $(".modal__dialog", modal)?.setAttribute("aria-labelledby", modalTitles[modal.id] || "modalTitle");
        const exit = $("#voteExitConfirm", modal);
        if (exit) exit.hidden = true;
        unlockPageScroll();
        updateCandidateControls();
        if (restoreFocus) state.lastFocused?.focus?.();
    };

    const voteExitConfirmationVisible = () => $("#voteExitConfirm")?.hidden === false;

    const showVoteExitConfirmation = () => {
        const modal = $("#voteModal");
        const exit = $("#voteExitConfirm");
        if (!modal || !exit || voteExitConfirmationVisible()) return;
        modal.classList.add("is-confirming-exit");
        $(".modal__dialog", modal)?.setAttribute("aria-labelledby", "voteExitTitle");
        exit.hidden = false;
        exit.focus();
        $("#voteExitContinue")?.focus();
    };

    const hideVoteExitConfirmation = (restoreFormFocus = true) => {
        const modal = $("#voteModal");
        const exit = $("#voteExitConfirm");
        if (!modal || !exit) return;
        modal.classList.remove("is-confirming-exit");
        $(".modal__dialog", modal)?.setAttribute("aria-labelledby", "voteModalTitle");
        exit.hidden = true;
        if (restoreFormFocus) {
            const firstField = $("#voteConfirmForm input:not([type=\"hidden\"]), #voteConfirmForm textarea");
            firstField?.focus();
        }
    };

    const requestModalClose = () => {
        const modal = activeModal();
        if (!modal) return;
        if (modal.id === "ageGateModal") {
            clearAgeConfirmation();
            closeModalImmediately(modal);
            return;
        }
        if (modal.id !== "voteModal" || $("#voteSuccess")?.hidden === false) {
            closeModalImmediately(modal);
            return;
        }
        if (state.voteSubmitting) {
            const result = $("#voteSubmitResult");
            result.textContent = "Бюллетень отправляется. Дождитесь результата, не закрывая форму.";
            result.className = "vote-confirm__result form-result";
            result.focus?.();
            return;
        }
        if (!voteExitConfirmationVisible()) showVoteExitConfirmation();
    };

    const trapModalFocus = (event) => {
        const modal = activeModal();
        if (!modal || event.key !== "Tab") return;
        const focusable = [...modal.querySelectorAll(
            'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )].filter((element) => !element.hidden && element.offsetParent !== null);
        if (!focusable.length) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
        }
    };

    const fingerprint = async () => {
        const values = {
            userAgent: navigator.userAgent,
            platform: navigator.userAgentData?.platform || navigator.platform || "",
            languages: navigator.languages || [navigator.language],
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "",
            screen: [screen.width, screen.height, screen.colorDepth],
            hardwareConcurrency: navigator.hardwareConcurrency || 0,
            deviceMemory: navigator.deviceMemory || 0,
            touchPoints: navigator.maxTouchPoints || 0,
        };
        const bytes = new TextEncoder().encode(JSON.stringify(values));
        const digest = await crypto.subtle.digest("SHA-256", bytes);
        return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
    };

    const calculateDeclaredAge = (value) => {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))) return null;
        const [year, month, day] = value.split("-").map(Number);
        const birth = new Date(year, month - 1, day);
        if (
            birth.getFullYear() !== year
            || birth.getMonth() !== month - 1
            || birth.getDate() !== day
        ) return null;
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        if (birth > today) return null;
        let age = today.getFullYear() - year;
        if (today.getMonth() < month - 1 || (today.getMonth() === month - 1 && today.getDate() < day)) {
            age -= 1;
        }
        return age;
    };

    const normalizeBirthDateInput = (value) => {
        const text = String(value || "").trim();
        if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
        const match = text.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
        return match ? `${match[3]}-${match[2]}-${match[1]}` : null;
    };

    const formatBirthDateForDisplay = (isoDate) => {
        const match = String(isoDate || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
        return match ? `${match[3]}.${match[2]}.${match[1]}` : "";
    };

    const clearAgeConfirmation = () => {
        state.birthDate = null;
        const form = $("#ageGateForm");
        form?.reset();
        if (form) form.hidden = false;
        const rejected = $("#ageGateRejected");
        if (rejected) rejected.hidden = true;
        const status = $("#ageGateStatus");
        if (status) {
            status.textContent = "";
            status.className = "form-result age-gate__status";
        }
    };

    const showAgeRejection = (message) => {
        resetVoteDraft();
        const voteModal = $("#voteModal");
        if (voteModal) voteModal.hidden = true;
        const ageModal = $("#ageGateModal");
        const form = $("#ageGateForm");
        const rejected = $("#ageGateRejected");
        if (!ageModal || !form || !rejected) return;
        ageModal.hidden = false;
        form.hidden = true;
        rejected.hidden = false;
        setText("#ageGateRejectedMessage", message);
        rejected.focus();
        $("button", rejected)?.focus();
    };

    const openAgeGate = (event) => {
        event.preventDefault();
        const result = $("#voteResult");
        if (state.selectedCandidates.length !== state.selectionCount) {
            result.textContent = "Выберите одного кандидата.";
            result.className = "form-result is-error";
            return;
        }
        result.textContent = "";
        result.className = "form-result";
        state.lastFocused = document.activeElement;
        clearAgeConfirmation();
        const input = $("#ageBirthDate");
        const picker = $("#ageBirthDatePicker");
        if (picker) picker.max = new Date().toLocaleDateString("sv-SE");
        const modal = $("#ageGateModal");
        modal.hidden = false;
        lockPageScroll();
        input?.focus();
    };

    const submitAgeGate = (event) => {
        event.preventDefault();
        const form = event.currentTarget;
        const input = $("#ageBirthDate");
        const status = $("#ageGateStatus");
        if (!form.reportValidity()) return;
        const birthDate = normalizeBirthDateInput(input?.value);
        const age = calculateDeclaredAge(birthDate);
        if (age === null || age > 120) {
            status.textContent = "Проверьте указанную дату рождения.";
            status.className = "form-result age-gate__status is-error";
            input?.focus();
            return;
        }
        if (age < 18) {
            showAgeRejection("Голосовать могут только участники, которым уже исполнилось 18 лет. Бюллетень и введённые данные сброшены.");
            return;
        }
        state.birthDate = birthDate;
        $("#ageGateModal").hidden = true;
        openVoteConfirmation({ pageAlreadyLocked: true });
    };

    const openVoteConfirmation = ({ pageAlreadyLocked = false } = {}) => {
        const list = $("#voteModalCandidates");
        empty(list);
        state.selectedCandidates.forEach((candidate) => {
            const item = document.createElement("li");
            item.textContent = candidate.full_name;
            list.append(item);
        });
        $("#voteConfirmForm").hidden = false;
        $("#voteSuccess").hidden = true;
        const modal = $("#voteModal");
        modal.hidden = false;
        if (!pageAlreadyLocked) lockPageScroll();
        $(".modal__close", modal)?.focus();
        updateEmailVerificationUi();
        updateCandidateControls();
    };

    const resetSmartCaptcha = () => {
        const form = $("#voteConfirmForm");
        const token = form ? $('input[name="smart-token"]', form) : null;
        if (token) token.value = "";
        if (!state.voteStatus?.captcha?.enabled) return;
        try {
            window.smartCaptcha?.reset();
        } catch {
            // Если внешний виджет ещё не загрузился, пустой токен всё равно
            // не позволит повторно отправить уже использованное значение.
        }
    };

    const submitVote = async (event) => {
        event.preventDefault();
        const result = $("#voteSubmitResult");
        const button = $("#voteSubmitButton");
        if (state.selectedCandidates.length !== state.selectionCount) {
            result.textContent = "Бюллетень изменился. Вернитесь к выбору и отметьте одного кандидата.";
            result.className = "vote-confirm__result form-result is-error";
            return;
        }
        if (!state.birthDate) {
            result.textContent = "Сначала подтвердите, что вам исполнилось 18 лет.";
            result.className = "vote-confirm__result form-result is-error";
            return;
        }
        const form = event.currentTarget;
        validateContactInputs();
        if (!form.reportValidity()) return;
        const email = normalizedEmail($("#voteField-email")?.value);
        if (
            !state.emailVerification.token
            || state.emailVerification.email !== email
        ) {
            result.textContent = "Сначала подтвердите электронную почту кодом из письма.";
            result.className = "vote-confirm__result form-result is-error";
            return;
        }
        button.disabled = true;
        button.textContent = "Подготавливаем отправку…";
        result.textContent = "";
        result.className = "vote-confirm__result form-result";
        state.voteSubmitting = true;
        try {
            const issued = await api("/api/vote-nonce.php", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({}),
            });
            state.voteNonce = issued.nonce;
            button.textContent = "Отправляем…";
            const formData = new FormData(form);
            const contact = {};
            formData.forEach((value, key) => {
                if (key !== "personalDataConsent" && key !== "smart-token") {
                    contact[key] = String(value);
                }
            });
            const response = await api("/api/vote.php", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    candidateIds: state.selectedCandidates.map((candidate) => candidate.id),
                    birthDate: state.birthDate,
                    contact,
                    personalDataConsent: $("#personalDataConsent")?.checked === true,
                    nonce: state.voteNonce,
                    fingerprint: await fingerprint(),
                    emailVerificationToken: state.emailVerification.token,
                }),
            });
            form.hidden = true;
            const success = $("#voteSuccess");
            success.hidden = false;
            setText("#voteSuccessMessage", response.message || "Ваш бюллетень принят. Спасибо за участие!");
            const details = [];
            if (response.email?.reply === "sent") {
                details.push("Подтверждение отправлено на вашу электронную почту.");
            } else if (response.email?.reply === "failed") {
                details.push("Бюллетень принят, но письмо-подтверждение отправить не удалось.");
            }
            if (response.email?.feedbackSaved) {
                details.push("Ваше сообщение сохранено для редакции.");
            }
            setText("#voteSuccessDetails", details.join(" "));
            success.focus();
            state.voteStatus = {
                ...state.voteStatus,
                cooldownHours: response.cooldownHours,
                cooldown: {
                    active: true,
                    permanent: !response.repeatAllowed,
                    hours: response.cooldownHours,
                    lastVotedAt: response.acceptedAt,
                    nextAllowedAt: response.nextAllowedAt,
                    remainingSeconds: response.nextAllowedAt
                        ? Math.max(0, Math.ceil((Date.parse(response.nextAllowedAt) - (Date.now() + state.serverOffset)) / 1000))
                        : null,
                },
            };
            state.voteNonce = null;
            state.birthDate = null;
            const ageForm = $("#ageGateForm");
            ageForm?.reset();
            resetEmailVerification({ clearPending: true });
            renderStatus(state.voteStatus);
            await refreshResults();
        } catch (error) {
            state.voteNonce = null;
            if (error.code === "AGE_RESTRICTED") {
                showAgeRejection(error.message);
                return;
            }
            result.textContent = `Бюллетень не отправлен: ${error.message}`;
            result.className = "vote-confirm__result form-result is-error";
            button.textContent = "Проголосовать!";
            button.disabled = !state.emailVerification.token;
            try {
                const refreshed = await api("/api/vote-status.php");
                renderStatus(refreshed);
            } catch {
                result.textContent += " Статус сервиса также не удалось обновить.";
            }
        } finally {
            state.voteSubmitting = false;
        }
    };

    const pendingEmailDigest = async (email) => {
        if (!globalThis.crypto?.subtle || typeof TextEncoder === "undefined") return "";
        const bytes = new TextEncoder().encode(normalizedEmail(email));
        const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
        return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
    };

    const readPendingEmailVerification = () => {
        try {
            const pending = JSON.parse(localStorage.getItem(EMAIL_VERIFICATION_STORAGE_KEY) || "null");
            if (
                !pending
                || !/^[a-f0-9]{64}$/.test(String(pending.challenge || ""))
                || !/^[a-f0-9]{64}$/.test(String(pending.emailDigest || ""))
                || Number(pending.expiresAt || 0) <= Date.now()
            ) {
                localStorage.removeItem(EMAIL_VERIFICATION_STORAGE_KEY);
                return null;
            }
            return pending;
        } catch {
            return null;
        }
    };

    const clearPendingEmailVerification = (challenge = "") => {
        try {
            const pending = readPendingEmailVerification();
            if (!challenge || !pending || pending.challenge === challenge) {
                localStorage.removeItem(EMAIL_VERIFICATION_STORAGE_KEY);
            }
        } catch {
            // Ограничения приватного режима не должны ломать форму.
        }
    };

    const rememberPendingEmailVerification = async ({ challenge, email, maskedEmail, expiresIn }) => {
        try {
            const emailDigest = await pendingEmailDigest(email);
            if (!emailDigest || state.emailVerification.challenge !== challenge) return;
            localStorage.setItem(EMAIL_VERIFICATION_STORAGE_KEY, JSON.stringify({
                challenge,
                emailDigest,
                maskedEmail: String(maskedEmail || ""),
                expiresAt: Date.now() + Math.max(60, Number(expiresIn || 600)) * 1000,
            }));
        } catch {
            // Локальное продолжение — удобство, а не условие отправки кода.
        }
    };

    const restorePendingEmailVerification = async (email) => {
        if (!email || state.emailVerification.challenge || state.emailVerification.token) return false;
        const pending = readPendingEmailVerification();
        if (!pending || await pendingEmailDigest(email) !== pending.emailDigest) return false;
        if (normalizedEmail($("#voteField-email")?.value) !== email) return false;
        state.emailVerification = {
            challenge: pending.challenge,
            token: null,
            email,
            deliveryStatus: "queued",
            maskedEmail: pending.maskedEmail,
            expiresAt: pending.expiresAt,
            retryUntil: 0,
            retryMessage: "",
        };
        setEmailRequestLoading(true);
        updateEmailVerificationUi();
        const status = $("#emailVerificationStatus");
        if (status) {
            status.textContent = "Продолжаем ранее созданный запрос. Новый код не отправляется.";
            status.className = "form-result";
        }
        void watchEmailDelivery(pending.challenge, pending.maskedEmail);
        return true;
    };

    const setEmailRetry = (seconds, message) => {
        window.clearInterval(emailRetryTimer);
        const safeSeconds = Math.max(1, Math.ceil(Number(seconds) || 0));
        state.emailVerification.retryUntil = Date.now() + safeSeconds * 1000;
        state.emailVerification.retryMessage = String(message || "Повторный запрос временно ограничен.");
        const tick = () => {
            if (state.emailVerification.retryUntil <= Date.now()) {
                window.clearInterval(emailRetryTimer);
                emailRetryTimer = 0;
                state.emailVerification.retryUntil = 0;
                state.emailVerification.retryMessage = "";
            }
            updateEmailVerificationUi();
        };
        tick();
        emailRetryTimer = window.setInterval(tick, 1000);
    };

    const resetEmailVerification = ({ clearPending = false } = {}) => {
        if (clearPending) clearPendingEmailVerification(state.emailVerification.challenge || "");
        window.clearInterval(emailRetryTimer);
        emailRetryTimer = 0;
        state.emailVerification = {
            challenge: null,
            token: null,
            email: "",
            deliveryStatus: null,
            maskedEmail: "",
            expiresAt: 0,
            retryUntil: 0,
            retryMessage: "",
        };
        const code = $("#emailVerificationCode");
        if (code) code.value = "";
        setEmailRequestLoading(false);
        updateEmailVerificationUi();
    };

    const collectVoteContact = () => {
        const form = $("#voteConfirmForm");
        const contact = {};
        if (!form) return contact;
        new FormData(form).forEach((value, key) => {
            if (key !== "personalDataConsent" && key !== "smart-token") {
                contact[key] = String(value);
            }
        });
        return contact;
    };

    const captchaToken = () => {
        const form = $("#voteConfirmForm");
        return form ? ($('input[name="smart-token"]', form)?.value || "") : "";
    };

    const emailRequestReady = () => {
        const form = $("#voteConfirmForm");
        if (!form || !state.birthDate) return false;
        validateContactInputs();
        const requiredReady = [...form.querySelectorAll("input[required], textarea[required], select[required]")]
            .every((control) => {
                if (control.type === "checkbox") return control.checked && control.validity.valid;
                return String(control.value || "").trim() !== "" && control.validity.valid;
            });
        const captchaReady = document.body.dataset.captchaEnabled !== "true" || captchaToken() !== "";
        return requiredReady && captchaReady;
    };

    const setEmailRequestLoading = (loading) => {
        const button = $("#emailVerificationRequest");
        if (!button) return;
        button.classList.toggle("is-loading", loading);
        if (loading) {
            button.setAttribute("aria-busy", "true");
        } else {
            button.removeAttribute("aria-busy");
        }
    };

    const resetVoteDraft = ({ announce = false } = {}) => {
        state.selectedCandidates = [];
        clearAgeConfirmation();
        state.voteNonce = null;
        const form = $("#voteConfirmForm");
        form?.reset();
        if (form) form.hidden = false;
        const success = $("#voteSuccess");
        if (success) success.hidden = true;
        setText("#messageCount", "0");
        const submitResult = $("#voteSubmitResult");
        if (submitResult) {
            submitResult.textContent = "";
            submitResult.className = "vote-confirm__result form-result";
        }
        const submitButton = $("#voteSubmitButton");
        if (submitButton) submitButton.textContent = "Проголосовать!";
        resetSmartCaptcha();
        resetEmailVerification();
        renderSelectionSummary();
        updateCandidateControls();
        if (announce) {
            const result = $("#voteResult");
            result.textContent = "Список выбранных кандидатов очищен.";
            result.className = "form-result";
        }
    };

    const updateEmailVerificationUi = () => {
        const status = $("#emailVerificationStatus");
        const confirm = $("#emailVerificationConfirm");
        const submit = $("#voteSubmitButton");
        const request = $("#emailVerificationRequest");
        if (!status || !confirm || !submit || !request) return;
        const retrySeconds = Math.max(0, Math.ceil((state.emailVerification.retryUntil - Date.now()) / 1000));
        confirm.hidden = !state.emailVerification.challenge || Boolean(state.emailVerification.token);
        if (state.emailVerification.token) {
            status.textContent = "Электронная почта подтверждена.";
            status.className = "form-result is-success";
        } else if (retrySeconds > 0) {
            const minutes = Math.floor(retrySeconds / 60);
            const seconds = String(retrySeconds % 60).padStart(2, "0");
            status.textContent = `${state.emailVerification.retryMessage} Новый код можно запросить через ${minutes}:${seconds}.`;
            status.className = "form-result is-error";
        } else if (!state.emailVerification.challenge) {
            status.textContent = emailRequestReady()
                ? "Все обязательные данные заполнены. Теперь можно запросить код."
                : "Заполните обязательные поля, примите согласие и пройдите CAPTCHA.";
            status.className = "form-result";
        }
        request.disabled = Boolean(state.emailVerification.challenge)
            || Boolean(state.emailVerification.token)
            || emailRequestInFlight
            || retrySeconds > 0
            || !emailRequestReady();
        submit.disabled = !state.emailVerification.token;
    };

    const watchEmailDelivery = async (challenge, maskedEmail) => {
        const status = $("#emailVerificationStatus");
        // Минутный cron может забрать письмо почти через 60 секунд; оставляем
        // дополнительное время на SMTP и обновление статуса доставки.
        for (let attempt = 0; attempt < 45; attempt += 1) {
            if (state.emailVerification.challenge !== challenge || state.emailVerification.token) return;
            if (attempt > 0) {
                await new Promise((resolve) => window.setTimeout(resolve, 2000));
            }
            try {
                const delivery = await api("/api/email-verification-status.php", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ challenge }),
                });
                if (state.emailVerification.challenge !== challenge) return;
                state.emailVerification.deliveryStatus = delivery.status;
                if (delivery.status === "sent") {
                    setEmailRequestLoading(false);
                    status.textContent = `Код отправлен на ${maskedEmail}. Проверьте также папку «Спам».`;
                    status.className = "form-result is-success";
                    $("#emailVerificationCode")?.focus();
                    return;
                }
                if (delivery.status === "failed" || delivery.status === "expired") {
                    setEmailRequestLoading(false);
                    resetSmartCaptcha();
                    clearPendingEmailVerification(challenge);
                    state.emailVerification.challenge = null;
                    updateEmailVerificationUi();
                    status.textContent = delivery.message;
                    status.className = "form-result is-error";
                    return;
                }
                status.textContent = delivery.message;
                status.className = "form-result";
            } catch (error) {
                if (error.code === "CODE_EXPIRED") {
                    setEmailRequestLoading(false);
                    resetSmartCaptcha();
                    clearPendingEmailVerification(challenge);
                    state.emailVerification.challenge = null;
                    state.emailVerification.deliveryStatus = "expired";
                    state.emailVerification.expiresAt = 0;
                    updateEmailVerificationUi();
                    status.textContent = error.message;
                    status.className = "form-result is-error";
                    return;
                }
                // Кратковременная ошибка проверки не отменяет уже поставленное в очередь письмо.
            }
        }
        if (state.emailVerification.challenge === challenge && !state.emailVerification.token) {
            setEmailRequestLoading(false);
            status.textContent = "Письмо ещё обрабатывается. Можно подождать или запросить новый код позднее.";
            status.className = "form-result";
        }
    };

    const requestEmailVerification = async () => {
        const emailInput = $("#voteField-email");
        const consent = $("#personalDataConsent");
        const button = $("#emailVerificationRequest");
        const status = $("#emailVerificationStatus");
        const form = $("#voteConfirmForm");
        const email = normalizedEmail(emailInput?.value);
        if (emailRequestInFlight) return;
        validateContactInputs({ show: true });
        if (!form?.reportValidity() || !email || !state.birthDate) return;
        emailRequestInFlight = true;
        button.disabled = true;
        setEmailRequestLoading(true);
        status.textContent = "Отправляем код…";
        status.className = "form-result";
        try {
            if (await restorePendingEmailVerification(email)) return;
            const currentCaptchaToken = captchaToken();
            if (!consent?.checked || (document.body.dataset.captchaEnabled === "true" && !currentCaptchaToken)) {
                status.textContent = "Заполните обязательные поля, примите согласие и пройдите CAPTCHA.";
                status.className = "form-result is-error";
                return;
            }
            const response = await api("/api/email-verification-request.php", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    contact: collectVoteContact(),
                    birthDate: state.birthDate,
                    personalDataConsent: true,
                    captchaToken: currentCaptchaToken,
                }),
            });
            state.emailVerification = {
                challenge: response.challenge,
                token: null,
                email,
                deliveryStatus: response.deliveryStatus,
                maskedEmail: response.maskedEmail,
                expiresAt: Date.now() + Number(response.expiresIn || 600) * 1000,
                retryUntil: 0,
                retryMessage: "",
            };
            void rememberPendingEmailVerification({
                challenge: response.challenge,
                email,
                maskedEmail: response.maskedEmail,
                expiresIn: response.expiresIn,
            });
            status.textContent = `Код для ${response.maskedEmail} поставлен в очередь отправки.`;
            status.className = "form-result";
            updateEmailVerificationUi();
            void watchEmailDelivery(response.challenge, response.maskedEmail);
        } catch (error) {
            setEmailRequestLoading(false);
            resetSmartCaptcha();
            state.emailVerification = {
                challenge: null,
                token: null,
                email: "",
                deliveryStatus: null,
                maskedEmail: "",
                expiresAt: 0,
                retryUntil: 0,
                retryMessage: "",
            };
            if (error.code === "RATE_LIMITED" && error.retryAfter > 0) {
                setEmailRetry(error.retryAfter, error.message);
            } else {
                updateEmailVerificationUi();
                status.textContent = error.message;
                status.className = "form-result is-error";
                if (error.details?.field === "email") {
                    renderFieldError(emailInput, error.message, true);
                    emailInput?.focus();
                }
            }
        } finally {
            emailRequestInFlight = false;
            if (status.classList.contains("is-error")) {
                button.disabled = true;
            } else {
                updateEmailVerificationUi();
            }
        }
    };

    const confirmEmailVerification = async () => {
        const codeInput = $("#emailVerificationCode");
        const button = $("#emailVerificationSubmit");
        const status = $("#emailVerificationStatus");
        const code = String(codeInput?.value || "").trim();
        if (!state.emailVerification.challenge || !/^\d{6}$/.test(code)) {
            status.textContent = "Введите шестизначный код из письма.";
            status.className = "form-result is-error";
            return;
        }
        button.disabled = true;
        status.textContent = "Проверяем код…";
        status.className = "form-result";
        try {
            const response = await api("/api/email-verification-confirm.php", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    challenge: state.emailVerification.challenge,
                    code,
                }),
            });
            clearPendingEmailVerification(state.emailVerification.challenge);
            state.emailVerification.token = response.verificationToken;
            setEmailRequestLoading(false);
            updateEmailVerificationUi();
        } catch (error) {
            if (["CODE_EXPIRED", "CODE_ALREADY_USED", "CODE_ATTEMPTS_EXCEEDED"].includes(error.code)) {
                clearPendingEmailVerification(state.emailVerification.challenge || "");
                resetSmartCaptcha();
                state.emailVerification.challenge = null;
                state.emailVerification.deliveryStatus = "expired";
                state.emailVerification.expiresAt = 0;
                setEmailRequestLoading(false);
                updateEmailVerificationUi();
            }
            status.textContent = error.message;
            status.className = "form-result is-error";
        } finally {
            button.disabled = false;
        }
    };

    const setupNavigation = () => {
        const toggle = $(".nav-toggle");
        const nav = $("#siteNav");
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
            if (event.target.closest("a")) {
                setOpen(false);
            }
        });
        document.addEventListener("keydown", (event) => {
            if (event.key === "Escape" && toggle.getAttribute("aria-expanded") === "true") {
                setOpen(false, true);
            }
        });
    };

    const setupHomeNews = () => {
        const button = document.querySelector("[data-news-expand]");
        if (!button) return;
        button.addEventListener("click", (event) => {
            if (button.getAttribute("aria-expanded") === "true") return;
            event.preventDefault();
            document.querySelectorAll(".news-grid--home .news-card--extra").forEach((card) => {
                card.hidden = false;
            });
            button.setAttribute("aria-expanded", "true");
            button.textContent = block("home_news").extra?.allButton || "Все новости";
        });
    };

    const setupPrivacyBanner = () => {
        const banner = $("#privacyBanner");
        const button = $("#privacyAccept");
        const status = $("#privacyBannerStatus");
        if (!banner || !button || !status) return;

        button.addEventListener("click", async () => {
            button.disabled = true;
            banner.setAttribute("aria-busy", "true");
            status.textContent = "Сохраняем ваше согласие…";

            try {
                const response = await fetch("/api/privacy-consent.php", {
                    method: "POST",
                    credentials: "same-origin",
                    headers: {
                        Accept: "application/json",
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify({ action: "accept" }),
                });
                const payload = await response.json().catch(() => null);
                if (!response.ok || !payload?.ok) {
                    throw new Error(payload?.error?.message || "Не удалось сохранить согласие.");
                }

                status.textContent = "Согласие сохранено. Подключаем голосование…";
                window.location.reload();
            } catch (error) {
                status.textContent = error.message;
                button.disabled = false;
                banner.removeAttribute("aria-busy");
            }
        });
    };

    const setupModal = () => {
        document.querySelectorAll("[data-close-modal]").forEach((button) => {
            button.addEventListener("click", requestModalClose);
        });
        document.addEventListener("keydown", (event) => {
            if (event.key === "Escape" && voteExitConfirmationVisible()) {
                hideVoteExitConfirmation();
            } else if (event.key === "Escape") {
                requestModalClose();
            }
            trapModalFocus(event);
        });
        $("#voteExitContinue")?.addEventListener("click", () => hideVoteExitConfirmation());
        $("#voteExitCancel")?.addEventListener("click", () => {
            hideVoteExitConfirmation(false);
            closeModalImmediately($("#voteModal"), false);
            resetVoteDraft({ announce: true });
            $("#candidateGrid input[name=\"candidate[]\"]:not([disabled])")?.focus();
        });
        $("#resetSelectedCandidates")?.addEventListener("click", () => resetVoteDraft({ announce: true }));
        $("#voteField-message")?.addEventListener("input", (event) => {
            setText("#messageCount", event.currentTarget.value.length);
        });
        $("#emailVerificationRequest")?.addEventListener("click", requestEmailVerification);
        $("#emailVerificationSubmit")?.addEventListener("click", confirmEmailVerification);
        $("#voteField-email")?.addEventListener("input", (event) => {
            validateEmailInput(event.currentTarget);
            const email = normalizedEmail(event.currentTarget.value);
            if (state.emailVerification.email && state.emailVerification.email !== email) {
                resetSmartCaptcha();
                resetEmailVerification();
            }
            updateEmailVerificationUi();
            if (event.currentTarget.checkValidity()) void restorePendingEmailVerification(email);
        });
        $("#voteField-email")?.addEventListener("blur", (event) => {
            validateEmailInput(event.currentTarget, { show: true });
            const email = normalizedEmail(event.currentTarget.value);
            if (event.currentTarget.checkValidity()) void restorePendingEmailVerification(email);
            updateEmailVerificationUi();
        });
        $("#voteField-phone")?.addEventListener("input", (event) => {
            validatePhoneInput(event.currentTarget);
            updateEmailVerificationUi();
        });
        $("#voteField-phone")?.addEventListener("blur", (event) => {
            const canonical = normalizeRussianPhone(event.currentTarget.value);
            if (canonical) event.currentTarget.value = formatRussianPhone(canonical);
            validatePhoneInput(event.currentTarget, { show: true });
            updateEmailVerificationUi();
        });
        $("#personalDataConsent")?.addEventListener("change", updateEmailVerificationUi);
        $("#voteConfirmForm")?.addEventListener("input", updateEmailVerificationUi);
        $("#voteConfirmForm")?.addEventListener("change", updateEmailVerificationUi);
        window.onVoteCaptchaSuccess = updateEmailVerificationUi;
        window.onVoteCaptchaExpired = updateEmailVerificationUi;
        $("#ageBirthDate")?.addEventListener("input", (event) => {
            const digits = String(event.currentTarget.value || "").replace(/\D/g, "").slice(0, 8);
            event.currentTarget.value = [digits.slice(0, 2), digits.slice(2, 4), digits.slice(4)]
                .filter(Boolean)
                .join(".");
        });
        $("#ageBirthDatePicker")?.addEventListener("change", (event) => {
            const input = $("#ageBirthDate");
            if (input) input.value = formatBirthDateForDisplay(event.currentTarget.value);
        });
        $("#ageGateForm")?.addEventListener("submit", submitAgeGate);
        updateEmailVerificationUi();
    };

    const setupReveals = () => {
        const nodes = document.querySelectorAll("[data-reveal]");
        if (window.matchMedia("(prefers-reduced-motion: reduce)").matches || !("IntersectionObserver" in window)) {
            nodes.forEach((node) => node.classList.add("is-visible"));
            return;
        }
        document.documentElement.classList.add("reveal-ready");
        const observer = new IntersectionObserver((entries) => {
            entries.forEach((entry) => {
                if (!entry.isIntersecting) return;
                entry.target.classList.add("is-visible");
                observer.unobserve(entry.target);
            });
        }, { rootMargin: "0px 0px -8% 0px", threshold: 0.08 });
        nodes.forEach((node) => observer.observe(node));
    };

    const showLoadingError = (message) => {
        ["#timeline", "#candidateGrid"].forEach((selector) => {
            const container = $(selector);
            if (!container) return;
            empty(container);
            const note = document.createElement("p");
            note.className = "empty-state";
            note.textContent = message;
            container.append(note);
        });
    };

    const init = async () => {
        try {
            setupNavigation();
            setupHomeNews();
            setupModal();
            setupPrivacyBanner();
            setupMobileVoteIndicator();
            $("#voteForm")?.addEventListener("submit", openAgeGate);
            $("#voteConfirmForm")?.addEventListener("submit", submitVote);

            const hasPrivacyConsent = document.body.dataset.privacyConsent === "true";
            state.hasPrivacyConsent = hasPrivacyConsent;
            const [site, candidates, status] = await Promise.all([
                api("/api/site.php?v=3"),
                api("/api/candidates.php"),
                hasPrivacyConsent ? api("/api/vote-status.php") : Promise.resolve(null),
            ]);
            site.blocks.forEach((item) => state.blocks.set(item.block_key, item));
            state.candidates = fairOrder(candidates.candidates);
            applyBlocks();
            renderRegionStats(site.regionStats);
            renderTimeline(site.timeline);
            if (status) {
                state.statusUpdatedAt = Date.now();
                renderStatus(status);
            } else {
                renderStatus(publicVotingStatus());
            }
            setText("#resultsStatus", "Результаты загрузятся при переходе к этому разделу.");
            setupReveals();
            setupPublicPolling();
        } catch (error) {
            showLoadingError("Не удалось загрузить данные. Попробуйте обновить страницу позже.");
            setText("#statusText", "Сервис временно недоступен");
            console.error("Application bootstrap failed", error);
        } finally {
            hideSitePreloader();
            restoreInitialHashPosition();
        }
    };

    init();
})();
