"use strict";

function renderDivisionsPage() {
    const section = document.createElement("section");
    section.className = "page-content";
    section.setAttribute("aria-label", "Championship partnerships");

    const invitation = document.createElement("section");
    invitation.className = "division-invitation";

    const introduction = document.createElement("div");
    introduction.className = "division-invitation-copy";

    const eyebrow = document.createElement("p");
    eyebrow.className = "division-invitation-eyebrow";
    eyebrow.textContent = "For tournament hosts";

    const heading = document.createElement("h2");
    heading.textContent = "Bring your event to the division.";

    const description = document.createElement("p");
    description.textContent = "Running a Bonk.io football tournament? We'd like to hear how you run it and how the division could help your players and organisers.";

    introduction.append(eyebrow, heading, description);

    const request = document.createElement("div");
    request.className = "division-invitation-request";

    const requestHeading = document.createElement("h3");
    requestHeading.textContent = "Host requests";

    const requestDescription = document.createElement("p");
    requestDescription.textContent = "A request form is being prepared. When it opens, you can send us your tournament name, format, schedule and what you'd like to work on together.";

    const requestStatus = document.createElement("p");
    requestStatus.className = "division-invitation-status";
    requestStatus.textContent = "Request form coming soon";

    request.append(requestHeading, requestDescription, requestStatus);
    invitation.append(introduction, request);

    const eventsHeading = document.createElement("h2");
    eventsHeading.className = "division-events-heading";
    eventsHeading.textContent = "Partnered events";

    const events = document.createElement("div");
    events.className = "content-grid division-events";

    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = "No partnered competitions have been announced yet.";
    events.append(empty);

    section.append(invitation, eventsHeading, events);
    return section;
}
