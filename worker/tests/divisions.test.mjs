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
