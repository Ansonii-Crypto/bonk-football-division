import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { Script } from "node:vm";
import { JSDOM } from "jsdom";

function preview(t) {
    const dom = new JSDOM("<!doctype html><html><body></body></html>", { runScripts: "outside-only" });
    t.after(() => dom.window.close());
    new Script(readFileSync(new URL("../code/javascript/division-view.js", import.meta.url), "utf8"))
        .runInContext(dom.getInternalVMContext());
    return dom.window;
}

function teams(count) {
    return Array.from({ length: count }, (_, index) => ({
        id: String.fromCharCode(97 + index),
        name: `Team ${index + 1}`,
        players: [{ username: `Player ${index + 1}`, bonkId: null }]
    }));
}

test("a bye advances its entrant but never resolves an opponent still waiting on a match", t => {
    const { DivisionView } = preview(t);
    const rounds = DivisionView.buildBracket(teams(3), {});
    assert.equal(rounds.length, 2);
    assert.equal(rounds[0][0].bye, true);
    assert.equal(rounds[0][0].winner.id, "a");
    assert.equal(rounds[1][0].teamA.id, "a");
    assert.equal(rounds[1][0].pendingB, true);
    assert.equal(rounds[1][0].winner, null);
    assert.equal(rounds[1][0].complete, false);
});

test("bracket results advance winners and stale downstream pairings cannot crown a new winner", t => {
    const { DivisionView } = preview(t);
    const results = {
        "0-0": { teamAId: "a", teamBId: "d", scoreA: 2, scoreB: 0 },
        "0-1": { teamAId: "b", teamBId: "c", scoreA: 1, scoreB: 2 },
        "1-0": { teamAId: "a", teamBId: "c", scoreA: 1, scoreB: 3 }
    };
    assert.equal(DivisionView.buildBracket(teams(4), results)[1][0].winner.id, "c");
    results["0-1"] = { teamAId: "b", teamBId: "c", scoreA: 4, scoreB: 2 };
    const final = DivisionView.buildBracket(teams(4), results)[1][0];
    assert.equal(final.teamB.id, "b");
    assert.equal(final.scoreA, null);
    assert.equal(final.scoreB, null);
    assert.equal(final.winner, null);
    assert.equal(final.complete, false);
    results["0-0"].scoreA = 0;
    assert.equal(DivisionView.buildBracket(teams(4), results)[1][0].pendingA, true, "a tied match does not supply a winner");
});

test("brackets have at most sixteen seeded entrants and four rounds", t => {
    const { DivisionView } = preview(t);
    const rounds = DivisionView.buildBracket(teams(17), {});
    assert.equal(rounds.length, 4);
    assert.equal(rounds[0].length, 8);
    const seeded = rounds[0].flatMap(match => [match.teamA.id, match.teamB.id]);
    assert.equal(new Set(seeded).size, 16);
    assert.equal(seeded.includes("q"), false);
});

test("division previews show editable empty sections and render event text without treating it as markup", t => {
    const window = preview(t);
    const content = {
        name: "<img src=x onerror=alert(1)>", summary: "Event summary", description: "",
        participation: { mode: "teams", teamSize: 4, registration: "invite-only" },
        timeline: [], teams: [], campaigns: [], referendums: []
    };
    const publicView = window.DivisionView.render(content);
    assert.equal(publicView.querySelector("img"), null);
    assert.equal(publicView.querySelector("h1").textContent, content.name);
    assert.equal(publicView.querySelector("[data-section='timeline']"), null);
    assert.match(publicView.querySelector("[data-section='participation']").textContent, /4 vs 4/);
    const selected = [];
    const editView = window.DivisionView.render({ ...content, sectionOrder: ["participation", "timeline"] }, {
        editing: true,
        editableSections: ["timeline"],
        onSection: key => selected.push(key)
    });
    assert.equal(editView.querySelectorAll(".division-section-edit").length, 1);
    editView.querySelector("[data-section='timeline'] .division-section-edit").click();
    assert.deepEqual(selected, ["timeline"]);
});

test("explicit section order controls public layout while legacy events keep their existing sections", t => {
    const { DivisionView } = preview(t);
    const content = {
        name: "Cup", participation: { mode: "solo", teamSize: 1 },
        timeline: [{ id: "opening", title: "Opening round", date: "", description: "" }],
        teams: teams(2), campaigns: [{ id: "campaign", title: "Campaign", description: "" }], referendums: []
    };
    assert.deepEqual(Array.from(DivisionView.sectionOrder(content)), ["participation", "timeline", "teams", "bracket", "campaigns"]);
    const rendered = DivisionView.render({ ...content, sectionOrder: ["campaigns", "participation", "timeline"] });
    assert.deepEqual([...rendered.querySelectorAll(".division-event-section")].map(node => node.dataset.section),
        ["general", "campaigns", "participation", "timeline"]);
    assert.equal(rendered.querySelector(".division-section-actions"), null);
    assert.equal(rendered.querySelector(".division-add-section"), null);
    const empty = DivisionView.render({ ...content, sectionOrder: [] }, {
        editing: true, onAddSection() {}
    });
    assert.deepEqual([...empty.querySelectorAll(".division-event-section")].map(node => node.dataset.section), ["general"]);
    assert.ok(empty.querySelector(".division-add-section"));
});

test("section controls select, move, remove and add without exposing controls on restricted sections", t => {
    const { DivisionView } = preview(t);
    const calls = [];
    const rendered = DivisionView.render({
        name: "Cup", sectionOrder: ["campaigns", "participation", "timeline"],
        participation: { teamSize: 1 }, timeline: [], campaigns: [], teams: [], referendums: []
    }, {
        editing: true, selectedSection: "timeline", editableSections: ["campaigns", "timeline", "teams"],
        onSection: key => calls.push(["select", key]),
        onMoveSection: (key, offset) => calls.push(["move", key, offset]),
        onRemoveSection: key => calls.push(["remove", key]),
        onAddSection: () => calls.push(["add"])
    });
    assert.equal(rendered.querySelector("[data-section='general'] .division-section-actions"), null);
    assert.equal(rendered.querySelector("[data-section='participation'] .division-section-actions"), null);
    assert.ok(rendered.querySelector("[data-section='timeline']").classList.contains("division-event-section--selected"));
    assert.equal(rendered.querySelector("[data-section='campaigns'] .division-section-move-up").disabled, true);
    assert.equal(rendered.querySelector("[data-section='timeline'] .division-section-move-down").disabled, true);
    rendered.querySelector("[data-section='timeline'] .division-section-edit").click();
    rendered.querySelector("[data-section='campaigns'] .division-section-move-down").click();
    rendered.querySelector("[data-section='timeline'] .division-section-remove").click();
    rendered.querySelector(".division-add-section").click();
    assert.deepEqual(calls, [["select", "timeline"], ["move", "campaigns", 1], ["remove", "timeline"], ["add"]]);
});

test("custom text sections follow saved order, use safe text and keep Add section available", t => {
    const { DivisionView } = preview(t);
    const custom = { id: "rules", title: "<img src=x>", description: "<script>alert(1)</script>" };
    const content = {
        name: "Cup", participation: { teamSize: 1 }, timeline: [], teams: [], campaigns: [], referendums: [],
        customSections: [custom], sectionOrder: ["custom:rules", "participation", "timeline", "teams", "bracket", "campaigns", "referendums"]
    };
    const calls = [];
    const rendered = DivisionView.render(content, {
        editing: true, editableSections: ["custom"],
        onAddSection: () => calls.push("add"), onSection: key => calls.push(key)
    });
    assert.deepEqual([...rendered.querySelectorAll(".division-event-section")].map(node => node.dataset.section),
        ["general", ...content.sectionOrder]);
    const textSection = rendered.querySelector("[data-section='custom:rules']");
    assert.equal(textSection.querySelector("h2").textContent, custom.title);
    assert.equal(textSection.querySelector(".division-event-copy").textContent, custom.description);
    assert.equal(rendered.querySelector("img, script"), null);
    textSection.querySelector(".division-section-edit").click();
    rendered.querySelector(".division-add-section").click();
    assert.deepEqual(calls, ["custom:rules", "add"]);
    assert.deepEqual(Array.from(DivisionView.sectionOrder({ ...content, sectionOrder: undefined })), ["participation", "custom:rules"]);
    assert.deepEqual(Array.from(DivisionView.sectionOrder({ ...content, sectionOrder: ["custom:missing", "custom:rules"] })), ["custom:rules"]);
    const publicView = DivisionView.render(content);
    assert.equal(publicView.querySelector(".division-section-actions, .division-add-section"), null);
});
