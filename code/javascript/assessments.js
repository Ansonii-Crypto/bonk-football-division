"use strict";

(() => {
    const tierColors = {
        S: "#fe2f44",
        A: "#fca475",
        B: "#fcfe90",
        C: "#7c905f",
        D: "#82c6cb",
        E: "#eda4e3",
        F: "#a36cfd"
    };

    const attributes = [
        ["control", "Control"],
        ["execution", "Execution"],
        ["defending", "Defending"],
        ["reactionTime", "Reaction time"],
        ["chemistry", "Chemistry"],
        ["gameSense", "Game sense"]
    ];

    const assessmentsPerPage = 12;
    const storageKey = "bonk-football-division:assessments:v1";
    const sortOptions = ["descending", "ascending", "newest", "alphabetical"];
    const browseState = { query: "", tiers: new Set(), initials: new Set(), sort: "descending", page: 1 };
    let browseScroll = { view: "", left: 0, top: 0, indexes: 0 };

    window.addEventListener("scroll", () => {
        const browser = document.querySelector(".assessment-browser");
        if (browser?.isConnected) {
            browseScroll = {
                view: viewHash(),
                left: window.scrollX,
                top: window.scrollY,
                indexes: document.querySelector(".assessment-browser .assessment-indexes")?.scrollTop || 0
            };
        }
    }, { passive: true });

    function restoreState(value) {
        const state = value && typeof value === "object" && !Array.isArray(value) ? value : {};
        browseState.query = typeof state.query === "string" ? state.query.slice(0, 200) : "";
        browseState.sort = sortOptions.includes(state.sort) ? state.sort : "descending";
        browseState.page = Number.isSafeInteger(state.page) && state.page > 0 ? state.page : 1;
        browseState.tiers.clear();
        browseState.initials.clear();
        for (const value of Array.isArray(state.tiers) ? state.tiers : []) {
            if (typeof value === "string" && Object.hasOwn(tierColors, value)) {
                browseState.tiers.add(value);
            }
        }
        for (const value of Array.isArray(state.initials) ? state.initials : []) {
            if (typeof value === "string" && /^[A-Z#]$/.test(value)) {
                browseState.initials.add(value);
            }
        }
    }

    try {
        restoreState(JSON.parse(window.localStorage.getItem(storageKey)));
    } catch {
        // Browsing still works when saved preferences are unavailable or malformed.
    }

    function viewHash() {
        const parameters = new URLSearchParams({ view: "1" });
        if (browseState.query) {
            parameters.set("q", browseState.query);
        }
        if (browseState.tiers.size) {
            parameters.set("tiers", Object.keys(tierColors).filter(value => browseState.tiers.has(value)).join(","));
        }
        if (browseState.initials.size) {
            parameters.set("initials", [...browseState.initials].sort().join(","));
        }
        parameters.set("sort", browseState.sort);
        parameters.set("page", String(browseState.page));
        return `#assessments?${parameters}`;
    }

    function saveView() {
        try {
            window.localStorage.setItem(storageKey, JSON.stringify({
                query: browseState.query,
                tiers: [...browseState.tiers],
                initials: [...browseState.initials],
                sort: browseState.sort,
                page: browseState.page
            }));
        } catch {
            // Storage restrictions must not prevent filtering or sharing.
        }
        try {
            const url = new URL(window.location.href);
            url.hash = viewHash();
            window.history.replaceState(window.history.state, "", url);
        } catch {
            // Some local-file previews restrict History API updates.
        }
    }

    document.addEventListener("keydown", event => {
        if (event.key !== "/" || event.ctrlKey || event.metaKey || event.altKey || event.repeat || event.defaultPrevented || event.isComposing || event.keyCode === 229) {
            return;
        }
        const isEditing = target => target?.isContentEditable || target?.closest?.("input, textarea, select");
        if (isEditing(event.target) || isEditing(document.activeElement) || document.querySelector("dialog[open]")) {
            return;
        }
        const search = document.querySelector(".assessment-browser .assessment-search");
        if (search?.isConnected) {
            event.preventDefault();
            search.focus();
        }
    });

    const players = [];

    function element(tagName, className, text) {
        const node = document.createElement(tagName);
        if (className) {
            node.className = className;
        }
        if (text !== undefined) {
            node.textContent = text;
        }
        return node;
    }

    function selectField(labelText, options) {
        const label = element("label", "field-label");
        const control = element("select", "field-control");
        label.append(element("span", "", labelText), control);

        for (const [value, text] of options) {
            const option = element("option", "", text);
            option.value = value;
            control.append(option);
        }

        return { label, control };
    }

    function playerInitial(name) {
        const first = String(name || "").trim().charAt(0).toUpperCase();
        return /^[A-Z]$/.test(first) ? first : "#";
    }

    function assessmentHeading(player, headingTag = "h3") {
        const heading = element("div", "assessment-heading");
        const avatar = element("span", "assessment-avatar", player.name.charAt(0));
        avatar.setAttribute("aria-hidden", "true");
        const identity = element("div", "assessment-identity");
        identity.append(
            element(headingTag, "", player.name),
            element("p", "assessment-meta", player.className || "Not recorded")
        );
        const tier = element("span", "tier-badge", player.tier);
        tier.setAttribute("aria-label", `${player.tier} tier`);
        heading.append(avatar, identity, tier);
        return heading;
    }

    function attributeList(player, compact = false) {
        const stats = element("ul", "attribute-list");
        attributes.forEach(([, label], index) => {
            const value = player.values[index];
            const row = element("li", "attribute-row");
            if (compact) {
                row.setAttribute("aria-label", `${label}: ${value} out of 300`);
            }
            const track = element("span", "attribute-track");
            track.setAttribute("aria-hidden", "true");
            const fill = element("span", "attribute-fill");
            fill.style.width = `${value / 300 * 100}%`;
            track.append(fill);
            row.append(element("span", "", label), track, element("span", "", compact ? String(value) : `${value} / 300`));
            stats.append(row);
        });
        return stats;
    }

    function assessmentDate(player) {
        if (typeof player.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(player.date)) {
            return element("span", "", "Not recorded");
        }
        const recordedDate = new Date(`${player.date}T12:00:00`);
        if (Number.isNaN(recordedDate.getTime())) {
            return element("span", "", "Not recorded");
        }
        const date = recordedDate.toLocaleDateString("en-GB", {
            day: "numeric", month: "long", year: "numeric"
        });
        const time = element("time", "", date);
        time.dateTime = player.date;
        return time;
    }

    function assessmentCard(player) {
        const card = element("a", "content-card assessment-card assessment-card-link");
        card.href = `#assessments/${encodeURIComponent(player.id)}`;
        card.setAttribute("aria-label", `View ${player.name}'s assessment`);
        card.style.setProperty("--tier-color", tierColors[player.tier]);
        const total = element("p", "assessment-total");
        total.append(element("strong", "", String(player.total)), element("span", "", "/ 1800"));
        card.append(
            assessmentHeading(player),
            total,
            attributeList(player, true)
        );
        return card;
    }

    function assessmentProfile(player) {
        const section = element("section", "page-content assessments-content assessment-profile");
        section.setAttribute("aria-label", `${player.name}'s assessment`);
        const back = element("a", "assessment-back", "Back to assessments");
        back.href = "#assessments";
        const layout = element("div", "profile-layout");
        const stats = element("section", "content-card assessment-card profile-stats");
        stats.style.setProperty("--tier-color", tierColors[player.tier]);
        stats.append(
            assessmentHeading(player, "h2"),
            element("p", "assessment-total", `${player.total} / 1800 points`),
            element("h3", "", "Attributes"),
            attributeList(player),
            element("p", "muted", "Each attribute is out of 300. The overall tier is calculated from the average of all six scores.")
        );

        const notes = element("section", "content-card profile-notes");
        notes.append(element("h2", "", "Assessment notes"));
        const information = element("dl", "detail-list");
        const date = element("dd");
        date.append(assessmentDate(player));
        const classValue = element("dd");
        if (player.className) {
            const classLink = element("a", "", player.className);
            classLink.href = "#classes";
            classValue.append(classLink);
        } else {
            classValue.textContent = "Not recorded";
        }
        information.append(
            element("dt", "", "Assessed by"), element("dd", "", player.assessorName || "Not recorded"),
            element("dt", "", "Assessment date"), date,
            element("dt", "", "Class"), classValue
        );

        notes.append(
            information,
            element("h3", "", "Summary"),
            element("p", "", typeof player.notes === "string" && player.notes.trim() ? player.notes : "Not recorded")
        );

        layout.append(stats, notes);
        section.append(back, layout);
        return section;
    }

    window.getAssessmentProfile = function getAssessmentProfile(id) {
        const player = players.find(player => player.id === id);
        if (!player) {
            return null;
        }
        return {
            title: player.name,
            description: "Player attribute scores and assessment notes.",
            render: () => assessmentProfile(player)
        };
    };

    window.renderAssessmentsPage = function renderAssessmentsPage(parameters = null) {
        if (parameters !== null) {
            const pageText = parameters.get("page") || "";
            restoreState({
                query: parameters.get("q"),
                tiers: (parameters.get("tiers") || "").split(","),
                initials: (parameters.get("initials") || "").split(","),
                sort: parameters.get("sort"),
                page: /^[1-9]\d*$/.test(pageText) ? Number(pageText) : 1
            });
        }
        const section = element("section", "page-content assessments-content assessment-browser");
        section.setAttribute("aria-label", "Player assessments");

        const toolbar = element("div", "assessment-toolbar");
        const searchLabel = element("label", "field-label");
        const search = element("input", "field-control assessment-search");
        search.type = "search";
        search.placeholder = "Search names or classes";
        search.autocomplete = "off";
        search.maxLength = 200;
        search.value = browseState.query;
        searchLabel.append(element("span", "", "Search assessments"), search);
        const sort = selectField("Sort assessments", [
            ["descending", "Descending points"],
            ["ascending", "Ascending points"],
            ["newest", "Newest assessment"],
            ["alphabetical", "Alphabetical"]
        ]);
        sort.control.value = browseState.sort;
        const copyView = element("button", "assessment-copy-view", "Copy view link");
        copyView.type = "button";
        toolbar.append(searchLabel, sort.label, copyView);
        const shareStatus = element("p", "assessment-share-status");
        shareStatus.setAttribute("role", "status");
        shareStatus.setAttribute("aria-live", "polite");
        const shareFallback = element("label", "assessment-share-fallback field-label");
        shareFallback.hidden = true;
        const shareInput = element("input", "field-control");
        shareInput.type = "text";
        shareInput.readOnly = true;
        shareFallback.append(element("span", "", "Copy this view link"), shareInput);

        const count = element("p", "assessment-meta");
        count.setAttribute("role", "status");
        count.setAttribute("aria-live", "polite");
        count.setAttribute("aria-atomic", "true");
        count.tabIndex = -1;
        const grid = element("div", "content-grid");
        grid.id = "assessment-results";
        const populatedTiers = new Set(players.map(player => player.tier));
        const populatedInitials = new Set(players.map(player => playerInitial(player.name)));
        const availableTiers = Object.keys(tierColors).filter(value => populatedTiers.has(value) || browseState.tiers.has(value));
        const availableInitials = [...new Set([...populatedInitials, ...browseState.initials])].sort();
        function createIndex(type, values, selection, populated) {
            const index = element("nav", `assessment-index assessment-${type}-index`);
            const isTier = type === "tier";
            index.setAttribute("aria-label", isTier ? "Filter assessments by tier" : "Filter assessments by name initial");
            const buttons = [];
            for (const value of ["all", ...values]) {
                const button = element("button", "assessment-index-button", value === "all" ? "All" : value);
                button.type = "button";
                button.dataset.value = value;
                const label = value === "all"
                    ? (isTier ? "All tiers" : "All name initials")
                    : isTier ? `${value} tier`
                        : value === "#" ? "Names starting with a number or symbol" : `Names starting with ${value}`;
                button.setAttribute("aria-label", label);
                button.setAttribute("aria-controls", grid.id);
                button.title = label;
                if (value === "all") {
                    button.className += " assessment-index-all";
                } else if (isTier) {
                    button.style.setProperty("--tier-color", tierColors[value]);
                }
                button.addEventListener("click", () => {
                    if (value === "all") {
                        selection.clear();
                    } else if (selection.has(value)) {
                        selection.delete(value);
                    } else {
                        selection.add(value);
                    }
                    resetResults();
                    if (button.hidden) {
                        buttons[0].focus({ preventScroll: true });
                    }
                });
                buttons.push(button);
                index.append(button);
            }
            return {
                node: index,
                update() {
                    for (const button of buttons) {
                        const value = button.dataset.value;
                        button.hidden = value !== "all" && !populated.has(value) && !selection.has(value);
                        button.setAttribute("aria-pressed", String(value === "all" ? selection.size === 0 : selection.has(value)));
                    }
                }
            };
        }

        const tierIndex = createIndex("tier", availableTiers, browseState.tiers, populatedTiers);
        const initialIndex = createIndex("initial", availableInitials, browseState.initials, populatedInitials);
        const indexes = element("aside", "assessment-indexes");
        indexes.append(tierIndex.node, initialIndex.node);
        const directory = element("div", "assessment-directory");
        const resultsPane = element("div", "assessment-results-pane");
        resultsPane.setAttribute("role", "region");
        resultsPane.setAttribute("aria-label", "Assessment results");
        const pagination = element("nav", "assessment-pagination");
        pagination.setAttribute("aria-label", "Assessment pages");
        const previous = element("button", "pagination-button", "Previous");
        const next = element("button", "pagination-button", "Next");
        const pageIndicator = element("span", "pagination-status");
        for (const button of [previous, next]) {
            button.type = "button";
            button.setAttribute("aria-controls", grid.id);
        }
        pagination.append(previous, pageIndicator, next);
        resultsPane.append(grid, pagination);
        directory.append(indexes, resultsPane);
        section.append(
            toolbar,
            shareStatus,
            shareFallback,
            count,
            element("p", "assessment-method-note muted", "Each assessment covers six attributes, each out of 300. The overall tier is calculated from their average."),
            directory
        );

        let results = [];
        let viewRevision = 0;
        let copyAttempt = 0;

        function currentPosition() {
            return { left: window.scrollX, top: window.scrollY, indexes: indexes.scrollTop };
        }

        function restorePosition(position) {
            indexes.scrollTop = position.indexes;
            // The browser naturally clamps this when fewer results cannot fill the previous offset.
            window.scrollTo({ left: position.left, top: position.top, behavior: "instant" });
            rememberScroll();
        }

        function rememberScroll() {
            if (section.isConnected) {
                browseScroll = { view: viewHash(), ...currentPosition() };
            }
        }
        resultsPane.addEventListener("click", event => {
            if (event.target.closest?.(".assessment-card-link")) {
                rememberScroll();
            }
        });
        indexes.addEventListener("scroll", rememberScroll, { passive: true });

        function updateResults() {
            browseState.query = search.value.slice(0, 200);
            browseState.sort = sort.control.value;
            const query = browseState.query.trim().toLowerCase();
            results = players.filter(player => {
                const matchesSearch = `${player.name} ${player.className}`.toLowerCase().includes(query);
                const matchesTier = browseState.tiers.size === 0 || browseState.tiers.has(player.tier);
                const matchesInitial = browseState.initials.size === 0 || browseState.initials.has(playerInitial(player.name));
                return matchesSearch && matchesTier && matchesInitial;
            });
            const alphabetical = (left, right) => left.name.localeCompare(right.name, "en");
            results.sort((left, right) => {
                if (sort.control.value === "alphabetical") {
                    return alphabetical(left, right);
                }
                if (sort.control.value === "newest") {
                    return right.date.localeCompare(left.date) || alphabetical(left, right);
                }
                const difference = sort.control.value === "ascending"
                    ? left.total - right.total : right.total - left.total;
                return difference || alphabetical(left, right);
            });
            renderResults();
        }

        function renderResults() {
            const connected = section.isConnected;
            const position = connected ? currentPosition() : null;
            tierIndex.update();
            initialIndex.update();
            viewRevision += 1;
            copyView.disabled = false;
            shareStatus.textContent = "";
            shareFallback.hidden = true;

            const pageCount = Math.max(1, Math.ceil(results.length / assessmentsPerPage));
            browseState.page = Math.max(1, Math.min(browseState.page, pageCount));
            const start = (browseState.page - 1) * assessmentsPerPage;
            const end = Math.min(start + assessmentsPerPage, results.length);
            const totalLabel = results.length === players.length ? "" : ` (${players.length} total)`;
            count.textContent = players.length === 0 ? "0 assessments" : results.length
                ? `Showing ${start + 1}\u2013${end} of ${results.length} assessments${totalLabel}`
                : `No matching assessments (${players.length} total)`;

            // Replace the previous page so rendered cards never accumulate as people browse.
            grid.replaceChildren(...results.slice(start, end).map(assessmentCard));
            if (!results.length) {
                grid.append(element("p", "empty-state", players.length === 0
                    ? "No assessments have been published yet."
                    : "No assessments match. Try another search or use All to reset either index."));
            }
            pagination.hidden = pageCount <= 1;
            previous.disabled = browseState.page === 1;
            next.disabled = browseState.page === pageCount;
            pageIndicator.textContent = `Page ${browseState.page} of ${pageCount}`;
            saveView();

            if (connected) {
                restorePosition(position);
            } else {
                const view = viewHash();
                const saved = browseScroll.view === view ? browseScroll : { left: 0, top: 0, indexes: 0 };
                const revision = viewRevision;
                window.requestAnimationFrame(() => {
                    if (section.isConnected && revision === viewRevision) {
                        restorePosition(saved);
                    }
                });
            }
        }

        function resetResults() {
            browseState.page = 1;
            updateResults();
        }

        function changePage(offset) {
            browseState.page += offset;
            renderResults();
            count.focus({ preventScroll: true });
        }

        previous.addEventListener("click", () => changePage(-1));
        next.addEventListener("click", () => changePage(1));
        search.addEventListener("input", resetResults);
        sort.control.addEventListener("change", resetResults);
        copyView.addEventListener("click", async () => {
            const revision = viewRevision;
            const attempt = ++copyAttempt;
            const url = new URL(window.location.href);
            url.hash = viewHash();
            const link = url.href;
            const isCurrent = () => section.isConnected && revision === viewRevision && attempt === copyAttempt;
            const position = currentPosition();
            copyView.disabled = true;
            shareStatus.textContent = "";
            shareFallback.hidden = true;
            restorePosition(position);
            try {
                if (!window.navigator?.clipboard?.writeText) {
                    throw new Error("Clipboard unavailable");
                }
                await window.navigator.clipboard.writeText(link);
                if (isCurrent()) {
                    const position = currentPosition();
                    shareStatus.textContent = "View link copied.";
                    restorePosition(position);
                }
            } catch {
                if (isCurrent()) {
                    const position = currentPosition();
                    shareStatus.textContent = "Select and copy the link below.";
                    shareInput.value = link;
                    shareFallback.hidden = false;
                    shareInput.focus({ preventScroll: true });
                    shareInput.select();
                    restorePosition(position);
                }
            } finally {
                if (isCurrent()) {
                    copyView.disabled = false;
                }
            }
        });
        updateResults();
        return section;
    };
})();
