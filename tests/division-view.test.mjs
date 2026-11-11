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
    const editView = window.DivisionView.render(content, {
        editing: true,
        editableSections: ["timeline"],
        onSection: key => selected.push(key)
    });
    assert.equal(editView.querySelectorAll(".division-section-edit").length, 1);
    editView.querySelector("[data-section='timeline'] .division-section-edit").click();
    assert.deepEqual(selected, ["timeline"]);
});
