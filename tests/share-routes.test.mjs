import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { Script } from "node:vm";
import { JSDOM } from "jsdom";

function routes(t, url) {
    const dom = new JSDOM("<!doctype html><html><body></body></html>", { url, runScripts: "outside-only" });
    t.after(() => dom.window.close());
    new Script(readFileSync(new URL("../code/javascript/share-routes.js", import.meta.url), "utf8"))
        .runInContext(dom.getInternalVMContext());
    return dom.window;
}

test("clean page links hydrate the existing router while legacy hash links gain a server-readable path", t => {
    for (const route of ["classes", "classes/weaver", "assessments/24", "divisions/7", "account", "profile", "admin"]) {
        const window = routes(t, `https://bonk-football-division.com/${route}`);
        assert.equal(window.location.hash, `#${route}`);
        assert.equal(window.location.pathname, `/${route}`);
        assert.equal(window.BonkRoutes.shareUrl(), `https://bonk-football-division.com/${route}`);
    }
    const legacy = routes(t, "https://bonk-football-division.com/#divisions/8");
    assert.equal(legacy.location.pathname, "/divisions/8");
    assert.equal(legacy.location.hash, "#divisions/8");
    assert.equal(legacy.BonkRoutes.shareUrl("#players"), "https://bonk-football-division.com/assessments");
    const mixedCase = routes(t, "https://bonk-football-division.com/classes/Weaver");
    assert.equal(mixedCase.location.pathname, "/classes/weaver");
    assert.equal(mixedCase.location.hash, "#classes/weaver");
    const home = routes(t, "https://bonk-football-division.com/");
    assert.equal(home.location.hash, "");
    assert.equal(home.BonkRoutes.shareUrl("#home"), "https://bonk-football-division.com/");
});

test("assessment shares preserve filters and route changes remove only their route-specific query", t => {
    const window = routes(t, "https://bonk-football-division.com/?utm_source=community#assessments?view=1&q=North+Star&tiers=S%2CA&initials=N&sort=ascending&page=2");
    const expected = "https://bonk-football-division.com/assessments?view=1&q=North+Star&tiers=S%2CA&initials=N&sort=ascending&page=2";
    assert.equal(window.location.pathname, "/assessments");
    assert.equal(new URL(window.location.href).searchParams.get("utm_source"), "community");
    assert.equal(window.BonkRoutes.shareUrl(), expected);
    const recipient = routes(t, expected);
    assert.equal(recipient.location.hash, "#assessments?view=1&q=North+Star&tiers=S%2CA&initials=N&sort=ascending&page=2");
    window.history.replaceState({ retained: true }, "", `${window.location.pathname}${window.location.search}#account`);
    window.BonkRoutes.sync();
    assert.equal(window.location.pathname, "/account");
    assert.equal(window.location.hash, "#account");
    assert.equal(window.location.search, "?utm_source=community");
    assert.equal(window.history.state.retained, true);
    assert.equal(window.BonkRoutes.shareUrl(), "https://bonk-football-division.com/account");
});

test("local files retain working relative paths and route helpers never create off-site share links", t => {
    const local = routes(t, "file:///preview/code/html/index.html#classes");
    assert.equal(local.location.pathname, "/preview/code/html/index.html");
    assert.equal(local.BonkRoutes.shareUrl("#divisions/2"), "file:///preview/code/html/index.html#divisions/2");
    const web = routes(t, "https://bonk-football-division.com/#classes");
    for (const invalid of ["https://example.com/", "//example.com", "#divisions/9007199254740992", "#classes/unknown"]) {
        assert.equal(web.BonkRoutes.shareUrl(invalid), "https://bonk-football-division.com/");
    }
});

test("mirrored paths preserve hashchange history and assessment filters when navigating back", async t => {
    const window = routes(t, "https://bonk-football-division.com/#assessments?view=1&q=keeper&sort=newest&page=2");
    const priorHash = window.location.hash;
    let previousHash;
    window.addEventListener("hashchange", event => {
        previousHash = new URL(event.oldURL).hash;
        window.BonkRoutes.sync();
    });
    const changed = () => new Promise(resolve => window.addEventListener("hashchange", resolve, { once: true }));
    let event = changed();
    window.location.hash = "#account";
    await event;
    assert.equal(previousHash, priorHash, "login return still sees the complete prior view in oldURL");
    assert.equal(window.location.pathname, "/account");
    assert.equal(window.location.search, "");
    event = changed();
    window.history.back();
    await event;
    assert.equal(window.location.pathname, "/assessments");
    assert.equal(window.location.hash, priorHash);
    assert.equal(new URL(window.location.href).searchParams.get("q"), "keeper");
});
