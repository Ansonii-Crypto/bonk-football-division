import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { Script } from "node:vm";
import { JSDOM } from "jsdom";

const root = new URL("../", import.meta.url);
const html = readFileSync(new URL("code/html/index.html", root), "utf8");
const tick = () => new Promise(resolve => setImmediate(resolve));

function assessment(id) {
    return {
        id,
        name: id === 13 ? "Beta" : `Aster ${id}`,
        className: "Weaver",
        date: "2026-11-11",
        values: [215, 215, 215, 215, 215, 215],
        total: 1290,
        tier: "A",
        assessorName: "Admin",
        notes: `Assessment ${id} notes`
    };
}

test("public assessments replace each page of cards and load the selected assessment", async t => {
    const calls = [];
    const dom = new JSDOM(html, {
        url: "https://bonk-football-division.com/#assessments",
        runScripts: "outside-only",
        pretendToBeVisual: true
    });
    t.after(() => dom.window.close());
    const { window } = dom;
    window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
    window.scrollTo = () => {};
    window.fetch = async path => {
        const url = new URL(path, window.location.origin);
        calls.push(url);
        if (url.pathname === "/api/account") {
            return Response.json({ account: null });
        }
        if (url.pathname === "/api/assessments") {
            const page = Number(url.searchParams.get("page"));
            const ids = page === 2 ? [13] : Array.from({ length: 12 }, (_, index) => index + 1);
            return Response.json({
                assessments: ids.map(assessment),
                total: 13,
                page,
                pages: 2,
                availableTiers: ["A"],
                availableInitials: ["A", "B"]
            });
        }
        if (url.pathname === "/api/assessments/13") {
            return Response.json({ assessment: assessment(13) });
        }
        throw new Error(`Unexpected request: ${url.pathname}`);
    };
    for (const script of window.document.querySelectorAll("script[src]")) {
        const name = script.getAttribute("src").split("/").at(-1);
        new Script(readFileSync(new URL(`code/javascript/${name}`, root), "utf8"), { filename: name })
            .runInContext(dom.getInternalVMContext());
    }
    await tick();
    assert.equal(window.document.querySelectorAll(".assessment-card-link").length, 12);
    assert.match(window.document.querySelector(".pagination-status").textContent, /Page 1 of 2/);
    window.document.querySelector(".assessment-pagination button:last-of-type").click();
    await tick();
    assert.equal(window.document.querySelectorAll(".assessment-card-link").length, 1);
    assert.match(window.document.querySelector(".assessment-card-link").textContent, /Beta/);
    assert.match(window.document.querySelector(".pagination-status").textContent, /Page 2 of 2/);
    assert.ok(calls.some(url => url.pathname === "/api/assessments" && url.searchParams.get("page") === "2"));
    const routed = new Promise(resolve => window.addEventListener("hashchange", resolve, { once: true }));
    window.document.querySelector(".assessment-card-link").click();
    await routed;
    await tick();
    assert.equal(window.location.hash, "#assessments/13");
    assert.match(window.document.querySelector(".assessment-profile").textContent, /Assessment 13 notes/);
    assert.ok(calls.some(url => url.pathname === "/api/assessments/13"));
});
