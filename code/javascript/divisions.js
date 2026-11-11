"use strict";

(() => {
    const sectionNames = { general: "Event information", appearance: "Background", participation: "Participation", timeline: "Timeline", teams: "Teams and players", bracket: "Tournament bracket", campaigns: "Campaigns", referendums: "Referendums" };
    const roleNames = { "site-admin": "Site administrator", director: "Division director", organizer: "Organiser", editor: "Editor" };

    function element(tag, className, text) {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (text !== undefined) node.textContent = String(text);
        return node;
    }

    function button(text, action, className = "") {
        const node = element("button", `division-button ${className}`, text);
        node.type = "button";
        node.addEventListener("click", action);
        return node;
    }

    async function request(path, method = "GET", body) {
        const controller = new AbortController();
        const timeout = window.setTimeout(() => controller.abort(), 20000);
        try {
            const response = await fetch(path, {
                method, credentials: "same-origin", cache: "no-store", redirect: "error", signal: controller.signal,
                headers: body === undefined ? { Accept: "application/json" } : { Accept: "application/json", "Content-Type": "application/json" },
                body: body === undefined ? undefined : JSON.stringify(body)
            });
            const data = await response.json().catch(() => null);
            if (!response.ok) {
                const error = new Error(typeof data?.error === "string" ? data.error : "Unable to load this division. Please try again.");
                error.status = response.status;
                throw error;
            }
            if (!data || typeof data !== "object") throw new Error("The division response could not be read.");
            return data;
        } catch (error) {
            if (error.name === "AbortError") throw new Error("The request took too long. Please try again.");
            throw error;
        } finally {
            window.clearTimeout(timeout);
        }
    }

    function clone(value) { return JSON.parse(JSON.stringify(value)); }
    function id() { return `item-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`; }

    function backgroundImage(value) {
        try {
            const url = new URL(value);
            return url.protocol === "https:" && !url.username && !url.password ? url.href : "";
        } catch {
            return "";
        }
    }

    function applyBackground(node, appearance, card = false) {
        const colour = /^#[0-9a-f]{6}$/i.test(appearance?.backgroundColor || "") ? appearance.backgroundColor : "";
        const image = backgroundImage(appearance?.backgroundImage || "");
        const custom = Boolean(colour || image);
        if (!card) node.hidden = !custom;
        if (!custom) return;
        node.style.backgroundColor = colour || "#080c14";
        const layers = [];
        if (card) layers.push("linear-gradient(rgb(8 12 20 / 72%), rgb(8 12 20 / 88%))");
        else if (image) layers.push("linear-gradient(rgb(8 12 20 / 22%), rgb(8 12 20 / 22%))");
        if (image) layers.push(`url(${JSON.stringify(image)})`);
        node.style.backgroundImage = layers.length ? layers.join(", ") : "none";
    }

    function invitation() {
        const panel = element("section", "division-host-invitation");
        panel.append(element("p", "division-eyebrow", "For tournament hosts"), element("h2", "", "Bring your event to the division."),
            element("p", "", "Running a Bonk.io football tournament? This is a place for your event, its players and the people organising it."),
            element("span", "division-state", "Host request form coming soon"));
        return panel;
    }

    function card(division, managed = false) {
        const node = element("a", "division-event-card");
        node.href = `#divisions/${encodeURIComponent(division.id)}`;
        applyBackground(node, division.appearance, true);
        node.append(element("span", "division-state", managed && !division.publishedAt ? "Private draft" : division.status || "Upcoming"),
            element("h3", "", division.name), element("p", "", division.summary || "Open the event for its format, schedule and bracket."));
        const footer = element("div", "division-card-footer");
        footer.append(element("span", "", managed ? roleNames[division.role] || "Management" : division.startDate || "Dates to be announced"), element("span", "", "Open event →"));
        node.append(footer);
        return node;
    }

    function renderList() {
        const section = element("section", "page-content divisions-directory");
        const session = window.BonkAccount.session();
        section.append(invitation());
        const management = element("div", "division-directory-management");
        const events = element("section", "division-directory-events");
        events.append(element("h2", "", "Published events"));
        const grid = element("div", "division-event-grid");
        const loading = element("p", "division-muted", "Loading events…");
        loading.setAttribute("role", "status");
        grid.append(loading);
        const pagination = element("nav", "division-directory-pagination");
        pagination.setAttribute("aria-label", "Division pages");
        events.append(grid, pagination);
        section.append(management, events);
        let page = 1;
        let listRevision = 0;
        async function loadEvents() {
            const revision = ++listRevision;
            try {
                const data = await request(`/api/divisions?page=${page}&limit=12`);
                if (!section.isConnected || revision !== listRevision) return;
                grid.replaceChildren(...data.divisions.map(item => card(item)));
                if (!data.divisions.length) grid.append(element("p", "division-empty", "No events have been published yet."));
                pagination.replaceChildren();
                if (data.pages > 1) {
                    const previous = button("Previous", () => { page -= 1; void loadEvents(); });
                    const next = button("Next", () => { page += 1; void loadEvents(); });
                    previous.disabled = data.page <= 1;
                    next.disabled = data.page >= data.pages;
                    pagination.append(previous, element("span", "division-muted", `Page ${data.page} of ${data.pages}`), next);
                }
            } catch (error) {
                if (!section.isConnected || revision !== listRevision) return;
                grid.replaceChildren(element("p", "division-error", error.message), button("Try again", () => void loadEvents()));
            }
        }
        if (session.account) {
            const heading = element("div", "division-directory-heading");
            heading.append(element("h2", "", session.account.isAdmin ? "Division management" : "Your divisions"));
            management.append(heading);
            const managed = element("div", "division-event-grid");
            management.append(managed);
            if (session.account.isAdmin) {
                const create = element("form", "division-create-form");
                create.hidden = true;
                const name = element("input", "division-field");
                name.required = true;
                name.maxLength = 120;
                name.placeholder = "Division or tournament name";
                name.setAttribute("aria-label", "New division name");
                const summary = element("input", "division-field");
                summary.maxLength = 300;
                summary.placeholder = "A short introduction";
                summary.setAttribute("aria-label", "New division introduction");
                const submit = element("button", "division-button division-button--primary", "Create private draft");
                submit.type = "submit";
                const status = element("p", "division-message");
                status.setAttribute("role", "status");
                create.append(name, summary, submit, status);
                create.addEventListener("submit", async event => {
                    event.preventDefault();
                    if (!create.reportValidity()) return;
                    submit.disabled = true;
                    status.textContent = "Creating division…";
                    try {
                        const data = await request("/api/admin/divisions", "POST", { name: name.value, summary: summary.value });
                        if (section.isConnected) window.location.hash = `#divisions/${data.division.id}`;
                    } catch (error) {
                        status.textContent = error.message;
                        submit.disabled = false;
                    }
                });
                heading.append(button("New division", () => { create.hidden = !create.hidden; if (!create.hidden) name.focus(); }, "division-button--primary"));
                management.append(create);
            }
            let managedPage = 1;
            let managedRevision = 0;
            const managedPagination = element("nav", "division-directory-pagination");
            managedPagination.setAttribute("aria-label", "Managed division pages");
            management.append(managedPagination);
            async function loadManaged() {
                const revision = ++managedRevision;
                try {
                    const data = await request(`/api/manage/divisions?page=${managedPage}&limit=12`);
                    if (!section.isConnected || revision !== managedRevision) return;
                    managed.replaceChildren(...data.divisions.map(item => card(item, true)));
                    managedPagination.replaceChildren();
                    if (data.pages > 1) {
                        const previous = button("Previous", () => { managedPage -= 1; void loadManaged(); });
                        const next = button("Next", () => { managedPage += 1; void loadManaged(); });
                        previous.disabled = data.page <= 1;
                        next.disabled = data.page >= data.pages;
                        managedPagination.append(previous, element("span", "division-muted", `Page ${data.page} of ${data.pages}`), next);
                    }
                    if (!data.divisions.length) {
                        if (!session.account.isAdmin) management.hidden = true;
                        else managed.append(element("p", "division-empty", "Create a division to start its private event template."));
                    }
                } catch (error) {
                    if (section.isConnected && revision === managedRevision) managed.replaceChildren(element("p", "division-error", error.message));
                }
            }
            void Promise.resolve().then(loadManaged);
        }
        void Promise.resolve().then(loadEvents);
        return section;
    }

    function renderDivision(divisionId) {
        const section = element("section", "division-event-page");
        const backdrop = element("div", "division-page-background");
        backdrop.setAttribute("aria-hidden", "true");
        backdrop.hidden = true;
        section.append(backdrop);
        const back = element("a", "division-back", "← All divisions");
        back.href = "#divisions";
        section.append(back);
        const container = element("div", "division-event-container");
        const initial = element("p", "division-muted", "Loading event…");
        initial.setAttribute("role", "status");
        container.append(initial);
        section.append(container);
        let model = null;
        let draft = null;
        let editing = false;
        let selected = "general";
        let dirty = false;
        let editRevision = 0;
        let pending = false;
        let message = "";
        let members = null;
        let preview;
        let inspector;
        let notice;
        let saveButton;
        let publishButton;

        function editable(key) { return model?.permissions?.editSections?.includes(key); }
        function change() { editRevision += 1; dirty = true; message = "Unsaved changes · save before publishing"; updateNotice(); paintPreview(); }
        function updateNotice() {
            if (notice) notice.textContent = message || (model?.publishedAt
                ? model.version === model.publishedVersion ? "Draft preview · published version is up to date" : "Draft preview · saved changes are not published"
                : "Private draft preview · publish when the event is ready");
            for (const action of container.querySelectorAll(".division-management-actions .division-button")) action.disabled = pending;
            if (saveButton) saveButton.disabled = pending || !dirty;
            if (publishButton) publishButton.disabled = pending || dirty;
        }
        function paintPreview() {
            if (!preview) return;
            applyBackground(backdrop, draft.appearance);
            section.classList.toggle("division-custom-background", !backdrop.hidden);
            preview.replaceChildren(window.DivisionView.render(draft, { editing, editableSections: model.permissions?.editSections || [],
                onSection(key) { selected = key; paintInspector(); inspector?.scrollIntoView?.({ block: "nearest", behavior: "smooth" }); } }));
        }
        async function load() {
            try {
                let data;
                if (window.BonkAccount.session().account) {
                    try { data = await request(`/api/manage/divisions/${encodeURIComponent(divisionId)}`); }
                    catch (error) { if (![401, 403, 404].includes(error.status)) throw error; }
                }
                if (!data) data = await request(`/api/divisions/${encodeURIComponent(divisionId)}`);
                if (!section.isConnected) return;
                model = data.division;
                draft = clone(model.content);
                dirty = false; pending = false; message = "";
                document.title = `${draft.name} | Bonk Football Division`;
                paint();
            } catch (error) {
                if (section.isConnected) container.replaceChildren(element("p", "division-error", error.message), button("Try again", () => void load()));
            }
        }
        async function save() {
            if (pending || !dirty) return;
            const savedRevision = editRevision;
            pending = true; message = "Saving draft…"; updateNotice();
            try {
                const data = await request(`/api/manage/divisions/${divisionId}`, "PUT", { version: model.version, content: draft });
                if (!section.isConnected) return;
                model = data.division;
                if (editRevision === savedRevision) { draft = clone(model.content); dirty = false; message = "Draft saved · preview changes before publishing"; }
                else message = "Draft saved · newer preview edits still need saving";
                document.title = `${draft.name} | Bonk Football Division`;
            } catch (error) {
                message = error.message;
                if (error.status === 409) message += " Your local changes are kept. Reload the saved draft to use the newer version.";
            } finally { pending = false; if (section.isConnected) updateNotice(); }
        }
        async function publish() {
            if (pending || dirty) return;
            pending = true; message = "Publishing event…"; updateNotice();
            try {
                const data = await request(`/api/manage/divisions/${divisionId}/publish`, "POST", { version: model.version });
                if (!section.isConnected) return;
                model = data.division; message = "Event published";
            } catch (error) { message = error.message; }
            finally { pending = false; if (section.isConnected) paint(); }
        }
        async function unpublish() {
            if (pending) return;
            pending = true; message = "Removing public event…"; updateNotice();
            try {
                const data = await request(`/api/manage/divisions/${divisionId}/unpublish`, "POST", { version: model.version });
                if (!section.isConnected) return;
                model = data.division; message = "Event unpublished · draft preview is preserved";
            } catch (error) { message = error.message; }
            finally { pending = false; if (section.isConnected) paint(); }
        }
        function paint() {
            container.replaceChildren();
            saveButton = null; publishButton = null; notice = null;
            if (model.permissions?.editSections?.length) {
                const toolbar = element("div", "division-management-bar");
                const identity = element("div", "division-management-identity");
                identity.append(element("strong", "", roleNames[model.role] || "Division management"));
                notice = element("p", "division-message"); notice.setAttribute("role", "status"); identity.append(notice);
                const actions = element("div", "division-management-actions");
                const view = button("View", () => { editing = false; paint(); });
                const edit = button("Edit", () => { editing = true; paint(); });
                view.disabled = pending; edit.disabled = pending;
                view.setAttribute("aria-pressed", String(!editing)); edit.setAttribute("aria-pressed", String(editing));
                saveButton = button("Save draft", () => void save(), "division-button--primary");
                actions.append(view, edit, saveButton);
                if (model.permissions.publish) {
                    publishButton = button("Publish", () => void publish(), "division-button--warm"); actions.append(publishButton);
                    if (model.publishedAt) { const unpublishButton = button("Unpublish", () => void unpublish(), "division-button--danger"); unpublishButton.disabled = pending; actions.append(unpublishButton); }
                }
                const reload = button("Reload saved draft", () => {
                    if (!dirty || window.confirm("Discard the unsaved preview changes and reload the saved draft?")) void load();
                });
                reload.disabled = pending; actions.append(reload);
                toolbar.append(identity, actions); container.append(toolbar); updateNotice();
            }
            const workspace = element("div", `division-workspace${editing ? " is-editing" : ""}`);
            preview = element("div", "division-live-preview"); workspace.append(preview);
            if (editing) { inspector = element("aside", "division-inspector"); inspector.setAttribute("aria-label", "Edit event section"); workspace.append(inspector); }
            else inspector = null;
            container.append(workspace); paintPreview(); if (editing) paintInspector();
        }

        function inputField(parent, label, value, onInput, options = {}) {
            const wrapper = element("label", "division-field-label", label);
            let control;
            if (options.options) {
                control = element("select", "division-field");
                for (const [key, text] of options.options) { const option = element("option", "", text); option.value = key; control.append(option); }
            } else {
                control = element(options.multiline ? "textarea" : "input", "division-field");
                if (!options.multiline) control.type = options.type || "text";
                else control.rows = options.rows || 3;
            }
            if (options.maxLength) control.maxLength = options.maxLength;
            if (options.min !== undefined) control.min = options.min;
            if (options.max !== undefined) control.max = options.max;
            control.value = value ?? ""; control.disabled = Boolean(options.disabled);
            control.addEventListener(options.options || options.type === "number" ? "change" : "input", () => { onInput(control.value); if (!options.noChange) change(); });
            wrapper.append(control); parent.append(wrapper); return control;
        }
        function paintInspector() {
            if (!inspector) return;
            if (!editable(selected) && selected !== "members") selected = model.permissions.editSections[0];
            inspector.replaceChildren();
            const navigation = element("nav", "division-inspector-navigation"); navigation.setAttribute("aria-label", "Event sections");
            for (const key of model.permissions.editSections) {
                const tab = button(sectionNames[key], () => { selected = key; paintInspector(); }); tab.setAttribute("aria-pressed", String(selected === key)); navigation.append(tab);
            }
            if (model.permissions.manageMembers) {
                const tab = button("Management roles", () => { selected = "members"; paintInspector(); }); tab.setAttribute("aria-pressed", String(selected === "members")); navigation.append(tab);
            }
            inspector.append(element("p", "division-eyebrow", "Live editor"), navigation);
            const body = element("div", "division-inspector-body"); body.append(element("h2", "", selected === "members" ? "Management roles" : sectionNames[selected])); inspector.append(body);
            if (selected === "general") editGeneral(body);
            if (selected === "appearance") editAppearance(body);
            if (selected === "participation") editParticipation(body);
            if (["timeline", "campaigns", "referendums"].includes(selected)) editCollection(body, selected);
            if (selected === "teams") editTeams(body);
            if (selected === "bracket") editBracket(body);
            if (selected === "members") editMembers(body);
        }
        function editGeneral(body) {
            const fields = model.permissions.generalFields || (model.role === "editor" ? ["description"] : ["name", "summary", "description", "status", "startDate", "endDate"]);
            if (fields.includes("name")) inputField(body, "Event name", draft.name, value => { draft.name = value; }, { maxLength: 120 });
            if (fields.includes("summary")) inputField(body, "Short introduction", draft.summary, value => { draft.summary = value; }, { multiline: true, maxLength: 300 });
            if (fields.includes("description")) inputField(body, "About this event", draft.description, value => { draft.description = value; }, { multiline: true, rows: 6, maxLength: 5000 });
            if (fields.includes("status")) inputField(body, "Event status", draft.status, value => { draft.status = value; }, { options: [["upcoming", "Upcoming"], ["registration", "Registration"], ["live", "Live"], ["completed", "Completed"]] });
            if (fields.includes("startDate")) inputField(body, "Start date", draft.startDate, value => { draft.startDate = value; }, { type: "date" });
            if (fields.includes("endDate")) inputField(body, "End date", draft.endDate, value => { draft.endDate = value; }, { type: "date" });
        }
        function editAppearance(body) {
            const appearance = draft.appearance || { backgroundColor: "", backgroundImage: "" };
            const colour = inputField(body, "Background colour", appearance.backgroundColor || "#080c14", value => {
                draft.appearance = { ...appearance, backgroundColor: value };
                appearance.backgroundColor = value;
            }, { type: "color" });
            colour.classList.add("division-colour-picker");
            const image = inputField(body, "Background image URL", appearance.backgroundImage, value => {
                draft.appearance = { ...appearance, backgroundImage: value };
                appearance.backgroundImage = value;
            }, { type: "url", maxLength: 2048 });
            image.placeholder = "https://example.com/background.jpg";
            body.append(element("p", "division-editor-note", "Paste a direct HTTPS image link. The image fills the event background; the colour is used underneath it."));
            body.append(button("Reset background", () => {
                draft.appearance = { backgroundColor: "", backgroundImage: "" };
                change();
                paintInspector();
            }));
        }
        function editParticipation(body) {
            inputField(body, "Participation mode", draft.participation.mode, value => { draft.participation.mode = value; if (value === "solo") draft.participation.teamSize = 1; paintInspector(); }, { options: [["solo", "Individual players"], ["teams", "Team battles"]] });
            inputField(body, "Players per side", draft.participation.teamSize, value => { draft.participation.teamSize = Number(value); }, { options: [["1", "1 vs 1"], ["2", "2 vs 2"], ["3", "3 vs 3"], ["4", "4 vs 4"]], disabled: draft.participation.mode === "solo" });
            inputField(body, "Participation availability", draft.participation.registration, value => { draft.participation.registration = value; }, { options: [["closed", "Closed"], ["open", "Open"], ["invite-only", "Invitation only"]] });
            inputField(body, "Participation details", draft.participation.description, value => { draft.participation.description = value; }, { multiline: true, maxLength: 2000 });
            body.append(element("p", "division-editor-note", "This describes how to take part. Registration submissions are not collected by this template."));
        }
        function editCollection(body, key) {
            const limit = key === "timeline" ? 30 : 12;
            draft[key].forEach((item, index) => {
                const entry = element("div", "division-editor-entry"); const heading = element("div", "division-editor-entry-heading");
                heading.append(element("strong", "", `${key === "timeline" ? "Stage" : "Item"} ${index + 1}`), button("Remove", () => { draft[key].splice(index, 1); change(); paintInspector(); }, "division-button--danger")); entry.append(heading);
                inputField(entry, key === "referendums" ? "Question or title" : "Title", item.title, value => { item.title = value; }, { maxLength: key === "referendums" ? 200 : 120 });
                if (key === "timeline") inputField(entry, "Date", item.date, value => { item.date = value; }, { type: "date" });
                inputField(entry, "Description", item.description, value => { item.description = value; }, { multiline: true, maxLength: key === "timeline" ? 1000 : 2000 });
                if (key === "referendums") {
                    inputField(entry, "Status", item.status, value => { item.status = value; }, { options: [["planned", "Planned"], ["open", "Open"], ["closed", "Closed"]] });
                    inputField(entry, "Choices, one per line", item.options.join("\n"), value => { item.options = value.split("\n").filter(Boolean); }, { multiline: true, maxLength: 1000 });
                }
                body.append(entry);
            });
            const add = button(`Add ${key === "timeline" ? "timeline stage" : key === "campaigns" ? "campaign" : "referendum"}`, () => {
                const item = { id: id(), title: "", description: "" };
                if (key === "timeline") item.date = "";
                if (key === "referendums") Object.assign(item, { options: [], status: "planned" });
                draft[key].push(item); change(); paintInspector();
            });
            add.disabled = draft[key].length >= limit; body.append(add);
            if (key === "referendums") body.append(element("p", "division-editor-note", "Referendums are information blocks in this template. Voting is not enabled."));
        }
        function editTeams(body) {
            body.append(element("p", "division-editor-note", `Team order determines seeding. Up to ${draft.participation.teamSize} players per side. Adding or removing entrants clears bracket scores.`));
            draft.teams.forEach((team, index) => {
                const entry = element("div", "division-editor-entry"); const heading = element("div", "division-editor-entry-heading");
                heading.append(element("strong", "", `Seed ${index + 1}`), button("Remove", () => { draft.teams.splice(index, 1); draft.results = {}; change(); paintInspector(); }, "division-button--danger")); entry.append(heading);
                inputField(entry, draft.participation.mode === "solo" ? "Entrant name" : "Team name", team.name, value => { team.name = value; }, { maxLength: 100 });
                inputField(entry, "Bonk usernames, one per line", team.players.map(player => player.username).join("\n"), value => { team.players = value.split("\n").filter(name => name.trim()).map(username => ({ username, bonkId: null })); }, { multiline: true, maxLength: 500 });
                body.append(entry);
            });
            const add = button(draft.participation.mode === "solo" ? "Add entrant" : "Add team", () => { draft.teams.push({ id: id(), name: "", players: [] }); draft.results = {}; change(); paintInspector(); });
            add.disabled = draft.teams.length >= 16; body.append(add);
        }
        function editBracket(body) {
            body.append(element("p", "division-editor-note", "Single elimination. Add entrants under Teams and players, then enter scores here. A tied or incomplete score does not advance a winner."));
            const rounds = window.DivisionView.buildBracket(draft.teams, draft.results);
            if (!rounds.length) { body.append(element("p", "division-muted", "Add at least two entrants to create a bracket.")); return; }
            rounds.forEach((matches, roundIndex) => {
                body.append(element("h3", "", window.DivisionView.roundTitle?.(roundIndex, rounds.length) || `Round ${roundIndex + 1}`));
                matches.forEach(match => {
                    const entry = element("div", "division-editor-entry"); entry.append(element("strong", "", `${match.teamA?.name || "TBD"} vs ${match.teamB?.name || "TBD"}`));
                    const scores = element("div", "division-score-fields");
                    const update = (side, value) => {
                        draft.results[match.key] = { teamAId: match.teamA?.id || null, teamBId: match.teamB?.id || null, scoreA: match.scoreA ?? null, scoreB: match.scoreB ?? null, ...{ [side]: value === "" ? null : Number(value) } };
                        paintInspector();
                    };
                    inputField(scores, "First side", match.scoreA, value => update("scoreA", value), { type: "number", min: 0, max: 99, disabled: !match.teamA || !match.teamB });
                    inputField(scores, "Second side", match.scoreB, value => update("scoreB", value), { type: "number", min: 0, max: 99, disabled: !match.teamA || !match.teamB });
                    entry.append(scores); body.append(entry);
                });
            });
            body.append(button("Clear all scores", () => { draft.results = {}; change(); paintInspector(); }, "division-button--danger"));
        }
        function editMembers(body) {
            body.append(element("p", "division-editor-note", "Directors publish and manage lower roles. Organisers edit the event and competition. Editors maintain descriptions, campaigns and referendums. Accounts must sign in to this site before they can be assigned."));
            const list = element("div", "division-member-list"); body.append(list);
            const memberStatus = element("p", "division-message"); memberStatus.setAttribute("role", "status");
            function showMembers() {
                list.replaceChildren();
                for (const member of members || []) {
                    const row = element("div", "division-member-row"); const info = element("div");
                    info.append(element("strong", "", member.username), element("span", "division-muted", `${roleNames[member.role] || member.role} · Bonk player ID ${member.bonkId}`)); row.append(info);
                    if (model.permissions.assignRoles.includes(member.role)) row.append(button("Remove", async () => {
                        try { const data = await request(`/api/manage/divisions/${divisionId}/members/${encodeURIComponent(member.bonkId)}`, "DELETE"); members = data.members; if (section.isConnected) showMembers(); }
                        catch (error) { memberStatus.textContent = error.message; }
                    }, "division-button--danger"));
                    list.append(row);
                }
                if (!members?.length) list.append(element("p", "division-muted", "No division roles have been assigned yet."));
            }
            if (members) showMembers();
            else {
                list.append(element("p", "division-muted", "Loading roles…"));
                void request(`/api/manage/divisions/${divisionId}/members`).then(data => { members = data.members; if (list.isConnected) showMembers(); })
                    .catch(error => { if (list.isConnected) list.replaceChildren(element("p", "division-error", error.message)); });
            }
            const form = element("form", "division-member-form"); let bonkId = ""; let role = model.permissions.assignRoles[0];
            inputField(form, "Bonk player ID", "", value => { bonkId = value; }, { maxLength: 16, noChange: true });
            inputField(form, "Management role", role, value => { role = value; }, { options: model.permissions.assignRoles.map(key => [key, roleNames[key]]), noChange: true });
            const submit = element("button", "division-button division-button--primary", "Assign role"); submit.type = "submit"; form.append(submit);
            form.addEventListener("submit", async event => {
                event.preventDefault(); submit.disabled = true; memberStatus.textContent = "Assigning role…";
                try { const data = await request(`/api/manage/divisions/${divisionId}/members`, "POST", { bonkId, role }); members = data.members; if (!section.isConnected) return; showMembers(); memberStatus.textContent = "Role assigned"; }
                catch (error) { memberStatus.textContent = error.message; }
                finally { submit.disabled = false; }
            });
            body.append(form, memberStatus);
        }
        void Promise.resolve().then(load);
        return section;
    }
    window.BonkDivisions = { renderList, renderDivision };
    window.renderDivisionsPage = renderList;
})();
