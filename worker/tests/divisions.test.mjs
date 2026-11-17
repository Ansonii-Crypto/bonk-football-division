import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import worker from "../index.js";

const origin = "https://bonk-football-division.com";

function environment(t) {
    const db = new DatabaseSync(":memory:");
    db.exec("PRAGMA foreign_keys=ON");
    for (const name of ["0001_bonk_accounts.sql", "0002_assessments.sql", "0003_divisions.sql"]) {
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
    return {
        db,
        DB: {
            prepare,
            async batch(statements) {
                db.exec("BEGIN");
                try {
                    const results = [];
                    for (const statement of statements) {
                        results.push(await statement.run());
                    }
                    db.exec("COMMIT");
                    return results;
                } catch (error) {
                    db.exec("ROLLBACK");
                    throw error;
                }
            }
        },
        API_RATE_LIMITER: { async limit() { return { success: true }; } },
        LOGIN_RATE_LIMITER: { async limit() { return { success: true }; } },
        ASSETS: { async fetch() { return new Response("asset"); } }
    };
}

function request(env, path, body, options = {}) {
    const headers = new Headers({ Origin: origin, "Content-Type": "application/json", ...options.headers });
    if (options.cookie) {
        headers.set("Cookie", options.cookie);
    }
    if (options.noOrigin) {
        headers.delete("Origin");
    }
    return worker.fetch(new Request(origin + path, {
        method: options.method || (body === undefined ? "GET" : "POST"),
        headers,
        ...(body === undefined ? {} : { body: JSON.stringify(body) })
    }), env);
}

async function signIn(env, id = 3177088, username = "Admin") {
    const prior = globalThis.fetch;
    globalThis.fetch = async () => Response.json({ r: "success", id, username, token: "private-upstream-token" });
    try {
        const response = await request(env, "/api/bonk/login", { username, password: "synthetic-test-password" });
        assert.equal(response.status, 200, await response.clone().text());
        return response.headers.get("Set-Cookie").split(";")[0];
    } finally {
        globalThis.fetch = prior;
    }
}

async function create(env, cookie, name = "Football Cup") {
    const response = await request(env, "/api/admin/divisions", { name, summary: "A football event", isAdmin: true }, { cookie });
    assert.equal(response.status, 201, await response.clone().text());
    return (await response.json()).division;
}

async function grant(env, cookie, id, bonkId, role) {
    const response = await request(env, `/api/manage/divisions/${id}/members`, { bonkId, role }, { cookie });
    assert.equal(response.status, 200, await response.clone().text());
    return response.json();
}

async function save(env, cookie, division, changes) {
    const response = await request(env, `/api/manage/divisions/${division.id}`, {
        version: division.version, content: { ...division.content, ...changes }
    }, { cookie, method: "PUT" });
    assert.equal(response.status, 200, await response.clone().text());
    return (await response.json()).division;
}

async function publish(env, cookie, division) {
    const response = await request(env, `/api/manage/divisions/${division.id}/publish`, { version: division.version }, { cookie });
    assert.equal(response.status, 200, await response.clone().text());
    return (await response.json()).division;
}

test("division drafts are private and publication preserves a separate public snapshot", async t => {
    const env = environment(t);
    const admin = await signIn(env);
    const regular = await signIn(env, 1001, "Player");
    assert.equal((await request(env, "/api/admin/divisions", { name: "Forged", isAdmin: true }, { cookie: regular })).status, 403);
    assert.equal((await request(env, "/api/admin/divisions", { name: "Unsigned" })).status, 401);
    let division = await create(env, admin);
    assert.equal(division.role, "site-admin");
    assert.equal(division.permissions.publish, true);
    assert.equal((await request(env, `/api/divisions/${division.id}`)).status, 404);
    assert.equal((await (await request(env, "/api/divisions")).json()).total, 0);
    assert.equal((await (await request(env, "/api/manage/divisions", undefined, { cookie: admin })).json()).total, 1);
    assert.equal((await (await request(env, "/api/manage/divisions", undefined, { cookie: regular })).json()).total, 0);
    assert.equal((await request(env, `/api/manage/divisions/${division.id}`, undefined, { cookie: regular })).status, 403);
    division = await save(env, admin, division, { description: "Published details" });
    const published = await request(env, `/api/manage/divisions/${division.id}/publish`, { version: division.version }, { cookie: admin });
    assert.equal(published.status, 200);
    division = (await published.json()).division;
    assert.equal(division.publishedVersion, division.version);
    const publicBefore = (await (await request(env, `/api/divisions/${division.id}`)).json()).division;
    assert.equal(publicBefore.content.description, "Published details");
    assert.equal(publicBefore.version, undefined);
    division = await save(env, admin, division, { name: "Private renamed cup", description: "Not public yet" });
    const publicAfter = (await (await request(env, `/api/divisions/${division.id}`)).json()).division;
    assert.deepEqual(publicAfter, publicBefore);
    const publicList = await (await request(env, "/api/divisions")).json();
    assert.equal(publicList.divisions[0].name, "Football Cup");
    assert.equal(publicList.divisions[0].role, undefined);
    assert.equal((await request(env, `/api/manage/divisions/${division.id}/publish`, { version: division.version - 1 }, { cookie: admin })).status, 409);
    assert.equal((await request(env, `/api/manage/divisions/${division.id}`, {
        version: division.version - 1, content: division.content
    }, { cookie: admin, method: "PUT" })).status, 409);
    const unpublishedResponse = await request(env, `/api/manage/divisions/${division.id}/unpublish`, { version: division.version }, { cookie: admin });
    assert.equal(unpublishedResponse.status, 200);
    const unpublished = (await unpublishedResponse.json()).division;
    assert.equal(unpublished.publishedAt, null);
    assert.equal(unpublished.publishedVersion, null);
    assert.deepEqual(unpublished.content, division.content);
    assert.equal(unpublished.version, division.version);
    assert.equal((await request(env, `/api/divisions/${division.id}`)).status, 404);
    assert.equal((await (await request(env, "/api/divisions")).json()).total, 0);
});

test("division role hierarchy is scoped and only site admins can change directors", async t => {
    const env = environment(t);
    const admin = await signIn(env);
    const director = await signIn(env, 1001, "Director");
    const secondDirector = await signIn(env, 1002, "Second director");
    const organizer = await signIn(env, 1003, "Organizer");
    const editor = await signIn(env, 1004, "Editor");
    const first = await create(env, admin);
    const second = await create(env, admin, "Other division");
    await grant(env, admin, first.id, "1001", "director");
    await grant(env, admin, first.id, "1002", "director");
    await grant(env, director, first.id, "1003", "organizer");
    await grant(env, director, first.id, "1004", "editor");
    for (const target of ["1001", "1002"]) {
        assert.equal((await request(env, `/api/manage/divisions/${first.id}/members`, { bonkId: target, role: "editor" }, { cookie: director })).status, 403);
        assert.equal((await request(env, `/api/manage/divisions/${first.id}/members/${target}`, undefined, { cookie: director, method: "DELETE" })).status, 403);
    }
    assert.equal((await request(env, `/api/manage/divisions/${first.id}/members`, { bonkId: "1003", role: "director" }, { cookie: director })).status, 403);
    assert.equal((await request(env, `/api/manage/divisions/${first.id}/members`, { bonkId: "999999", role: "editor" }, { cookie: director })).status, 400);
    assert.equal((await request(env, `/api/manage/divisions/${second.id}`, undefined, { cookie: director })).status, 403);
    assert.equal((await request(env, `/api/manage/divisions/${first.id}/members`, { bonkId: "1001", role: "editor" }, { cookie: organizer })).status, 403);
    const managed = (await (await request(env, `/api/manage/divisions/${first.id}`, undefined, { cookie: editor })).json()).division;
    assert.deepEqual(managed.permissions.generalFields, ["description"]);
    assert.equal(managed.permissions.publish, false);
    assert.equal((await request(env, `/api/manage/divisions/${first.id}/publish`, { version: first.version }, { cookie: organizer })).status, 403);
    assert.equal((await request(env, `/api/manage/divisions/${first.id}/publish`, { version: first.version }, { cookie: editor })).status, 403);
    assert.equal((await request(env, `/api/manage/divisions/${first.id}/unpublish`, { version: first.version }, { cookie: organizer })).status, 403);
    assert.equal((await request(env, `/api/manage/divisions/${first.id}/members/1004`, undefined, { cookie: director, method: "DELETE" })).status, 200);
    assert.equal((await request(env, `/api/manage/divisions/${first.id}`, undefined, { cookie: editor })).status, 403);
    assert.equal((await request(env, `/api/manage/divisions/${first.id}`, undefined, { cookie: secondDirector })).status, 200);
    await grant(env, admin, first.id, "3177088", "editor");
    assert.equal((await (await request(env, `/api/manage/divisions/${first.id}`, undefined, { cookie: admin })).json()).division.role, "site-admin");
});

test("editors have limited sections while organizers can build validated 4v4 brackets", async t => {
    const env = environment(t);
    const admin = await signIn(env);
    const organizer = await signIn(env, 1001, "Organizer");
    const editor = await signIn(env, 1002, "Editor");
    let division = await create(env, admin);
    await grant(env, admin, division.id, "1001", "organizer");
    await grant(env, admin, division.id, "1002", "editor");
    division = await save(env, editor, division, { description: "Edited copy", campaigns: [{ id: "campaign-1", title: "Welcome", description: "Join the event" }],
        referendums: [{ id: "vote-1", title: "Next format?", description: "Feedback", status: "planned", options: ["Solo", "Teams"] }] });
    for (const changes of [{ name: "Hijacked" }, { participation: { ...division.content.participation, registration: "open" } },
        { timeline: [{ id: "stage", title: "Round", date: "2026-11-12", description: "" }] }, { results: { "0-0": { teamAId: null, teamBId: null, scoreA: null, scoreB: null } } }]) {
        assert.equal((await request(env, `/api/manage/divisions/${division.id}`, { version: division.version, content: { ...division.content, ...changes } }, { cookie: editor, method: "PUT" })).status, 403);
    }
    const teams = ["blue", "red"].map((id, team) => ({ id, name: `${id} team`, players: Array.from({ length: 4 }, (_, player) => ({ username: `Player ${team}-${player}`, bonkId: team === 0 && player === 0 ? "1002" : null })) }));
    const competition = { participation: { mode: "teams", teamSize: 4, registration: "open", description: "Four on each side" }, teams,
        results: { "0-0": { teamAId: "blue", teamBId: "red", scoreA: 2, scoreB: 1 } },
        timeline: [{ id: "kickoff", title: "Kickoff", date: "2026-11-12", description: "Opening match" }] };
    division = await save(env, organizer, division, competition);
    assert.equal(division.content.teams[0].players.length, 4);
    assert.equal((await request(env, `/api/manage/divisions/${division.id}/publish`, { version: division.version }, { cookie: admin })).status, 200);
    const publicDivision = (await (await request(env, `/api/divisions/${division.id}`)).json()).division;
    assert.deepEqual(publicDivision.content.teams[0].players[0], { username: "Player 0-0" });
    assert.equal(division.content.teams[0].players[0].bonkId, "1002");
    for (const content of [
        { ...division.content, startDate: "2026-02-30" },
        { ...division.content, startDate: "2026-12-01", endDate: "2026-11-01" },
        { ...division.content, timeline: [{ id: "bad", title: "Bad date", date: "2026-02-30", description: "" }] },
        { ...division.content, participation: { ...competition.participation, teamSize: 5 } },
        { ...division.content, teams: [{ ...teams[0], players: [...teams[0].players, { username: "Fifth", bonkId: null }] }, teams[1]] },
        { ...division.content, results: { "0-0": { teamAId: "unknown", teamBId: "red", scoreA: 1, scoreB: 0 } } },
        { ...division.content, surprise: "Unsupported field" }
    ]) {
        assert.equal((await request(env, `/api/manage/divisions/${division.id}`, { version: division.version, content }, { cookie: organizer, method: "PUT" })).status, 400);
    }
});

test("a concurrent director promotion cannot be overwritten or removed by a lower director", async t => {
    const env = environment(t);
    const admin = await signIn(env);
    const director = await signIn(env, 1001, "Director");
    await signIn(env, 1002, "Organizer");
    const division = await create(env, admin);
    await grant(env, admin, division.id, "1001", "director");
    await grant(env, admin, division.id, "1002", "organizer");
    const originalPrepare = env.DB.prepare;
    let promoteAfterRead = true;
    env.DB.prepare = sql => {
        const statement = originalPrepare(sql);
        if (sql !== "SELECT role FROM division_members WHERE division_id = ? AND bonk_id = ?") {
            return statement;
        }
        return {
            ...statement,
            bind(...values) {
                const bound = statement.bind(...values);
                return {
                    ...bound,
                    async first() {
                        const row = await bound.first();
                        if (promoteAfterRead && values[1] === "1002") {
                            promoteAfterRead = false;
                            env.db.prepare("UPDATE division_members SET role = 'director' WHERE division_id = ? AND bonk_id = ?")
                                .run(division.id, "1002");
                        }
                        return row;
                    }
                };
            }
        };
    };
    const reassigned = await request(env, `/api/manage/divisions/${division.id}/members`, { bonkId: "1002", role: "editor" }, { cookie: director });
    assert.equal(reassigned.status, 403);
    assert.equal(env.db.prepare("SELECT role FROM division_members WHERE division_id = ? AND bonk_id = ?").get(division.id, "1002").role, "director");
    env.db.prepare("UPDATE division_members SET role = 'organizer' WHERE division_id = ? AND bonk_id = ?").run(division.id, "1002");
    promoteAfterRead = true;
    const removed = await request(env, `/api/manage/divisions/${division.id}/members/1002`, undefined, { cookie: director, method: "DELETE" });
    assert.equal(removed.status, 403);
    assert.equal(env.db.prepare("SELECT role FROM division_members WHERE division_id = ? AND bonk_id = ?").get(division.id, "1002").role, "director");
});

test("division writes keep CSRF, body bounds, and pagination gates", async t => {
    const env = environment(t);
    const admin = await signIn(env);
    const division = await create(env, admin);
    assert.equal((await request(env, "/api/admin/divisions", { name: "Blocked" }, { cookie: admin, noOrigin: true })).status, 403);
    assert.equal((await request(env, "/api/admin/divisions", { name: "Blocked" }, { cookie: admin, headers: { "Content-Type": "text/plain" } })).status, 415);
    assert.equal((await request(env, "/api/admin/divisions", { name: "Blocked" }, { cookie: admin, headers: { "Content-Length": "65537" } })).status, 413);
    assert.equal((await request(env, `/api/manage/divisions/${division.id}/members/1001`, undefined, { cookie: admin, method: "DELETE", noOrigin: true })).status, 403);
    assert.equal((await request(env, "/api/manage/divisions")).status, 401);
    assert.equal((await request(env, "/api/divisions?limit=25")).status, 400);
    assert.equal((await request(env, "/api/divisions", {}, { cookie: admin })).status, 405);
    const large = await request(env, `/api/manage/divisions/${division.id}`, { version: division.version, content: { ...division.content, description: "a".repeat(66000) } }, { cookie: admin, method: "PUT" });
    assert.equal(large.status, 400);
});

test("division appearance is editable by managers and published as a separate safe snapshot", async t => {
    const env = environment(t);
    const admin = await signIn(env);
    const editor = await signIn(env, 1001, "Editor");
    let division = await create(env, admin);
    assert.deepEqual(division.content.appearance, { backgroundColor: "", backgroundImage: "" });
    await grant(env, admin, division.id, "1001", "editor");
    assert.ok(division.permissions.editSections.includes("appearance"));
    const legacy = { ...division.content };
    delete legacy.appearance;
    const legacyResponse = await request(env, `/api/manage/divisions/${division.id}`, { version: division.version, content: legacy }, { cookie: editor, method: "PUT" });
    assert.equal(legacyResponse.status, 200);
    division = (await legacyResponse.json()).division;
    assert.deepEqual(division.content.appearance, { backgroundColor: "", backgroundImage: "" });
    assert.ok(division.permissions.editSections.includes("appearance"));
    const publishedAppearance = { backgroundColor: "#123aBC", backgroundImage: "https://example.com/background.png?theme=ice" };
    division = await save(env, editor, division, { appearance: publishedAppearance });
    assert.equal((await request(env, `/api/manage/divisions/${division.id}/publish`, { version: division.version }, { cookie: admin })).status, 200);
    assert.deepEqual((await (await request(env, `/api/divisions/${division.id}`)).json()).division.content.appearance, publishedAppearance);
    assert.deepEqual((await (await request(env, "/api/divisions")).json()).divisions[0].appearance, publishedAppearance);
    const draftAppearance = { backgroundColor: "#654321", backgroundImage: "" };
    division = await save(env, editor, division, { appearance: draftAppearance });
    assert.deepEqual((await (await request(env, "/api/manage/divisions", undefined, { cookie: editor })).json()).divisions[0].appearance, draftAppearance);
    assert.deepEqual((await (await request(env, "/api/divisions")).json()).divisions[0].appearance, publishedAppearance);
    assert.equal((await request(env, `/api/manage/divisions/${division.id}`, { version: division.version, content: {
        ...division.content, appearance: draftAppearance, participation: { ...division.content.participation, registration: "open" }
    } }, { cookie: editor, method: "PUT" })).status, 403);
    for (const invalid of [
        { backgroundColor: "red", backgroundImage: "" },
        { backgroundColor: "#fff", backgroundImage: "" },
        { backgroundColor: "", backgroundImage: "javascript:alert(1)" },
        { backgroundColor: "", backgroundImage: "data:image/png;base64,abc" },
        { backgroundColor: "", backgroundImage: "http://example.com/image.png" },
        { backgroundColor: "", backgroundImage: "/image.png" },
        { backgroundColor: "", backgroundImage: "https://user:password@example.com/image.png" },
        { backgroundColor: "", backgroundImage: "https://example.com/image\n.png" },
        { backgroundColor: "", backgroundImage: `https://example.com/${"a".repeat(2048)}` },
        { backgroundColor: "", backgroundImage: "", extra: "unsupported" }
    ]) {
        assert.equal((await request(env, `/api/manage/divisions/${division.id}`, { version: division.version,
            content: { ...division.content, appearance: invalid } }, { cookie: editor, method: "PUT" })).status, 400);
    }
});

test("division section order is validated, retained in drafts, and published separately", async t => {
    const env = environment(t);
    const admin = await signIn(env);
    let division = await create(env, admin);
    assert.deepEqual(division.content.sectionOrder, []);
    division = await save(env, admin, division, {
        sectionOrder: ["campaigns", "timeline"],
        timeline: [{ id: "opening", title: "Opening match", date: "2026-11-12", description: "" }],
        campaigns: [{ id: "welcome", title: "Welcome", description: "Play football" }]
    });
    assert.deepEqual(division.content.sectionOrder, ["campaigns", "timeline"]);
    assert.equal((await request(env, `/api/manage/divisions/${division.id}/publish`, { version: division.version }, { cookie: admin })).status, 200);
    const published = (await (await request(env, `/api/divisions/${division.id}`)).json()).division.content;
    assert.deepEqual(published.sectionOrder, ["campaigns", "timeline"]);
    division = await save(env, admin, division, { sectionOrder: ["campaigns"] });
    assert.equal(division.content.timeline.length, 1, "removing a section retains its content for re-adding");
    assert.deepEqual((await (await request(env, `/api/divisions/${division.id}`)).json()).division.content.sectionOrder, ["campaigns", "timeline"]);
    for (const sectionOrder of [null, "timeline", ["timeline", "timeline"], ["general"], ["appearance"], ["unknown"]]) {
        assert.equal((await request(env, `/api/manage/divisions/${division.id}`, {
            version: division.version, content: { ...division.content, sectionOrder }
        }, { cookie: admin, method: "PUT" })).status, 400);
    }

    const legacy = { ...division.content, teams: ["blue", "red"].map(id => ({ id, name: id, players: [{ username: id, bonkId: null }] })) };
    delete legacy.sectionOrder;
    const response = await request(env, `/api/manage/divisions/${division.id}`, { version: division.version, content: legacy }, { cookie: admin, method: "PUT" });
    assert.equal(response.status, 200);
    division = (await response.json()).division;
    assert.deepEqual(division.content.sectionOrder, ["participation", "timeline", "teams", "bracket", "campaigns"]);
    assert.equal((await request(env, `/api/manage/divisions/${division.id}/publish`, { version: division.version }, { cookie: admin })).status, 200);
    assert.deepEqual((await (await request(env, `/api/divisions/${division.id}`)).json()).division.content.sectionOrder,
        ["participation", "timeline", "teams", "bracket", "campaigns"]);
});

test("legacy event order prioritises live brackets without changing stored or manually arranged content", async t => {
    const env = environment(t);
    const admin = await signIn(env);
    const division = await create(env, admin);
    const legacy = {
        ...division.content,
        timeline: [{ id: "opening", title: "Opening match", date: "2026-11-21", description: "" }],
        teams: ["blue", "red"].map(id => ({ id, name: id, players: [{ username: id, bonkId: null }] })),
        campaigns: [{ id: "welcome", title: "Welcome", description: "" }],
        customSections: [{ id: "rules", title: "Rules", description: "Play fair." }]
    };
    delete legacy.sectionOrder;
    const stored = content => {
        const serialized = JSON.stringify(content);
        env.db.prepare("UPDATE divisions SET draft_json = ?, published_json = ?, published_version = version, published_at = 1000 WHERE id = ?")
            .run(serialized, serialized, division.id);
        return serialized;
    };
    async function orders() {
        const publicView = (await (await request(env, `/api/divisions/${division.id}`)).json()).division;
        const managedView = (await (await request(env, `/api/manage/divisions/${division.id}`, undefined, { cookie: admin })).json()).division;
        return [publicView.content.sectionOrder, managedView.content.sectionOrder];
    }
    for (const status of ["upcoming", "registration", "live", "completed"]) {
        const serialized = stored({ ...legacy, status });
        const expected = ["live", "completed"].includes(status)
            ? ["bracket", "participation", "timeline", "teams", "campaigns", "custom:rules"]
            : ["participation", "timeline", "teams", "bracket", "campaigns", "custom:rules"];
        for (const order of await orders()) assert.deepEqual(order, expected);
        const row = env.db.prepare("SELECT draft_json, published_json FROM divisions WHERE id = ?").get(division.id);
        assert.equal(row.draft_json, serialized);
        assert.equal(row.published_json, serialized, "reading an older event does not rewrite either stored snapshot");
    }
    for (const sectionOrder of [[], ["campaigns", "timeline", "bracket", "participation"]]) {
        stored({ ...legacy, status: "live", sectionOrder });
        for (const order of await orders()) assert.deepEqual(order, sectionOrder, "an explicit saved order is preserved");
    }
    stored({ ...legacy, status: "live", teams: legacy.teams.slice(0, 1) });
    for (const order of await orders()) assert.deepEqual(order, ["participation", "timeline", "teams", "campaigns", "custom:rules"],
        "a legacy event still needs two entrants before a bracket is included");
});

test("editors can arrange their own sections without hiding or reordering restricted sections", async t => {
    const env = environment(t);
    const admin = await signIn(env);
    const editor = await signIn(env, 1001, "Editor");
    let division = await create(env, admin);
    await grant(env, admin, division.id, "1001", "editor");
    division = await save(env, admin, division, {
        sectionOrder: ["participation", "timeline", "campaigns"],
        timeline: [{ id: "opening", title: "Opening", date: "", description: "" }],
        campaigns: [{ id: "welcome", title: "Welcome", description: "" }]
    });
    division = await save(env, editor, division, {
        sectionOrder: ["campaigns", "participation", "referendums", "timeline"],
        referendums: [{ id: "format", title: "Next format?", description: "", status: "planned", options: ["Solo", "Teams"] }]
    });
    division = await save(env, editor, division, { sectionOrder: ["participation", "referendums", "timeline"] });
    assert.equal(division.content.campaigns.length, 1);
    for (const sectionOrder of [
        ["timeline", "participation", "referendums"],
        ["participation", "referendums"],
        ["participation", "teams", "referendums", "timeline"]
    ]) {
        assert.equal((await request(env, `/api/manage/divisions/${division.id}`, {
            version: division.version, content: { ...division.content, sectionOrder }
        }, { cookie: editor, method: "PUT" })).status, 403);
    }
    division = await save(env, admin, division, { sectionOrder: ["timeline", "participation"] });
    assert.deepEqual(division.content.sectionOrder, ["timeline", "participation"]);
});

test("custom sections have validated references and remain scoped editable content", async t => {
    const env = environment(t);
    const admin = await signIn(env);
    const editor = await signIn(env, 1001, "Editor");
    let division = await create(env, admin);
    assert.deepEqual(division.content.customSections, []);
    await grant(env, admin, division.id, "1001", "editor");
    division = await save(env, admin, division, { sectionOrder: ["participation"] });
    division = await save(env, editor, division, {
        customSections: [{ id: "rules", title: "Match rules", description: "Respect the referee." }],
        sectionOrder: ["custom:rules", "participation"]
    });
    assert.ok(division.permissions.editSections.includes("custom"));
    assert.equal((await request(env, `/api/manage/divisions/${division.id}/publish`, { version: division.version }, { cookie: admin })).status, 200);
    const published = (await (await request(env, `/api/divisions/${division.id}`)).json()).division.content;
    assert.deepEqual(published.customSections, division.content.customSections);
    assert.deepEqual(published.sectionOrder, ["custom:rules", "participation"]);
    division = await save(env, editor, division, { sectionOrder: ["participation"] });
    assert.equal(division.content.customSections.length, 1, "hidden custom content is available to restore");
    assert.deepEqual((await (await request(env, `/api/divisions/${division.id}`)).json()).division.content.sectionOrder, ["custom:rules", "participation"]);
    for (const changes of [
        { sectionOrder: ["custom:unknown", "participation"] },
        { sectionOrder: ["custom:rules", "custom:rules", "participation"] },
        { customSections: null },
        { customSections: [{ id: "rules", title: "", description: "" }] },
        { customSections: [{ id: "rules", title: "Rules", description: "", extra: true }] },
        { customSections: [{ id: "bad:id", title: "Rules", description: "" }] },
        { customSections: [{ id: "rules", title: "Rules", description: "x".repeat(6001) }] },
        { customSections: Array.from({ length: 21 }, (_, index) => ({ id: `section-${index}`, title: "Title", description: "" })) }
    ]) {
        assert.equal((await request(env, `/api/manage/divisions/${division.id}`, {
            version: division.version, content: { ...division.content, ...changes }
        }, { cookie: editor, method: "PUT" })).status, 400);
    }
    assert.equal((await request(env, `/api/manage/divisions/${division.id}`, {
        version: division.version, content: { ...division.content, sectionOrder: ["custom:rules"] }
    }, { cookie: editor, method: "PUT" })).status, 403);

    const legacy = { ...division.content };
    delete legacy.sectionOrder;
    const legacyResponse = await request(env, `/api/manage/divisions/${division.id}`, {
        version: division.version, content: legacy
    }, { cookie: admin, method: "PUT" });
    assert.equal(legacyResponse.status, 200);
    assert.deepEqual((await legacyResponse.json()).division.content.sectionOrder, ["participation", "custom:rules"]);
});

test("published event status filters paginate the public snapshot and prioritise live and upcoming events", async t => {
    const env = environment(t);
    const admin = await signIn(env);
    async function event(name, status, startDate, publishedAt) {
        let division = await create(env, admin, name);
        division = await save(env, admin, division, { status, startDate });
        division = await publish(env, admin, division);
        env.db.prepare("UPDATE divisions SET published_at = ? WHERE id = ?").run(publishedAt, division.id);
        return division;
    }
    const later = await event("Upcoming later", "upcoming", "2026-12-20", 5000);
    const completedOlder = await event("Completed older", "completed", "2026-10-01", 1000);
    let live = await event("Live cup", "live", "2026-11-01", 2000);
    const registration = await event("Registration first", "registration", "2026-12-01", 3000);
    const undated = await event("Upcoming undated", "upcoming", "", 9000);
    const tieA = await event("Upcoming tie A", "upcoming", "2026-12-10", 4000);
    const tieB = await event("Upcoming tie B", "upcoming", "2026-12-10", 4000);
    const completedRecent = await event("Completed recent", "completed", "2026-10-02", 8000);
    const hidden = await create(env, admin, "Private live event");
    await save(env, admin, hidden, { status: "live" });
    live = await save(env, admin, live, { name: "Unpublished renamed event", status: "completed" });

    const all = await (await request(env, "/api/divisions?status=all")).json();
    assert.equal(all.total, 8);
    assert.deepEqual(all.divisions.map(division => division.id),
        [live.id, registration.id, tieB.id, tieA.id, later.id, undated.id, completedRecent.id, completedOlder.id]);
    assert.equal(all.divisions[0].name, "Live cup", "draft names and statuses do not affect the public listing");
    const paged = await (await request(env, "/api/divisions?limit=3&page=2")).json();
    assert.equal(paged.total, 8);
    assert.equal(paged.pages, 3);
    assert.deepEqual(paged.divisions.map(division => division.id), [tieA.id, later.id, undated.id]);
    const upcoming = await (await request(env, "/api/divisions?status=upcoming&limit=2&page=2")).json();
    assert.equal(upcoming.total, 5);
    assert.equal(upcoming.pages, 3);
    assert.equal(upcoming.page, 2);
    assert.deepEqual(upcoming.divisions.map(division => division.id), [tieA.id, later.id]);
    const registrations = await (await request(env, "/api/divisions?status=registration")).json();
    assert.equal(registrations.total, 1);
    assert.equal(registrations.divisions[0].id, registration.id);
    const liveOnly = await (await request(env, "/api/divisions?status=live")).json();
    assert.equal(liveOnly.total, 1);
    assert.equal(liveOnly.divisions[0].id, live.id);
    const completed = await (await request(env, "/api/divisions?status=completed")).json();
    assert.deepEqual(completed.divisions.map(division => division.id), [completedRecent.id, completedOlder.id]);
    const clamped = await (await request(env, "/api/divisions?status=registration&page=999")).json();
    assert.equal(clamped.page, 1);
    for (const status of ["unknown", "", "live' OR 1=1"]) {
        assert.equal((await request(env, `/api/divisions?status=${encodeURIComponent(status)}`)).status, 400);
    }
});

test("showcase metadata uses the same public or private snapshot without exposing player identities", async t => {
    const env = environment(t);
    const admin = await signIn(env);
    let division = await create(env, admin);
    const teams = ["blue", "red", "green"].map((id, index) => ({ id, name: `${id} team`, players: [{ username: `${id} player`, bonkId: String(3177088 + index) }] }));
    division = await save(env, admin, division, {
        participation: { mode: "teams", teamSize: 4, registration: "open", description: "Published participation details" },
        teams: teams.slice(0, 2)
    });
    division = await publish(env, admin, division);
    division = await save(env, admin, division, {
        participation: { mode: "teams", teamSize: 2, registration: "invite-only", description: "Private participation details" },
        teams
    });
    const publicSummary = (await (await request(env, "/api/divisions")).json()).divisions[0];
    const privateSummary = (await (await request(env, "/api/manage/divisions", undefined, { cookie: admin })).json()).divisions[0];
    assert.deepEqual(publicSummary.participation, { mode: "teams", teamSize: 4, registration: "open" });
    assert.equal(publicSummary.entrantCount, 2);
    assert.deepEqual(privateSummary.participation, { mode: "teams", teamSize: 2, registration: "invite-only" });
    assert.equal(privateSummary.entrantCount, 3);
    for (const summary of [publicSummary, privateSummary]) {
        assert.equal(summary.teams, undefined);
        assert.equal(summary.participation.description, undefined);
        assert.doesNotMatch(JSON.stringify(summary), /3177088|blue player|red player|green player|bonkId/);
    }
    assert.equal(publicSummary.version, undefined);
    assert.equal(publicSummary.permissions, undefined);
});

test("draft filtering keeps unpublished changes paged and scoped to the manager's own divisions", async t => {
    const env = environment(t);
    const admin = await signIn(env);
    const editor = await signIn(env, 1001, "Editor");
    const unrelated = await signIn(env, 1002, "Unrelated");
    const assignedDraft = await create(env, admin, "Assigned private draft");
    const otherDraft = await create(env, admin, "Other private draft");
    let clean = await create(env, admin, "Clean published event");
    let changed = await create(env, admin, "Published event with a draft");
    await grant(env, admin, assignedDraft.id, "1001", "editor");
    await grant(env, admin, clean.id, "1001", "editor");
    await grant(env, admin, changed.id, "1001", "editor");
    clean = await publish(env, admin, clean);
    changed = await publish(env, admin, changed);
    changed = await save(env, editor, changed, { description: "An unpublished edit" });
    for (const [id, timestamp] of [[assignedDraft.id, 1000], [otherDraft.id, 2000], [changed.id, 3000]]) {
        env.db.prepare("UPDATE divisions SET updated_at = ? WHERE id = ?").run(timestamp, id);
    }
    const all = await (await request(env, "/api/manage/divisions?publication=all", undefined, { cookie: admin })).json();
    assert.equal(all.total, 4);
    const adminDrafts = await (await request(env, "/api/manage/divisions?publication=drafts", undefined, { cookie: admin })).json();
    assert.equal(adminDrafts.total, 3);
    assert.deepEqual(adminDrafts.divisions.map(division => division.id), [changed.id, otherDraft.id, assignedDraft.id]);
    const first = await (await request(env, "/api/manage/divisions?publication=drafts&limit=1", undefined, { cookie: editor })).json();
    assert.equal(first.total, 2);
    assert.equal(first.pages, 2);
    assert.equal(first.divisions[0].id, changed.id);
    assert.equal(first.divisions[0].role, "editor");
    const second = await (await request(env, "/api/manage/divisions?publication=drafts&limit=1&page=2", undefined, { cookie: editor })).json();
    assert.equal(second.divisions[0].id, assignedDraft.id);
    const noAccess = await (await request(env, "/api/manage/divisions?publication=drafts", undefined, { cookie: unrelated })).json();
    assert.equal(noAccess.total, 0);
    assert.equal((await request(env, "/api/manage/divisions?publication=drafts")).status, 401);
    assert.equal((await request(env, "/api/manage/divisions?publication=unknown", undefined, { cookie: admin })).status, 400);
    changed = await publish(env, admin, changed);
    assert.equal((await (await request(env, "/api/manage/divisions?publication=drafts", undefined, { cookie: editor })).json()).total, 1,
        "publishing an edit removes it from the manager's draft list");
    assert.equal((await request(env, `/api/manage/divisions/${clean.id}/unpublish`, { version: clean.version }, { cookie: admin })).status, 200);
    const afterUnpublish = await (await request(env, "/api/manage/divisions?publication=drafts", undefined, { cookie: editor })).json();
    assert.equal(afterUnpublish.total, 2, "an unpublished event returns to the draft list");
    const publicList = await (await request(env, "/api/divisions?publication=drafts")).json();
    assert.deepEqual(publicList.divisions.map(division => division.id), [changed.id], "public query parameters cannot expose private drafts");
});

test("text formatting is stored in the private draft and published as a separate structured snapshot", async t => {
    const env = environment(t);
    const admin = await signIn(env);
    let division = await create(env, admin);
    assert.equal(division.content.textStyles, undefined, "legacy plain text does not gain formatting on read");
    const textStyles = {
        "general.name": [{ start: 0, end: 8, bold: true, color: "#95e1ff", font: "serif", size: "large" }],
        "general.description": [{ start: 0, end: 4, italic: true }, { start: 5, end: 9, underline: true, font: "mono" }],
        "timeline.opening.title": [{ start: 0, end: 7, bold: true }],
        "campaigns.welcome.description": [{ start: 0, end: 4, color: "#ffc09d" }],
        "referendums.format.title": [{ start: 0, end: 4, font: "sans", size: "small" }],
        "custom.rules.title": [{ start: 0, end: 5, underline: true }],
        "teams.blue.name": [{ start: 0, end: 4, bold: true }],
        "participation.description": [{ start: 0, end: 5, italic: true }]
    };
    division = await save(env, admin, division, {
        description: "Play fair and enjoy football.",
        timeline: [{ id: "opening", title: "Opening match", date: "", description: "" }],
        campaigns: [{ id: "welcome", title: "Welcome", description: "Join the cup." }],
        referendums: [{ id: "format", title: "Next format?", description: "", status: "planned", options: ["Solo", "Teams"] }],
        customSections: [{ id: "rules", title: "Rules", description: "Play fair." }],
        teams: [{ id: "blue", name: "Blue team", players: [{ username: "BluePlayer", bonkId: null }] }],
        participation: { ...division.content.participation, description: "Enter with your team." },
        textStyles
    });
    assert.deepEqual(division.content.textStyles, textStyles);
    assert.equal((await request(env, `/api/divisions/${division.id}`)).status, 404);
    division = await publish(env, admin, division);
    const published = (await (await request(env, `/api/divisions/${division.id}`)).json()).division.content;
    assert.deepEqual(published.textStyles, textStyles);
    const draftStyles = { ...textStyles, "general.description": [{ start: 0, end: 9, color: "#ffffff", bold: true }] };
    division = await save(env, admin, division, { textStyles: draftStyles });
    assert.deepEqual(division.content.textStyles, draftStyles);
    assert.deepEqual((await (await request(env, `/api/divisions/${division.id}`)).json()).division.content.textStyles, textStyles);
    assert.equal((await (await request(env, "/api/divisions")).json()).divisions[0].textStyles, undefined,
        "directory summaries do not include the detailed formatting map");
});

test("formatting rejects unsupported properties, stale paths and invalid or overlapping text ranges", async t => {
    const env = environment(t);
    const admin = await signIn(env);
    let division = await create(env, admin);
    division = await save(env, admin, division, { description: "😀 Fair play matters.", customSections: [{ id: "rules", title: "Rules", description: "x".repeat(600) }] });
    const run = { start: 0, end: 2, bold: true };
    const invalid = [
        null, [], "bold", { "__proto__.name": [run] }, { "general.status": [run] },
        { "custom.missing.title": [run] }, { "teams.rules.title": [run] }, { "custom.rules.name": [run] },
        { "general.description": null }, { "general.description": { start: 0, end: 2 } },
        { "general.description": [{ start: -1, end: 2 }] }, { "general.description": [{ start: 0.5, end: 2 }] },
        { "general.description": [{ start: 2, end: 2 }] }, { "general.description": [{ start: 2, end: 200 }] },
        { "general.description": [{ start: 0, end: 1 }] }, { "general.description": [{ start: 1, end: 2 }] },
        { "general.description": [{ start: 2, end: 6 }, { start: 5, end: 8 }] },
        { "general.description": [{ start: 6, end: 8 }, { start: 2, end: 5 }] },
        { "general.description": [{ ...run, bold: false }] }, { "general.description": [{ ...run, italic: "true" }] },
        { "general.description": [{ ...run, color: "red" }] }, { "general.description": [{ ...run, color: "#fff" }] },
        { "general.description": [{ ...run, color: "url(https://example.com)" }] },
        { "general.description": [{ ...run, font: "Arial; background: red" }] },
        { "general.description": [{ ...run, size: "100px" }] }, { "general.description": [{ ...run, html: "<b>text</b>" }] },
        { "general.description": [{ ...run, style: "font-weight: bold" }] },
        { "custom.rules.description": Array.from({ length: 101 }, (_, index) => ({ start: index * 2, end: index * 2 + 1, bold: true })) },
        Object.fromEntries(Array.from({ length: 201 }, (_, index) => [`custom.item${index}.title`, []]))
    ];
    for (const textStyles of invalid) {
        const response = await request(env, `/api/manage/divisions/${division.id}`, {
            version: division.version, content: { ...division.content, textStyles }
        }, { cookie: admin, method: "PUT" });
        assert.equal(response.status, 400, JSON.stringify(textStyles));
    }
    division = await save(env, admin, division, { textStyles: { "general.description": [run], "custom.rules.description": [] } });
    assert.deepEqual(division.content.textStyles["general.description"], [run], "whole UTF-16 code points remain valid");
    const customSections = Array.from({ length: 11 }, (_, index) => ({ id: `rules${index}`, title: "Rules", description: "x".repeat(200) }));
    const styles = Object.fromEntries(customSections.map((section, index) => [`custom.${section.id}.description`,
        Array.from({ length: index === 10 ? 1 : 100 }, (_, offset) => ({ start: offset * 2, end: offset * 2 + 1, bold: true }))]));
    assert.equal((await request(env, `/api/manage/divisions/${division.id}`, {
        version: division.version, content: { ...division.content, customSections, textStyles: styles }
    }, { cookie: admin, method: "PUT" })).status, 400, "total formatting runs are bounded independently of the per-field limit");
});

test("editors can format only the text fields they are allowed to edit", async t => {
    const env = environment(t);
    const admin = await signIn(env);
    const editor = await signIn(env, 1001, "Editor");
    let division = await create(env, admin);
    await grant(env, admin, division.id, "1001", "editor");
    division = await save(env, admin, division, {
        description: "Play fair.",
        participation: { ...division.content.participation, description: "Roster rules" },
        campaigns: [{ id: "welcome", title: "Welcome", description: "Join the cup." }],
        referendums: [{ id: "format", title: "Next format?", description: "", status: "planned", options: ["Solo", "Teams"] }],
        customSections: [{ id: "rules", title: "Rules", description: "Play fair." }],
        textStyles: { "general.name": [{ color: "#95e1ff", end: 8, start: 0, bold: true }] }
    });
    const permitted = {
        "general.name": [{ start: 0, end: 8, bold: true, color: "#95e1ff" }],
        "general.description": [{ start: 0, end: 4, italic: true }],
        "campaigns.welcome.title": [{ start: 0, end: 7, font: "serif" }],
        "referendums.format.description": [],
        "custom.rules.description": [{ start: 0, end: 4, color: "#ffc09d" }]
    };
    division = await save(env, editor, division, { textStyles: permitted });
    assert.deepEqual(division.content.textStyles, permitted, "property order changes do not falsely alter restricted styling");
    const forbidden = [
        { ...permitted, "general.name": [{ start: 0, end: 8, color: "#ffffff" }] },
        { ...permitted, "general.summary": [{ start: 0, end: 4, italic: true }] },
        { ...permitted, "participation.description": [{ start: 0, end: 6, underline: true }] },
        Object.fromEntries(Object.entries(permitted).filter(([path]) => path !== "general.name"))
    ];
    for (const textStyles of forbidden) {
        assert.equal((await request(env, `/api/manage/divisions/${division.id}`, {
            version: division.version, content: { ...division.content, textStyles }
        }, { cookie: editor, method: "PUT" })).status, 403);
    }
    assert.equal((await request(env, `/api/manage/divisions/${division.id}/publish`, { version: division.version }, { cookie: editor })).status, 403);
});

test("banner appearance can change independently from the page background and remains private until published", async t => {
    const env = environment(t);
    const admin = await signIn(env);
    const editor = await signIn(env, 1001, "Editor");
    let division = await create(env, admin);
    await grant(env, admin, division.id, "1001", "editor");
    const first = { backgroundColor: "#152536", backgroundImage: "https://example.com/page.jpg", bannerColor: "#164c61", bannerImage: "https://example.com/banner.jpg" };
    division = await save(env, editor, division, { appearance: first });
    assert.deepEqual(division.content.appearance, first);
    division = await publish(env, admin, division);
    const next = { ...first, bannerColor: "#ffc09d", bannerImage: "" };
    division = await save(env, editor, division, { appearance: next });
    assert.deepEqual(division.content.appearance, next);
    assert.deepEqual((await (await request(env, `/api/divisions/${division.id}`)).json()).division.content.appearance, first);
    assert.deepEqual((await (await request(env, "/api/divisions")).json()).divisions[0].appearance, first);
    assert.deepEqual((await (await request(env, "/api/manage/divisions", undefined, { cookie: editor })).json()).divisions[0].appearance, next);
    for (const appearance of [
        { ...next, bannerColor: "red" }, { ...next, bannerColor: null }, { ...next, bannerImage: "http://example.com/a.jpg" },
        { ...next, bannerImage: "javascript:alert(1)" }, { ...next, bannerImage: "https://user:password@example.com/a.jpg" },
        { ...next, bannerImage: "https://example.com/a b.jpg" }, { ...next, bannerImage: "data:image/svg+xml,<svg></svg>" },
        { ...next, bannerStyle: "position: fixed" }
    ]) {
        assert.equal((await request(env, `/api/manage/divisions/${division.id}`, {
            version: division.version, content: { ...division.content, appearance }
        }, { cookie: editor, method: "PUT" })).status, 400);
    }
});
