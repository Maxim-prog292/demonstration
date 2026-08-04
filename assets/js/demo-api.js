(() => {
    "use strict";

    const originalFetch = window.fetch?.bind(window);
    const demoState = {
        code: "",
        challenge: "",
        verificationToken: "",
        ballots: [],
    };

    const text = (root, selector) => root.querySelector(selector)?.textContent?.trim() || "";
    const html = (root, selector) => root.querySelector(selector)?.innerHTML?.trim() || "";
    const templateRecords = (selector, recordSelector) => {
        const template = document.querySelector(selector);
        return template ? [...template.content.querySelectorAll(recordSelector)] : [];
    };

    const candidates = templateRecords("#demoCandidateRecords", "[data-demo-candidate]").map((record) => ({
        id: Number(record.dataset.id),
        full_name: text(record, '[data-field="full_name"]'),
        slug: record.dataset.slug || "",
        life_years: text(record, '[data-field="life_years"]'),
        short_description: text(record, '[data-field="short_description"]'),
        biography: text(record, '[data-field="biography"]'),
        region_connection: text(record, '[data-field="region_connection"]'),
        contribution: text(record, '[data-field="contribution"]'),
        image_path: text(record, '[data-field="image_path"]'),
        image_alt: text(record, '[data-field="image_alt"]'),
        category_id: Number(record.dataset.categoryId),
        category_slug: record.dataset.categorySlug || "",
        category_title: text(record, '[data-field="category_title"]'),
        canVote: record.dataset.canVote === "true",
        requires_review: false,
        sources: [...record.querySelectorAll("[data-demo-source]")].map((source) => {
            const url = source.getAttribute("href") || "";
            return url ? { title: source.textContent.trim(), url } : source.textContent.trim();
        }),
    }));

    const blocks = templateRecords("#demoSiteRecords", "[data-demo-block]").map((record) => {
        const extra = {};
        record.querySelectorAll("[data-extra-key]").forEach((field) => {
            extra[field.dataset.extraKey] = field.innerHTML.trim();
        });
        return {
            block_key: record.dataset.key,
            title: html(record, '[data-field="title"]') || null,
body: html(record, '[data-field="body"]') || null,
            extra: Object.keys(extra).length ? extra : null,
            requires_review: false,
        };
    });

    const timeline = templateRecords("#demoTimelineRecords", "[data-demo-timeline]").map((record) => ({
        id: Number(record.dataset.id),
        period_text: html(record, '[data-field="period_text"]'),
title: html(record, '[data-field="title"]'),
description: html(record, '[data-field="description"]'),
        image_path: null,
        image_alt: null,
    }));

    const jsonResponse = (data, status = 200) => new Response(JSON.stringify({ ok: true, data }), {
        status,
        headers: { "Content-Type": "application/json; charset=utf-8" },
    });

    const errorResponse = (code, message, status = 422) => new Response(JSON.stringify({
        ok: false,
        error: { code, message },
    }), {
        status,
        headers: { "Content-Type": "application/json; charset=utf-8" },
    });

    const parseBody = (options) => {
        try {
            return JSON.parse(String(options?.body || "{}"));
        } catch {
            return {};
        }
    };

    const makeCode = () => {
        const values = new Uint32Array(1);
        if (globalThis.crypto?.getRandomValues) crypto.getRandomValues(values);
        const value = values[0] || Math.floor(Math.random() * 1000000);
        return String(value % 1000000).padStart(6, "0");
    };

    const makeToken = (prefix) => {
        const values = new Uint32Array(4);
        if (globalThis.crypto?.getRandomValues) crypto.getRandomValues(values);
        return `${prefix}-${[...values].map((value) => value.toString(16).padStart(8, "0")).join("")}`;
    };

    const maskEmail = (email) => {
        const [name, domain] = String(email || "").split("@");
        if (!name || !domain) return "указанный адрес";
        return `${name.slice(0, 2)}***@${domain}`;
    };

    const showDemoCode = (code) => {
        const panel = document.querySelector("#demoCodePanel");
        const value = document.querySelector("#demoCodeValue");
        if (value) value.textContent = code;
        if (panel) panel.hidden = false;
    };

    const hideDemoCode = () => {
        const panel = document.querySelector("#demoCodePanel");
        if (panel) panel.hidden = true;
    };

    const votingStatus = () => {
        const now = new Date();
        const start = new Date(now.getTime() - 86400000);
        const end = new Date(now.getTime() + 13 * 86400000);
        return {
            status: "active",
            serverTime: now.toISOString(),
            votingStartAt: start.toISOString(),
            votingEndAt: end.toISOString(),
            cooldownHours: 24,
            repeatAllowed: false,
            selectionCount: 5,
            cooldown: {
                active: false,
                permanent: false,
                hours: 24,
                lastVotedAt: null,
                nextAllowedAt: null,
                remainingSeconds: 0,
            },
            captcha: { enabled: false, clientKey: "" },
        };
    };

    const results = () => {
        const counts = new Map();
        demoState.ballots.forEach((ballot) => {
            ballot.candidateIds.forEach((id) => counts.set(id, (counts.get(id) || 0) + 1));
        });
        const leaders = candidates
            .filter((candidate) => counts.has(candidate.id))
            .sort((left, right) => (counts.get(right.id) - counts.get(left.id)) || left.full_name.localeCompare(right.full_name, "ru"))
            .slice(0, 5)
            .map((candidate, index) => ({
                id: candidate.id,
                rank: index + 1,
                full_name: candidate.full_name,
                slug: candidate.slug,
                image_path: candidate.image_path,
                category_title: candidate.category_title,
            }));
        return {
            mode: "leader_list",
            leaders,
            tieAtCutoff: false,
            tieBreakRule: "runoff",
            finalistsStatus: "provisional",
            updatedAt: new Date().toISOString(),
        };
    };

    const saveDemoBallot = (candidateIds) => {
        const acceptedAt = new Date().toISOString();
        const receipt = `DEMO-${String(Math.floor(Math.random() * 100000000)).padStart(8, "0")}`;
        const record = { candidateIds, acceptedAt, receipt };
        demoState.ballots.push(record);
        try {
            const key = "narodnoeVecheDemoBallots";
            const previous = JSON.parse(localStorage.getItem(key) || "[]");
            const safePrevious = Array.isArray(previous) ? previous : [];
            localStorage.setItem(key, JSON.stringify([...safePrevious, record].slice(-20)));
        } catch {
            // Демо продолжает работать и при недоступном локальном хранилище.
        }
        return record;
    };

    window.fetch = async (input, options = {}) => {
        const rawUrl = typeof input === "string" ? input : input?.url || "";
        const url = new URL(rawUrl, window.location.href);
        const path = url.pathname;

        if (path.endsWith("/api/site.php")) {
            return jsonResponse({
                blocks,
                regionStats: [],
                timeline,
                site: { name: "Народное Вече - 2026", description: "Демонстрационная версия" },
            });
        }
        if (path.endsWith("/api/candidates.php")) return jsonResponse({ candidates });
        if (path.endsWith("/api/vote-status.php")) return jsonResponse(votingStatus());
        if (path.endsWith("/api/results.php")) return jsonResponse(results());
        if (path.endsWith("/api/privacy-consent.php")) return jsonResponse({ accepted: true });
        if (path.endsWith("/api/vote-nonce.php")) return jsonResponse({ nonce: makeToken("demo-nonce") }, 201);

        if (path.endsWith("/api/email-verification-request.php")) {
            const payload = parseBody(options);
            demoState.code = makeCode();
            demoState.challenge = makeToken("demo-challenge");
            demoState.verificationToken = "";
            showDemoCode(demoState.code);
            return jsonResponse({
                challenge: demoState.challenge,
                maskedEmail: maskEmail(payload.email),
                deliveryStatus: "sent",
            }, 201);
        }
        if (path.endsWith("/api/email-verification-status.php")) {
            return jsonResponse({ status: "sent", message: "Демонстрационный код показан в форме." });
        }
        if (path.endsWith("/api/email-verification-confirm.php")) {
            const payload = parseBody(options);
            if (payload.challenge !== demoState.challenge || String(payload.code) !== demoState.code) {
                return errorResponse("INVALID_CODE", "Код не совпадает с демонстрационным кодом в форме.");
            }
            demoState.verificationToken = makeToken("demo-proof");
            return jsonResponse({ verificationToken: demoState.verificationToken });
        }
        if (path.endsWith("/api/vote.php")) {
            const payload = parseBody(options);
            const candidateIds = [...new Set((payload.candidateIds || []).map(Number).filter(Number.isInteger))];
            if (candidateIds.length !== 5) {
                return errorResponse("INVALID_SELECTION", "В демонстрационном бюллетене должно быть ровно пять кандидатов.");
            }
            if (payload.personalDataConsent !== true || payload.emailVerificationToken !== demoState.verificationToken) {
                return errorResponse("CONFIRMATION_REQUIRED", "Подтвердите форму и демонстрационный код.");
            }
            const record = saveDemoBallot(candidateIds);
            hideDemoCode();
            return jsonResponse({
                message: `Демонстрационный бюллетень принят. Локальная квитанция: ${record.receipt}.`,
                acceptedAt: record.acceptedAt,
                cooldownHours: 24,
                repeatAllowed: false,
                nextAllowedAt: null,
                email: { reply: "disabled", feedbackSaved: false },
            }, 201);
        }

        if (originalFetch && !/^https?:$/i.test(url.protocol)) return originalFetch(input, options);
        throw new Error(`В демо-версии сетевой запрос отключён: ${path}`);
    };
})();
