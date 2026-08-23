(() => {
    "use strict";

    const form = document.querySelector(".news-search");
    const input = document.getElementById("newsSearch");
    const grid = document.querySelector(".news-grid--archive");
    if (!form || !input || !grid) return;

    const cards = [...grid.querySelectorAll(".news-card")];
    const empty = document.createElement("p");
    empty.className = "news-empty demo-news-empty";
    empty.textContent = "По вашему запросу публикации не найдены.";
    empty.hidden = true;
    grid.after(empty);

    const apply = () => {
        const query = input.value.trim().toLocaleLowerCase("ru");
        let visible = 0;
        cards.forEach((card) => {
            const matches = query === "" || card.textContent.toLocaleLowerCase("ru").includes(query);
            card.hidden = !matches;
            if (matches) visible += 1;
        });
        empty.hidden = visible !== 0;
    };

    const initialQuery = new URLSearchParams(window.location.search).get("q") || "";
    input.value = initialQuery;
    apply();
    form.addEventListener("submit", (event) => {
        event.preventDefault();
        apply();
        input.focus();
    });
    input.addEventListener("search", apply);
})();
