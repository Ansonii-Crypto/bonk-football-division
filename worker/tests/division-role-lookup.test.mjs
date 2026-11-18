import assert from "node:assert/strict";
import { createHash } from "node:crypto";
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

function user(env, id, username, tokenLetter) {
    env.db.prepare("INSERT INTO bonk_users(bonk_id, username, updated_at) VALUES (?, ?, ?)").run(String(id), username, Date.now());
    if (!tokenLetter) return undefined;
    const token = tokenLetter.repeat(64);
    env.db.prepare("INSERT INTO user_sessions(token_hash, bonk_id, expires_at) VALUES (?, ?, ?)")
        .run(createHash("sha256").update(token).digest("hex"), String(id), Date.now() + 60000);
    return `__Host-bfd_session=${token}`;
}

function request(env, path, body, cookie, method = body === undefined ? "GET" : "POST") {
    return worker.fetch(new Request(origin + path, { method,
        headers: { Origin: origin, "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }) }), env);
}

async function division(env, cookie, name = "Role lookup cup") {
    const response = await request(env, "/api/admin/divisions", { name }, cookie);
    assert.equal(response.status, 201, await response.clone().text());
    return (await response.json()).division;
}

const assign = (env, id, cookie, fields, role = "editor") => request(env, `/api/manage/divisions/${id}/members`, { ...fields, role }, cookie);
const membership = (env, divisionId, id) => env.db.prepare("SELECT role FROM division_members WHERE division_id = ? AND bonk_id = ?").get(divisionId, String(id))?.role;

test("management roles accept a verified username, explicit player ID, or matching name and ID", async t => {
    const env = environment(t);
    const admin = user(env, 3177088, "Administrator", "a");
    user(env, 1001, "ExactPlayer");
    user(env, 1002, " spaced name ");
    user(env, 1003, "1001");
    const event = await division(env, admin);
    assert.equal((await assign(env, event.id, admin, { username: "eXACTpLAYER" })).status, 200);
    assert.equal(membership(env, event.id, 1001), "editor");
    assert.equal((await assign(env, event.id, admin, { bonkId: "1001", username: "EXACTPLAYER" }, "organizer")).status, 200);
    assert.equal(membership(env, event.id, 1001), "organizer");
    const mismatch = await assign(env, event.id, admin, { bonkId: "1001", username: "OtherPlayer" });
    assert.equal(mismatch.status, 400);
    assert.match((await mismatch.json()).error, /do not match/i);
    assert.equal(membership(env, event.id, 1001), "organizer");
    assert.equal((await assign(env, event.id, admin, { username: " spaced NAME " })).status, 200);
    assert.equal((await assign(env, event.id, admin, { username: "spaced name" })).status, 400, "significant username spaces are never stripped");
    assert.equal((await assign(env, event.id, admin, { username: "1001" })).status, 200, "an explicit numeric username is a name");
    assert.equal(membership(env, event.id, 1003), "editor");
    assert.equal((await assign(env, event.id, admin, { bonkId: 1002 }, "organizer")).status, 200, "the original ID-only request remains supported");
    assert.equal((await request(env, `/api/manage/divisions/${event.id}/members/1002`, undefined, admin, "DELETE")).status, 200);
    assert.equal(membership(env, event.id, 1002), undefined);
});

test("ambiguous names and numeric account selectors never grant a role to an arbitrary match", async t => {
    const env = environment(t);
    const admin = user(env, 3177088, "Administrator", "a");
    user(env, 1001, "CaseName");
    user(env, 1002, "casename");
    user(env, 1003, "1001");
    const event = await division(env, admin);
    const ambiguous = await assign(env, event.id, admin, { username: "CaseName" });
    assert.equal(ambiguous.status, 409);
    assert.match((await ambiguous.json()).error, /player ID/i);
    assert.equal(env.db.prepare("SELECT COUNT(*) AS count FROM division_members").get().count, 0);
    assert.equal((await assign(env, event.id, admin, { account: "1001" })).status, 409);
    assert.equal((await assign(env, event.id, admin, { bonkId: "1001", username: "CASENAME" })).status, 200,
        "a supplied ID disambiguates a matching name");
    assert.equal(membership(env, event.id, 1001), "editor");
    assert.equal(membership(env, event.id, 1002), undefined);
    assert.equal(membership(env, event.id, 1003), undefined);
    assert.equal((await assign(env, event.id, admin, { account: "1002" })).status, 200, "a single unambiguous account ID can be resolved");
    assert.equal((await assign(env, event.id, admin, { account: "1001", username: "CaseName" })).status, 400,
        "conflicting selector formats are rejected");
});

test("username lookup uses literal equality and requires a previously verified account", async t => {
    const env = environment(t);
    const admin = user(env, 3177088, "Administrator", "a");
    const unusualName = "50%_O'Brien ' OR 1=1 --";
    user(env, 1001, unusualName);
    user(env, 1002, "OrdinaryPlayer");
    const event = await division(env, admin);
    assert.equal((await assign(env, event.id, admin, { username: unusualName })).status, 200);
    assert.equal(membership(env, event.id, 1001), "editor");
    for (const fields of [{ username: "%" }, { username: "Ordinary" }, { username: "NeverSignedIn" }, { bonkId: "999999" }]) {
        const response = await assign(env, event.id, admin, fields);
        assert.equal(response.status, 400);
        assert.match((await response.json()).error, /must sign in/i);
    }
    assert.equal(membership(env, event.id, 1002), undefined);
    assert.equal(env.db.prepare("SELECT COUNT(*) AS count FROM bonk_users").get().count, 3, "lookup never creates an unverified account");
    for (const fields of [{}, { username: "   " }, { username: [] }, { account: 1001 }, { bonkId: "0" }, { bonkId: "1001", username: {} }]) {
        assert.equal((await assign(env, event.id, admin, fields)).status, 400);
    }
});

test("name-based grants keep authenticated division scoping and director restrictions", async t => {
    const env = environment(t);
    const admin = user(env, 3177088, "Administrator", "a");
    const director = user(env, 1001, "Director", "b");
    const regular = user(env, 1002, "Regular", "c");
    user(env, 1003, "Target");
    const event = await division(env, admin);
    const otherEvent = await division(env, admin, "Other division");
    assert.equal((await assign(env, event.id, admin, { username: "Director" }, "director")).status, 200);
    assert.equal((await assign(env, event.id, undefined, { username: "Target", isAdmin: true })).status, 401);
    assert.equal((await assign(env, event.id, regular, { username: "Target", isAdmin: true, actorBonkId: "3177088" })).status, 403);
    assert.equal((await assign(env, otherEvent.id, director, { username: "Target" })).status, 403);
    assert.equal((await assign(env, event.id, director, { username: "Target" }, "organizer")).status, 200);
    assert.equal((await assign(env, event.id, director, { username: "Target" }, "director")).status, 403);
    assert.equal((await assign(env, event.id, admin, { username: "Target" }, "director")).status, 200);
    assert.equal((await assign(env, event.id, director, { username: "Target" }, "editor")).status, 403);
    assert.equal(membership(env, event.id, 1003), "director");
    assert.equal((await request(env, `/api/manage/divisions/${event.id}/members/1003`, undefined, director, "DELETE")).status, 403);
    assert.equal((await assign(env, event.id, admin, { username: "Target" }, "site-admin")).status, 403);
});
