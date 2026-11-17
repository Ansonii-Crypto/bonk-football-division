import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { Script } from "node:vm";
import { JSDOM } from "jsdom";

function preview(t) {
    const dom = new JSDOM("<!doctype html><html><body></body></html>", { runScripts: "outside-only" });
    t.after(() => dom.window.close());
    for (const name of ["division-text.js", "division-view.js"]) {
        new Script(readFileSync(new URL(`../code/javascript/${name}`, import.meta.url), "utf8"))
            .runInContext(dom.getInternalVMContext());
    }
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
    rendered.querySelector("[data-section='timeline']").click();
    rendered.querySelector("[data-section='timeline'] h2").click();
    assert.deepEqual(calls, [], "reading a section or clicking its heading does not open an editor");
    assert.equal(rendered.querySelector(".division-section-edit--keyboard"), null, "Edit is a visible section action");
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

test("event banners use validated appearance and show event facts before the description", t => {
    const { DivisionView } = preview(t);
    const content = {
        name: "Football Cup", summary: "Opening weekend", description: "Tournament information",
        startDate: "2026-11-21", endDate: "2026-11-22", sectionOrder: [],
        participation: { mode: "teams", teamSize: 4, registration: "invite-only" },
        appearance: { backgroundColor: "#254b62", backgroundImage: "https://example.com/football.jpg" }
    };
    const rendered = DivisionView.render(content, { editing: true, editableSections: ["general"] });
    const hero = rendered.querySelector(":scope > [data-section='general']");
    const cover = hero.querySelector(":scope > .division-event-cover");
    assert.equal(cover.getAttribute("aria-hidden"), "true");
    assert.equal(cover.style.getPropertyValue("--division-cover-colour"), "#254b62");
    assert.match(cover.style.getPropertyValue("--division-cover-image"), /^url\("https:\/\/example\.com\/football\.jpg"\)$/);
    assert.ok(cover.classList.contains("division-cover--image"));
    const overview = hero.querySelector(".division-event-overview");
    assert.ok(overview.querySelector(".division-section-edit"), "event controls remain within the readable overview");
    const facts = overview.querySelector(".division-event-facts");
    assert.deepEqual([...facts.querySelectorAll("dt")].map(node => node.textContent), ["Dates", "Match format", "Registration"]);
    assert.match(facts.textContent, /21 November 2026 — 22 November 2026/);
    assert.match(facts.textContent, /4 vs 4 · Team entry/);
    assert.match(facts.textContent, /By invitation/);
    assert.ok([...overview.children].indexOf(facts) < [...overview.children].indexOf(overview.querySelector(".division-event-description")));

    for (const backgroundImage of ["http://example.com/image.jpg", "javascript:alert(1)", "data:image/svg+xml,<svg/>", "https://user:password@example.com/image.jpg"]) {
        const unsafe = DivisionView.render({ ...content, appearance: { backgroundColor: "red; background: url(https://example.com)", backgroundImage } });
        const fallback = unsafe.querySelector(".division-event-cover");
        assert.equal(fallback.style.getPropertyValue("--division-cover-colour"), "");
        assert.equal(fallback.style.getPropertyValue("--division-cover-image"), "");
        assert.equal(fallback.classList.contains("division-cover--custom"), false);
    }
});

test("live legacy events lead with the bracket while saved section layouts stay exact", t => {
    const { DivisionView } = preview(t);
    const content = {
        name: "Cup", status: "live", teams: teams(4), participation: { mode: "teams", teamSize: 4 },
        timeline: [{ title: "Opening round" }], campaigns: [], referendums: []
    };
    assert.deepEqual(Array.from(DivisionView.sectionOrder(content)), ["bracket", "participation", "timeline", "teams"]);
    assert.deepEqual([...DivisionView.render(content).children].map(node => node.dataset.section), ["general", "bracket", "participation", "timeline", "teams"]);
    assert.deepEqual(Array.from(DivisionView.sectionOrder({ ...content, status: "completed" })), ["bracket", "participation", "timeline", "teams"]);
    assert.deepEqual(Array.from(DivisionView.sectionOrder({ ...content, status: "upcoming" })), ["participation", "timeline", "teams", "bracket"]);
    assert.deepEqual(Array.from(DivisionView.sectionOrder({ ...content, sectionOrder: ["timeline", "teams", "bracket"] })), ["timeline", "teams", "bracket"]);
    assert.deepEqual(Array.from(DivisionView.sectionOrder({ ...content, sectionOrder: [] })), []);
});

test("edit insertion points identify the section they follow and stay hidden from readers", t => {
    const { DivisionView } = preview(t);
    const content = {
        name: "Cup", sectionOrder: ["timeline", "custom:rules"], participation: { teamSize: 1 },
        timeline: [{ title: "Opening round" }], teams: [], campaigns: [], referendums: [],
        customSections: [{ id: "rules", title: "Match rules", description: "Play fair" }]
    };
    const inserted = [];
    const editView = DivisionView.render(content, { editing: true, editableSections: ["custom"], onAddSection: key => inserted.push(key) });
    const controls = [...editView.querySelectorAll(".division-section-insert, .division-add-section")];
    assert.deepEqual(controls.map(node => node.dataset.afterSection), ["general", "timeline", "custom:rules"]);
    controls.forEach(node => {
        assert.equal(node.previousElementSibling.dataset.section, node.dataset.afterSection);
        assert.match(node.getAttribute("aria-label"), /^Add section after /);
        node.click();
    });
    assert.deepEqual(inserted, ["general", "timeline", "custom:rules"]);
    assert.equal(editView.querySelectorAll(".division-add-section").length, 1, "the final full-size insertion area remains unique");
    assert.equal(DivisionView.render(content).querySelector(".division-section-insert, .division-add-section"), null);
    const restricted = DivisionView.render(content, { editing: true, editableSections: ["general"], onAddSection() {} });
    assert.equal(restricted.querySelector(".division-section-insert, .division-add-section"), null);
});

test("banner editing has its own permitted pen control and does not open the event information editor", t => {
    const { DivisionView } = preview(t);
    const content = {
        name: "Cup", sectionOrder: [], participation: { teamSize: 1 },
        appearance: { backgroundColor: "#112233", backgroundImage: "https://example.com/page.jpg", bannerColor: "#445566", bannerImage: "https://example.com/banner.jpg" }
    };
    const calls = [];
    const rendered = DivisionView.render(content, {
        editing: true, editableSections: ["general", "appearance"],
        onSection: key => calls.push(key), onBanner: () => calls.push("banner")
    });
    const cover = rendered.querySelector(".division-event-cover");
    assert.equal(cover.getAttribute("aria-hidden"), null, "interactive cover remains in the accessibility tree");
    assert.equal(cover.style.getPropertyValue("--division-cover-colour"), "#445566");
    assert.match(cover.style.getPropertyValue("--division-cover-image"), /banner\.jpg/);
    const pen = cover.querySelector("button.division-banner-edit");
    assert.equal(pen.getAttribute("aria-label"), "Edit banner");
    assert.ok(pen.querySelector("svg path"));
    pen.click();
    assert.deepEqual(calls, ["banner"]);
    const edit = rendered.querySelector(".division-section-edit");
    assert.equal(edit.type, "button");
    assert.equal(edit.hidden, false);
    assert.equal(edit.getAttribute("aria-label"), "Edit event information");
    edit.click();
    assert.deepEqual(calls, ["banner", "general"], "the visible native Edit button remains keyboard accessible");
    assert.equal(DivisionView.render(content, { editing: true, editableSections: ["general"], onBanner() {} }).querySelector(".division-banner-edit"), null);
    assert.equal(DivisionView.render(content, { editableSections: ["appearance"], onBanner() {} }).querySelector(".division-banner-edit"), null);
    const cleared = DivisionView.render({ ...content, appearance: { ...content.appearance, bannerColor: "", bannerImage: "" } }).querySelector(".division-event-cover");
    assert.equal(cleared.style.getPropertyValue("--division-cover-colour"), "");
    assert.equal(cleared.style.getPropertyValue("--division-cover-image"), "", "an explicitly cleared banner does not fall back to the page image");
});

test("saved field styles appear in the overview, custom sections and roster names as safe text", t => {
    const { DivisionView } = preview(t);
    const content = {
        name: "Football Cup", summary: "A weekend event", description: "<script>not markup</script>",
        participation: { mode: "teams", teamSize: 4, description: "Bring a team" }, sectionOrder: ["custom:rules", "teams"],
        teams: [{ id: "north", name: "North", players: [{ username: "Player" }] }],
        customSections: [{ id: "rules", title: "Match rules", description: "No cheating" }],
        textStyles: {
            "general.name": [{ start: 0, end: 8, bold: true, color: "#82c6cb" }],
            "general.description": [{ start: 0, end: 8, italic: true }],
            "custom.rules.title": [{ start: 0, end: 5, font: "serif" }],
            "custom.rules.description": [{ start: 3, end: 11, underline: true }],
            "teams.north.name": [{ start: 0, end: 5, size: "large" }]
        }
    };
    const rendered = DivisionView.render(content);
    assert.equal(rendered.querySelector("script"), null);
    assert.equal(rendered.querySelector("h1").textContent, "Football Cup");
    assert.equal(rendered.querySelector("h1 span").textContent, "Football");
    assert.equal(rendered.querySelector("h1 span").style.color, "rgb(130, 198, 203)");
    assert.match(rendered.querySelector('[data-section="custom:rules"] h2 span').style.fontFamily, /Georgia/);
    assert.equal(rendered.querySelector('[data-section="custom:rules"] p span').style.textDecorationLine, "underline");
    assert.equal(rendered.querySelector(".division-entrant h3 span").style.fontSize, "1.2em");
    assert.equal(rendered.querySelector(".division-event-description").textContent, content.description);
    assert.equal(rendered.querySelector('[data-text-path="general.name"]').tagName, "H1");
});
