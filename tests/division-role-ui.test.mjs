import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { Script } from "node:vm";
import { JSDOM } from "jsdom";

const root = new URL("../", import.meta.url);
const html = readFileSync(new URL("code/html/index.html", root), "utf8");
const tick = () => new Promise(resolve => setImmediate(resolve));

test("division roles can be assigned by username, ID, or matching details without requiring an ID", async t => {
    const writes = [];
    const dom = new JSDOM(html, { url: "https://bonk-football-division.com/divisions/1", runScripts: "outside-only", pretendToBeVisual: true });
    t.after(() => dom.window.close());
    const { window } = dom;
    window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
    window.scrollTo = () => {};
    window.fetch = async (path, options = {}) => {
        if (path === "/api/account") return Response.json({ account: { bonkId: "3177088", username: "Admin", isAdmin: true } });
        if (path.endsWith("/members")) {
            if (options.method === "POST") writes.push(JSON.parse(options.body));
            return Response.json({ members: [] });
        }
        assert.equal(path, "/api/manage/divisions/1");
        return Response.json({ division: { id: 1, version: 1, role: "site-admin", content: { name: "Test cup", summary: "", description: "", status: "upcoming", startDate: "", endDate: "", participation: { mode: "teams", teamSize: 4, registration: "closed", description: "" }, timeline: [], campaigns: [], referendums: [], teams: [], results: {}, sectionOrder: [] }, permissions: { editSections: ["general", "appearance", "custom"], publish: true, manageMembers: true, assignRoles: ["director", "organizer", "editor"] } } });
    };
    for (const script of window.document.querySelectorAll("script[src]")) {
        const name = script.getAttribute("src").split("/").at(-1);
        new Script(readFileSync(new URL(`code/javascript/${name}`, root), "utf8"), { filename: name }).runInContext(dom.getInternalVMContext());
    }
    await tick();
    [...window.document.querySelectorAll("button")].find(button => button.textContent === "Management roles").click();
    await tick();
    const form = window.document.querySelector(".division-member-form");
    const getField = caption => [...form.querySelectorAll(".division-field-label")]
        .find(node => node.textContent.startsWith(caption)).querySelector("input");
    const username = getField("Bonk username");
    const id = getField("Bonk player ID");
    const fill = (field, value) => { field.value = value; field.dispatchEvent(new window.Event("input", { bubbles: true })); };
    const submit = async () => { form.dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true })); await tick(); };
    await submit();
    assert.equal(writes.length, 0, "empty identity details are rejected before sending a role request");
    fill(username, " Player ");
    await submit();
    assert.deepEqual(writes.at(-1), { username: " Player ", role: "director" }, "significant username spaces are preserved");
    fill(username, ""); fill(id, "1001");
    await submit();
    assert.deepEqual(writes.at(-1), { bonkId: "1001", role: "director" });
    fill(username, "Verified player");
    await submit();
    assert.deepEqual(writes.at(-1), { username: "Verified player", bonkId: "1001", role: "director" });
});
