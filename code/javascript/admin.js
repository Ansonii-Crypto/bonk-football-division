"use strict";

(() => {
    const attributeNames = ["Control", "Execution", "Defending", "Reaction time", "Chemistry", "Game sense"];
    const classes = ["Weaver", "Bulwark", "Catalyst", "Tactician", "Opportunist", "Dynamo", "Renegade"];
    const sortOptions = [
        ["newest", "Newest assessment"],
        ["oldest", "Oldest assessment"],
        ["points_desc", "Highest points"],
        ["points_asc", "Lowest points"],
        ["name_asc", "Player name A–Z"]
    ];
    let suggestionId = 0;
    const state = {
        owner: "",
        tab: "assessments",
        mode: "browse",
        query: "",
        sort: "newest",
        page: 1,
        list: null,
        detail: null,
        loading: false,
        pending: false,
        error: "",
        prefill: null
    };
    let requestVersion = 0;

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

    function status(text, error = false) {
        const node = element("p", `admin-status${error ? " admin-status--error" : ""}`, text);
        node.setAttribute("role", "status");
        return node;
    }

    function message(section, title, detail, linkText, href) {
        const panel = element("div", "admin-shell admin-empty");
        panel.append(element("h2", "", title), element("p", "", detail));
        if (linkText && href) {
            const link = element("a", "admin-button admin-button--primary", linkText);
            link.href = href;
            panel.append(link);
        }
        section.append(panel);
        return section;
    }

    async function request(path, method = "GET", body) {
        const controller = new AbortController();
        const timeout = window.setTimeout(() => controller.abort(), 25000);
        try {
            const response = await fetch(path, {
                method,
                headers: body === undefined
                    ? { Accept: "application/json" }
                    : { Accept: "application/json", "Content-Type": "application/json" },
                body: body === undefined ? undefined : JSON.stringify(body),
                credentials: "same-origin",
                cache: "no-store",
                redirect: "error",
                signal: controller.signal
            });
            const data = await response.json().catch(() => null);
            if (!response.ok) {
                const failure = new Error(typeof data?.error === "string" && data.error.length <= 240
                    ? data.error : "The assessment service is unavailable. Please try again.");
                failure.status = response.status;
                throw failure;
            }
            if (!data || typeof data !== "object") {
                throw new Error("The assessment response could not be read. Please try again.");
            }
            return data;
        } catch (error) {
            if (error.name === "AbortError") {
                throw new Error("The assessment request took too long. Please try again.");
            }
            if (error instanceof TypeError) {
                throw new Error("Unable to reach the assessment service. Check your connection and try again.");
            }
            throw error;
        } finally {
            window.clearTimeout(timeout);
        }
    }

    function attachAccountSuggestions(input, field, onChoose) {
        const list = element("div", "admin-account-suggestions");
        const listId = `admin-account-suggestions-${++suggestionId}`;
        list.id = listId;
        list.setAttribute("role", "listbox");
        list.setAttribute("aria-label", "Known Bonk account suggestions");
        list.hidden = true;
        field.classList.add("admin-account-field");
        field.append(list);
        input.autocomplete = "off";
        input.setAttribute("role", "combobox");
        input.setAttribute("aria-autocomplete", "list");
        input.setAttribute("aria-controls", listId);
        input.setAttribute("aria-expanded", "false");

        let timer = 0;
        let controller = null;
        let timeout = 0;
        let revision = 0;
        let options = [];
        let active = -1;
        let disposed = false;

        function close() {
            list.hidden = true;
            input.setAttribute("aria-expanded", "false");
            input.removeAttribute("aria-activedescendant");
            active = -1;
        }

        function cancel() {
            ++revision;
            window.clearTimeout(timer);
            window.clearTimeout(timeout);
            controller?.abort();
            controller = null;
            close();
        }

        function showMessage(message) {
            const notice = element("p", "admin-suggestion-message", message);
            notice.setAttribute("role", "status");
            list.replaceChildren(notice);
            options = [];
            list.hidden = false;
            input.setAttribute("aria-expanded", "true");
        }

        function setActive(index) {
            active = index;
            options.forEach((option, position) => {
                option.classList.toggle("is-active", position === active);
                option.setAttribute("aria-selected", String(position === active));
            });
            if (active >= 0) {
                input.setAttribute("aria-activedescendant", options[active].id);
                options[active].scrollIntoView?.({ block: "nearest" });
            } else {
                input.removeAttribute("aria-activedescendant");
            }
        }

        function choose(account) {
            if (disposed || list.hidden) {
                return;
            }
            cancel();
            input.value = account.username;
            onChoose(account);
        }

        function showAccounts(accounts) {
            list.replaceChildren();
            options = [];
            if (!accounts.length) {
                showMessage("No known names match. You can still enter a username yourself.");
                return;
            }
            for (const account of accounts) {
                const option = element("div", "admin-suggestion-option");
                option.id = `${listId}-option-${options.length}`;
                option.account = account;
                option.setAttribute("role", "option");
                option.setAttribute("aria-selected", "false");
                const avatar = element("span", "admin-suggestion-avatar", Array.from(account.username.trimStart())[0]?.toUpperCase() || "?");
                avatar.setAttribute("aria-hidden", "true");
                const text = element("span", "admin-suggestion-text");
                text.append(element("span", "admin-suggestion-name", `“${account.username}”`),
                    element("span", "admin-suggestion-source", account.source === "verified"
                        ? `Verified sign-in · Bonk player ID ${account.bonkId}` : "From an assessment · identity not verified"));
                option.append(avatar, text);
                option.addEventListener("pointerdown", event => {
                    event.preventDefault();
                    choose(account);
                });
                option.addEventListener("click", () => choose(account));
                options.push(option);
                list.append(option);
            }
            list.append(element("p", "admin-suggestion-caption", "Known to Bonk Football Division"));
            list.hidden = false;
            input.setAttribute("aria-expanded", "true");
            setActive(-1);
        }

        async function lookup(query, version) {
            if (disposed || !input.isConnected || version !== revision) {
                return;
            }
            controller = new AbortController();
            const current = controller;
            const requestTimeout = window.setTimeout(() => current.abort(), 8000);
            timeout = requestTimeout;
            showMessage("Searching known accounts…");
            try {
                const parameters = new URLSearchParams({ q: query, limit: "6" });
                const response = await fetch(`/api/admin/bonk-accounts?${parameters}`, {
                    headers: { Accept: "application/json" },
                    credentials: "same-origin",
                    cache: "no-store",
                    redirect: "error",
                    signal: current.signal
                });
                if (!response.ok) {
                    if ([401, 403].includes(response.status)) {
                        window.BonkAccount.refresh(true);
                    }
                    throw new Error("Suggestions unavailable");
                }
                const data = await response.json();
                if (!Array.isArray(data?.accounts)) {
                    throw new Error("Suggestions unavailable");
                }
                if (disposed || !input.isConnected || version !== revision || current.signal.aborted) {
                    return;
                }
                const accounts = data.accounts.slice(0, 8).filter(account => account
                    && typeof account.username === "string" && account.username.length > 0 && account.username.length <= 100
                    && (account.source === "verified" && typeof account.bonkId === "string" && /^[1-9]\d{0,15}$/.test(account.bonkId)
                        || account.source === "assessment" && account.bonkId === null));
                showAccounts(accounts);
            } catch {
                if (!disposed && input.isConnected && version === revision && !current.signal.aborted) {
                    showMessage("Suggestions are unavailable. You can still search or enter a name manually.");
                }
            } finally {
                window.clearTimeout(requestTimeout);
                if (timeout === requestTimeout) {
                    timeout = 0;
                }
                if (controller === current) {
                    controller = null;
                }
            }
        }

        function onInput() {
            cancel();
            const query = input.value.trim();
            if (query.length < 2) {
                return;
            }
            const version = revision;
            timer = window.setTimeout(() => void lookup(query, version), 250);
        }

        function onKeydown(event) {
            if (event.key === "Escape" && !list.hidden) {
                event.preventDefault();
                cancel();
            } else if (event.key === "Tab") {
                cancel();
            } else if (["ArrowDown", "ArrowUp"].includes(event.key) && options.length && !list.hidden) {
                event.preventDefault();
                setActive((active + (event.key === "ArrowDown" ? 1 : options.length - 1)) % options.length);
            } else if (event.key === "Enter" && active >= 0 && !list.hidden) {
                event.preventDefault();
                choose(options[active].account);
            }
        }

        function onOutside(event) {
            if (!field.contains(event.target)) {
                cancel();
            }
        }

        function dispose() {
            if (disposed) {
                return;
            }
            disposed = true;
            cancel();
            document.removeEventListener("pointerdown", onOutside);
            window.removeEventListener("hashchange", dispose);
            window.removeEventListener("bonk-account-change", dispose);
        }

        input.addEventListener("input", onInput);
        input.addEventListener("keydown", onKeydown);
        document.addEventListener("pointerdown", onOutside);
        window.addEventListener("hashchange", dispose, { once: true });
        window.addEventListener("bonk-account-change", dispose, { once: true });
        return dispose;
    }

    function localDate() {
        const now = new Date();
        return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    }

    function readableDate(value) {
        if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
            return "Date not recorded";
        }
        const date = new Date(`${value}T12:00:00`);
        return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString("en-GB", {
            day: "numeric", month: "long", year: "numeric"
        });
    }

    function renderPage() {
        const section = element("section", "admin-center");
        section.setAttribute("aria-label", "Admin center");
        const session = window.BonkAccount.session();
        if (session.checked && (!session.account || session.account.isAdmin !== true)) {
            ++requestVersion;
            Object.assign(state, { owner: "", tab: "assessments", mode: "browse", list: null,
                detail: null, loading: false, pending: false, error: "", prefill: null });
        }
        if (!session.checked) {
            return message(section, "Checking administrator access", "Verifying your Bonk account session.");
        }
        if (session.unavailable) {
            return message(section, "Account unavailable", session.unavailable, "Account center", "#account");
        }
        if (!session.account) {
            return message(section, "Sign in to administer assessments", "Administrator access is linked to an approved Bonk account.", "Sign in", "#account");
        }
        if (session.account.isAdmin !== true) {
            return message(section, "Administrator access required", "This Bonk account is not linked to an administrator.", "Account center", "#account");
        }
        if (state.owner !== session.account.bonkId) {
            Object.assign(state, { owner: session.account.bonkId, tab: "assessments", mode: "browse",
                query: "", sort: "newest", page: 1, list: null, detail: null, loading: false,
                pending: false, error: "", prefill: null });
        }

        const shell = element("div", "admin-shell");
        const tabs = element("div", "admin-tabs");
        tabs.setAttribute("role", "tablist");
        tabs.setAttribute("aria-label", "Admin center sections");
        const panel = element("div", "admin-panel");
        panel.id = "admin-tab-panel";
        panel.setAttribute("role", "tabpanel");
        let autocompleteCleanup = null;
        const tabButtons = [
            ["assessments", "Assessments"],
            ["new", "New assessment"]
        ].map(([key, label]) => {
            const button = element("button", "admin-tab", label);
            button.type = "button";
            button.id = `admin-tab-${key}`;
            button.setAttribute("role", "tab");
            button.setAttribute("aria-controls", panel.id);
            button.addEventListener("click", () => {
                if (state.tab === key) {
                    return;
                }
                ++requestVersion;
                state.tab = key;
                state.mode = key === "new" ? "create" : "browse";
                state.detail = null;
                state.error = "";
                if (key === "assessments") {
                    state.list = null;
                }
                paint();
            });
            tabs.append(button);
            return button;
        });
        shell.append(tabs, panel);
        section.append(shell);

        function loadList() {
            const version = ++requestVersion;
            state.loading = true;
            state.error = "";
            paint();
            const parameters = new URLSearchParams({ sort: state.sort, page: String(state.page), limit: "12" });
            if (state.query) {
                parameters.set("q", state.query);
            }
            request(`/api/admin/assessments?${parameters}`).then(data => {
                if (version !== requestVersion || !section.isConnected) {
                    return;
                }
                if (!Array.isArray(data.assessments) || !Number.isInteger(data.total)
                    || !Number.isInteger(data.page) || !Number.isInteger(data.pages)) {
                    throw new Error("The assessment list could not be read. Please try again.");
                }
                state.list = data;
                state.page = data.page;
                state.loading = false;
                paint();
            }).catch(error => {
                if (version !== requestVersion || !section.isConnected) {
                    return;
                }
                state.loading = false;
                state.error = error.message;
                if (error.status === 401 || error.status === 403) {
                    window.BonkAccount.refresh(true);
                }
                paint();
            });
        }

        function loadDetail(id, nextMode = "view") {
            const version = ++requestVersion;
            state.mode = "loading-detail";
            state.error = "";
            paint();
            request(`/api/admin/assessments/${encodeURIComponent(id)}`).then(data => {
                if (version !== requestVersion || !section.isConnected) {
                    return;
                }
                if (!data.assessment || typeof data.assessment !== "object") {
                    throw new Error("The assessment could not be read. Please try again.");
                }
                state.detail = data.assessment;
                state.mode = nextMode;
                paint();
            }).catch(error => {
                if (version !== requestVersion || !section.isConnected) {
                    return;
                }
                state.mode = "browse";
                state.error = error.message;
                if (error.status === 401 || error.status === 403) {
                    window.BonkAccount.refresh(true);
                }
                paint();
            });
        }

        function renderBrowse() {
            const browse = element("div", "admin-browse");
            const heading = element("div", "admin-panel-heading");
            heading.append(element("h2", "", "Manage assessments"),
                element("p", "", "Browse records before choosing to edit one."));
            const controls = element("div", "admin-controls");
            const searchForm = element("form", "admin-search");
            searchForm.setAttribute("role", "search");
            const searchLabel = element("label", "", "Find a player");
            const search = element("input", "admin-field");
            search.type = "search";
            search.name = "q";
            search.placeholder = "Username or Bonk player ID";
            search.maxLength = 100;
            search.value = state.query;
            searchLabel.append(search);
            const searchButton = element("button", "admin-button", "Search");
            searchButton.type = "submit";
            searchForm.append(searchLabel, searchButton);
            function submitSearch() {
                state.query = search.value;
                state.page = 1;
                state.list = null;
                loadList();
            }
            searchForm.addEventListener("submit", event => {
                event.preventDefault();
                submitSearch();
            });
            search.addEventListener("input", () => { state.prefill = null; });
            autocompleteCleanup = attachAccountSuggestions(search, searchLabel, account => {
                state.prefill = account;
                submitSearch();
            });
            const sortLabel = element("label", "admin-sort", "Sort by");
            const sort = element("select", "admin-field");
            for (const [value, label] of sortOptions) {
                const option = element("option", "", label);
                option.value = value;
                sort.append(option);
            }
            sort.value = state.sort;
            sort.addEventListener("change", () => {
                state.sort = sort.value;
                state.page = 1;
                state.list = null;
                loadList();
            });
            sortLabel.append(sort);
            controls.append(searchForm, sortLabel);
            browse.append(heading, controls);
            if (state.loading || !state.list && !state.error) {
                browse.append(status("Loading assessments…"));
                if (!state.loading) {
                    window.queueMicrotask(loadList);
                }
                return browse;
            }
            if (state.error) {
                browse.append(status(state.error, true));
                const retry = element("button", "admin-button", "Try again");
                retry.type = "button";
                retry.addEventListener("click", loadList);
                browse.append(retry);
                return browse;
            }
            browse.append(element("p", "admin-results-count", `${state.list.total} ${state.list.total === 1 ? "assessment" : "assessments"}`));
            if (!state.list.assessments.length) {
                browse.append(element("p", "admin-no-results", state.query
                    ? "No assessments match that search." : "No assessments have been added yet."));
                if (state.query) {
                    const create = element("button", "admin-button admin-button--primary admin-create-from-search", "Create an assessment");
                    create.type = "button";
                    create.addEventListener("click", () => {
                        if (!state.prefill || state.prefill.username !== state.query) {
                            state.prefill = /^\d+$/.test(state.query) ? null
                                : { username: state.query, bonkId: null, source: "assessment" };
                        }
                        state.tab = "new";
                        state.mode = "create";
                        paint();
                    });
                    browse.append(create);
                }
                return browse;
            }
            const list = element("div", "admin-assessment-list");
            for (const assessment of state.list.assessments) {
                const row = element("article", "admin-assessment-row");
                const identity = element("div", "admin-assessment-identity");
                identity.append(element("h3", "", assessment.playerName),
                    element("p", "", [assessment.className || "No class", readableDate(assessment.date)].join(" · ")));
                const score = element("div", "admin-assessment-score");
                score.append(element("strong", "", assessment.tier || "—"),
                    element("span", "", `${assessment.total} / 1800`));
                const actions = element("div", "admin-row-actions");
                const view = element("button", "admin-button", "View");
                view.type = "button";
                view.addEventListener("click", () => loadDetail(assessment.id, "view"));
                const edit = element("button", "admin-button admin-button--outline", "Edit");
                edit.type = "button";
                edit.addEventListener("click", () => loadDetail(assessment.id, "edit"));
                actions.append(view, edit);
                row.append(identity, score, actions);
                list.append(row);
            }
            browse.append(list);
            const paging = element("div", "admin-pagination");
            const previous = element("button", "admin-button", "Previous");
            previous.type = "button";
            previous.disabled = state.list.page <= 1;
            const next = element("button", "admin-button", "Next");
            next.type = "button";
            next.disabled = state.list.page >= state.list.pages;
            for (const [button, step] of [[previous, -1], [next, 1]]) {
                button.addEventListener("click", () => {
                    state.page += step;
                    state.list = null;
                    loadList();
                });
            }
            paging.append(previous, element("span", "", `Page ${state.list.page} of ${state.list.pages}`), next);
            browse.append(paging);
            return browse;
        }

        function renderDetail() {
            const assessment = state.detail;
            const view = element("div", "admin-detail");
            const back = element("button", "admin-button admin-button--back", "← All assessments");
            back.type = "button";
            back.addEventListener("click", () => {
                state.mode = "browse";
                state.list = null;
                paint();
            });
            view.append(back);
            const heading = element("div", "admin-detail-heading");
            const name = element("div", "");
            name.append(element("p", "admin-kicker", "Assessment"), element("h2", "", assessment.playerName));
            const tier = element("div", "admin-detail-tier", `${assessment.tier || "—"} tier · ${assessment.total} / 1800`);
            heading.append(name, tier);
            view.append(heading);
            const facts = element("dl", "admin-facts");
            for (const [label, value] of [
                ["Bonk player ID", assessment.playerBonkId || "Not linked"],
                ["Class", assessment.className || "Not recorded"],
                ["Assessment date", readableDate(assessment.date)],
                ["Assessed by", assessment.updatedByName || assessment.createdByName || "Not recorded"]
            ]) {
                const fact = element("div", "");
                fact.append(element("dt", "", label), element("dd", "", value));
                facts.append(fact);
            }
            view.append(facts);
            const scores = element("div", "admin-score-list");
            attributeNames.forEach((label, index) => {
                const item = element("div", "admin-score-item");
                item.append(element("span", "", label), element("strong", "", `${assessment.values?.[index] ?? "—"} / 300`));
                scores.append(item);
            });
            view.append(scores);
            if (assessment.notes) {
                const notes = element("div", "admin-notes");
                notes.append(element("h3", "", "Notes"), element("p", "", assessment.notes));
                view.append(notes);
            }
            const edit = element("button", "admin-button admin-button--primary", "Edit assessment");
            edit.type = "button";
            edit.addEventListener("click", () => {
                state.mode = "edit";
                paint();
            });
            view.append(edit);
            return view;
        }

        function renderForm(editing) {
            const assessment = editing ? state.detail : null;
            const prefill = editing ? null : state.prefill;
            const form = element("form", "admin-form");
            const heading = element("div", "admin-panel-heading");
            heading.append(element("h2", "", editing ? "Edit assessment" : "New assessment"),
                element("p", "", editing ? "Review the current values, then apply your changes." : "Enter the player's details and six attribute scores."));
            form.append(heading);
            const fields = element("fieldset", "admin-form-fields");
            fields.disabled = state.pending;
            const details = element("div", "admin-form-grid");
            function field(label, control) {
                const wrapper = element("label", "admin-field-label", label);
                control.classList.add("admin-field");
                wrapper.append(control);
                details.append(wrapper);
                return control;
            }
            const playerName = field("Bonk username", element("input"));
            playerName.type = "text";
            playerName.maxLength = 100;
            playerName.required = true;
            playerName.value = assessment?.playerName ?? prefill?.username ?? "";
            const playerBonkId = field("Bonk player ID (optional)", element("input"));
            playerBonkId.type = "text";
            playerBonkId.inputMode = "numeric";
            playerBonkId.pattern = "[1-9][0-9]*";
            playerBonkId.maxLength = 16;
            playerBonkId.value = assessment?.playerBonkId ?? (prefill?.source === "verified" ? prefill.bonkId : "") ?? "";
            let linkedName = playerBonkId.value ? playerName.value : null;
            playerName.addEventListener("input", () => {
                if (linkedName && playerName.value !== linkedName) {
                    playerBonkId.value = "";
                    linkedName = null;
                }
            });
            autocompleteCleanup = attachAccountSuggestions(playerName, playerName.parentElement, account => {
                playerName.value = account.username;
                playerBonkId.value = account.source === "verified" ? account.bonkId : "";
                linkedName = account.source === "verified" ? account.username : null;
                if (!editing) {
                    state.prefill = account;
                }
            });
            const className = field("Class", element("select"));
            for (const value of ["", ...classes]) {
                const option = element("option", "", value || "Not recorded");
                option.value = value;
                className.append(option);
            }
            className.value = assessment?.className || "";
            const date = field("Assessment date", element("input"));
            date.type = "date";
            date.required = true;
            date.value = assessment?.date || localDate();
            fields.append(details);
            const scoreHeading = element("h3", "admin-form-subheading", "Attributes");
            const scoreGrid = element("div", "admin-score-grid");
            const inputs = attributeNames.map((label, index) => {
                const wrapper = element("label", "admin-field-label", label);
                const input = element("input", "admin-field");
                input.type = "number";
                input.min = "0";
                input.max = "300";
                input.step = "1";
                input.required = true;
                input.value = assessment?.values?.[index] ?? "";
                wrapper.append(input);
                scoreGrid.append(wrapper);
                return input;
            });
            const total = element("p", "admin-form-total");
            const updateTotal = () => {
                const complete = inputs.every(input => input.value !== "" && Number.isInteger(Number(input.value)));
                total.textContent = complete ? `${inputs.reduce((sum, input) => sum + Number(input.value), 0)} / 1800 points` : "Enter all six scores to see the total.";
            };
            inputs.forEach(input => input.addEventListener("input", updateTotal));
            updateTotal();
            fields.append(scoreHeading, scoreGrid, total);
            const notesLabel = element("label", "admin-field-label admin-notes-field", "Notes (optional)");
            const notes = element("textarea", "admin-field");
            notes.maxLength = 2000;
            notes.rows = 4;
            notes.value = assessment?.notes || "";
            notesLabel.append(notes);
            fields.append(notesLabel);
            const formStatus = status(state.error, Boolean(state.error));
            const actions = element("div", "admin-form-actions");
            const cancel = element("button", "admin-button", "Cancel");
            cancel.type = "button";
            cancel.addEventListener("click", () => {
                state.error = "";
                state.mode = editing ? "view" : "browse";
                state.tab = "assessments";
                if (!editing) {
                    state.list = null;
                }
                paint();
            });
            const submit = element("button", "admin-button admin-button--primary", editing ? "Apply changes" : "Create assessment");
            submit.type = "submit";
            actions.append(cancel, submit);
            fields.append(actions);
            form.append(fields, formStatus);
            form.addEventListener("submit", async event => {
                event.preventDefault();
                if (state.pending || !form.reportValidity()) {
                    return;
                }
                const values = inputs.map(input => Number(input.value));
                if (!playerName.value.trim() || values.some(value => !Number.isInteger(value) || value < 0 || value > 300)) {
                    formStatus.textContent = "Enter a username and whole number scores from 0 to 300.";
                    formStatus.classList.add("admin-status--error");
                    return;
                }
                const body = { playerName: playerName.value, playerBonkId: playerBonkId.value || null,
                    className: className.value, date: date.value, values, notes: notes.value };
                if (editing) {
                    body.version = assessment.version;
                }
                state.pending = true;
                fields.disabled = true;
                formStatus.textContent = editing ? "Applying changes…" : "Creating assessment…";
                formStatus.classList.remove("admin-status--error");
                try {
                    const data = await request(editing
                        ? `/api/admin/assessments/${encodeURIComponent(assessment.id)}` : "/api/admin/assessments",
                    editing ? "PUT" : "POST", body);
                    if (!data.assessment || typeof data.assessment !== "object") {
                        throw new Error("The saved assessment could not be read. Please reload this page.");
                    }
                    if (!section.isConnected) {
                        return;
                    }
                    state.detail = data.assessment;
                    state.list = null;
                    state.tab = "assessments";
                    state.mode = "view";
                    state.error = "";
                    state.prefill = null;
                    paint();
                } catch (error) {
                    if (!section.isConnected) {
                        return;
                    }
                    state.error = error.status === 409
                        ? "This assessment was changed elsewhere. Reload it before editing again."
                        : error.message;
                    formStatus.textContent = state.error;
                    formStatus.classList.add("admin-status--error");
                    if (error.status === 409) {
                        const reload = element("button", "admin-button", "Reload assessment");
                        reload.type = "button";
                        reload.addEventListener("click", () => loadDetail(assessment.id, "view"));
                        formStatus.after(reload);
                    }
                    if (error.status === 401 || error.status === 403) {
                        window.BonkAccount.refresh(true);
                    }
                } finally {
                    state.pending = false;
                    if (fields.isConnected) {
                        fields.disabled = false;
                    }
                }
            });
            return form;
        }

        function paint() {
            if (!section.isConnected && panel.hasChildNodes()) {
                return;
            }
            autocompleteCleanup?.();
            autocompleteCleanup = null;
            tabButtons.forEach((button, index) => {
                const selected = state.tab === (index === 0 ? "assessments" : "new");
                button.setAttribute("aria-selected", String(selected));
                button.tabIndex = selected ? 0 : -1;
            });
            panel.setAttribute("aria-labelledby", state.tab === "new" ? "admin-tab-new" : "admin-tab-assessments");
            if (state.tab === "new") {
                panel.replaceChildren(renderForm(false));
            } else if (state.mode === "loading-detail") {
                panel.replaceChildren(status("Loading assessment…"));
            } else if (state.mode === "view" && state.detail) {
                panel.replaceChildren(renderDetail());
            } else if (state.mode === "edit" && state.detail) {
                panel.replaceChildren(renderForm(true));
            } else {
                panel.replaceChildren(renderBrowse());
            }
        }

        tabs.addEventListener("keydown", event => {
            if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
                return;
            }
            event.preventDefault();
            const next = event.key === "Home" || event.key === "ArrowLeft" ? 0 : 1;
            tabButtons[next].click();
            tabButtons[next].focus();
        });
        paint();
        return section;
    }

    window.BonkAdmin = { renderPage };
})();
