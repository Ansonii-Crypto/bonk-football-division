import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { Script } from "node:vm";
import { JSDOM } from "jsdom";

function formatter(t) {
    const dom = new JSDOM("<!doctype html><html><body></body></html>", { runScripts: "outside-only" });
    t.after(() => dom.window.close());
    new Script(readFileSync(new URL("../code/javascript/division-text.js", import.meta.url), "utf8"))
        .runInContext(dom.getInternalVMContext());
    return dom.window;
}

const plain = value => JSON.parse(JSON.stringify(value));

test("formatted ranges render as safe text spans without treating event copy or style values as markup", t => {
    const window = formatter(t);
    const node = window.document.createElement("p");
    const text = "Hello <img src=x onerror=alert(1)>";
    window.DivisionText.render(node, text, [
        { start: 0, end: 5, bold: true, color: "#fe2f44", font: "serif", size: "large" },
        { start: 6, end: text.length, italic: true, color: "red; background:url(https://example.com)", font: "url(https://example.com)", size: "100px" }
    ]);
    assert.equal(node.textContent, text);
    assert.equal(node.querySelector("img, script"), null);
    const first = node.querySelector("span");
    assert.equal(first.textContent, "Hello");
    assert.equal(first.style.fontWeight, "700");
    assert.equal(first.style.color, "rgb(254, 47, 68)");
    assert.match(first.style.fontFamily, /Georgia/);
    assert.equal(first.style.fontSize, "1.2em");
    const second = node.querySelectorAll("span")[1];
    assert.equal(second.style.fontStyle, "italic");
    assert.equal(second.style.color, "");
    assert.equal(second.style.fontFamily, "");
    assert.equal(second.style.fontSize, "");
    assert.equal(second.style.backgroundImage, "");
});

test("formatting a substring splits existing styles and clearing it merges matching neighbours", t => {
    const { DivisionText } = formatter(t);
    const original = [{ start: 0, end: 10, bold: true }];
    const coloured = DivisionText.apply(original, "abcdefghij", 2, 7, { color: "#82c6cb" });
    assert.deepEqual(plain(coloured), [
        { start: 0, end: 2, bold: true },
        { start: 2, end: 7, bold: true, color: "#82c6cb" },
        { start: 7, end: 10, bold: true }
    ]);
    assert.deepEqual(original, [{ start: 0, end: 10, bold: true }], "formatting does not mutate the undo snapshot");
    const cleared = DivisionText.apply(coloured, "abcdefghij", 2, 7, { color: null });
    assert.deepEqual(plain(cleared), original);
    const unbold = DivisionText.apply(cleared, "abcdefghij", 4, 6, { bold: false });
    assert.deepEqual(plain(unbold), [{ start: 0, end: 4, bold: true }, { start: 6, end: 10, bold: true }]);
    const italic = DivisionText.apply(unbold, "abcdefghij", 2, 8, { italic: true });
    assert.deepEqual(plain(italic), [
        { start: 0, end: 2, bold: true }, { start: 2, end: 4, bold: true, italic: true },
        { start: 4, end: 6, italic: true }, { start: 6, end: 8, bold: true, italic: true }, { start: 8, end: 10, bold: true }
    ]);
});

test("default font and normal size remove overrides, and invalid selections do not split surrogate pairs", t => {
    const { DivisionText } = formatter(t);
    const text = "A😀B";
    const styled = DivisionText.apply([], text, 1, 3, { font: "mono", size: "small", underline: true });
    assert.deepEqual(plain(styled), [{ start: 1, end: 3, underline: true, font: "mono", size: "small" }]);
    assert.deepEqual(plain(DivisionText.apply(styled, text, 1, 3, { font: "default", size: "normal" })), [{ start: 1, end: 3, underline: true }]);
    assert.deepEqual(plain(DivisionText.apply([], text, 1, 2, { bold: true })), []);
    assert.deepEqual(plain(DivisionText.apply(styled, text, -1, 10, { bold: true })), plain(styled));
});

test("typing preserves unaffected ranges and inherits formatting only inside a styled run", t => {
    const { DivisionText } = formatter(t);
    const text = "alpha beta gamma";
    const runs = [{ start: 6, end: 10, bold: true, color: "#fcfe90" }, { start: 11, end: 16, italic: true }];
    assert.deepEqual(plain(DivisionText.rebase(runs, text, "alpha beXXta gamma")), [
        { start: 6, end: 12, bold: true, color: "#fcfe90" }, { start: 13, end: 18, italic: true }
    ]);
    assert.deepEqual(plain(DivisionText.rebase(runs, text, "alpha beta! gamma")), [
        { start: 6, end: 10, bold: true, color: "#fcfe90" }, { start: 12, end: 17, italic: true }
    ]);
    assert.deepEqual(plain(DivisionText.rebase(runs, text, "alpha gamma")), [{ start: 6, end: 11, italic: true }]);
    assert.deepEqual(plain(DivisionText.rebase(runs, text, "new copy")), []);
});

test("formatting limits reject a new split without discarding the existing ranges", t => {
    const { DivisionText } = formatter(t);
    const text = "a".repeat(300);
    const runs = Array.from({ length: 100 }, (_, index) => ({ start: index * 3, end: index * 3 + 1, bold: true }));
    const before = JSON.stringify(runs);
    assert.throws(() => DivisionText.apply(runs, text, 0, text.length, { italic: true }), /formatting limit/);
    assert.equal(JSON.stringify(runs), before);
});

test("field paths use stable item identifiers and exclude player identities and unsupported values", t => {
    const { DivisionText } = formatter(t);
    const fields = DivisionText.fields({
        name: "Cup", summary: "Summary", description: "About", participation: { description: "Teams of four" },
        timeline: [{ id: "opening", title: "Opening round", description: "First matches" }],
        campaigns: [{ id: "fair", title: "Fair play", description: "Respect the players" }],
        referendums: [{ id: "vote", title: "Next format", description: "Discuss", options: ["A", "B"] }],
        customSections: [{ id: "rules", title: "Rules", description: "Play fair" }, { id: "bad.id", title: "Not valid" }],
        teams: [{ id: "north", name: "North", players: [{ username: "Player", bonkId: "1" }] }]
    });
    assert.equal(fields["general.name"], "Cup");
    assert.equal(fields["participation.description"], "Teams of four");
    assert.equal(fields["timeline.opening.description"], "First matches");
    assert.equal(fields["campaigns.fair.title"], "Fair play");
    assert.equal(fields["referendums.vote.title"], "Next format");
    assert.equal(fields["custom.rules.description"], "Play fair");
    assert.equal(fields["teams.north.name"], "North");
    assert.equal(Object.keys(fields).some(path => /username|bonkId|options|bad\.id/.test(path)), false);
    assert.equal(DivisionText.sectionForPath("custom.rules.description"), "custom:rules");
    assert.equal(DivisionText.sectionForPath("timeline.opening.title"), "timeline");
});
