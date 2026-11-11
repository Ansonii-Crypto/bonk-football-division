import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { Script } from "node:vm";
import { JSDOM } from "jsdom";

const root = new URL("../", import.meta.url);
const html = readFileSync(new URL("code/html/index.html", root), "utf8");
const admin = { bonkId: "3177088", username: "SiteOwner", avatarCode: null, isAdmin: true };
const regular = { bonkId: "1234567", username: "Visitor", avatarCode: null, isAdmin: false };
const tick = () => new Promise(resolve => setImmediate(resolve));

async function page(t, account, handleAdmin) {
    const dom = new JSDOM(html, {
        url: "https://bonk-football-division.com/#admin",
        runScripts: "outside-only",
        pretendToBeVisual: true
    });
    t.after(() => dom.window.close());
    const { window } = dom;
    window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
    window.scrollTo = () => {};
    window.fetch = async (path, options = {}) => path === "/api/account"
        ? Response.json({ account }) : handleAdmin(path, options);
    for (const script of window.document.querySelectorAll("script[src]")) {
        const name = script.getAttribute("src").split("/").at(-1);
        new Script(readFileSync(new URL(`code/javascript/${name}`, root), "utf8"), { filename: name })
            .runInContext(dom.getInternalVMContext());
    }
    await tick();
    await tick();
    return window;
}

test("admin entry and direct route follow the verified account flag", async t => {
    let adminCalls = 0;
    const window = await page(t, regular, () => {
        adminCalls += 1;
        return Response.json({ error: "Forbidden" }, { status: 403 });
    });
    const { document } = window;
    assert.match(document.querySelector("#app").textContent, /Administrator access required/);
    assert.equal(document.querySelector(".account-menu-options a[href='#admin']"), null);
    assert.equal(document.querySelector(".admin-tabs"), null);
    assert.equal(adminCalls, 0, "a regular account never requests admin data from the UI");
});

test("admin can browse read-only, edit with a version, and create an assessment", async t => {
    let existing = {
        id: "assessment-1", playerName: "Keeper", playerBonkId: "7654321", className: "Bulwark",
        date: "2026-11-10", values: [200, 210, 220, 230, 240, 250], total: 1350, tier: "A",
        notes: "", createdByName: "SiteOwner", updatedByName: "SiteOwner", version: 1
    };
    const calls = [];
    const window = await page(t, admin, (path, options) => {
        calls.push({ path, method: options.method || "GET", body: options.body });
        if (path.startsWith("/api/admin/assessments?")) {
            return Response.json({ assessments: [existing], page: 1, pages: 1, total: 1 });
        }
        if (path === "/api/admin/assessments/assessment-1" && options.method === "GET") {
            return Response.json({ assessment: existing });
        }
        if (path === "/api/admin/assessments/assessment-1" && options.method === "PUT") {
            const body = JSON.parse(options.body);
            assert.equal(body.version, 1);
            assert.equal(body.playerName, "Keeper");
            assert.equal(body.values[0], 205);
            existing = { ...existing, ...body, total: 1355, version: 2 };
            return Response.json({ assessment: existing });
        }
        if (path === "/api/admin/assessments" && options.method === "POST") {
            const body = JSON.parse(options.body);
            assert.equal(body.playerName, "Striker");
            assert.equal(body.playerBonkId, null);
            assert.equal(body.values.length, 6);
            return Response.json({ assessment: { ...body, id: "assessment-2", total: 900, tier: "C", version: 1 } }, { status: 201 });
        }
        throw new Error(`Unexpected ${options.method} ${path}`);
    });
    const { document } = window;
    assert.ok(document.querySelector(".account-menu-options a[href='#admin']"));
    assert.ok(document.querySelector(".admin-assessment-row"));
    assert.equal(document.querySelector("#admin-tab-assessments").getAttribute("aria-selected"), "true");
    const sort = document.querySelector(".admin-sort select");
    sort.value = "points_desc";
    sort.dispatchEvent(new window.Event("change", { bubbles: true }));
    await tick();
    assert.ok(calls.some(call => call.path.includes("sort=points_desc")));

    document.querySelector(".admin-assessment-row .admin-button").click();
    await tick();
    assert.ok(document.querySelector(".admin-detail"));
    assert.equal(document.querySelector(".admin-form"), null, "View does not open an editable form");
    document.querySelector(".admin-detail .admin-button--primary").click();
    const edit = document.querySelector(".admin-form");
    assert.ok(edit);
    edit.querySelector(".admin-score-grid input").value = "205";
    edit.dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
    await tick();
    assert.ok(document.querySelector(".admin-detail"));
    assert.match(document.querySelector(".admin-detail-tier").textContent, /1355/);

    document.querySelector("#admin-tab-new").click();
    const create = document.querySelector(".admin-form");
    assert.ok(create);
    create.querySelector(".admin-form-grid input").value = "Striker";
    for (const input of create.querySelectorAll(".admin-score-grid input")) {
        input.value = "150";
    }
    create.dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
    await tick();
    assert.match(document.querySelector(".admin-detail-heading h2").textContent, /Striker/);
    assert.equal(calls.filter(call => call.method === "PUT").length, 1);
    assert.equal(calls.filter(call => call.method === "POST").length, 1);

    const accountRoute = new Promise(resolve => window.addEventListener("hashchange", resolve, { once: true }));
    window.location.hash = "#account";
    await accountRoute;
    assert.match(document.querySelector(".account-id").textContent, /Bonk player ID: 3177088/);
    assert.ok(document.querySelector(".account-dashboard-card a[href='#admin']"));
});

test("known account suggestions support keyboard selection and prefill only verified IDs", async t => {
    const lookupQueries = [];
    const window = await page(t, admin, path => {
        if (path.startsWith("/api/admin/assessments?")) {
            return Response.json({ assessments: [], page: 1, pages: 1, total: 0 });
        }
        if (path.startsWith("/api/admin/bonk-accounts?")) {
            const query = new URL(path, window.location.origin).searchParams.get("q");
            lookupQueries.push(query);
            return Response.json({ accounts: query === "Leg" ? [
                { username: "  Legacy  ", bonkId: "7654321", source: "verified" },
                { username: "LegacyTwo", bonkId: null, source: "assessment" }
            ] : [{ username: "Assessed Only", bonkId: null, source: "assessment" }] });
        }
        throw new Error(`Unexpected request ${path}`);
    });
    const { document } = window;
    const search = document.querySelector(".admin-search input[name=q]");
    search.value = "Leg";
    search.dispatchEvent(new window.Event("input", { bubbles: true }));
    await new Promise(resolve => setTimeout(resolve, 320));
    await tick();
    assert.deepEqual(lookupQueries, ["Leg"]);
    assert.equal(search.getAttribute("aria-expanded"), "true");
    assert.match(document.querySelector(".admin-suggestion-name").textContent, /“  Legacy  ”/);
    search.dispatchEvent(new window.KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true }));
    assert.ok(search.getAttribute("aria-activedescendant"));
    search.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    await tick();
    assert.equal(document.querySelector(".admin-search input[name=q]").value, "  Legacy  ");
    document.querySelector(".admin-create-from-search").click();
    const formName = document.querySelector(".admin-form-grid input[type=text]");
    const formId = document.querySelector(".admin-form-grid input[inputmode=numeric]");
    assert.equal(formName.value, "  Legacy  ");
    assert.equal(formId.value, "7654321");

    formName.value = "Ass";
    formName.dispatchEvent(new window.Event("input", { bubbles: true }));
    assert.equal(formId.value, "", "editing a chosen username clears its linked ID");
    await new Promise(resolve => setTimeout(resolve, 320));
    await tick();
    const assessmentOption = document.querySelector(".admin-suggestion-option");
    assessmentOption.dispatchEvent(new window.Event("pointerdown", { bubbles: true, cancelable: true }));
    assert.equal(formName.value, "Assessed Only");
    assert.equal(formId.value, "", "assessment-only names never auto-fill an unverified ID");
});

test("a delayed suggestion response cannot replace newer matches", async t => {
    let resolveOlder;
    const window = await page(t, admin, path => {
        if (path.startsWith("/api/admin/assessments?")) {
            return Response.json({ assessments: [], page: 1, pages: 1, total: 0 });
        }
        const query = new URL(path, window.location.origin).searchParams.get("q");
        if (query === "Al") {
            return new Promise(resolve => { resolveOlder = resolve; });
        }
        return Response.json({ accounts: [{ username: "Beta", bonkId: "2345", source: "verified" }] });
    });
    const search = window.document.querySelector(".admin-search input[name=q]");
    search.value = "Al";
    search.dispatchEvent(new window.Event("input", { bubbles: true }));
    await new Promise(resolve => setTimeout(resolve, 320));
    assert.equal(typeof resolveOlder, "function");
    search.value = "Be";
    search.dispatchEvent(new window.Event("input", { bubbles: true }));
    await new Promise(resolve => setTimeout(resolve, 320));
    await tick();
    assert.match(window.document.querySelector(".admin-suggestion-name").textContent, /Beta/);
    resolveOlder(Response.json({ accounts: [{ username: "Alpha", bonkId: "1234", source: "verified" }] }));
    await tick();
    assert.match(window.document.querySelector(".admin-suggestion-name").textContent, /Beta/);
    search.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    assert.equal(search.getAttribute("aria-expanded"), "false");
});
