import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import worker from "../index.js";

const origin = "https://bonk-football-division.com";
const migrations = ["0001_bonk_accounts.sql", "0002_assessments.sql"];

function environment(t) {
    const db = new DatabaseSync(":memory:");
    db.exec("PRAGMA foreign_keys=ON");
    for (const name of migrations) {
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
        ASSETS: { async fetch() { return new Response("public asset"); } }
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

async function signIn(t, env, bonkId = 3177088, username = "Assessor") {
    const prior = globalThis.fetch;
    globalThis.fetch = async () => Response.json({ r: "success", id: bonkId, username, token: "upstream-token" });
    try {
        const response = await request(env, "/api/bonk/login", { username, password: "private-test-password" });
        assert.equal(response.status, 200, await response.clone().text());
        return { account: (await response.json()).account, cookie: response.headers.get("Set-Cookie").split(";")[0] };
    } finally {
        globalThis.fetch = prior;
    }
}

function sample(name = "Aster", values = [257, 257, 257, 257, 257, 257]) {
    return { playerName: name, playerBonkId: "71234", className: "Weaver", date: "2026-11-10", values, notes: "Good control." };
}

async function create(env, cookie, body = sample()) {
    const response = await request(env, "/api/admin/assessments", body, { cookie });
    assert.equal(response.status, 201, await response.clone().text());
    return (await response.json()).assessment;
}

test("only the Bonk-verified primary identity can manage assessments", async t => {
    const env = environment(t);
    const primary = await signIn(t, env);
    const other = await signIn(t, env, 555555, "Another player");
    assert.equal(primary.account.isAdmin, true);
    assert.equal(other.account.isAdmin, false);
    assert.equal((await request(env, "/api/admin/assessments")).status, 401);
    assert.equal((await request(env, "/api/admin/assessments", sample(), { cookie: other.cookie })).status, 403);
    assert.equal((await request(env, "/api/admin/assessments", sample(), { cookie: "__Host-bfd_session=3177088" })).status, 401);
    assert.equal((await request(env, "/api/assessments", sample())).status, 405);
    const created = await create(env, primary.cookie, { ...sample(), isAdmin: true, tier: "F", total: 0, createdByBonkId: "999" });
    assert.equal(created.tier, "S");
    assert.equal(created.total, 1542);
    assert.equal(created.createdByBonkId, "3177088");
    assert.equal(created.createdByName, "Assessor");
    const publicRow = (await (await request(env, "/api/assessments")).json()).assessments[0];
    assert.equal(publicRow.name, "Aster");
    assert.equal(publicRow.assessorName, "Assessor");
    assert.equal(publicRow.createdByBonkId, undefined);
    assert.equal(publicRow.playerBonkId, undefined);
});

test("create and edit validate scores, dates, class and stale versions", async t => {
    const env = environment(t);
    const { cookie } = await signIn(t, env);
    for (const bad of [
        { ...sample(), values: [300, 300, 300, 300, 300, 301] },
        { ...sample(), values: [300, 300, 300, 300, 300, "300"] },
        { ...sample(), date: "2026-02-30" },
        { ...sample(), className: "Unknown" },
        { ...sample(), playerBonkId: "-3" }
    ]) {
        assert.equal((await request(env, "/api/admin/assessments", bad, { cookie })).status, 400);
    }
    for (const [score, tier] of [[42, "F"], [43, "E"], [86, "D"], [129, "C"], [172, "B"], [215, "A"], [257, "S"]]) {
        assert.equal((await create(env, cookie, sample(`Score ${score}`, Array(6).fill(score)))).tier, tier);
    }
    const first = await create(env, cookie);
    assert.equal(first.version, 1);
    const changed = await request(env, `/api/admin/assessments/${first.id}`, {
        ...sample("Aster", [256, 256, 256, 256, 256, 256]), version: 1, tier: "S"
    }, { cookie, method: "PUT" });
    assert.equal(changed.status, 200, await changed.clone().text());
    const edited = (await changed.json()).assessment;
    assert.equal(edited.tier, "A");
    assert.equal(edited.total, 1536);
    assert.equal(edited.version, 2);
    const stale = await request(env, `/api/admin/assessments/${first.id}`, { ...sample(), version: 1 }, { cookie, method: "PUT" });
    assert.equal(stale.status, 409);
    assert.equal((await (await request(env, `/api/admin/assessments/${first.id}`, undefined, { cookie })).json()).assessment.version, 2);
});

test("public lists are paged and filtered; indexes describe all available assessments", async t => {
    const env = environment(t);
    const { cookie } = await signIn(t, env);
    const aster = await create(env, cookie, sample("Aster"));
    await create(env, cookie, sample("#Ball", [0, 0, 0, 0, 0, 0]));
    await create(env, cookie, sample("Zed", [215, 215, 215, 215, 215, 215]));
    const listing = await request(env, "/api/assessments?sort=ascending&limit=2&page=2");
    assert.equal(listing.status, 200);
    const second = await listing.json();
    assert.equal(second.total, 3);
    assert.equal(second.pages, 2);
    assert.equal(second.assessments.length, 1);
    assert.equal(second.assessments[0].name, "Aster");
    assert.deepEqual(second.availableTiers, ["S", "A", "F"]);
    assert.deepEqual(second.availableInitials, ["#", "A", "Z"]);
    const filtered = await (await request(env, "/api/assessments?tiers=S&initials=A&q=ast")).json();
    assert.equal(filtered.total, 1);
    assert.equal(filtered.assessments[0].id, aster.id);
    const idSearch = await (await request(env, "/api/admin/assessments?q=71234", undefined, { cookie })).json();
    assert.equal(idSearch.total, 3);
    assert.equal((await (await request(env, "/api/assessments?q=71234")).json()).total, 0);
    assert.equal((await request(env, `/api/assessments?q=${"x".repeat(150)}`)).status, 200);
    const detail = await (await request(env, `/api/assessments/${aster.id}`)).json();
    assert.equal(detail.assessment.name, "Aster");
    assert.equal(detail.assessment.createdByBonkId, undefined);
    assert.equal((await request(env, "/api/assessments?initials=1")).status, 400);
    assert.equal((await request(env, "/api/assessments/999")).status, 404);
});

test("writes require same origin, JSON and a bounded body", async t => {
    const env = environment(t);
    const { cookie } = await signIn(t, env);
    assert.equal((await request(env, "/api/admin/assessments", sample(), { cookie, noOrigin: true })).status, 403);
    assert.equal((await request(env, "/api/admin/assessments", sample(), { cookie, headers: { Origin: "https://evil.test" } })).status, 403);
    assert.equal((await request(env, "/api/admin/assessments", sample(), { cookie, headers: { "Content-Type": "text/plain" } })).status, 415);
    assert.equal((await request(env, "/api/admin/assessments", sample(), { cookie, headers: { "Content-Length": "8193" } })).status, 413);
});
