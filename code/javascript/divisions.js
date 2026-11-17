"use strict";

(() => {
    const sectionNames = { general: "Event information", appearance: "Background", banner: "Banner", participation: "Participation", timeline: "Timeline", teams: "Teams and players", bracket: "Tournament bracket", campaigns: "Campaigns", referendums: "Referendums" };
    const sectionDescriptions = {
        participation: "Match format and how players can take part.",
        timeline: "Dates, milestones and event announcements.",
        teams: "Entrants and their player rosters.",
        bracket: "Fixtures, results and the route to the final.",
        campaigns: "Announcements and campaigns for the event.",
        referendums: "Proposals and the choices being discussed."
    };
    const roleNames = { "site-admin": "Site administrator", director: "Division director", organizer: "Organiser", editor: "Editor" };
    const statusNames = { upcoming: "Upcoming", registration: "Registration open", live: "Live", completed: "Completed" };

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

    function applyBackground(node, appearance) {
        const colour = /^#[0-9a-f]{6}$/i.test(appearance?.backgroundColor || "") ? appearance.backgroundColor : "";
        const image = backgroundImage(appearance?.backgroundImage || "");
        const custom = Boolean(colour || image);
        node.hidden = !custom;
        if (!custom) return;
        node.style.backgroundColor = colour || "#080c14";
        const layers = [];
        if (image) layers.push("linear-gradient(rgb(8 12 20 / 22%), rgb(8 12 20 / 22%))");
        if (image) layers.push(`url(${JSON.stringify(image)})`);
        node.style.backgroundImage = layers.length ? layers.join(", ") : "none";
    }

    function invitation() {
        const panel = element("section", "division-host-invitation");
        const copy = element("div");
        copy.append(element("h2", "", "Hosting a tournament?"), element("p", "", "Keep your event, schedule, teams and results together."));
        panel.append(copy, element("span", "division-muted", "Host requests coming soon"));
        return panel;
    }

    function applyCover(node, appearance) {
        const value = appearance?.bannerColor ?? appearance?.backgroundColor ?? "";
        const colour = /^#[0-9a-f]{6}$/i.test(value) ? value : "";
        const image = backgroundImage(appearance?.bannerImage ?? appearance?.backgroundImage);
        node.classList.toggle("division-cover--custom", Boolean(colour));
        node.classList.toggle("division-cover--image", Boolean(image));
        if (colour) node.style.setProperty("--division-cover-colour", colour);
        else node.style.removeProperty("--division-cover-colour");
        if (image) node.style.setProperty("--division-cover-image", `url(${JSON.stringify(image)})`);
        else node.style.removeProperty("--division-cover-image");
    }

    function eventDates(start, end) {
        const valid = value => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T12:00:00`));
        const values = [start, end].filter(valid);
        if (!values.length) return "Dates to be announced";
        const format = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" });
        const first = new Date(`${values[0]}T12:00:00`);
        const last = new Date(`${values.at(-1)}T12:00:00`);
        return first.getTime() !== last.getTime() && first < last && format.formatRange
            ? format.formatRange(first, last) : format.format(first);
    }

    function card(division) {
        const node = element("a", "division-event-card");
        node.href = `#divisions/${encodeURIComponent(division.id)}`;
        const cover = element("div", "division-card-cover division-cover");
        cover.setAttribute("aria-hidden", "true");
        applyCover(cover, division.appearance);
        const body = element("div", "division-card-content");
        const status = Object.hasOwn(statusNames, division.status) ? division.status : "upcoming";
        body.append(element("span", `division-state division-state--${status}`, statusNames[status]),
            element("h3", "", division.name), element("p", "", division.summary || "Open the event for its format, schedule and bracket."));
        const metadata = element("div", "division-card-meta");
        metadata.append(element("span", "", eventDates(division.startDate, division.endDate)));
        const size = division.participation?.teamSize;
        if (Number.isInteger(size) && size >= 1 && size <= 4) metadata.append(element("span", "", `${size} vs ${size}`));
        body.append(metadata);
        const footer = element("div", "division-card-footer");
        const count = division.entrantCount;
        const entrant = division.participation?.mode === "teams" ? "team" : "player";
        footer.append(element("span", "", Number.isInteger(count) && count > 0 ? `${count} ${entrant}${count === 1 ? "" : "s"}` : "Entrants to be announced"), element("span", "", "Open event →"));
        body.append(footer);
        node.append(cover, body);
        return node;
    }

    function draftRow(division) {
        const row = element("a", "division-draft-row");
        row.href = `#divisions/${encodeURIComponent(division.id)}`;
        const identity = element("div", "division-draft-identity");
        identity.append(element("strong", "", division.name), element("span", "division-muted", roleNames[division.role] || "Division management"));
        row.append(identity, element("span", "division-state", division.publishedAt ? "Unpublished changes" : "Private draft"),
            element("span", "division-draft-action", "Continue editing →"));
        return row;
    }

    function renderList() {
        const section = element("section", "page-content divisions-directory");
        const session = window.BonkAccount.session();
        const management = element("div", "division-directory-management");
        const events = element("section", "division-directory-events");
        const heading = element("div", "division-directory-heading");
        heading.append(element("h2", "", "Events"));
        events.append(heading);
        const filters = element("nav", "division-directory-filters");
        filters.setAttribute("aria-label", "Filter divisions by status");
        let currentStatus = "all";
        let page = 1;
        for (const [value, label] of [["all", "All"], ["live", "Live"], ["upcoming", "Upcoming"], ["completed", "Completed"]]) {
            const filter = button(label, () => {
                if (currentStatus === value) return;
                currentStatus = value; page = 1;
                for (const option of filters.querySelectorAll("button")) option.setAttribute("aria-pressed", String(option.dataset.status === value));
                void loadEvents();
            }, "division-status-filter");
            filter.dataset.status = value;
            filter.setAttribute("aria-pressed", String(value === "all"));
            filters.append(filter);
        }
        const grid = element("div", "division-event-grid");
        const loading = element("p", "division-muted", "Loading events…");
        loading.setAttribute("role", "status");
        grid.append(loading);
        const pagination = element("nav", "division-directory-pagination");
        pagination.setAttribute("aria-label", "Division pages");
        events.append(filters, grid, pagination);
        section.append(events, management, invitation());
        let listRevision = 0;
        async function loadEvents() {
            const revision = ++listRevision;
            grid.setAttribute("aria-busy", "true");
            try {
                const parameters = new URLSearchParams({ page: String(page), limit: "12" });
                if (currentStatus !== "all") parameters.set("status", currentStatus);
                const data = await request(`/api/divisions?${parameters}`);
                if (!section.isConnected || revision !== listRevision) return;
                page = data.page;
                grid.replaceChildren(...data.divisions.map(card));
                if (!data.divisions.length) grid.append(element("p", "division-empty", currentStatus === "all" ? "No events have been published yet." : `No ${currentStatus} events right now.`));
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
                pagination.replaceChildren();
            } finally {
                if (revision === listRevision) grid.setAttribute("aria-busy", "false");
            }
        }
        if (session.account) {
            management.append(element("h2", "", session.account.isAdmin ? "Division drafts" : "Your drafts"));
            const managed = element("div", "division-draft-list");
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
                const toggle = button("New division", () => {
                    create.hidden = !create.hidden;
                    toggle.setAttribute("aria-expanded", String(!create.hidden));
                    if (!create.hidden) name.focus();
                }, "division-button--primary");
                toggle.setAttribute("aria-expanded", "false");
                heading.append(toggle);
                heading.after(create);
            }
            let managedPage = 1;
            let managedRevision = 0;
            const managedPagination = element("nav", "division-directory-pagination");
            managedPagination.setAttribute("aria-label", "Division draft pages");
            management.append(managedPagination);
            async function loadManaged() {
                const revision = ++managedRevision;
                try {
                    const data = await request(`/api/manage/divisions?page=${managedPage}&limit=6&publication=drafts`);
                    if (!section.isConnected || revision !== managedRevision) return;
                    managedPage = data.page;
                    managed.replaceChildren(...data.divisions.map(draftRow));
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
                        else managed.append(element("p", "division-muted", "No unpublished drafts or changes. Use New division to create an event."));
                    }
                } catch (error) {
                    if (section.isConnected && revision === managedRevision) managed.replaceChildren(element("p", "division-error", error.message), button("Try again", () => void loadManaged()));
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
        let selected = "";
        let dirty = false;
        let editRevision = 0;
        let pending = false;
        let message = "";
        let members = null;
        let preview;
        let activeEditor = null;
        let editorFields = null;
        let inlineStatus = null;
        let inlineSave = null;
        let inlineCancel = null;
        let pickerOpen = false;
        let insertionAfter = null;
        let toolMode = "";
        let toolPanel = null;
        let notice;
        let saveButton;
        let publishButton;
        let scrollRestoreRevision = 0;
        let scrollAnchorLockRevision = 0;
        let previousScrollAnchoring = null;
        const undoHistory = [];
        const redoHistory = [];
        let undoButton;
        let redoButton;
        let backgroundEvents = null;
        let managementEvents = null;
        let toolsOpen = false;
        let clearSectionRail = () => {};
        const fieldBindings = new Map();
        let textSelection = null;
        let formatPanel = null;
        let formatFeedback = "";

        function editable(key) { return model?.permissions?.editSections?.includes(key === "banner" ? "appearance" : key.startsWith("custom:") ? "custom" : key); }
        function customSection(key) { return draft.customSections?.find(item => `custom:${item.id}` === key); }
        function snapshot() { return { content: clone(draft), dirty, message }; }
        function sameContent(first, second) {
            const comparable = value => {
                const result = clone(value);
                const appearance = result.appearance || { backgroundColor: "", backgroundImage: "" };
                result.appearance = { ...appearance, bannerColor: appearance.bannerColor ?? appearance.backgroundColor ?? "",
                    bannerImage: appearance.bannerImage ?? appearance.backgroundImage ?? "" };
                if (result.textStyles && !Object.keys(result.textStyles).length) delete result.textStyles;
                return result;
            };
            return JSON.stringify(comparable(first)) === JSON.stringify(comparable(second));
        }
        function settingsEditorOpen() { return ["appearance", "banner"].includes(activeEditor?.key); }
        function inlineEditorOpen() { return Boolean(activeEditor && !settingsEditorOpen()); }
        function editorChanged() { return activeEditor && !sameContent(activeEditor.before.content, draft); }
        function remember(content) {
            if (sameContent(content, draft)) return;
            if (!undoHistory.length || !sameContent(undoHistory.at(-1), content)) undoHistory.push(clone(content));
            if (undoHistory.length > 30) undoHistory.shift();
            redoHistory.length = 0;
        }
        function markRestored(text) {
            dirty = !sameContent(draft, model.content);
            editRevision += 1;
            message = dirty ? `${text} · save before publishing` : `${text} · matches the saved draft`;
        }
        function parkEditor() {
            if (!activeEditor || pending) return false;
            remember(activeEditor.before.content);
            activeEditor = null;
            backgroundEvents?.abort();
            selected = "";
            textSelection = null; fieldBindings.clear(); formatFeedback = "";
            dirty = !sameContent(draft, model.content);
            if (!dirty) message = "Preview matches the saved draft";
            return true;
        }
        function closeSettings() {
            if (!settingsEditorOpen() || pending) return;
            const position = editorScrollPosition();
            parkEditor();
            paintAtScrollPosition(position);
        }
        function finishEditing() {
            if (!activeEditor || pending) return;
            const position = editorScrollPosition();
            parkEditor();
            paintAtScrollPosition(position);
        }
        function travelHistory(backwards) {
            if (pending) return;
            const position = editorScrollPosition();
            parkEditor();
            const from = backwards ? undoHistory : redoHistory;
            const to = backwards ? redoHistory : undoHistory;
            if (!from.length) return;
            to.push(clone(draft));
            draft = from.pop();
            selected = ""; pickerOpen = false;
            markRestored(backwards ? "Change undone" : "Change restored");
            paintAtScrollPosition(position);
        }
        function previewSections() { return [...(preview?.querySelectorAll(".division-view > [data-section]") || [])]; }
        function editorScrollPosition() {
            const nodes = previewSections();
            const current = nodes.find(node => node.dataset.section === activeEditor?.key);
            const headerBottom = document.querySelector(".site-header")?.getBoundingClientRect().bottom || 0;
            const position = {
                left: window.scrollX, top: window.scrollY, anchors: [],
                toolsTop: container.querySelector(".division-management-tools")?.scrollTop || 0
            };
            const anchor = (node, edge = "top", replacementY) => {
                if (!node) return;
                position.anchors.push({ key: node.dataset.section || null, add: node.matches(".division-add-section"),
                    insert: node.matches(".division-section-insert") ? node.dataset.afterSection : null,
                    edge, viewportY: replacementY ?? node.getBoundingClientRect()[edge] });
            };
            if (current) {
                const rect = current.getBoundingClientRect();
                const add = preview.querySelector(".division-add-section");
                if (rect.top >= headerBottom) {
                    anchor(current);
                    if (activeEditor.insertedAfter) {
                        const insert = [...preview.querySelectorAll(".division-section-insert, .division-add-section")]
                            .find(node => node.dataset.afterSection === activeEditor.insertedAfter);
                        anchor(insert, "top", rect.top);
                    }
                    // A cancelled new section is replaced by the Add section area.
                    anchor(add, "top", rect.top);
                } else {
                    anchor(nodes[nodes.indexOf(current) + 1]);
                    anchor(add);
                    anchor(current, "bottom");
                }
            } else {
                // Background settings resize the tools rather than the event itself.
                anchor(nodes.find(node => node.getBoundingClientRect().bottom > headerBottom));
            }
            return position;
        }
        function paintAtScrollPosition(position) {
            if (previousScrollAnchoring === null) previousScrollAnchoring = container.style.overflowAnchor;
            const lockRevision = ++scrollAnchorLockRevision;
            container.style.overflowAnchor = "none";
            paint();
            const revision = scrollRestoreRevision;
            const restore = () => {
                const nodes = previewSections();
                let top = position.top;
                for (const anchor of position.anchors) {
                    const node = anchor.insert ? [...preview.querySelectorAll(".division-section-insert")].find(item => item.dataset.afterSection === anchor.insert)
                        : anchor.add ? preview.querySelector(".division-add-section") : nodes.find(item => item.dataset.section === anchor.key);
                    if (!node) continue;
                    top = window.scrollY + node.getBoundingClientRect()[anchor.edge] - anchor.viewportY;
                    break;
                }
                const tools = container.querySelector(".division-management-tools");
                if (tools) tools.scrollTop = position.toolsTop;
                window.scrollTo({ left: position.left, top: Math.max(0, top), behavior: "instant" });
            };
            restore();
            const restoredTop = window.scrollY;
            const restoredLeft = window.scrollX;
            window.requestAnimationFrame(() => {
                if (section.isConnected && revision === scrollRestoreRevision
                    && window.scrollY === restoredTop && window.scrollX === restoredLeft) restore();
                if (lockRevision === scrollAnchorLockRevision) {
                    container.style.overflowAnchor = previousScrollAnchoring;
                    previousScrollAnchoring = null;
                }
            });
        }
        function change() {
            if (draft.textStyles && window.DivisionText) {
                const fields = window.DivisionText.fields(draft);
                for (const path of Object.keys(draft.textStyles)) if (!Object.hasOwn(fields, path)) delete draft.textStyles[path];
            }
            editRevision += 1;
            dirty = true;
            message = "Unsaved changes · save before publishing";
            if (activeEditor) activeEditor.error = "";
            applyBackground(backdrop, draft.appearance);
            for (const cover of preview?.querySelectorAll(".division-cover") || []) applyCover(cover, draft.appearance);
            section.classList.toggle("division-custom-background", !backdrop.hidden);
            updateNotice();
            if (!activeEditor) paintPreview();
        }
        function updateNotice() {
            if (notice) notice.textContent = message || (model?.publishedAt
                ? model.version === model.publishedVersion ? "Draft preview · published version is up to date" : "Draft preview · saved changes are not published"
                : "Private draft preview · publish when the event is ready");
            for (const action of container.querySelectorAll(".division-management-actions .division-button")) action.disabled = pending;
            if (saveButton) saveButton.disabled = pending || !dirty;
            if (publishButton) publishButton.disabled = pending || dirty;
            if (undoButton) undoButton.disabled = pending || (!undoHistory.length && !editorChanged());
            if (redoButton) redoButton.disabled = pending || !redoHistory.length || editorChanged();
            for (const dot of container.querySelectorAll(".division-section-dot")) dot.disabled = pending;
            if (editorFields) editorFields.disabled = pending;
            if (inlineSave) inlineSave.disabled = pending || !dirty;
            if (inlineCancel) inlineCancel.disabled = pending;
            const close = toolPanel?.querySelector(".division-tool-close");
            if (close) close.disabled = pending;
            if (inlineStatus) inlineStatus.textContent = activeEditor?.error || (pending ? "Saving section…" : "");
            updateFormattingPanel();
            if (pending) {
                for (const control of preview?.querySelectorAll(".division-section-control, .division-section-insert, .division-add-section, .division-add-panel button") || []) control.disabled = true;
            }
        }
        function paintPreview() {
            if (!preview) return;
            scrollRestoreRevision += 1;
            applyBackground(backdrop, draft.appearance);
            section.classList.toggle("division-custom-background", !backdrop.hidden);
            preview.replaceChildren(window.DivisionView.render(draft, {
                editing, selectedSection: selected, editableSections: model.permissions?.editSections || [],
                onSection: selectSection,
                onBanner() { selectSection("banner"); },
                onAddSection(afterKey) { selectSection("add", afterKey); },
                onMoveSection(key, offset) {
                    if (pending) return;
                    const order = window.DivisionView.sectionOrder(draft);
                    const index = order.indexOf(key);
                    const next = index + offset;
                    if (!editable(key) || index < 0 || next < 0 || next >= order.length) return;
                    finishEditing();
                    const before = clone(draft);
                    [order[index], order[next]] = [order[next], order[index]];
                    draft.sectionOrder = order;
                    remember(before);
                    change();
                    const control = preview.querySelector(`[data-section="${key}"] .division-section-move-${offset < 0 ? "up" : "down"}:not(:disabled)`)
                        || preview.querySelector(`[data-section="${key}"] .division-section-edit`);
                    control?.focus({ preventScroll: true });
                },
                onRemoveSection(key) {
                    if (!editable(key) || pending) return;
                    finishEditing();
                    const before = clone(draft);
                    draft.sectionOrder = window.DivisionView.sectionOrder(draft).filter(value => value !== key);
                    remember(before);
                    pickerOpen = false;
                    change();
                    preview.querySelector(".division-add-section")?.focus({ preventScroll: true });
                }
            }));
            if (inlineEditorOpen()) {
                const target = [...preview.querySelectorAll("[data-section]")].find(node => node.dataset.section === activeEditor.key);
                if (target) target.replaceChildren(renderInlineEditor());
            } else if (pickerOpen && editing) {
                const panel = element("div", "division-add-panel");
                panel.append(element("p", "division-eyebrow", "Build your page"), element("h2", "", "Add a section"));
                editSectionPicker(panel);
                panel.dataset.afterSection = insertionAfter || "";
                panel.append(button("Cancel", () => {
                    const position = editorScrollPosition(); pickerOpen = false; paintAtScrollPosition(position);
                }));
                const add = [...preview.querySelectorAll(".division-section-insert, .division-add-section")]
                    .find(node => node.dataset.afterSection === insertionAfter) || preview.querySelector(".division-add-section");
                if (add) add.replaceWith(panel);
                else preview.append(panel);
            }
            refreshSectionRail();
        }
        function selectSection(key, afterKey = null) {
            if (pending) return;
            if (activeEditor?.key === key) return;
            const position = activeEditor ? editorScrollPosition() : null;
            const clicked = previewSections().find(node => node.dataset.section === key);
            if (position && clicked) position.anchors.unshift({ key, edge: "top", viewportY: clicked.getBoundingClientRect().top });
            parkEditor();
            if (key === "add") {
                insertionAfter = afterKey || window.DivisionView.sectionOrder(draft).at(-1) || "general";
                pickerOpen = true; toolMode = "";
                if (position) paintAtScrollPosition(position); else paint();
                return;
            }
            beginSection(key, snapshot(), position);
        }
        function beginSection(key, before = snapshot(), position = null, insertedAfter = null) {
            if (!editable(key) || activeEditor || pending) return;
            selected = key;
            editing = true;
            pickerOpen = false;
            toolMode = "";
            activeEditor = { key, before, insertedAfter, error: "" };
            if (settingsEditorOpen()) toolsOpen = true;
            if (position) paintAtScrollPosition(position);
            else paint();
        }
        function cancelSection() {
            if (!activeEditor || pending) return;
            const position = editorScrollPosition();
            const before = activeEditor.before;
            draft = clone(before.content);
            markRestored("Section changes cancelled");
            activeEditor = null;
            selected = "";
            textSelection = null; formatFeedback = "";
            paintAtScrollPosition(position);
        }
        function renderInlineEditor() {
            const form = element("form", `division-inline-editor${settingsEditorOpen() ? " division-appearance-editor" : ""}`);
            const heading = selected.startsWith("custom:") ? "Text section" : sectionNames[selected];
            form.setAttribute("aria-label", `Edit ${heading}`);
            const header = element("div", "division-inline-heading");
            const title = element("div");
            title.append(element("p", "division-eyebrow", "Editing section"), element("h2", "", heading));
            header.append(title);
            if (settingsEditorOpen()) header.append(button("Close panel", closeSettings, "division-tool-close"));
            form.append(header);
            if (settingsEditorOpen()) form.append(element("p", "division-background-hint", "Changes preview immediately. Close to keep them in your draft, or Cancel to revert."));
            editorFields = element("fieldset", "division-inline-fields");
            form.append(editorFields);
            paintInspector();
            inlineStatus = element("p", "division-inline-status");
            inlineStatus.setAttribute("role", "status");
            const actions = element("div", `division-inline-actions${settingsEditorOpen() ? " division-appearance-actions" : ""}`);
            inlineCancel = button("Cancel", cancelSection, "division-inline-cancel");
            inlineSave = element("button", "division-button division-button--primary division-inline-save", settingsEditorOpen() ? "Save settings" : "Save section");
            inlineSave.type = "submit";
            actions.append(inlineCancel, inlineSave);
            form.append(inlineStatus, actions);
            form.addEventListener("submit", async event => {
                event.preventDefault();
                if (pending || !form.reportValidity()) return;
                const current = activeEditor;
                if (await save() && activeEditor === current) {
                    const position = editorScrollPosition();
                    remember(current.before.content);
                    activeEditor = null;
                    selected = "";
                    paintAtScrollPosition(position);
                }
            });
            return form;
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
                activeEditor = null; selected = ""; pickerOpen = false; toolMode = "";
                undoHistory.length = 0; redoHistory.length = 0;
                document.title = `${draft.name} | Bonk Football Division`;
                paint();
            } catch (error) {
                if (section.isConnected) container.replaceChildren(element("p", "division-error", error.message), button("Try again", () => void load()));
            }
        }
        async function save() {
            if (pending || !dirty) return false;
            const savedRevision = editRevision;
            pending = true; message = "Saving draft…"; updateNotice();
            try {
                const data = await request(`/api/manage/divisions/${divisionId}`, "PUT", { version: model.version, content: draft });
                if (!section.isConnected) return false;
                model = data.division;
                if (editRevision === savedRevision) { dirty = false; message = "Draft saved · preview changes before publishing"; }
                else message = "Draft saved · newer preview edits still need saving";
                document.title = `${draft.name} | Bonk Football Division`;
                return true;
            } catch (error) {
                message = error.message;
                if (error.status === 409) message += " Your local changes are kept. Reload the saved draft to use the newer version.";
                if (activeEditor) activeEditor.error = message;
                return false;
            } finally {
                pending = false;
                if (section.isConnected) {
                    if (!inlineEditorOpen()) paintPreview();
                    updateNotice();
                }
            }
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
            scrollRestoreRevision += 1;
            container.replaceChildren();
            saveButton = null; publishButton = null; notice = null;
            undoButton = null; redoButton = null;
            editorFields = null; inlineStatus = null; inlineSave = null; inlineCancel = null; toolPanel = null;
            formatPanel = null;
            container.classList.toggle("division-event-container--managed", Boolean(model.permissions?.editSections?.length));
            if (model.permissions?.editSections?.length) {
                const slot = element("div", `division-management-slot${toolsOpen ? " is-open" : ""}`);
                const dock = element("div", "division-management-dock");
                const toggle = button("Tools", () => setToolsOpen(!toolsOpen), "division-management-toggle");
                toggle.setAttribute("aria-expanded", String(toolsOpen));
                toggle.setAttribute("aria-controls", "division-management-tools");
                toggle.setAttribute("aria-label", `${toolsOpen ? "Close" : "Open"} division management tools`);
                const toolbar = element("aside", "division-management-bar division-management-tools");
                toolbar.id = "division-management-tools";
                toolbar.setAttribute("aria-label", "Division management tools");
                const identity = element("div", "division-management-identity");
                const heading = element("div", "division-management-heading");
                heading.append(element("strong", "", roleNames[model.role] || "Division management"),
                    button("Close tools", () => setToolsOpen(false, true), "division-management-close"));
                identity.append(heading);
                notice = element("p", "division-message"); notice.setAttribute("role", "status"); identity.append(notice);
                const actions = element("div", "division-management-actions");
                const modes = element("div", "division-mode-switch");
                modes.append(element("p", "division-tool-group-label", "Mode"));
                const view = button("View", () => setMode(false));
                const edit = button("Edit", () => setMode(true));
                view.disabled = pending; edit.disabled = pending;
                view.setAttribute("aria-pressed", String(!editing)); edit.setAttribute("aria-pressed", String(editing));
                modes.append(view, edit);
                const pageActions = element("div", "division-page-actions");
                pageActions.append(element("p", "division-tool-group-label", "Publication"));
                saveButton = button("Save draft", () => { finishEditing(); void save(); }, "division-button--primary");
                pageActions.append(saveButton);
                if (model.permissions.publish) {
                    const publication = element("div", "division-publication-actions");
                    publishButton = button("Publish", () => { finishEditing(); void publish(); }, "division-button--warm"); publication.append(publishButton);
                    if (model.publishedAt) publication.append(button("Unpublish", () => { finishEditing(); void unpublish(); }, "division-button--danger"));
                    pageActions.append(publication);
                }
                const settings = element("div", "division-settings-actions");
                settings.append(element("p", "division-tool-group-label", "Appearance & access"));
                if (editable("appearance")) {
                    const background = button("Background", () => { if (activeEditor?.key === "appearance") closeSettings(); else selectSection("appearance"); });
                    background.setAttribute("aria-expanded", String(activeEditor?.key === "appearance"));
                    settings.append(background);
                    settings.append(button("Banner", () => { if (activeEditor?.key === "banner") closeSettings(); else selectSection("banner"); }));
                }
                if (model.permissions.manageMembers) settings.append(button("Management roles", () => {
                    const position = activeEditor ? editorScrollPosition() : null;
                    parkEditor(); toolMode = toolMode === "members" ? "" : "members"; pickerOpen = false;
                    toolsOpen = true;
                    if (position) paintAtScrollPosition(position); else paint();
                }));
                const history = element("div", "division-history-actions");
                history.append(element("p", "division-tool-group-label", "History"));
                undoButton = button("Undo", () => travelHistory(true));
                redoButton = button("Redo", () => travelHistory(false));
                history.append(undoButton, redoButton);
                formatPanel = renderFormattingPanel();
                actions.append(modes, formatPanel, pageActions, settings, history);
                const reload = button("Reload saved draft", () => {
                    if (!dirty || window.confirm("Discard the unsaved preview changes and reload the saved draft?")) void load();
                });
                const secondary = element("div", "division-secondary-actions");
                secondary.append(reload); actions.append(secondary);
                actions.append(sharingTools());
                toolbar.append(identity, actions);
                if (settingsEditorOpen() || toolMode === "members") {
                    toolPanel = element("div", "division-tool-panel");
                    if (toolMode === "members") {
                        toolPanel.append(element("h2", "", "Management roles"));
                        editMembers(toolPanel);
                        toolPanel.append(button("Close roles", () => { toolMode = ""; paint(); }));
                    }
                    settings.after(toolPanel);
                }
                dock.append(toggle, toolbar); slot.append(dock); container.append(slot);
            }
            const workspace = element("div", `division-workspace${editing ? " is-editing" : ""}`);
            preview = element("div", "division-live-preview"); workspace.append(preview);
            container.append(workspace);
            paintPreview();
            if (settingsEditorOpen()) toolPanel.append(renderInlineEditor());
            updateNotice();
            watchBackgroundDismissal();
            watchManagementDismissal();
        }

        function setToolsOpen(value, focusToggle = false) {
            toolsOpen = value;
            const slot = container.querySelector(".division-management-slot");
            const toggle = slot?.querySelector(".division-management-toggle");
            slot?.classList.toggle("is-open", value);
            toggle?.setAttribute("aria-expanded", String(value));
            toggle?.setAttribute("aria-label", `${value ? "Close" : "Open"} division management tools`);
            if (focusToggle && toggle && getComputedStyle(toggle).display !== "none") toggle.focus({ preventScroll: true });
            watchManagementDismissal();
        }

        function watchManagementDismissal() {
            managementEvents?.abort();
            if (!toolsOpen) return;
            const events = new AbortController();
            managementEvents = events;
            document.addEventListener("click", event => {
                if (!section.isConnected) { events.abort(); return; }
                if (!(event.target instanceof Element) || event.target.closest(".division-management-slot")) return;
                setToolsOpen(false);
            }, { signal: events.signal });
            document.addEventListener("keydown", event => {
                if (!section.isConnected) { events.abort(); return; }
                if (event.key !== "Escape" || event.defaultPrevented || settingsEditorOpen()) return;
                event.preventDefault();
                setToolsOpen(false, true);
            }, { signal: events.signal });
            for (const type of ["hashchange", "bonk-account-change"]) window.addEventListener(type, () => events.abort(), { signal: events.signal, once: true });
        }

        function setMode(value) {
            const position = activeEditor ? editorScrollPosition() : null;
            parkEditor(); editing = value; pickerOpen = false; toolMode = "";
            if (position) paintAtScrollPosition(position); else paint();
        }

        function renderFormattingPanel() {
            const panel = element("section", "division-format-panel");
            panel.setAttribute("aria-label", "Text style");
            panel.append(element("h2", "", "Text style"), element("p", "division-format-selection", "Select text in a field to format it."));
            const all = button("Select whole field", () => {
                const binding = fieldBindings.get(textSelection?.path);
                if (!binding) return;
                binding.control.setSelectionRange(0, binding.control.value.length);
                selectTextField(binding);
            }, "division-format-all");
            panel.append(all);
            const toolbar = element("div", "division-format-toolbar");
            toolbar.setAttribute("role", "group"); toolbar.setAttribute("aria-label", "Text emphasis");
            for (const [property, label, title] of [["bold", "B", "Bold"], ["italic", "I", "Italic"], ["underline", "U", "Underline"]]) {
                const toggle = button(label, () => applyTextStyle({ [property]: !selectedStyle(property) }), "division-format-toggle");
                toggle.dataset.formatProperty = property;
                toggle.setAttribute("aria-label", title); toggle.setAttribute("aria-pressed", "false");
                toggle.addEventListener("pointerdown", event => event.preventDefault());
                toolbar.append(toggle);
            }
            panel.append(toolbar);
            const fields = element("div", "division-format-fields");
            const font = inputField(fields, "Font", "default", value => applyTextStyle({ font: value }), {
                options: [["default", "Default"], ["sans", "Sans serif"], ["serif", "Serif"], ["mono", "Monospace"]], noChange: true
            });
            font.dataset.formatProperty = "font";
            const size = inputField(fields, "Size", "normal", value => applyTextStyle({ size: value }), {
                options: [["small", "Small"], ["normal", "Normal"], ["large", "Large"]], noChange: true
            });
            size.dataset.formatProperty = "size";
            const colour = inputField(fields, "Text colour", "#e2eff7", value => applyTextStyle({ color: value }), { type: "color", noChange: true });
            colour.dataset.formatProperty = "color";
            panel.append(fields, button("Clear formatting", () => applyTextStyle({ bold: null, italic: null, underline: null, color: null, font: null, size: null }), "division-format-reset"));
            const feedback = element("p", "division-format-feedback"); feedback.setAttribute("role", "status");
            panel.append(feedback);
            return panel;
        }

        function selectTextField(binding) {
            if (!binding.control.isConnected) return;
            textSelection = { path: binding.path, start: binding.control.selectionStart ?? 0, end: binding.control.selectionEnd ?? 0 };
            formatFeedback = "";
            updateFormattingPanel();
        }

        function selectedStyle(property) {
            if (!textSelection || textSelection.start >= textSelection.end) return undefined;
            const { path, start, end } = textSelection;
            const runs = (draft.textStyles?.[path] || []).filter(run => run.start < end && run.end > start);
            let cursor = start;
            let value;
            for (const run of runs) {
                if (run.start > cursor || !Object.hasOwn(run, property)) return undefined;
                if (cursor === start) value = run[property];
                else if (run[property] !== value) return undefined;
                cursor = Math.max(cursor, run.end);
                if (cursor >= end) return value;
            }
            return undefined;
        }

        function updateFormattingPanel() {
            if (!formatPanel) return;
            formatPanel.hidden = !inlineEditorOpen();
            const binding = fieldBindings.get(textSelection?.path);
            const hasField = Boolean(binding?.control.isConnected && binding.control.value.length);
            const hasRange = hasField && textSelection.start < textSelection.end;
            const selection = formatPanel.querySelector(".division-format-selection");
            selection.textContent = hasRange ? `${binding.label} · ${textSelection.end - textSelection.start} characters selected`
                : hasField ? `${binding.label} · select some text or the whole field` : "Select text in a field to format it.";
            for (const control of formatPanel.querySelectorAll("button, input, select")) {
                control.disabled = pending || (control.classList.contains("division-format-all") ? !hasField : !hasRange);
            }
            for (const toggle of formatPanel.querySelectorAll(".division-format-toggle")) toggle.setAttribute("aria-pressed", String(selectedStyle(toggle.dataset.formatProperty) === true));
            formatPanel.querySelector('[data-format-property="font"]').value = selectedStyle("font") || "default";
            formatPanel.querySelector('[data-format-property="size"]').value = selectedStyle("size") || "normal";
            formatPanel.querySelector('[data-format-property="color"]').value = selectedStyle("color") || "#e2eff7";
            formatPanel.querySelector(".division-format-feedback").textContent = formatFeedback;
            for (const field of fieldBindings.values()) {
                const runs = draft.textStyles?.[field.path] || [];
                field.preview.hidden = !runs.length && !(hasRange && textSelection.path === field.path);
                window.DivisionText?.render(field.copy, field.control.value, runs);
            }
        }

        function applyTextStyle(patch) {
            const binding = fieldBindings.get(textSelection?.path);
            if (pending || !binding || textSelection.start >= textSelection.end || !window.DivisionText) return;
            try {
                const runs = window.DivisionText.apply(draft.textStyles?.[binding.path], binding.control.value, textSelection.start, textSelection.end, patch);
                draft.textStyles ||= {};
                if (runs.length) draft.textStyles[binding.path] = runs;
                else delete draft.textStyles[binding.path];
                formatFeedback = "";
                change();
            } catch (error) {
                formatFeedback = error instanceof RangeError ? "This field has too many separate styles. Clear some formatting before adding more." : "Unable to apply this text style.";
                updateFormattingPanel();
            }
        }

        function sharingTools() {
            const tools = element("div", "division-share-tools");
            tools.append(element("p", "division-tool-group-label", "Links"));
            const status = element("p", "division-share-status"); status.setAttribute("role", "status");
            const fallback = element("input", "division-field division-share-fallback");
            fallback.type = "text"; fallback.readOnly = true; fallback.hidden = true;
            fallback.setAttribute("aria-label", "Event link");
            const copy = button("Copy event link", async () => {
                const url = new URL(window.location.href);
                url.search = ""; url.hash = `divisions/${encodeURIComponent(divisionId)}`;
                const link = window.BonkRoutes?.shareUrl(url.hash) || url.href;
                copy.disabled = true;
                try {
                    await navigator.clipboard.writeText(link);
                    if (status.isConnected) { status.textContent = "Event link copied"; fallback.hidden = true; }
                } catch {
                    if (fallback.isConnected) {
                        fallback.value = link; fallback.hidden = false;
                        fallback.focus({ preventScroll: true }); fallback.select();
                        status.textContent = "Copy this event link.";
                    }
                } finally { if (copy.isConnected) updateNotice(); }
            });
            tools.append(copy, status, fallback);
            return tools;
        }

        function refreshSectionRail() {
            clearSectionRail();
            const currentPreview = preview;
            const nodes = previewSections();
            const workspace = preview?.parentElement;
            workspace?.querySelector(".division-section-rail-slot")?.remove();
            if (!workspace || !nodes.length) return;
            const slot = element("div", "division-section-rail-slot");
            const rail = element("nav", "division-section-rail");
            rail.setAttribute("aria-label", "Event sections");
            const track = element("div", "division-section-track");
            const dots = nodes.map(node => {
                const key = node.dataset.section;
                const title = customSection(key)?.title || sectionNames[key] || "Text section";
                const dot = element("button", "division-section-dot");
                dot.type = "button";
                dot.dataset.sectionTarget = key;
                dot.setAttribute("aria-label", title);
                dot.disabled = pending;
                const label = element("span", "division-section-label", title);
                label.setAttribute("aria-hidden", "true");
                dot.append(label);
                track.append(dot);
                return dot;
            });
            function nearestDot(clientY) {
                const bounds = track.getBoundingClientRect();
                if (!bounds.height) return null;
                const percent = (clientY - bounds.top) / bounds.height * 100;
                return dots.reduce((closest, dot) => Math.abs(parseFloat(dot.style.getPropertyValue("--section-position")) - percent)
                    < Math.abs(parseFloat(closest.style.getPropertyValue("--section-position")) - percent) ? dot : closest);
            }
            track.addEventListener("click", event => {
                if (pending) return;
                // Closely spaced points keep their exact proportions. Pick the nearest
                // marker rather than whichever overlapping button is painted last.
                const dot = event.detail > 0 ? nearestDot(event.clientY) : event.target.closest(".division-section-dot");
                const key = dot?.dataset.sectionTarget;
                if (!key) return;
                const wasBackground = settingsEditorOpen() && parkEditor();
                if (wasBackground) paint();
                scrollRestoreRevision += 1;
                const target = previewSections().find(item => item.dataset.section === key);
                target?.scrollIntoView({ block: "start", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" });
                if (wasBackground) [...container.querySelectorAll(".division-section-dot")].find(item => item.dataset.sectionTarget === key)?.focus({ preventScroll: true });
            });
            track.addEventListener("pointermove", event => {
                if (event.pointerType === "touch") return;
                const nearest = nearestDot(event.clientY);
                dots.forEach(dot => dot.toggleAttribute("data-pointer-near", dot === nearest));
            });
            track.addEventListener("pointerleave", () => dots.forEach(dot => dot.removeAttribute("data-pointer-near")));
            rail.append(track); slot.append(rail); workspace.append(slot);
            const events = new AbortController();
            let frame = null;
            function update() {
                frame = null;
                if (!section.isConnected || preview !== currentPreview) { cleanup(); return; }
                const bounds = currentPreview.getBoundingClientRect();
                container.style.setProperty("--division-content-height", `${bounds.height}px`);
                track.style.setProperty("--section-content-height", `${bounds.height}px`);
                const rectangles = nodes.map(node => node.getBoundingClientRect());
                const headerBottom = document.querySelector(".site-header")?.getBoundingClientRect().bottom || 0;
                let active = 0;
                rectangles.forEach((rect, index) => {
                    const proportion = bounds.height > 0 ? Math.min(100, Math.max(0, (rect.top - bounds.top) / bounds.height * 100)) : 0;
                    dots[index].style.setProperty("--section-position", `${proportion.toFixed(4)}%`);
                    if (rect.top <= headerBottom + 24) active = index;
                });
                const pageHeight = document.documentElement.scrollHeight;
                if (pageHeight > window.innerHeight && window.scrollY + window.innerHeight >= pageHeight - 2) active = dots.length - 1;
                dots.forEach((dot, index) => {
                    if (index === active) dot.setAttribute("aria-current", "location");
                    else dot.removeAttribute("aria-current");
                });
            }
            const schedule = () => { if (frame === null) frame = window.requestAnimationFrame(update); };
            const observer = typeof ResizeObserver === "function" ? new ResizeObserver(schedule) : null;
            function cleanup() {
                events.abort(); observer?.disconnect();
                if (frame !== null) { window.cancelAnimationFrame(frame); frame = null; }
            }
            clearSectionRail = cleanup;
            observer?.observe(currentPreview);
            window.addEventListener("resize", schedule, { signal: events.signal, passive: true });
            window.addEventListener("scroll", schedule, { signal: events.signal, passive: true });
            for (const type of ["hashchange", "bonk-account-change"]) window.addEventListener(type, cleanup, { signal: events.signal, once: true });
            update();
            schedule();
        }

        function watchBackgroundDismissal() {
            backgroundEvents?.abort();
            if (!settingsEditorOpen()) return;
            const events = new AbortController();
            backgroundEvents = events;
            document.addEventListener("click", event => {
                if (!section.isConnected) { events.abort(); return; }
                if (pending || !(event.target instanceof Element)) return;
                if (event.target.closest(".division-management-slot")) return;
                closeSettings();
            }, { signal: events.signal });
            document.addEventListener("keydown", event => {
                if (!section.isConnected) { events.abort(); return; }
                if (event.key !== "Escape" || pending) return;
                event.preventDefault();
                const settingsName = sectionNames[activeEditor.key];
                closeSettings();
                const background = [...container.querySelectorAll("button")].find(node => node.textContent === settingsName);
                const focusTarget = background?.getClientRects().length ? background : container.querySelector(".division-management-toggle");
                focusTarget?.focus({ preventScroll: true });
            }, { signal: events.signal });
            for (const type of ["hashchange", "bonk-account-change"]) window.addEventListener(type, () => events.abort(), { once: true, signal: events.signal });
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
            let previousText = String(value ?? "");
            control.addEventListener(options.options || options.type === "number" ? "change" : "input", () => {
                onInput(control.value);
                if (options.formatPath && window.DivisionText) {
                    const runs = window.DivisionText.rebase(draft.textStyles?.[options.formatPath], previousText, control.value);
                    if (runs.length) { draft.textStyles ||= {}; draft.textStyles[options.formatPath] = runs; }
                    else if (draft.textStyles) delete draft.textStyles[options.formatPath];
                    previousText = control.value;
                    const binding = fieldBindings.get(options.formatPath);
                    if (binding) selectTextField(binding);
                }
                if (!options.noChange) change();
            });
            wrapper.append(control); parent.append(wrapper);
            if (options.formatPath && window.DivisionText) {
                control.dataset.formatPath = options.formatPath;
                const preview = element("div", "division-formatted-preview");
                preview.hidden = true;
                const copy = element("div", "division-formatted-preview-copy");
                preview.append(element("span", "division-formatted-preview-label", "Formatted preview"), copy);
                wrapper.append(preview);
                const binding = { path: options.formatPath, label, control, preview, copy };
                fieldBindings.set(options.formatPath, binding);
                for (const event of ["select", "keyup", "mouseup", "focus"]) control.addEventListener(event, () => selectTextField(binding));
            }
            return control;
        }
        function paintInspector() {
            if (!editorFields || !activeEditor) return;
            fieldBindings.clear();
            editorFields.replaceChildren();
            const body = editorFields;
            if (selected === "general") editGeneral(body);
            if (selected === "appearance") editAppearance(body);
            if (selected === "banner") editAppearance(body, true);
            if (selected === "participation") editParticipation(body);
            if (["timeline", "campaigns", "referendums"].includes(selected)) editCollection(body, selected);
            if (selected === "teams") editTeams(body);
            if (selected === "bracket") editBracket(body);
            if (selected.startsWith("custom:")) editCustomSection(body);
            updateFormattingPanel();
        }
        function editSectionPicker(body) {
            const order = window.DivisionView.sectionOrder(draft);
            const available = Object.keys(sectionDescriptions).filter(key => editable(key));
            const choices = element("div", "division-section-picker");
            function addToPage(key, before = snapshot()) {
                if (pending || activeEditor) return;
                const order = window.DivisionView.sectionOrder(draft).filter(value => value !== key);
                const index = insertionAfter === "general" ? 0 : order.includes(insertionAfter) ? order.indexOf(insertionAfter) + 1 : order.length;
                order.splice(index, 0, key);
                draft.sectionOrder = order;
                dirty = true;
                editRevision += 1;
                message = "New section · save or cancel to finish adding it";
                beginSection(key, before, null, insertionAfter);
            }
            if (editable("custom")) {
                const addText = button("", () => {
                    if (pending || activeEditor) return;
                    const before = snapshot();
                    const item = { id: id(), title: "New text section", description: "" };
                    draft.customSections = [...(draft.customSections || []), item];
                    addToPage(`custom:${item.id}`, before);
                }, "division-section-choice");
                addText.dataset.addSection = "custom";
                addText.disabled = (draft.customSections?.length || 0) >= 20;
                addText.append(element("strong", "", "+ Text section"), element("span", "", "A heading and text for anything else your event needs."));
                choices.append(addText);
                for (const item of draft.customSections || []) {
                    const key = `custom:${item.id}`;
                    if (order.includes(key)) continue;
                    const restore = button("", () => addToPage(key), "division-section-choice");
                    restore.dataset.addSection = key;
                    restore.append(element("strong", "", item.title), element("span", "", "Restore this saved text section."));
                    choices.append(restore);
                }
            }
            for (const key of available) {
                const present = order.includes(key);
                const choice = button("", () => present ? selectSection(key) : addToPage(key), `division-section-choice${present ? " division-section-choice--present" : ""}`);
                choice.dataset.addSection = key;
                choice.append(element("strong", "", sectionNames[key]), element("span", "", present ? "Already on this page · edit section" : sectionDescriptions[key]));
                choices.append(choice);
            }
            if (!choices.childElementCount) choices.append(element("p", "division-muted", "All available sections are on the page."));
            body.append(choices, element("p", "division-editor-note", "Built-in sections appear once per page. Choose an existing section to edit it, or add a missing section here. Text sections can be added more than once."));
        }
        function editCustomSection(body) {
            const item = customSection(selected);
            if (!item) return;
            inputField(body, "Section title", item.title, value => { item.title = value; }, { maxLength: 120, formatPath: `custom.${item.id}.title` });
            inputField(body, "Section text", item.description, value => { item.description = value; }, { multiline: true, rows: 8, maxLength: 6000, formatPath: `custom.${item.id}.description` });
        }
        function editGeneral(body) {
            const fields = model.permissions.generalFields || (model.role === "editor" ? ["description"] : ["name", "summary", "description", "status", "startDate", "endDate"]);
            if (fields.includes("name")) inputField(body, "Event name", draft.name, value => { draft.name = value; }, { maxLength: 120, formatPath: "general.name" });
            if (fields.includes("summary")) inputField(body, "Short introduction", draft.summary, value => { draft.summary = value; }, { multiline: true, maxLength: 300, formatPath: "general.summary" });
            if (fields.includes("description")) inputField(body, "About this event", draft.description, value => { draft.description = value; }, { multiline: true, rows: 6, maxLength: 5000, formatPath: "general.description" });
            if (fields.includes("status")) inputField(body, "Event status", draft.status, value => { draft.status = value; }, { options: [["upcoming", "Upcoming"], ["registration", "Registration"], ["live", "Live"], ["completed", "Completed"]] });
            if (fields.includes("startDate")) inputField(body, "Start date", draft.startDate, value => { draft.startDate = value; }, { type: "date" });
            if (fields.includes("endDate")) inputField(body, "End date", draft.endDate, value => { draft.endDate = value; }, { type: "date" });
        }
        function editAppearance(body, banner = false) {
            const appearance = draft.appearance || { backgroundColor: "", backgroundImage: "" };
            const colourKey = banner ? "bannerColor" : "backgroundColor";
            const imageKey = banner ? "bannerImage" : "backgroundImage";
            const freezeBanner = () => {
                appearance.bannerColor ??= appearance.backgroundColor || "";
                appearance.bannerImage ??= appearance.backgroundImage || "";
            };
            const colour = inputField(body, banner ? "Banner colour" : "Background colour", (banner ? appearance.bannerColor ?? appearance.backgroundColor : appearance.backgroundColor) || "#080c14", value => {
                freezeBanner(); appearance[colourKey] = value;
                draft.appearance = { ...appearance };
            }, { type: "color" });
            colour.classList.add("division-colour-picker");
            const image = inputField(body, banner ? "Banner image URL" : "Background image URL", banner ? appearance.bannerImage ?? appearance.backgroundImage : appearance.backgroundImage, value => {
                freezeBanner(); appearance[imageKey] = value;
                draft.appearance = { ...appearance };
            }, { type: "url", maxLength: 2048 });
            image.placeholder = "https://example.com/background.jpg";
            body.append(element("p", "division-editor-note", banner ? "Use a direct HTTPS image link for the banner and showcase cover." : "Use a direct HTTPS image link for the page background."));
            body.append(button(banner ? "Reset banner" : "Reset background", () => {
                freezeBanner(); appearance[colourKey] = ""; appearance[imageKey] = "";
                draft.appearance = { ...appearance };
                change();
                paintInspector();
            }));
        }
        function editParticipation(body) {
            inputField(body, "Participation mode", draft.participation.mode, value => { draft.participation.mode = value; if (value === "solo") draft.participation.teamSize = 1; paintInspector(); }, { options: [["solo", "Individual players"], ["teams", "Team battles"]] });
            inputField(body, "Players per side", draft.participation.teamSize, value => { draft.participation.teamSize = Number(value); }, { options: [["1", "1 vs 1"], ["2", "2 vs 2"], ["3", "3 vs 3"], ["4", "4 vs 4"]], disabled: draft.participation.mode === "solo" });
            inputField(body, "Participation availability", draft.participation.registration, value => { draft.participation.registration = value; }, { options: [["closed", "Closed"], ["open", "Open"], ["invite-only", "Invitation only"]] });
            inputField(body, "Participation details", draft.participation.description, value => { draft.participation.description = value; }, { multiline: true, maxLength: 2000, formatPath: "participation.description" });
            body.append(element("p", "division-editor-note", "This describes how to take part. Registration submissions are not collected by this template."));
        }
        function editCollection(body, key) {
            const limit = key === "timeline" ? 30 : 12;
            draft[key].forEach((item, index) => {
                const entry = element("div", "division-editor-entry"); const heading = element("div", "division-editor-entry-heading");
                heading.append(element("strong", "", `${key === "timeline" ? "Stage" : "Item"} ${index + 1}`), button("Remove", () => { draft[key].splice(index, 1); change(); paintInspector(); }, "division-button--danger")); entry.append(heading);
                inputField(entry, key === "referendums" ? "Question or title" : "Title", item.title, value => { item.title = value; }, { maxLength: key === "referendums" ? 200 : 120, formatPath: `${key}.${item.id}.title` });
                if (key === "timeline") inputField(entry, "Date", item.date, value => { item.date = value; }, { type: "date" });
                inputField(entry, "Description", item.description, value => { item.description = value; }, { multiline: true, maxLength: key === "timeline" ? 1000 : 2000, formatPath: `${key}.${item.id}.description` });
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
                inputField(entry, draft.participation.mode === "solo" ? "Entrant name" : "Team name", team.name, value => { team.name = value; }, { maxLength: 100, formatPath: `teams.${team.id}.name` });
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
