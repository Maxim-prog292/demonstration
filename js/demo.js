(() => {
  "use strict";

  const body = document.body;
  const navToggle = document.querySelector(".nav-toggle");
  const siteNav = document.querySelector("#siteNav");

  if (navToggle && siteNav) {
    navToggle.addEventListener("click", () => {
      const open = navToggle.getAttribute("aria-expanded") === "true";
      navToggle.setAttribute("aria-expanded", String(!open));
      siteNav.classList.toggle("is-open", !open);
    });

    siteNav.addEventListener("click", (event) => {
      if (event.target.closest("a")) {
        navToggle.setAttribute("aria-expanded", "false");
        siteNav.classList.remove("is-open");
      }
    });
  }

  let lastModalTrigger = null;

  const openModal = (modal, trigger) => {
    if (!modal) return;
    lastModalTrigger = trigger || document.activeElement;
    modal.hidden = false;
    body.classList.add("modal-open");
    modal.querySelector(".modal__close")?.focus();
  };

  const closeModal = (modal) => {
    if (!modal) return;
    modal.hidden = true;
    if (!document.querySelector(".modal:not([hidden])")) {
      body.classList.remove("modal-open");
    }
    if (lastModalTrigger instanceof HTMLElement) lastModalTrigger.focus();
  };

  document.querySelectorAll("[data-detail-target]").forEach((button) => {
    button.addEventListener("click", () => {
      const template = document.getElementById(button.dataset.detailTarget);
      const modal = document.getElementById("detailModal");
      const content = modal?.querySelector("[data-detail-content]");
      if (!template || !content) return;
      content.replaceChildren(template.content.cloneNode(true));
      openModal(modal, button);
    });
  });

  document.querySelectorAll("[data-close-modal]").forEach((button) => {
    button.addEventListener("click", () => closeModal(button.closest(".modal")));
  });

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    const modal = document.querySelector(".modal:not([hidden])");
    if (modal) closeModal(modal);
  });

  const form = document.getElementById("demoVoteForm");
  if (form) {
    const checkboxes = [...form.querySelectorAll('input[name="candidate[]"]')];
    const count = document.querySelector("[data-selected-count]");
    const list = document.querySelector("[data-selected-list]");
    const submit = form.querySelector("[data-demo-vote-submit]");
    const result = form.querySelector("[data-demo-vote-result]");

    const selected = () => checkboxes.filter((checkbox) => checkbox.checked);

    const renderSelection = () => {
      const chosen = selected();
      if (count) count.textContent = String(chosen.length);

      checkboxes.forEach((checkbox) => {
        checkbox.disabled = chosen.length >= 5 && !checkbox.checked;
        const card = checkbox.closest(".candidate-card");
        const label = card?.querySelector(".candidate-card__choose");
        if (label) {
          label.textContent = checkbox.checked
            ? "В моей пятёрке"
            : "Добавить в мою пятёрку";
        }
      });

      if (list) {
        list.replaceChildren();
        if (!chosen.length) {
          const placeholder = document.createElement("li");
          placeholder.className = "is-placeholder";
          placeholder.textContent = "Выберите до пяти кандидатов";
          list.append(placeholder);
        } else {
          chosen.forEach((checkbox) => {
            const item = document.createElement("li");
            item.textContent = checkbox.dataset.candidateName;
            list.append(item);
          });
        }
      }

      if (submit) {
        submit.disabled = chosen.length === 0;
        submit.textContent = chosen.length
          ? `Продолжить · ${chosen.length} из 5`
          : "Выберите до пяти";
      }
      if (result) result.textContent = "";
    };

    checkboxes.forEach((checkbox) => {
      checkbox.addEventListener("change", () => {
        if (selected().length > 5) {
          checkbox.checked = false;
          if (result) result.textContent = "Можно выбрать не больше пяти имён.";
        }
        renderSelection();
      });
    });

    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const chosen = selected();
      if (!chosen.length) return;
      const modal = document.getElementById("demoVoteModal");
      const modalList = modal?.querySelector("[data-demo-modal-selection]");
      const success = modal?.querySelector("[data-demo-success]");
      if (modalList) {
        modalList.replaceChildren();
        chosen.forEach((checkbox) => {
          const item = document.createElement("li");
          item.textContent = checkbox.dataset.candidateName;
          modalList.append(item);
        });
      }
      if (success) success.hidden = true;
      openModal(modal, submit);
    });

    document.querySelector("[data-demo-finish]")?.addEventListener("click", (event) => {
      const success = event.currentTarget
        .closest(".vote-confirm")
        ?.querySelector("[data-demo-success]");
      if (success) {
        success.hidden = false;
        success.focus();
      }
    });

    renderSelection();
  }

  const main = document.querySelector("main[data-voting-end]");
  const timerTarget = main ? new Date(main.dataset.votingEnd) : null;

  const updateTimers = () => {
    if (!timerTarget || Number.isNaN(timerTarget.getTime())) return;
    const remaining = Math.max(0, timerTarget.getTime() - Date.now());
    const days = Math.floor(remaining / 86400000);
    const hours = Math.floor((remaining % 86400000) / 3600000);
    const minutes = Math.floor((remaining % 3600000) / 60000);
    const seconds = Math.floor((remaining % 60000) / 1000);

    document.querySelectorAll("[data-demo-timer]").forEach((timer) => {
      const values = { days, hours, minutes, seconds };
      Object.entries(values).forEach(([key, value]) => {
        const node = timer.querySelector(`[data-timer-${key}]`);
        if (node) node.textContent = String(value).padStart(2, "0");
      });
      const date = timer.querySelector("[data-timer-date]");
      if (date) date.textContent = "21 сентября 2026, 23:59";
    });
  };

  updateTimers();
  window.setInterval(updateTimers, 1000);

  const newsMore = document.querySelector("[data-news-more]");
  if (newsMore) {
    newsMore.addEventListener("click", () => {
      document.querySelectorAll(".news-card--extra").forEach((card) => {
        card.hidden = false;
        card.classList.remove("news-card--extra");
      });
      newsMore.hidden = true;
    });
  }
})();
