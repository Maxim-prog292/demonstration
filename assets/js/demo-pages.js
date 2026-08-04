(() => {
    "use strict";

    const search = document.querySelector(".news-search");
    const cards = [...document.querySelectorAll(".news-grid--archive .news-card")];
    if (search && cards.length) {
        const input = search.querySelector('input[type="search"]');
        const result = document.createElement("p");
        result.className = "demo-search-result";
        result.setAttribute("aria-live", "polite");
        search.append(result);

        const apply = () => {
            const query = String(input?.value || "").trim().toLocaleLowerCase("ru");
            let visible = 0;
            cards.forEach((card) => {
                const matches = query === "" || card.textContent.toLocaleLowerCase("ru").includes(query);
                card.hidden = !matches;
                if (matches) visible += 1;
            });
            result.textContent = query ? `Найдено публикаций: ${visible}` : "";
        };

        search.addEventListener("submit", (event) => {
            event.preventDefault();
            apply();
        });
        input?.addEventListener("input", apply);
    }

    const revoke = document.querySelector("#privacyRevoke");
    if (revoke) {
        revoke.disabled = true;
        revoke.title = "В демонстрационной версии технические данные не передаются";
    }
})();
