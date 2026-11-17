import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { Script } from "node:vm";
import { JSDOM } from "jsdom";

function page(t, options = {}) {
    const dom = new JSDOM("<!doctype html><html><body></body></html>", { runScripts: "outside-only", ...(options.url ? { url: options.url } : {}) });
    t.after(() => dom.window.close());
    const { window } = dom;
    window.HTMLMediaElement.prototype.pause = () => {};
    window.HTMLDialogElement.prototype.showModal = function () {
        assert.equal(this.open, false, "an open panel is reused without opening another modal");
        this.setAttribute("open", "");
    };
    window.HTMLDialogElement.prototype.close = function () {
        this.removeAttribute("open");
        this.dispatchEvent(new window.Event("close"));
    };
    if (options.url) {
        new Script(readFileSync(new URL("../code/javascript/share-routes.js", import.meta.url), "utf8"))
            .runInContext(dom.getInternalVMContext());
    }
    new Script(readFileSync(new URL("../code/javascript/classes.js", import.meta.url), "utf8"))
        .runInContext(dom.getInternalVMContext());
    window.document.body.append(window.renderClassesPage(options.initialClass ?? null));
    return window;
}

function cardButton(document, name) {
    return [...document.querySelectorAll(".class-card .card-action")]
        .find(button => button.getAttribute("aria-label") === `Read ${name} playstyle`);
}

function relatedNames(document, group) {
    return [...document.querySelectorAll(`[data-relationship="${group}"] .class-relationship-link`)]
        .map(button => button.textContent);
}

test("each class shows explained matchups and teammate pairings alongside its playstyle", t => {
    const { document, closeClassPanel } = page(t);
    const names = [...document.querySelectorAll(".class-card h3")].map(title => title.textContent);
    const relationships = new Map();
    for (const name of names) {
        cardButton(document, name).click();
        assert.equal(document.querySelector("#class-panel-title").textContent, name);
        assert.equal(document.querySelectorAll(".class-relationship-group").length, 3);
        assert.ok(document.querySelector(".class-panel-columns").textContent.includes("Offence"));
        assert.ok(document.querySelector(".class-video video").controls);
        const groups = Object.fromEntries(["strong", "weak", "teammates"].map(group => [group, relatedNames(document, group)]));
        for (const group of Object.values(groups)) {
            assert.ok(group.length > 0);
            assert.ok(group.every(related => names.includes(related) && related !== name));
            assert.equal(new Set(group).size, group.length);
        }
        for (const explanation of document.querySelectorAll(".class-relationship-list p")) assert.ok(explanation.textContent.length > 20);
        relationships.set(name, groups);
        closeClassPanel();
    }
    assert.deepEqual(relationships.get("Weaver"), { strong: ["Bulwark"], weak: ["Renegade"], teammates: ["Tactician"] });
    assert.deepEqual(relationships.get("Bulwark").strong, ["Catalyst", "Opportunist"]);
    for (const [name, groups] of relationships) {
        for (const opponent of groups.strong) assert.ok(relationships.get(opponent).weak.includes(name));
        for (const teammate of groups.teammates) assert.ok(relationships.get(teammate).teammates.includes(name));
    }
});

test("related classes replace the open panel and dismissal returns focus to the original card", t => {
    const window = page(t);
    const { document } = window;
    const trigger = cardButton(document, "Weaver");
    trigger.focus();
    trigger.click();
    const panel = document.querySelector(".class-panel");
    const panelContent = panel.querySelector(".class-panel-content");
    panelContent.scrollTop = 300;
    document.querySelector('[data-relationship="strong"] .class-relationship-link').click();
    assert.equal(panel.open, true);
    assert.equal(document.querySelectorAll(".class-panel").length, 1);
    assert.equal(document.querySelector("#class-panel-title").textContent, "Bulwark");
    assert.equal(document.activeElement.id, "class-panel-title");
    assert.equal(panelContent.scrollTop, 0);
    assert.deepEqual(relatedNames(document, "weak"), ["Weaver"]);
    assert.equal(document.querySelector("video").getAttribute("aria-label"), "Bulwark playstyle video");
    document.querySelector('[data-relationship="teammates"] .class-relationship-link').click();
    assert.equal(document.querySelector("#class-panel-title").textContent, "Dynamo");
    const cancel = new window.Event("cancel", { cancelable: true });
    panel.dispatchEvent(cancel);
    assert.equal(cancel.defaultPrevented, true);
    assert.equal(panel.open, false);
    assert.equal(document.body.classList.contains("class-panel-open"), false);
    assert.equal(document.activeElement, trigger);
    trigger.click();
    document.querySelector(".class-panel-close").click();
    assert.equal(panel.open, false);
    assert.equal(document.activeElement, trigger);
});

test("class share links open the requested playstyle and keep the public path in sync without trapping navigation", async t => {
    const window = page(t, { url: "https://bonk-football-division.com/classes/weaver", initialClass: "weaver" });
    const { document } = window;
    await new Promise(resolve => setImmediate(resolve));
    const panel = document.querySelector(".class-panel");
    assert.equal(panel.open, true);
    assert.equal(document.querySelector("#class-panel-title").textContent, "Weaver");
    document.querySelector('[data-relationship="strong"] .class-relationship-link').click();
    assert.equal(window.location.pathname, "/classes/bulwark");
    assert.equal(window.location.hash, "#classes/bulwark");
    assert.equal(window.BonkRoutes.shareUrl(), "https://bonk-football-division.com/classes/bulwark");
    document.querySelector(".class-panel-close").click();
    assert.equal(window.location.pathname, "/classes");
    assert.equal(window.location.hash, "#classes");
    assert.equal(panel.open, false);
    cardButton(document, "Weaver").click();
    window.location.hash = "#assessments";
    window.closeClassPanel();
    assert.equal(window.location.hash, "#assessments", "route cleanup keeps the destination chosen by the visitor");
    assert.equal(panel.open, false);
});
