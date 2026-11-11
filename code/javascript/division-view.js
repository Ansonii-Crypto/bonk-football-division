"use strict";

(() => {
    const statusNames = { upcoming: "Upcoming", registration: "Registration", live: "Live", completed: "Completed" };
    const registrationNames = { open: "Open participation", "invite-only": "By invitation", closed: "Registration closed" };

    function element(tag, className, text) {
        const node = document.createElement(tag);
        if (className) {
            node.className = className;
        }
        if (text !== undefined && text !== null) {
            node.textContent = String(text);
        }
        return node;
    }

    function roundTitle(index, count) {
        const remaining = count - index;
        return remaining === 1 ? "Final" : remaining === 2 ? "Semi-finals"
            : remaining === 3 ? "Quarter-finals" : `Round of ${2 ** remaining}`;
    }

    function seededSlots(size) {
        let seeds = [1, 2];
        while (seeds.length < size) {
            const next = seeds.length * 2 + 1;
            seeds = seeds.flatMap(seed => [seed, next - seed]);
        }
        return seeds;
    }

    function buildBracket(entrants, results = {}) {
        const teams = Array.isArray(entrants) ? entrants.slice(0, 16) : [];
        if (!teams.length) {
            return [];
        }
        const size = Math.max(2, 2 ** Math.ceil(Math.log2(teams.length)));
        let slots = seededSlots(size).map(seed => ({ team: teams[seed - 1] || null, resolved: true, source: null }));
        const rounds = [];
        while (slots.length > 1) {
            const roundIndex = rounds.length;
            const matches = [];
            const next = [];
            for (let index = 0; index < slots.length; index += 2) {
                const left = slots[index];
                const right = slots[index + 1];
                const key = `${roundIndex}-${index / 2}`;
                const teamA = left.team;
                const teamB = right.team;
                const recorded = results && typeof results === "object" ? results[key] : null;
                const correctPair = teamA && teamB && recorded
                    && recorded.teamAId === teamA.id && recorded.teamBId === teamB.id;
                const score = value => Number.isInteger(value) && value >= 0 ? value : null;
                const scoreA = correctPair ? score(recorded.scoreA) : null;
                const scoreB = correctPair ? score(recorded.scoreB) : null;
                const ready = left.resolved && right.resolved;
                const bye = Boolean(ready && (teamA || teamB) && !(teamA && teamB));
                const played = Boolean(teamA && teamB && scoreA !== null && scoreB !== null && scoreA !== scoreB);
                const winner = bye ? teamA || teamB : played ? scoreA > scoreB ? teamA : teamB : null;
                const complete = Boolean(ready && (!teamA && !teamB || bye || played));
                matches.push({
                    key,
                    roundIndex,
                    matchIndex: index / 2,
                    teamA,
                    teamB,
                    teamAId: teamA?.id || null,
                    teamBId: teamB?.id || null,
                    pendingA: !left.resolved,
                    pendingB: !right.resolved,
                    sourceA: left.source,
                    sourceB: right.source,
                    scoreA,
                    scoreB,
                    winner,
                    bye,
                    complete
                });
                next.push({ team: winner, resolved: complete, source: key });
            }
            rounds.push(matches);
            slots = next;
        }
        return rounds;
    }

    function dateLabel(value) {
        if (typeof value !== "string" || !value) {
            return "Date to be announced";
        }
        if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
            const date = new Date(`${value}T12:00:00`);
            if (!Number.isNaN(date.getTime())) {
                return date.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
            }
        }
        return value;
    }

    function render(content = {}, options = {}) {
        const page = element("div", "division-view");
        const allowed = options.editableSections ? new Set(options.editableSections) : null;
        const canEdit = key => Boolean(options.editing && (!allowed || allowed.has(key)));
        const hasText = value => typeof value === "string" && value.trim().length > 0;
        const list = value => Array.isArray(value) ? value : [];

        function section(key, title, hasContent = true, hero = false) {
            if (!hasContent && !options.editing) {
                return null;
            }
            const node = element("section", `division-event-section${hero ? " division-event-hero" : ""}`);
            node.dataset.section = key;
            const heading = element("div", "division-section-heading");
            if (title) {
                heading.append(element("h2", "", title));
            }
            if (canEdit(key)) {
                node.classList.add("division-event-section--editable");
                const edit = element("button", "division-section-edit", hasContent ? "Edit section" : "Add content");
                edit.type = "button";
                edit.setAttribute("aria-label", `${hasContent ? "Edit" : "Add"} ${title || "event information"}`);
                edit.addEventListener("click", () => options.onSection?.(key));
                heading.append(edit);
                node.addEventListener("click", event => {
                    if (!event.target.closest("button, a, input, textarea, select, summary")) {
                        options.onSection?.(key);
                    }
                });
            }
            if (heading.childElementCount) {
                node.append(heading);
            }
            page.append(node);
            return node;
        }

        const general = section("general", "", true, true);
        const top = element("div", "division-event-eyebrow");
        top.append(element("span", `division-event-status division-event-status--${Object.hasOwn(statusNames, content.status) ? content.status : "upcoming"}`,
            statusNames[content.status] || "Upcoming"), element("span", "", "Bonk.io football"));
        general.append(top, element("h1", "division-event-title", content.name || "Untitled division"));
        if (hasText(content.summary)) {
            general.append(element("p", "division-event-summary", content.summary));
        } else if (options.editing) {
            general.append(element("p", "division-edit-prompt", "Add a short introduction to your event."));
        }
        if (content.startDate || content.endDate) {
            const dates = element("p", "division-event-dates", content.startDate && content.endDate
                ? `${dateLabel(content.startDate)} — ${dateLabel(content.endDate)}`
                : dateLabel(content.startDate || content.endDate));
            general.append(dates);
        }
        if (hasText(content.description)) {
            general.append(element("p", "division-event-description", content.description));
        }

        const participation = content.participation || {};
        const participationSection = section("participation", "Taking part");
        const format = element("div", "division-format-facts");
        const teamSize = Math.max(1, Math.min(4, Number(participation.teamSize) || 1));
        for (const [label, value] of [
            ["Match format", `${teamSize} vs ${teamSize}`],
            ["Participation", participation.mode === "teams" ? "Team entry" : "Individual entry"],
            ["Registration", registrationNames[participation.registration] || "Details to be announced"]
        ]) {
            const fact = element("div", "division-format-fact");
            fact.append(element("span", "", label), element("strong", "", value));
            format.append(fact);
        }
        participationSection.append(format);
        if (hasText(participation.description)) {
            participationSection.append(element("p", "division-event-copy", participation.description));
        }

        const timeline = list(content.timeline);
        const timelineSection = section("timeline", "Event timeline", timeline.length > 0);
        if (timelineSection) {
            if (!timeline.length) {
                timelineSection.append(element("p", "division-edit-prompt", "Add dates for registration, matches and announcements."));
            } else {
                const items = element("ol", "division-timeline");
                for (const stage of timeline) {
                    const item = element("li", "division-timeline-item");
                    const card = element("div", "division-timeline-card");
                    card.append(element("p", "division-timeline-date", dateLabel(stage.date)), element("h3", "", stage.title || "Untitled stage"));
                    if (hasText(stage.description)) {
                        card.append(element("p", "division-event-copy", stage.description));
                    }
                    item.append(card);
                    items.append(item);
                }
                timelineSection.append(items);
            }
        }

        const teams = list(content.teams);
        const teamsSection = section("teams", participation.mode === "teams" ? "Teams" : "Players", teams.length > 0);
        if (teamsSection) {
            if (!teams.length) {
                teamsSection.append(element("p", "division-edit-prompt", "Add entrants and their player rosters. Teams can have up to four players."));
            } else {
                const entrants = element("div", "division-entrant-grid");
                teams.forEach((team, index) => {
                    const card = element("article", "division-entrant");
                    card.append(element("span", "division-entrant-seed", String(index + 1).padStart(2, "0")), element("h3", "", team.name || "Unnamed entrant"));
                    const roster = element("ul", "division-roster");
                    for (const player of list(team.players).slice(0, 4)) {
                        roster.append(element("li", "", player.username));
                    }
                    card.append(roster);
                    entrants.append(card);
                });
                teamsSection.append(entrants);
            }
        }

        const bracketSection = section("bracket", "Tournament bracket", teams.length >= 2);
        if (bracketSection) {
            if (teams.length < 2) {
                bracketSection.append(element("p", "division-edit-prompt", "Add at least two entrants to build the bracket. Results move winners into the next round."));
            } else {
                const rounds = buildBracket(teams, content.results);
                const bracket = element("div", "division-bracket");
                bracket.setAttribute("role", "region");
                bracket.setAttribute("aria-label", "Single elimination tournament bracket");
                bracket.tabIndex = 0;
                bracket.style.setProperty("--bracket-height", `${rounds[0].length * 8.2}rem`);
                rounds.forEach((matches, roundIndex) => {
                    const round = element("section", "division-bracket-round");
                    round.append(element("h3", "division-bracket-round-title", roundTitle(roundIndex, rounds.length)));
                    const matchList = element("div", "division-bracket-matches");
                    matchList.style.gridTemplateRows = `repeat(${matches.length}, minmax(0, 1fr))`;
                    for (const match of matches) {
                        const card = element("article", `division-bracket-match division-bracket-match--${match.matchIndex % 2 ? "lower" : "upper"}`);
                        card.dataset.match = match.key;
                        card.style.setProperty("--branch-height", `${rounds[0].length * 8.2 / matches.length / 2}rem`);
                        card.setAttribute("aria-label", `${roundTitle(roundIndex, rounds.length)}, match ${match.matchIndex + 1}`);
                        for (const [team, score, pending] of [[match.teamA, match.scoreA, match.pendingA], [match.teamB, match.scoreB, match.pendingB]]) {
                            const teamRow = element("div", `division-bracket-team${team && match.winner?.id === team.id ? " division-bracket-team--winner" : ""}${team ? "" : " division-bracket-team--empty"}`);
                            const identity = element("div", "division-bracket-team-name");
                            identity.append(element("strong", "", team?.name || (pending ? "To be decided" : "Bye")));
                            if (team) {
                                identity.append(element("span", "", list(team.players).map(player => player.username).join(" · ")));
                            }
                            teamRow.append(identity, element("span", "division-bracket-score", score === null ? "—" : score));
                            card.append(teamRow);
                        }
                        card.append(element("p", "division-bracket-match-status", match.bye ? "Advances with a bye" : match.complete ? "Result recorded" : "Awaiting result"));
                        matchList.append(card);
                    }
                    round.append(matchList);
                    bracket.append(round);
                });
                bracketSection.append(bracket);
                const champion = rounds.at(-1)[0].winner;
                if (champion) {
                    const winner = element("p", "division-bracket-champion");
                    winner.append(element("span", "", "Winner"), element("strong", "", champion.name));
                    bracketSection.append(winner);
                }
            }
        }

        for (const [key, title] of [["campaigns", "Campaigns"], ["referendums", "Referendums"]]) {
            const entries = list(content[key]);
            const node = section(key, title, entries.length > 0);
            if (!node) {
                continue;
            }
            if (!entries.length) {
                node.append(element("p", "division-edit-prompt", key === "campaigns"
                    ? "Add announcements and campaigns connected to the event."
                    : "Add proposals, their choices and the dates or rules for making a decision."));
                continue;
            }
            const cards = element("div", "division-information-grid");
            for (const entry of entries) {
                const card = element("article", "division-information-card");
                if (key === "referendums") {
                    card.append(element("span", "division-referendum-status", ({ planned: "Planned", open: "Open for discussion", closed: "Closed" })[entry.status] || "Planned"));
                }
                card.append(element("h3", "", entry.title || "Untitled"));
                if (hasText(entry.description)) {
                    card.append(element("p", "division-event-copy", entry.description));
                }
                if (key === "referendums" && list(entry.options).length) {
                    const choices = element("ul", "division-referendum-options");
                    for (const option of entry.options) {
                        choices.append(element("li", "", option));
                    }
                    card.append(choices);
                }
                cards.append(card);
            }
            node.append(cards);
        }
        return page;
    }

    window.DivisionView = { render, buildBracket, roundTitle };
})();
