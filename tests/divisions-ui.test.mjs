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
    editSections: ["general", "appearance", "participation", "timeline", "teams", "bracket", "campaigns", "referendums"],
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

test("an administrator creates a private division, previews a section and publishes the saved draft", async t => {
    let model = { id: 1, content: content(), version: 1, publishedAt: null, publishedVersion: null, role: "site-admin", permissions };
    const writes = [];
    const window = await page(t, async (path, options) => {
        if (path.startsWith("/api/divisions?")) return Response.json({ divisions: [], total: 0, pages: 1, page: 1 });
        if (path.startsWith("/api/manage/divisions?")) return Response.json({ divisions: [], total: 0, pages: 1, page: 1 });
        if (path === "/api/admin/divisions") {
            writes.push({ path, body: JSON.parse(options.body) });
            return Response.json({ division: model }, { status: 201 });
        }
        if (path === "/api/manage/divisions/1" && options.method === "PUT") {
            const body = JSON.parse(options.body);
            writes.push({ path, body });
            assert.equal(body.version, 1);
            model = { ...model, content: body.content, version: 2 };
            return Response.json({ division: model });
        }
        if (path === "/api/manage/divisions/1/publish") {
            const body = JSON.parse(options.body);
            writes.push({ path, body });
            assert.equal(body.version, 2);
            model = { ...model, publishedAt: Date.now(), publishedVersion: 2 };
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
    assert.ok(window.document.querySelector("#site-header .navigation"), "the site navigation remains");
    assert.equal(window.document.querySelector("#app > .page-introduction"), null, "the event owns the content area");
    button(window, "Edit").click();
    const description = [...window.document.querySelectorAll(".division-inspector label")]
        .find(label => label.textContent.startsWith("About this event")).querySelector("textarea");
    description.value = "The new event description";
    description.dispatchEvent(new window.Event("input", { bubbles: true }));
    assert.match(window.document.querySelector(".division-live-preview").textContent, /The new event description/);
    button(window, "Background").click();
    const colour = window.document.querySelector(".division-inspector input[type=color]");
    colour.value = "#384c68";
    colour.dispatchEvent(new window.Event("input", { bubbles: true }));
    const image = window.document.querySelector(".division-inspector input[type=url]");
    image.value = "https://example.com/football.jpg";
    image.dispatchEvent(new window.Event("input", { bubbles: true }));
    const backdrop = window.document.querySelector(".division-page-background");
    assert.equal(backdrop.hidden, false);
    assert.equal(backdrop.style.backgroundColor, "rgb(56, 76, 104)");
    assert.match(backdrop.style.backgroundImage, /https:\/\/example.com\/football.jpg/);
    assert.equal(button(window, "Publish").disabled, true, "unsaved content cannot be published");
    button(window, "Save draft").click();
    await tick();
    assert.equal(model.publishedAt, null, "saving does not publish");
    assert.equal(model.content.description, "The new event description");
    assert.deepEqual(model.content.appearance, { backgroundColor: "#384c68", backgroundImage: "https://example.com/football.jpg" });
    button(window, "Publish").click();
    await tick();
    assert.equal(model.publishedVersion, 2);
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
    assert.ok(window.document.querySelector("#site-header .navigation"));
    assert.equal(window.document.querySelector("#app").dataset.page, "divisions");
    assert.equal(window.document.querySelector(".division-page-background").style.backgroundColor, "rgb(56, 76, 104)");
});

test("typing during a draft save keeps newer preview edits unsaved", async t => {
    let finishSave;
    const model = { id: 1, content: content(), version: 1, publishedAt: null, publishedVersion: null, role: "site-admin", permissions };
    const window = await page(t, async (path, options) => {
        assert.equal(path, "/api/manage/divisions/1");
        if (options.method === "PUT") {
            const saved = JSON.parse(options.body);
            return new Promise(resolve => { finishSave = () => resolve(Response.json({ division: { ...model, version: 2, content: saved.content } })); });
        }
        return Response.json({ division: model });
    }, "#divisions/1");
    button(window, "Edit").click();
    const description = [...window.document.querySelectorAll(".division-inspector label")]
        .find(label => label.textContent.startsWith("About this event")).querySelector("textarea");
    description.value = "Saved snapshot";
    description.dispatchEvent(new window.Event("input", { bubbles: true }));
    button(window, "Save draft").click();
    description.value = "Newer local text";
    description.dispatchEvent(new window.Event("input", { bubbles: true }));
    finishSave();
    await tick();
    assert.match(window.document.querySelector(".division-live-preview").textContent, /Newer local text/);
    assert.equal(description.value, "Newer local text");
    assert.equal(button(window, "Save draft").disabled, false);
    assert.equal(button(window, "Publish").disabled, true);
});
