"use strict";

function renderDivisionsPage() {
    const section = document.createElement("section");
    section.className = "page-content";
    section.setAttribute("aria-label", "Championship partnerships");

    const events = document.createElement("div");
    events.className = "content-grid division-events";

    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = "No partnered competitions have been announced yet.";
    events.append(empty);

    section.append(events);
    return section;
}
