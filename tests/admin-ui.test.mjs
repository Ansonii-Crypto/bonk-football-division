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
