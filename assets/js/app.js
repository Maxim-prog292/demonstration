(() => {
    "use strict";

    const state = {
        blocks: new Map(),
        candidates: [],
        voteStatus: null,
        hasPrivacyConsent: false,
        selectedCandidates: [],
        voteNonce: null,
        emailVerification: {
            challenge: null,
            token: null,
            email: "",
            deliveryStatus: null,
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
            throw error;
        }
        return payload.data;
    };

    const DISALLOWED_EMAIL_DOMAINS = new Set(["gmail.com", "googlemail.com"]);
    const GOOGLE_EMAIL_MESSAGE = "Адреса Gmail и Google Mail не принимаются. Используйте электронную почту другого сервиса.";
    const PHONE_MESSAGE = "Укажите российский номер телефона в формате +7 (999) 123-45-67.";

    const normalizedEmail = (value) => String(value || "").trim().toLowerCase();

    const isDisallowedEmail = (value) => {
        const email = normalizedEmail(value);
        const separator = email.lastIndexOf("@");
        return separator >= 0 && DISALLOWED_EMAIL_DOMAINS.has(email.slice(separator + 1));
    };

    const validateEmailInput = (input) => {
        if (!input) return false;
        input.setCustomValidity(isDisallowedEmail(input.value) ? GOOGLE_EMAIL_MESSAGE : "");
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

    const validatePhoneInput = (input) => {
        if (!input) return true;
        const isEmptyOptional = !input.required && !String(input.value || "").trim();
        input.setCustomValidity(isEmptyOptional || normalizeRussianPhone(input.value) ? "" : PHONE_MESSAGE);
        return input.checkValidity();
    };

    const validateContactInputs = () => {
        const emailValid = validateEmailInput($("#voteField-email"));
        const phoneValid = validatePhoneInput($("#voteField-phone"));
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

    const applyBlocks = () => {
        document.querySelectorAll("[data-content-block][data-content-field]").forEach((element) => {
            const value = blockValue(block(element.dataset.contentBlock), element.dataset.contentField);
            if (value === null || value === undefined) return;
            const text = String(value);
            element.textContent = text;
            if (element.hasAttribute("data-content-hide-empty")) {
                element.hidden = text.trim() === "";
            }
        });

        state.voteRulesText = block("voting_intro").extra?.rules
            || "Изучите кандидатов и добавьте ровно пять человек в свой бюллетень.";
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
            if (record.source_text) {
                const source = document.createElement("small");
                source.textContent = record.source_text;
                item.append(source);
            }
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
            year.innerHTML = record.period_text;
            const title = document.createElement("h3");
            title.textContent = record.title;
            const description = document.createElement("p");
            description.innerHTML = record.description;
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
            checkbox.disabled = !votingOpen || (!selected && state.selectedCandidates.length >= 5);
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
        if (shouldSelect && !alreadySelected && state.selectedCandidates.length < 5) {
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
        const limitReached = state.selectedCandidates.length >= 5;
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
                                ? "Сначала уберите одного из пяти"
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
            placeholder.textContent = "Выберите пять кандидатов";
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
            state.selectedCandidates.length === 5
                ? "Пять кандидатов выбраны. Перейдите к подтверждению бюллетеня."
                : `Осталось выбрать ${5 - state.selectedCandidates.length}.`
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
        const remaining = Math.max(0, 5 - selected);

        setText("#mobileSelectedCount", selected);
        setText(
            "#mobileVoteIndicatorHint",
            remaining === 0 ? "Перейти к голосованию" : `Осталось выбрать ${remaining}`
        );
        indicator.classList.toggle("is-visible", shouldShow);
        indicator.classList.toggle("is-complete", selected === 5);
        indicator.setAttribute("aria-hidden", shouldShow ? "false" : "true");
        indicator.setAttribute(
            "aria-label",
            selected === 5
                ? "Выбрано пять из пяти. Перейти к голосованию"
                : `Выбрано ${selected} из пяти. Осталось выбрать ${remaining}`
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
            setText("#selectedCount", "5");
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

        const missing = Math.max(0, 5 - state.selectedCandidates.length);
        button.textContent = missing === 0 ? "Продолжить" : `Выберите ещё ${missing}`;
        button.disabled = missing !== 0;
    };

    const renderStatus = (status) => {
        state.voteStatus = status;
        state.serverOffset = Date.parse(status.serverTime) - Date.now();
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
            scheduled: "До начала голосования:",
            active: "До конца голосования:",
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
                ? "Онлайн-этап завершён, итоговая пятёрка сформирована."
                : "Показан предварительный рейтинг; итоговая пятёрка формируется после завершения голосования.";
        }
        results.leaders.forEach((leader) => {
            const item = document.createElement("li");
            item.className = "leader-card";
            const rank = document.createElement("span");
            rank.className = "leader-card__rank";
            rank.textContent = String(leader.rank);
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
        $(".modal__dialog", modal)?.setAttribute(
            "aria-labelledby",
            modal.id === "voteModal" ? "voteModalTitle" : "modalTitle"
        );
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

    const openVoteConfirmation = (event) => {
        event.preventDefault();
        const result = $("#voteResult");
        if (state.selectedCandidates.length !== 5) {
            result.textContent = "Выберите ровно пять кандидатов.";
            result.className = "form-result is-error";
            return;
        }
        result.textContent = "";
        result.className = "form-result";
        state.lastFocused = document.activeElement;
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
        lockPageScroll();
        $(".modal__close", modal)?.focus();
        updateEmailVerificationUi();
        updateCandidateControls();
    };

    const submitVote = async (event) => {
        event.preventDefault();
        const result = $("#voteSubmitResult");
        const button = $("#voteSubmitButton");
        if (state.selectedCandidates.length !== 5) {
            result.textContent = "Бюллетень изменился. Вернитесь к выбору и отметьте ровно пять кандидатов.";
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
        const captchaToken = $('input[name="smart-token"]', form)?.value || null;
        if (state.voteStatus.captcha?.enabled && !captchaToken) {
            result.textContent = "Подтвердите проверку CAPTCHA.";
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
                    contact,
                    personalDataConsent: $("#personalDataConsent")?.checked === true,
                    nonce: state.voteNonce,
                    fingerprint: await fingerprint(),
                    captchaToken,
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
            resetEmailVerification();
            renderStatus(state.voteStatus);
            await refreshResults();
        } catch (error) {
            state.voteNonce = null;
            result.textContent = `Бюллетень не отправлен: ${error.message}`;
            result.className = "vote-confirm__result form-result is-error";
            button.textContent = "Проголосовать!";
            button.disabled = false;
            if (state.voteStatus.captcha?.enabled) {
                result.textContent += " Повторно пройдите CAPTCHA или обновите страницу.";
            }
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

    const resetEmailVerification = () => {
        state.emailVerification = { challenge: null, token: null, email: "", deliveryStatus: null };
        const code = $("#emailVerificationCode");
        if (code) code.value = "";
        updateEmailVerificationUi();
    };

    const resetVoteDraft = ({ announce = false } = {}) => {
        state.selectedCandidates = [];
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
        if (!status || !confirm || !submit) return;
        confirm.hidden = !state.emailVerification.challenge || Boolean(state.emailVerification.token);
        if (state.emailVerification.token) {
            status.textContent = "Электронная почта подтверждена.";
            status.className = "form-result is-success";
        } else if (!state.emailVerification.challenge) {
            status.textContent = "Запросите код после заполнения email и согласия.";
            status.className = "form-result";
        }
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
                    status.textContent = `Код отправлен на ${maskedEmail}. Проверьте также папку «Спам».`;
                    status.className = "form-result is-success";
                    $("#emailVerificationCode")?.focus();
                    return;
                }
                if (delivery.status === "failed" || delivery.status === "expired") {
                    status.textContent = delivery.message;
                    status.className = "form-result is-error";
                    state.emailVerification.challenge = null;
                    updateEmailVerificationUi();
                    return;
                }
                status.textContent = delivery.message;
                status.className = "form-result";
            } catch {
                // Кратковременная ошибка проверки не отменяет уже поставленное в очередь письмо.
            }
        }
        if (state.emailVerification.challenge === challenge && !state.emailVerification.token) {
            status.textContent = "Письмо ещё обрабатывается. Можно подождать или запросить новый код позднее.";
            status.className = "form-result";
        }
    };

    const requestEmailVerification = async () => {
        const emailInput = $("#voteField-email");
        const consent = $("#personalDataConsent");
        const button = $("#emailVerificationRequest");
        const status = $("#emailVerificationStatus");
        const email = normalizedEmail(emailInput?.value);
        validateEmailInput(emailInput);
        if (!emailInput?.reportValidity() || !email) return;
        if (!consent?.checked) {
            status.textContent = "Сначала подтвердите согласие на обработку данных формы.";
            status.className = "form-result is-error";
            return;
        }
        button.disabled = true;
        status.textContent = "Отправляем код…";
        status.className = "form-result";
        try {
            const response = await api("/api/email-verification-request.php", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ email, personalDataConsent: true }),
            });
            state.emailVerification = {
                challenge: response.challenge,
                token: null,
                email,
                deliveryStatus: response.deliveryStatus,
            };
            status.textContent = `Код для ${response.maskedEmail} поставлен в очередь отправки.`;
            status.className = "form-result";
            updateEmailVerificationUi();
            void watchEmailDelivery(response.challenge, response.maskedEmail);
        } catch (error) {
            status.textContent = error.message;
            status.className = "form-result is-error";
        } finally {
            button.disabled = false;
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
            state.emailVerification.token = response.verificationToken;
            updateEmailVerificationUi();
        } catch (error) {
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
                resetEmailVerification();
            }
        });
        $("#voteField-phone")?.addEventListener("input", (event) => {
            validatePhoneInput(event.currentTarget);
        });
        $("#voteField-phone")?.addEventListener("blur", (event) => {
            const canonical = normalizeRussianPhone(event.currentTarget.value);
            if (canonical) event.currentTarget.value = formatRussianPhone(canonical);
            validatePhoneInput(event.currentTarget);
        });
        $("#personalDataConsent")?.addEventListener("change", updateEmailVerificationUi);
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
        setupNavigation();
        setupHomeNews();
        setupModal();
        setupPrivacyBanner();
        setupMobileVoteIndicator();
        $("#voteForm")?.addEventListener("submit", openVoteConfirmation);
        $("#voteConfirmForm")?.addEventListener("submit", submitVote);

        try {
            const hasPrivacyConsent = document.body.dataset.privacyConsent === "true";
            state.hasPrivacyConsent = hasPrivacyConsent;
            const [site, candidates, status] = await Promise.all([
                api("/api/site.php"),
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
        }
    };

    init();
})();
