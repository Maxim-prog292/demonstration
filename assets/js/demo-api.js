(() => {
    "use strict";

    const DEMO_CODE = "202026";
    const BALLOT_KEY = "veche2026StaticBallotV1";
    const RESULTS_KEY = "veche2026StaticResultsV1";
    const originalFetch = window.fetch.bind(window);

    const jsonFromElement = (id, fallback) => {
        try {
            return JSON.parse(document.getElementById(id)?.textContent || "");
        } catch {
            return fallback;
        }
    };

    const text = (root, selector) => root.querySelector(selector)?.textContent || "";
    const recordFields = (root) => Object.fromEntries(
        [...root.querySelectorAll(":scope > [data-field]")]
            .map((node) => [node.dataset.field, node.textContent || ""]),
    );

    const blocks = () => [...document.querySelectorAll("#demoSiteRecords [data-demo-block]")].map((node) => {
        const fields = recordFields(node);
        const extra = Object.fromEntries(
            [...node.querySelectorAll(":scope > [data-extra-key]")]
                .map((item) => [item.dataset.extraKey, item.textContent || ""]),
        );
        return {
            block_key: node.dataset.key || "",
            title: fields.title || "",
            body: fields.body || "",
            extra,
            requires_review: false,
        };
    });

    const timeline = () => [...document.querySelectorAll("#demoTimelineRecords [data-demo-timeline]")].map((node) => ({
        id: Number(node.dataset.id || 0),
        ...recordFields(node),
    }));

    const candidates = () => [...document.querySelectorAll("#demoCandidateRecords [data-demo-candidate]")].map((node) => ({
        id: Number(node.dataset.id || 0),
        slug: node.dataset.slug || "",
        category_id: Number(node.dataset.categoryId || 0),
        category_slug: node.dataset.categorySlug || "",
        canVote: node.dataset.canVote === "true",
        vote_count: 0,
        requires_review: false,
        ...recordFields(node),
        sources: [...node.querySelectorAll("[data-demo-source]")].map((source) => ({
            title: source.textContent || "",
            url: source.getAttribute("href") || "",
        })),
    }));

    const readStorage = (key, fallback) => {
        try {
            return JSON.parse(localStorage.getItem(key) || "") || fallback;
        } catch {
            return fallback;
        }
    };

    const round = () => ({
        ...jsonFromElement("demoRoundRecord", {}),
        selection_count: 1,
        result_count: 1,
        status: "active",
    });

    const ballot = () => readStorage(BALLOT_KEY, null);
    const storedResults = () => readStorage(RESULTS_KEY, {});
    const nowIso = () => new Date().toISOString();

    const votingStatus = () => {
        const accepted = ballot();
        const now = Date.now();
        return {
            status: "active",
            serverTime: new Date(now).toISOString(),
            votingStartAt: new Date(now - 86400000).toISOString(),
            votingEndAt: new Date(now + 30 * 86400000).toISOString(),
            cooldownHours: 24,
            repeatAllowed: false,
            selectionCount: 1,
            round: round(),
            cooldown: {
                active: Boolean(accepted),
                permanent: Boolean(accepted),
                hours: 24,
                lastVotedAt: accepted?.acceptedAt || null,
                nextAllowedAt: null,
                remainingSeconds: accepted ? null : 0,
            },
            captcha: { enabled: false, clientKey: "" },
        };
    };

    const results = () => {
        const counts = storedResults();
        const leaders = candidates()
            .map((candidate) => ({
                id: candidate.id,
                full_name: candidate.full_name,
                slug: candidate.slug,
                image_path: candidate.image_path,
                category_title: candidate.category_title,
                vote_count: Math.max(0, Number(counts[candidate.id] || 0)),
            }))
            .sort((left, right) => right.vote_count - left.vote_count || left.full_name.localeCompare(right.full_name, "ru"));
        return {
            mode: "exact",
            round: round(),
            leaders,
            tieAtCutoff: false,
            tieBreakRule: "runoff",
            finalistsStatus: "provisional",
            updatedAt: nowIso(),
        };
    };

    const response = (data, status = 200) => new Response(JSON.stringify({
        ok: true,
        data,
        requestId: "static-github-pages",
    }), {
        status,
        headers: { "Content-Type": "application/json; charset=utf-8" },
    });

    const errorResponse = (code, message, status = 422, details = {}) => new Response(JSON.stringify({
        ok: false,
        error: { code, message, details },
        requestId: "static-github-pages",
    }), {
        status,
        headers: { "Content-Type": "application/json; charset=utf-8" },
    });

    const requestPayload = (options) => {
        try {
            return JSON.parse(String(options?.body || "{}"));
        } catch {
            return {};
        }
    };

    const maskedEmail = (email) => {
        const [name = "", domain = ""] = String(email || "").trim().split("@");
        if (!domain) return "указанный адрес";
        return `${name.slice(0, 2) || "**"}***@${domain}`;
    };

    const showDemoCode = () => {
        const panel = document.getElementById("demoCodePanel");
        const value = document.getElementById("demoCodeValue");
        if (value) value.textContent = DEMO_CODE;
        if (panel) panel.hidden = false;
    };

    const saveDemoBallot = (candidateId) => {
        const acceptedAt = nowIso();
        const receipt = `DEMO-${Date.now().toString(36).toUpperCase()}`;
        localStorage.setItem(BALLOT_KEY, JSON.stringify({ candidateId, acceptedAt, receipt }));
        const counts = storedResults();
        counts[candidateId] = Math.max(0, Number(counts[candidateId] || 0)) + 1;
        localStorage.setItem(RESULTS_KEY, JSON.stringify(counts));
        return { acceptedAt, receipt };
    };

    window.fetch = async (input, options = {}) => {
        const url = new URL(typeof input === "string" ? input : input.url, window.location.href);
        const path = url.pathname;
        if (!path.includes("/api/")) return originalFetch(input, options);

        if (path.endsWith("/api/site.php")) {
            return response({
                blocks: blocks(),
                regionStats: jsonFromElement("demoRegionStats", []),
                timeline: timeline(),
                site: { name: "Народное Вече - 2026", description: "Клиентская демонстрация второго этапа" },
            });
        }
        if (path.endsWith("/api/candidates.php")) {
            return response({ round: round(), candidates: candidates() });
        }
        if (path.endsWith("/api/vote-status.php")) return response(votingStatus());
        if (path.endsWith("/api/results.php")) return response(results());
        if (path.endsWith("/api/privacy-consent.php")) return response({ accepted: true });
        if (path.endsWith("/api/vote-nonce.php")) {
            return response({ nonce: `static-${Date.now().toString(36)}` }, 201);
        }
        if (path.endsWith("/api/email-verification-request.php")) {
            const payload = requestPayload(options);
            showDemoCode();
            return response({
                challenge: `static-challenge-${Date.now().toString(36)}`,
                deliveryStatus: "sent",
                maskedEmail: maskedEmail(payload.contact?.email),
                expiresIn: 600,
            }, 201);
        }
        if (path.endsWith("/api/email-verification-status.php")) {
            return response({ status: "sent", message: `Демонстрационный код ${DEMO_CODE} показан в форме.` });
        }
        if (path.endsWith("/api/email-verification-confirm.php")) {
            const payload = requestPayload(options);
            if (String(payload.code || "") !== DEMO_CODE) {
                return errorResponse("CODE_INVALID", "Для демонстрации используйте код 202026.");
            }
            return response({ verificationToken: `static-verification-${Date.now().toString(36)}` });
        }
        if (path.endsWith("/api/vote.php")) {
            const payload = requestPayload(options);
            if (!Array.isArray(payload.candidateIds) || payload.candidateIds.length !== 1) {
                return errorResponse("INVALID_SELECTION", "Выберите одного кандидата.");
            }
            if (ballot()) {
                return errorResponse("DUPLICATE_VOTE", "Демонстрационный бюллетень уже принят. Сбросьте его на главной странице для повторного теста.", 409);
            }
            const saved = saveDemoBallot(Number(payload.candidateIds[0]));
            return response({
                message: `Демо-бюллетень принят. Квитанция ${saved.receipt}. Реальный голос не отправлялся.`,
                acceptedAt: saved.acceptedAt,
                cooldownHours: 24,
                repeatAllowed: false,
                nextAllowedAt: null,
                email: { reply: "not_requested", feedbackSaved: false },
            }, 201);
        }
        return errorResponse("STATIC_API_UNKNOWN", "Эта серверная операция недоступна в клиентской версии.", 404);
    };

    document.addEventListener("DOMContentLoaded", () => {
        document.getElementById("demoResetButton")?.addEventListener("click", () => {
            localStorage.removeItem(BALLOT_KEY);
            localStorage.removeItem(RESULTS_KEY);
            localStorage.removeItem("veche2026.pendingEmailVerification.v1");
            window.location.reload();
        });
        if (ballot()) {
            const button = document.getElementById("demoResetButton");
            if (button) button.textContent = "Сбросить принятый демо-бюллетень";
        }
    });
})();
