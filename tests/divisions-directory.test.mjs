import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { Script } from "node:vm";
import { JSDOM } from "jsdom";

const tick = () => new Promise(resolve => setImmediate(resolve));
const root = new URL("../", import.meta.url);
const event = (id, changes = {}) => ({
    id, name: `Event ${id}`, summary: "A football event", status: "upcoming",
    appearance: { backgroundColor: "", backgroundImage: "" },
    startDate: "2026-11-21", endDate: "2026-11-22", publishedAt: 1,
    participation: { mode: "teams", teamSize: 4, registration: "invite-only" }, entrantCount: 8,
    ...changes
});
const listing = (divisions, changes = {}) => Response.json({ divisions, page: 1, pages: 1, total: divisions.length, ...changes });

async function directory(t, fetcher, account = null) {
    const dom = new JSDOM("<!doctype html><html><body></body></html>", {
        url: "https://bonk-football-division.com/#divisions", runScripts: "outside-only", pretendToBeVisual: true
    });
    t.after(() => dom.window.close());
    const { window } = dom;
    window.BonkAccount = { session: () => ({ account }) };
    window.fetch = fetcher;
    for (const name of ["division-view.js", "divisions.js"]) {
        new Script(readFileSync(new URL(`code/javascript/${name}`, root), "utf8"), { filename: name })
            .runInContext(dom.getInternalVMContext());
    }
    window.document.body.append(window.BonkDivisions.renderList());
    await tick();
    return window;
}

test("the public showcase renders safe cover cards before the host invitation", async t => {
    const window = await directory(t, async () => listing([
        event(1, { name: "<img src=x>", status: "live", appearance: { backgroundColor: "#164c61", backgroundImage: "https://example.com/cover.jpg" } }),
        event(2, { appearance: { backgroundColor: "invalid", backgroundImage: "javascript:alert(1)" } })
    ]));
    const { document } = window;
    const cards = document.querySelectorAll(".division-event-card");
    assert.equal(cards.length, 2);
    assert.equal(cards[0].getAttribute("href"), "#divisions/1");
    assert.equal(cards[0].firstElementChild.classList.contains("division-card-cover"), true);
    assert.equal(cards[0].querySelector("h3").textContent, "<img src=x>");
    assert.equal(document.querySelector("img, script"), null);
    assert.match(cards[0].querySelector(".division-card-cover").style.getPropertyValue("--division-cover-image"), /https:\/\/example.com\/cover.jpg/);
    assert.ok(cards[0].querySelector(".division-state--live"));
    assert.match(cards[0].querySelector(".division-card-meta").textContent, /4 vs 4/);
    assert.match(cards[0].querySelector(".division-card-footer").textContent, /8 teams/);
    assert.equal(cards[1].querySelector(".division-cover").classList.contains("division-cover--image"), false);
    const page = document.querySelector(".divisions-directory");
    assert.equal(page.firstElementChild.className, "division-directory-events");
    assert.equal(page.lastElementChild.className, "division-host-invitation");
    assert.equal(document.querySelector(".division-draft-row"), null);
});

test("status filters reset pagination and replace the previous page's cards", async t => {
    const requests = [];
    const window = await directory(t, async path => {
        const url = new URL(path, "https://bonk-football-division.com");
        requests.push(url);
        if (url.searchParams.get("status") === "live") return listing([event(30, { status: "live" })]);
        if (url.searchParams.get("page") === "2") return listing([event(20)], { page: 2, pages: 2, total: 13 });
        return listing(Array.from({ length: 12 }, (_, index) => event(index + 1)), { pages: 2, total: 13 });
    });
    const { document } = window;
    [...document.querySelectorAll(".division-directory-pagination button")].find(button => button.textContent === "Next").click();
    await tick();
    assert.equal(document.querySelectorAll(".division-event-card").length, 1);
    assert.equal(document.querySelector(".division-event-card h3").textContent, "Event 20");
    document.querySelector('[data-status="live"]').click();
    await tick();
    assert.equal(requests.at(-1).searchParams.get("page"), "1");
    assert.equal(requests.at(-1).searchParams.get("limit"), "12");
    assert.equal(requests.at(-1).searchParams.get("status"), "live");
    assert.equal(document.querySelector(".division-event-card h3").textContent, "Event 30");
    assert.equal(document.querySelector('[data-status="live"]').getAttribute("aria-pressed"), "true");
    assert.equal(document.querySelector(".division-event-grid").getAttribute("aria-busy"), "false");
});

test("an older status response cannot overwrite the latest filter choice", async t => {
    let finishLive;
    const window = await directory(t, async path => {
        const url = new URL(path, "https://bonk-football-division.com");
        if (url.searchParams.get("status") === "live") return new Promise(resolve => { finishLive = () => resolve(listing([event(2, { status: "live" })])); });
        if (url.searchParams.get("status") === "upcoming") return listing([event(3)]);
        return listing([event(1)]);
    });
    const { document } = window;
    document.querySelector('[data-status="live"]').click();
    document.querySelector('[data-status="upcoming"]').click();
    await tick();
    finishLive();
    await tick();
    assert.equal(document.querySelector(".division-event-card h3").textContent, "Event 3");
    assert.equal(document.querySelector('[data-status="upcoming"]').getAttribute("aria-pressed"), "true");
});

test("private drafts and unpublished changes use compact rows without duplicating published cards", async t => {
    const requests = [];
    const window = await directory(t, async path => {
        const url = new URL(path, "https://bonk-football-division.com");
        requests.push(url);
        if (url.pathname === "/api/manage/divisions") return listing([
            event(2, { name: "Private event", publishedAt: null, role: "site-admin" }),
            event(1, { name: "New unpublished title", role: "site-admin", version: 2, publishedVersion: 1 })
        ]);
        return listing([event(1, { name: "Published title" })]);
    }, { bonkId: "3177088", username: "Admin", isAdmin: true });
    const { document } = window;
    assert.equal(document.querySelectorAll(".division-event-card").length, 1);
    assert.equal(document.querySelector(".division-event-card h3").textContent, "Published title");
    assert.equal(document.querySelectorAll(".division-draft-row").length, 2);
    assert.match(document.querySelector(".division-draft-list").textContent, /Private draft/);
    assert.match(document.querySelector(".division-draft-list").textContent, /Unpublished changes/);
    assert.equal(document.querySelector(".division-directory-management .division-event-card"), null);
    const managed = requests.find(url => url.pathname === "/api/manage/divisions");
    assert.equal(managed.searchParams.get("publication"), "drafts");
    assert.equal(managed.searchParams.get("limit"), "6");
    assert.ok(document.querySelector(".division-directory-heading button"));
});

test("an unavailable showcase can be retried without dropping its status filter", async t => {
    let fail = true;
    const window = await directory(t, async path => {
        const url = new URL(path, "https://bonk-football-division.com");
        if (url.searchParams.get("status") === "completed" && fail) return Response.json({ error: "Please try again." }, { status: 503 });
        return listing(url.searchParams.get("status") === "completed" ? [event(9, { status: "completed" })] : []);
    });
    const { document } = window;
    document.querySelector('[data-status="completed"]').click();
    await tick();
    assert.ok(document.querySelector(".division-error"));
    fail = false;
    document.querySelector(".division-event-grid button").click();
    await tick();
    assert.equal(document.querySelector(".division-event-card h3").textContent, "Event 9");
    assert.equal(document.querySelector('[data-status="completed"]').getAttribute("aria-pressed"), "true");
});
