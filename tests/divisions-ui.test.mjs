import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { Script } from "node:vm";
import { JSDOM } from "jsdom";

const root = new URL("../", import.meta.url);
const html = readFileSync(new URL("code/html/index.html", root), "utf8");
const tick = () => new Promise(resolve => setImmediate(resolve));
const account = { bonkId: "3177088", username: "EventAdmin", isAdmin: true, avatarCode: null };
const content = () => ({
    name: "Football cup", summary: "A community event", description: "Original description", status: "upcoming",
    startDate: "", endDate: "", participation: { mode: "teams", teamSize: 4, registration: "closed", description: "" },
    timeline: [], campaigns: [], referendums: [], teams: [], results: {}
});
const permissions = {
    editSections: ["general", "appearance", "participation", "timeline", "teams", "bracket", "campaigns", "referendums", "custom"],
    generalFields: ["name", "summary", "description", "status", "startDate", "endDate"],
    publish: true, manageMembers: true, assignRoles: ["director", "organizer", "editor"]
};

async function page(t, fetcher, hash = "#divisions", activeAccount = account) {
    const dom = new JSDOM(html, { url: `https://bonk-football-division.com/${hash}`, runScripts: "outside-only", pretendToBeVisual: true });
    t.after(() => dom.window.close());
    const { window } = dom;
    window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
    window.scrollTo = () => {};
    window.confirm = () => true;
    window.fetch = (path, options = {}) => path === "/api/account"
        ? Promise.resolve(Response.json({ account: activeAccount })) : fetcher(path, options);
    for (const script of window.document.querySelectorAll("script[src]")) {
        const name = script.getAttribute("src").split("/").at(-1);
        new Script(readFileSync(new URL(`code/javascript/${name}`, root), "utf8"), { filename: name })
            .runInContext(dom.getInternalVMContext());
    }
    await tick();
    return window;
}

function button(window, label) {
    const node = [...window.document.querySelectorAll("button")].find(node => node.textContent === label);
    assert.ok(node, `${label} is available`);
    return node;
}

function field(window, labelText) {
    const label = [...window.document.querySelectorAll(".division-inline-editor label")]
        .find(node => node.textContent.startsWith(labelText));
    assert.ok(label, `${labelText} is editable`);
    return label.querySelector("input, textarea, select");
}

function input(window, control, value) {
    control.value = value;
    control.dispatchEvent(new window.Event("input", { bubbles: true }));
}

function editSection(window, key = "general") {
    const edit = window.document.querySelector(`[data-section="${key}"] .division-section-edit`);
    assert.ok(edit, `${key} can be edited`);
    edit.click();
    const editor = window.document.querySelector(".division-inline-editor");
    assert.ok(editor, "an inline editor is open");
    return editor;
}

function modelFor(value = content()) {
    return { id: 1, content: value, version: 1, publishedAt: null, publishedVersion: null, role: "site-admin", permissions };
}

test("an administrator creates a private division, saves inline sections and publishes the saved draft", async t => {
    let model = modelFor();
    const writes = [];
    const window = await page(t, async (path, options) => {
        if (path.startsWith("/api/divisions?") || path.startsWith("/api/manage/divisions?")) {
            return Response.json({ divisions: [], total: 0, pages: 1, page: 1 });
        }
        if (path === "/api/admin/divisions") {
            writes.push({ path, body: JSON.parse(options.body) });
            return Response.json({ division: model }, { status: 201 });
        }
        if (path === "/api/manage/divisions/1" && options.method === "PUT") {
            const body = JSON.parse(options.body);
            writes.push({ path, body });
            assert.equal(body.version, model.version);
            model = { ...model, content: body.content, version: model.version + 1 };
            return Response.json({ division: model });
        }
        if (path === "/api/manage/divisions/1/publish") {
            const body = JSON.parse(options.body);
            writes.push({ path, body });
            assert.equal(body.version, model.version);
            model = { ...model, publishedAt: Date.now(), publishedVersion: model.version };
            return Response.json({ division: model });
        }
        if (path === "/api/manage/divisions/1") return Response.json({ division: model });
        throw new Error(`Unexpected request ${path}`);
    });
    button(window, "New division").click();
    const create = window.document.querySelector(".division-create-form");
    create.querySelector("input").value = "Football cup";
    const routed = new Promise(resolve => window.addEventListener("hashchange", resolve, { once: true }));
    create.dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
    await routed;
    await tick();
    assert.equal(window.location.hash, "#divisions/1");
    assert.ok(window.document.querySelector("#site-header .navigation"));
    assert.equal(window.document.querySelector("#app > .page-introduction"), null);
    assert.ok(window.document.querySelector(".division-management-tools"));
    assert.equal(window.document.querySelector(".division-inspector"), null);
    button(window, "Edit").click();
    const editor = editSection(window);
    assert.equal(editor.closest("[data-section]").dataset.section, "general", "fields sit inside the section being edited");
    input(window, field(window, "About this event"), "The new event description");
    assert.equal(writes.filter(write => write.path === "/api/manage/divisions/1").length, 0, "typing does not write to the server");
    window.document.querySelector(".division-inline-save").click();
    await tick();
    assert.equal(window.document.querySelector(".division-inline-editor"), null);
    assert.match(window.document.querySelector(".division-live-preview").textContent, /The new event description/);
    assert.equal(model.publishedAt, null, "saving a section does not publish it");
    button(window, "Background").click();
    assert.ok(window.document.querySelector(".division-management-tools .division-tool-panel .division-inline-editor"));
    input(window, field(window, "Background colour"), "#384c68");
    input(window, field(window, "Background image URL"), "https://example.com/football.jpg");
    const backdrop = window.document.querySelector(".division-page-background");
    assert.equal(backdrop.hidden, false);
    assert.equal(backdrop.style.backgroundColor, "rgb(56, 76, 104)");
    assert.match(backdrop.style.backgroundImage, /https:\/\/example.com\/football.jpg/);
    assert.equal(button(window, "Publish").disabled, true, "publishing waits for the open editor");
    window.document.querySelector(".division-inline-save").click();
    await tick();
    assert.deepEqual(model.content.appearance, { backgroundColor: "#384c68", backgroundImage: "https://example.com/football.jpg" });
    button(window, "Publish").click();
    await tick();
    assert.equal(model.publishedVersion, 3);
    assert.equal(writes.filter(write => write.path.endsWith("/publish")).length, 1);
});

test("a public division opens its published event content without management controls", async t => {
    const published = { ...content(), appearance: { backgroundColor: "#384c68", backgroundImage: "" } };
    const window = await page(t, async path => {
        assert.equal(path, "/api/divisions/2");
        return Response.json({ division: { id: 2, content: published, publishedAt: 1 } });
    }, "#divisions/2", null);
    assert.equal(window.document.querySelector(".division-event-title").textContent, "Football cup");
    assert.equal(window.document.querySelector(".division-management-bar"), null);
    assert.equal(window.document.querySelector(".division-inline-editor"), null);
    assert.ok(window.document.querySelector("#site-header .navigation"));
    assert.equal(window.document.querySelector("#app").dataset.page, "divisions");
    assert.equal(window.document.querySelector(".division-page-background").style.backgroundColor, "rgb(56, 76, 104)");
});

test("cancelling inline edits restores the section without writing or opening a second editor", async t => {
    let writes = 0;
    const model = modelFor();
    const window = await page(t, async (path, options) => {
        assert.equal(path, "/api/manage/divisions/1");
        if (options.method === "PUT") writes += 1;
        return Response.json({ division: model });
    }, "#divisions/1");
    button(window, "Edit").click();
    editSection(window);
    const description = field(window, "About this event");
    description.closest("label").dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true }));
    assert.equal(window.document.querySelector(".division-inline-status").textContent, "", "clicking a label in the current section does not request a different editor");
    input(window, description, "Discard this description");
    window.document.querySelector('[data-section="participation"] .division-section-edit').click();
    assert.equal(window.document.querySelectorAll(".division-inline-editor").length, 1);
    assert.equal(window.document.querySelector(".division-inline-editor").closest("[data-section]").dataset.section, "general");
    window.document.querySelector(".division-inline-cancel").click();
    assert.equal(window.document.querySelector(".division-inline-editor"), null);
    assert.match(window.document.querySelector('[data-section="general"]').textContent, /Original description/);
    assert.doesNotMatch(window.document.querySelector(".division-live-preview").textContent, /Discard this description/);
    assert.equal(button(window, "Save draft").disabled, true);
    assert.equal(writes, 0);
});

test("an inline save disables fields until the server confirms the saved section", async t => {
    let finishSave;
    const model = modelFor();
    const window = await page(t, async (path, options) => {
        assert.equal(path, "/api/manage/divisions/1");
        if (options.method === "PUT") {
            const saved = JSON.parse(options.body);
            return new Promise(resolve => { finishSave = () => resolve(Response.json({ division: { ...model, version: 2, content: saved.content } })); });
        }
        return Response.json({ division: model });
    }, "#divisions/1");
    button(window, "Edit").click();
    editSection(window);
    const description = field(window, "About this event");
    input(window, description, "Saved section text");
    window.document.querySelector(".division-inline-save").click();
    assert.equal(description.matches(":disabled"), true);
    assert.equal(button(window, "Publish").disabled, true);
    finishSave();
    await tick();
    assert.equal(window.document.querySelector(".division-inline-editor"), null);
    assert.match(window.document.querySelector('[data-section="general"]').textContent, /Saved section text/);
});

test("a conflicting section save keeps the fields open and preserves the local text", async t => {
    const model = modelFor();
    const window = await page(t, async (path, options) => {
        assert.equal(path, "/api/manage/divisions/1");
        return options.method === "PUT"
            ? Response.json({ error: "This division changed elsewhere. Reload it before saving." }, { status: 409 })
            : Response.json({ division: model });
    }, "#divisions/1");
    button(window, "Edit").click();
    editSection(window);
    input(window, field(window, "About this event"), "Keep this local version");
    window.document.querySelector(".division-inline-save").click();
    await tick();
    assert.equal(field(window, "About this event").value, "Keep this local version");
    assert.match(window.document.querySelector(".division-inline-status").textContent, /changed elsewhere/);
    assert.equal(field(window, "About this event").matches(":disabled"), false);
});

test("sections can be added, moved and removed without losing their content", async t => {
    let saved;
    const initial = { ...content(), sectionOrder: ["timeline", "campaigns"],
        timeline: [{ id: "opening", title: "Opening matches", date: "2026-11-21", description: "The event starts." }],
        campaigns: [{ id: "fair-play", title: "Fair play", description: "Respect the players." }] };
    const model = modelFor(initial);
    const window = await page(t, async (path, options) => {
        assert.equal(path, "/api/manage/divisions/1");
        if (options.method === "PUT") {
            saved = JSON.parse(options.body).content;
            return Response.json({ division: { ...model, content: saved, version: 2 } });
        }
        return Response.json({ division: model });
    }, "#divisions/1");
    const { document } = window;
    const order = () => [...document.querySelectorAll(".division-live-preview .division-view > [data-section]")].map(node => node.dataset.section);
    button(window, "Edit").click();
    assert.equal(document.querySelector(".division-inspector"), null);
    assert.deepEqual(order(), ["general", "timeline", "campaigns"]);
    document.querySelector('[data-section="campaigns"] .division-section-move-up').click();
    assert.deepEqual(order(), ["general", "campaigns", "timeline"]);
    document.querySelector('[data-section="timeline"] .division-section-remove').click();
    assert.deepEqual(order(), ["general", "campaigns"]);
    document.querySelector(".division-add-section")?.click();
    assert.ok(document.querySelector(".division-add-panel"));
    document.querySelector('[data-add-section="timeline"]').click();
    assert.deepEqual(order(), ["general", "campaigns", "timeline"]);
    assert.ok(document.querySelector('[data-section="timeline"] .division-inline-editor'));
    window.document.querySelector(".division-inline-save").click();
    await tick();
    assert.deepEqual(saved.sectionOrder, ["campaigns", "timeline"]);
    assert.equal(saved.timeline[0].title, "Opening matches");
    assert.match(document.querySelector('[data-section="timeline"]').textContent, /Opening matches/);
});

test("cancelling a newly added text section removes it, while saved text sections can be edited again", async t => {
    let saved;
    let writes = 0;
    const initial = { ...content(), sectionOrder: ["participation", "timeline", "teams", "bracket", "campaigns", "referendums"], customSections: [] };
    const model = modelFor(initial);
    const window = await page(t, async (path, options) => {
        assert.equal(path, "/api/manage/divisions/1");
        if (options.method === "PUT") {
            writes += 1;
            const body = JSON.parse(options.body);
            saved = body.content;
            return Response.json({ division: { ...model, content: saved, version: body.version + 1 } });
        }
        return Response.json({ division: model });
    }, "#divisions/1");
    const { document } = window;
    button(window, "Edit").click();
    document.querySelector(".division-add-section").click();
    document.querySelector('[data-add-section="custom"]').click();
    document.querySelector(".division-inline-cancel").click();
    assert.equal(document.querySelector('[data-section^="custom:"]'), null);
    assert.equal(writes, 0);
    document.querySelector(".division-add-section").click();
    document.querySelector('[data-add-section="custom"]').click();
    input(window, field(window, "Section title"), "Match rules");
    input(window, field(window, "Section text"), "First version of the rules.");
    document.querySelector(".division-inline-save").click();
    await tick();
    assert.equal(saved.customSections[0].title, "Match rules");
    const key = `custom:${saved.customSections[0].id}`;
    assert.ok(saved.sectionOrder.includes(key));
    editSection(window, key);
    input(window, field(window, "Section text"), "Updated rules after the first save.");
    document.querySelector(".division-inline-save").click();
    await tick();
    assert.equal(saved.customSections[0].description, "Updated rules after the first save.");
});

test("an open section chooser cannot mutate the draft while a global save is pending", async t => {
    let finishSave;
    let saves = 0;
    let latest;
    const initial = { ...content(), sectionOrder: ["timeline", "campaigns"], customSections: [],
        timeline: [{ id: "opening", title: "Opening matches", date: "2026-11-21", description: "The event starts." }],
        campaigns: [{ id: "fair-play", title: "Fair play", description: "Respect the players." }] };
    const model = modelFor(initial);
    const window = await page(t, async (path, options) => {
        assert.equal(path, "/api/manage/divisions/1");
        if (options.method === "PUT") {
            const body = JSON.parse(options.body);
            latest = body.content;
            saves += 1;
            const response = () => Response.json({ division: { ...model, content: body.content, version: body.version + 1 } });
            if (saves === 1) return new Promise(resolve => { finishSave = () => resolve(response()); });
            return response();
        }
        return Response.json({ division: model });
    }, "#divisions/1");
    const { document } = window;
    button(window, "Edit").click();
    document.querySelector('[data-section="campaigns"] .division-section-move-up').click();
    document.querySelector(".division-add-section").click();
    button(window, "Save draft").click();
    const choice = document.querySelector('[data-add-section="custom"]');
    assert.equal(choice.disabled, true, "the chooser is disabled while its draft is being saved");
    choice.click();
    assert.equal(document.querySelector(".division-inline-editor"), null);
    assert.equal(document.querySelector('[data-section^="custom:"]'), null);
    finishSave();
    await tick();
    const restoredChoice = document.querySelector('[data-add-section="custom"]');
    assert.equal(restoredChoice.disabled, false);
    restoredChoice.click();
    assert.ok(document.querySelector(".division-inline-editor"));
    document.querySelector(".division-inline-save").click();
    await tick();
    assert.equal(latest.customSections.length, 1, "the blocked click did not leave a hidden extra section in the draft");
});

test("background controls can close in several ways without losing local changes or writing them", async t => {
    let model = modelFor({ ...content(), appearance: { backgroundColor: "#384c68", backgroundImage: "" } });
    const writes = [];
    const window = await page(t, async (path, options) => {
        assert.equal(path, "/api/manage/divisions/1");
        if (options.method === "PUT") {
            const body = JSON.parse(options.body);
            writes.push(body);
            model = { ...model, content: body.content, version: body.version + 1 };
        }
        return Response.json({ division: model });
    }, "#divisions/1");
    const { document } = window;
    const backdrop = () => document.querySelector(".division-page-background");
    const closed = () => assert.equal(document.querySelector(".division-inline-editor"), null);
    button(window, "Edit").click();
    button(window, "Background").click();
    input(window, field(window, "Background colour"), "#407159");
    button(window, "Background").click();
    closed();
    assert.equal(backdrop().style.backgroundColor, "rgb(64, 113, 89)");
    assert.equal(button(window, "Save draft").disabled, false);

    button(window, "Background").click();
    assert.equal(field(window, "Background colour").value, "#407159");
    input(window, field(window, "Background image URL"), "https://example.com/local-field.jpg");
    button(window, "Close panel").click();
    closed();
    assert.match(backdrop().style.backgroundImage, /local-field\.jpg/);

    button(window, "Background").click();
    field(window, "Background colour").dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    closed();
    button(window, "Background").click();
    document.querySelector(".division-live-preview").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    closed();
    button(window, "Background").click();
    document.body.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    closed();
    assert.equal(writes.length, 0, "dismissing appearance controls does not save or publish the draft");

    button(window, "Save draft").click();
    await tick();
    assert.equal(writes.length, 1);
    assert.deepEqual(model.content.appearance, { backgroundColor: "#407159", backgroundImage: "https://example.com/local-field.jpg" });
    assert.equal(model.publishedAt, null);
});

test("editing another section closes background controls and preserves its unsaved appearance", async t => {
    const model = modelFor();
    let writes = 0;
    const window = await page(t, async (path, options) => {
        assert.equal(path, "/api/manage/divisions/1");
        if (options.method === "PUT") writes += 1;
        return Response.json({ division: model });
    }, "#divisions/1");
    const { document } = window;
    button(window, "Edit").click();
    button(window, "Background").click();
    input(window, field(window, "Background colour"), "#407159");
    const editor = editSection(window, "general");
    assert.equal(editor.closest("[data-section]").dataset.section, "general");
    assert.equal(document.querySelector(".division-tool-panel .division-inline-editor"), null);
    assert.equal(document.querySelectorAll(".division-inline-editor").length, 1);
    input(window, field(window, "About this event"), "This section change should be discarded.");
    document.querySelector(".division-inline-cancel").click();
    assert.match(document.querySelector('[data-section="general"]').textContent, /Original description/);
    assert.equal(document.querySelector(".division-page-background").style.backgroundColor, "rgb(64, 113, 89)");
    button(window, "Background").click();
    assert.equal(field(window, "Background colour").value, "#407159", "cancelling another section leaves the parked appearance intact");
    assert.equal(writes, 0);
});

test("closed background changes can be undone and redone in the preview without writes", async t => {
    const model = modelFor({ ...content(), appearance: { backgroundColor: "#384c68", backgroundImage: "https://example.com/original.jpg" } });
    let writes = 0;
    const window = await page(t, async (path, options) => {
        assert.equal(path, "/api/manage/divisions/1");
        if (options.method === "PUT") writes += 1;
        return Response.json({ division: model });
    }, "#divisions/1");
    const backdrop = () => window.document.querySelector(".division-page-background");
    button(window, "Edit").click();
    button(window, "Background").click();
    input(window, field(window, "Background colour"), "#407159");
    input(window, field(window, "Background image URL"), "https://example.com/revised.jpg");
    button(window, "Close panel").click();
    assert.equal(backdrop().style.backgroundColor, "rgb(64, 113, 89)");
    assert.match(backdrop().style.backgroundImage, /revised\.jpg/);
    button(window, "Undo").click();
    assert.equal(backdrop().style.backgroundColor, "rgb(56, 76, 104)");
    assert.match(backdrop().style.backgroundImage, /original\.jpg/);
    assert.equal(button(window, "Save draft").disabled, true);
    button(window, "Redo").click();
    assert.equal(backdrop().style.backgroundColor, "rgb(64, 113, 89)");
    assert.match(backdrop().style.backgroundImage, /revised\.jpg/);
    assert.equal(button(window, "Save draft").disabled, false);
    assert.equal(writes, 0);
});

test("restoring the saved background values leaves no unsaved change after closing the panel", async t => {
    const appearance = { backgroundColor: "#384c68", backgroundImage: "https://example.com/original.jpg" };
    const model = modelFor({ ...content(), appearance });
    let writes = 0;
    const window = await page(t, async (path, options) => {
        assert.equal(path, "/api/manage/divisions/1");
        if (options.method === "PUT") writes += 1;
        return Response.json({ division: model });
    }, "#divisions/1");
    button(window, "Edit").click();
    button(window, "Background").click();
    input(window, field(window, "Background colour"), "#407159");
    input(window, field(window, "Background image URL"), "https://example.com/revised.jpg");
    button(window, "Close panel").click();
    assert.equal(button(window, "Save draft").disabled, false);
    button(window, "Background").click();
    input(window, field(window, "Background colour"), appearance.backgroundColor);
    input(window, field(window, "Background image URL"), appearance.backgroundImage);
    button(window, "Close panel").click();
    assert.equal(button(window, "Save draft").disabled, true, "dirty state compares with the saved draft rather than the previous panel session");
    assert.equal(button(window, "Publish").disabled, false);
    assert.equal(writes, 0);
});

test("a failed background save keeps its fields and lets management switch to another section", async t => {
    const model = modelFor();
    let writes = 0;
    const window = await page(t, async (path, options) => {
        assert.equal(path, "/api/manage/divisions/1");
        if (options.method === "PUT") {
            writes += 1;
            return Response.json({ error: "This division changed elsewhere. Reload it before saving." }, { status: 409 });
        }
        return Response.json({ division: model });
    }, "#divisions/1");
    const { document } = window;
    button(window, "Edit").click();
    button(window, "Background").click();
    input(window, field(window, "Background colour"), "#407159");
    document.querySelector(".division-inline-save").click();
    await tick();
    assert.equal(field(window, "Background colour").value, "#407159");
    assert.equal(field(window, "Background colour").matches(":disabled"), false);
    assert.match(document.querySelector(".division-inline-status").textContent, /changed elsewhere/);
    const otherSection = document.querySelector('[data-section="general"] .division-section-edit');
    assert.equal(otherSection.disabled, false, "a failed appearance save does not trap management in its panel");
    otherSection.click();
    assert.equal(document.querySelector(".division-inline-editor").closest("[data-section]").dataset.section, "general");
    assert.equal(document.querySelector(".division-page-background").style.backgroundColor, "rgb(64, 113, 89)");
    assert.equal(writes, 1, "switching sections does not retry the failed save");
});

test("undo and redo preserve layout history after the reordered draft has been saved", async t => {
    let model = modelFor({ ...content(), sectionOrder: ["timeline", "campaigns"] });
    const writes = [];
    const window = await page(t, async (path, options) => {
        assert.equal(path, "/api/manage/divisions/1");
        if (options.method === "PUT") {
            const body = JSON.parse(options.body);
            writes.push(body);
            model = { ...model, content: body.content, version: body.version + 1 };
        }
        return Response.json({ division: model });
    }, "#divisions/1");
    const { document } = window;
    const order = () => [...document.querySelectorAll(".division-live-preview .division-view > [data-section]")].map(node => node.dataset.section);
    button(window, "Edit").click();
    assert.equal(button(window, "Undo").disabled, true);
    assert.equal(button(window, "Redo").disabled, true);
    document.querySelector('[data-section="campaigns"] .division-section-move-up').click();
    assert.deepEqual(order(), ["general", "campaigns", "timeline"]);
    button(window, "Undo").click();
    assert.deepEqual(order(), ["general", "timeline", "campaigns"]);
    button(window, "Redo").click();
    assert.deepEqual(order(), ["general", "campaigns", "timeline"]);
    assert.equal(writes.length, 0);
    button(window, "Save draft").click();
    await tick();
    assert.deepEqual(model.content.sectionOrder, ["campaigns", "timeline"]);
    assert.equal(button(window, "Save draft").disabled, true);
    button(window, "Undo").click();
    assert.deepEqual(order(), ["general", "timeline", "campaigns"]);
    assert.equal(button(window, "Save draft").disabled, false, "undoing saved changes creates a new unsaved draft change");
    assert.deepEqual(model.content.sectionOrder, ["campaigns", "timeline"], "undo does not rewrite the server");
    button(window, "Redo").click();
    assert.deepEqual(order(), ["general", "campaigns", "timeline"]);
    assert.equal(button(window, "Save draft").disabled, true);
    assert.equal(writes.length, 1);
    assert.equal(model.publishedAt, null);
});

test("a saved section can be undone and saved again without publishing the reversal", async t => {
    let model = modelFor();
    const writes = [];
    const window = await page(t, async (path, options) => {
        assert.equal(path, "/api/manage/divisions/1");
        if (options.method === "PUT") {
            const body = JSON.parse(options.body);
            writes.push(body);
            model = { ...model, content: body.content, version: body.version + 1 };
        }
        return Response.json({ division: model });
    }, "#divisions/1");
    const { document } = window;
    button(window, "Edit").click();
    editSection(window);
    input(window, field(window, "About this event"), "A saved description");
    document.querySelector(".division-inline-save").click();
    await tick();
    assert.equal(model.content.description, "A saved description");
    button(window, "Undo").click();
    assert.match(document.querySelector('[data-section="general"]').textContent, /Original description/);
    assert.equal(model.content.description, "A saved description");
    assert.equal(writes.length, 1);
    button(window, "Redo").click();
    assert.match(document.querySelector('[data-section="general"]').textContent, /A saved description/);
    button(window, "Undo").click();
    button(window, "Save draft").click();
    await tick();
    assert.equal(writes.length, 2);
    assert.equal(writes[1].version, 2);
    assert.equal(model.content.description, "Original description");
    assert.equal(model.publishedAt, null);
});

test("the section outline scrolls to the chosen event section without changing its content or route", async t => {
    const model = modelFor({ ...content(), sectionOrder: ["timeline", "campaigns", "custom:rules"],
        timeline: [{ id: "opening", title: "Opening matches", date: "2026-11-21", description: "The event starts." }],
        customSections: [{ id: "rules", title: "Match rules", description: "Fair play." }] });
    let requests = 0;
    const window = await page(t, async (path, options) => {
        assert.equal(path, "/api/manage/divisions/1");
        assert.equal(options.method || "GET", "GET");
        requests += 1;
        return Response.json({ division: model });
    }, "#divisions/1");
    const scrolled = [];
    window.HTMLElement.prototype.scrollIntoView = function () { scrolled.push(this.dataset.section); };
    const outline = window.document.querySelector("select.division-outline");
    assert.ok(outline, "the tools provide a section outline");
    assert.equal([...outline.options].some(option => option.value === "campaigns"), false, "View mode omits empty sections with no visible scroll target");
    assert.ok([...outline.options].some(option => option.value === "custom:rules" && option.textContent.includes("Match rules")));
    outline.value = "timeline";
    outline.dispatchEvent(new window.Event("change", { bubbles: true }));
    outline.value = "custom:rules";
    outline.dispatchEvent(new window.Event("change", { bubbles: true }));
    assert.deepEqual(scrolled, ["timeline", "custom:rules"]);
    assert.equal(window.location.hash, "#divisions/1");
    assert.equal(requests, 1);
    button(window, "Edit").click();
    assert.ok([...window.document.querySelector("select.division-outline").options].some(option => option.value === "campaigns"), "Edit mode includes the visible empty section");
});

test("copy event link copies the division URL and supplies selectable text when copying is unavailable", async t => {
    const model = modelFor();
    const window = await page(t, async path => {
        assert.equal(path, "/api/manage/divisions/1");
        return Response.json({ division: model });
    }, "#divisions/1");
    const copied = [];
    Object.defineProperty(window.navigator, "clipboard", { configurable: true, value: { writeText: async value => { copied.push(value); } } });
    button(window, "Copy event link").click();
    await tick();
    assert.deepEqual(copied, ["https://bonk-football-division.com/#divisions/1"]);
    assert.match(window.document.querySelector(".division-share-status").textContent, /copied/i);
    Object.defineProperty(window.navigator, "clipboard", { configurable: true, value: undefined });
    button(window, "Copy event link").click();
    await tick();
    const fallback = window.document.querySelector("input.division-share-fallback");
    assert.ok(fallback, "the URL remains available when clipboard access is unavailable");
    assert.equal(fallback.value, copied[0]);
    assert.equal(fallback.readOnly, true);
    assert.equal(fallback.selectionStart, 0);
    assert.equal(fallback.selectionEnd, fallback.value.length);
});
