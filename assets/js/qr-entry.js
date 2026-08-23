(() => {
    "use strict";

    if (!window.location.hash.startsWith("#voting/?")) return;

    const code = window.location.hash.slice("#voting/?".length);
    const number = Number(code);
    if (/^\d{6}$/.test(code) && Number.isInteger(number) && number >= 0 && number <= 140002) {
        try {
            window.sessionStorage.setItem("veche2026.qrEntry.v1", code);
        } catch {
            // The clean public address does not depend on storage availability.
        }
    }

    try {
        window.history.replaceState(
            window.history.state,
            "",
            `${window.location.pathname}${window.location.search}#voting`,
        );
    } catch {
        // Do not send the source code anywhere if the History API is unavailable.
    }
})();
