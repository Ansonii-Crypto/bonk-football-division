import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import worker from "../index.js";

const origin = "https://bonk-football-division.com";

function environment(t) {
    const db = new DatabaseSync(":memory:");
    db.exec("PRAGMA foreign_keys=ON");
    for (const name of ["0001_bonk_accounts.sql", "0002_assessments.sql", "0003_divisions.sql", "0004_division_polls.sql"]) {
        db.exec(readFileSync(new URL(`../migrations/${name}`, import.meta.url), "utf8"));
    }
    t.after(() => db.close());
    const prepare = sql => {
        const statement = values => ({
            async first() { return db.prepare(sql).get(...values) || null; },
            async all() { return { results: db.prepare(sql).all(...values) }; },
            async run() { return { meta: { changes: Number(db.prepare(sql).run(...values).changes) } }; }
        });
        return { ...statement([]), bind(...values) { return statement(values); } };
    };
    return { db, DB: { prepare, async batch(statements) { return Promise.all(statements.map(statement => statement.run())); } },
        API_RATE_LIMITER: { async limit() { return { success: true }; } },
        LOGIN_RATE_LIMITER: { async limit() { return { success: true }; } },
        ASSETS: { async fetch() { return new Response("asset"); } } };
}

function request(env, path, body, cookie, method = body === undefined ? "GET" : "POST", extraHeaders = {}) {
    return worker.fetch(new Request(origin + path, { method,
        headers: { Origin: origin, "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}), ...extraHeaders },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }) }), env);
}

async function signIn(env, id = 3177088) {
    const previous = globalThis.fetch;
    globalThis.fetch = async () => Response.json({ r: "success", id, username: `User${id}`, token: "discarded-provider-token" });
    try {
        const response = await request(env, "/api/bonk/login", { username: "synthetic", password: "synthetic-password" });
        assert.equal(response.status, 200);
        return response.headers.get("Set-Cookie").split(";")[0];
    } finally { globalThis.fetch = previous; }
}

async function save(env, cookie, division, changes) {
    const response = await request(env, `/api/manage/divisions/${division.id}`, { version: division.version,
        content: { ...division.content, ...changes } }, cookie, "PUT");
    assert.equal(response.status, 200, await response.clone().text());
    return (await response.json()).division;
}

async function publish(env, cookie, division) {
    const response = await request(env, `/api/manage/divisions/${division.id}/publish`, { version: division.version }, cookie);
    assert.equal(response.status, 200, await response.clone().text());
    return (await response.json()).division;
}

async function create(env, cookie) {
    const response = await request(env, "/api/admin/divisions", { name: "Poll cup", summary: "A public football poll" }, cookie);
    assert.equal(response.status, 201);
    return (await response.json()).division;
}

const poll = () => ({ id: "format", title: "Which match format?", description: "Choose the format you prefer.", options: ["2 vs 2", "4 vs 4"], status: "open" });
const endpoint = division => `/api/divisions/${division.id}/polls`;
async function results(env, division, cookie) {
    const response = await request(env, endpoint(division), undefined, cookie);
    assert.equal(response.status, 200, await response.clone().text());
    return response.json();
}
const vote = (env, division, revision, option, cookie, extra = {}) => request(env, `${endpoint(division)}/format/vote`, { revision, option, ...extra }, cookie);

test("published polls count one mutable vote per verified Bonk account without exposing voters", async t => {
    const env = environment(t);
    const admin = await signIn(env);
    const player = await signIn(env, 1001);
    const other = await signIn(env, 1002);
    let division = await create(env, admin);
    division = await save(env, admin, division, { polls: [poll()], sectionOrder: ["polls"] });
    assert.equal((await request(env, endpoint(division))).status, 404, "draft polls are private");
    division = await publish(env, admin, division);
    const initial = await results(env, division);
    assert.equal(initial.signedIn, false);
    assert.deepEqual(initial.polls[0].counts, [0, 0]);
    assert.equal(initial.polls[0].canVote, false);
    const revision = initial.polls[0].revision;
    assert.equal((await vote(env, division, revision, 0)).status, 401);
    assert.equal((await vote(env, division, revision, 0, player, { bonkId: "3177088" })).status, 400);
    assert.equal((await vote(env, division, revision, 0, player)).status, 200);
    assert.equal((await vote(env, division, revision, 0, player)).status, 200);
    const changed = await vote(env, division, revision, 1, player);
    assert.equal(changed.status, 200);
    const own = await changed.json();
    assert.deepEqual(own.polls[0].counts, [0, 1]);
    assert.equal(own.polls[0].selectedOption, 1);
    assert.equal(own.polls[0].total, 1);
    assert.equal(env.db.prepare("SELECT COUNT(*) AS count FROM division_poll_votes").get().count, 1);
    assert.equal((await results(env, division, other)).polls[0].selectedOption, null);
    await vote(env, division, revision, 0, other);
    const publicResult = await results(env, division);
    assert.deepEqual(publicResult.polls[0].counts, [1, 1]);
    assert.equal(publicResult.polls[0].selectedOption, null);
    assert.equal(publicResult.polls[0].title, poll().title);
    assert.deepEqual(publicResult.polls[0].options, poll().options);
    const serialized = JSON.stringify(publicResult);
    for (const secret of ["bonkId", "bonk_id", "username", "User1001", "1002"]) assert.ok(!serialized.includes(secret));
    const noCsrf = await request(env, `${endpoint(division)}/format/vote`, { revision, option: 0 }, player, "POST", { Origin: "https://example.com" });
    assert.equal(noCsrf.status, 403);
});

test("polls use published visible questions, preserve votes when closed, and reset their revision when choices change", async t => {
    const env = environment(t);
    const admin = await signIn(env);
    const player = await signIn(env, 1001);
    let division = await create(env, admin);
    division = await publish(env, admin, await save(env, admin, division, { polls: [poll()], sectionOrder: ["polls"] }));
    const original = (await results(env, division, player)).polls[0];
    await vote(env, division, original.revision, 0, player);
    division = await save(env, admin, division, { polls: [{ ...poll(), status: "closed" }] });
    assert.equal((await results(env, division, player)).polls[0].canVote, true, "unpublished changes do not close the public poll");
    division = await publish(env, admin, division);
    const closed = (await results(env, division, player)).polls[0];
    assert.equal(closed.revision, original.revision);
    assert.equal(closed.total, 1);
    assert.equal(closed.canVote, false);
    assert.equal((await vote(env, division, closed.revision, 1, player)).status, 409);
    division = await publish(env, admin, await save(env, admin, division, { polls: [{ ...poll(), options: ["4 vs 4", "2 vs 2"] }] }));
    const reordered = (await results(env, division, player)).polls[0];
    assert.notEqual(reordered.revision, original.revision);
    assert.equal(reordered.total, 0);
    assert.equal((await vote(env, division, original.revision, 0, player)).status, 409);
    assert.equal((await vote(env, division, reordered.revision, 2, player)).status, 400);
    const second = await publish(env, admin, await save(env, admin, await create(env, admin), { polls: [poll()], sectionOrder: ["polls"] }));
    assert.equal((await results(env, second, player)).polls[0].total, 0, "equal poll IDs in different divisions are independent");
    division = await publish(env, admin, await save(env, admin, division, { sectionOrder: [] }));
    assert.deepEqual((await results(env, division)).polls, []);
    assert.equal((await vote(env, division, reordered.revision, 0, player)).status, 404);
    await request(env, `/api/manage/divisions/${division.id}/unpublish`, { version: division.version }, admin);
    assert.equal((await request(env, endpoint(division))).status, 404);
});

test("a concurrent publication cannot authorise a stale poll vote", async t => {
    const env = environment(t);
    const admin = await signIn(env);
    const player = await signIn(env, 1001);
    let division = await create(env, admin);
    division = await publish(env, admin, await save(env, admin, division, { polls: [poll()], sectionOrder: ["polls"] }));
    const revision = (await results(env, division)).polls[0].revision;
    const prepare = env.DB.prepare;
    env.DB.prepare = sql => {
        const statement = prepare(sql);
        if (!sql.startsWith("INSERT INTO division_poll_votes")) return statement;
        return { bind(...values) {
            const bound = statement.bind(...values);
            return { ...bound, async first() {
                env.db.prepare("UPDATE divisions SET published_json = NULL WHERE id = ?").run(division.id);
                return bound.first();
            } };
        } };
    };
    assert.equal((await vote(env, division, revision, 0, player)).status, 409);
    assert.equal(env.db.prepare("SELECT COUNT(*) AS count FROM division_poll_votes").get().count, 0);
});

test("poll and archive schema validates scoped content, keeps archives private, and enforces editor permissions", async t => {
    const env = environment(t);
    const admin = await signIn(env);
    const editor = await signIn(env, 1001);
    let division = await create(env, admin);
    const timeline = [{ id: "stage", title: "PRIVATE archived timeline", date: "2026-11-17", description: "Archived copy" }];
    const archive = { id: "archive-one", type: "timeline", title: "Old timeline", archivedAt: 1, content: { timeline },
        textStyles: { "timeline.stage.title": [{ start: 0, end: 7, bold: true }] } };
    division = await save(env, admin, division, { archivedSections: [archive], polls: [poll()], sectionOrder: ["polls"],
        textStyles: { "polls.format.title": [{ start: 0, end: 5, italic: true }] } });
    division = await publish(env, admin, division);
    const publicResponse = await request(env, `/api/divisions/${division.id}`);
    const publicText = await publicResponse.text();
    assert.ok(!publicText.includes("PRIVATE archived timeline"));
    assert.ok(!publicText.includes("archivedSections"));
    await request(env, `/api/manage/divisions/${division.id}/members`, { bonkId: "1001", role: "editor" }, admin);
    const editorModel = (await (await request(env, `/api/manage/divisions/${division.id}`, undefined, editor)).json()).division;
    assert.ok(editorModel.permissions.editSections.includes("polls"));
    assert.deepEqual(editorModel.content.archivedSections, [archive]);
    division = await save(env, editor, editorModel, { polls: [{ ...poll(), description: "Editor can maintain polls" }] });
    const bad = async changes => request(env, `/api/manage/divisions/${division.id}`, { version: division.version, content: { ...division.content, ...changes } }, admin, "PUT");
    assert.equal((await bad({ polls: [{ ...poll(), options: ["Same", " same "] }] })).status, 400);
    assert.equal((await bad({ archivedSections: [{ ...archive, content: { timeline, general: "smuggled" } }] })).status, 400);
    assert.equal((await bad({ archivedSections: [{ ...archive, textStyles: { "general.name": [{ start: 0, end: 1, bold: true }] } }] })).status, 400);
    assert.equal((await bad({ archivedSections: [{ ...archive, content: { timeline: [{ ...timeline[0], title: "" }] } }] })).status, 400);
    const forbidden = await request(env, `/api/manage/divisions/${division.id}`, { version: division.version,
        content: { ...division.content, archivedSections: [] } }, editor, "PUT");
    assert.equal(forbidden.status, 403, "editors cannot delete restricted timeline archives");
    const pollArchive = { id: "archived-poll", type: "polls", title: "Earlier poll", archivedAt: 1, content: { polls: [poll()] } };
    division = await save(env, editor, division, { archivedSections: [archive, pollArchive] });
    assert.equal(division.content.archivedSections.length, 2);
});
