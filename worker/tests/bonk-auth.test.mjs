import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import worker from "../index.js";

const origin = "https://bonk-football-division.com";
const schema = readFileSync(new URL("../migrations/0001_bonk_accounts.sql", import.meta.url), "utf8");

function environment(t) {
    const db = new DatabaseSync(":memory:");
    db.exec("PRAGMA foreign_keys=ON");
    db.exec(schema);
    t.after(() => db.close());
    const prepare = sql => ({
        bind(...values) {
            return {
                async first() {
                    return db.prepare(sql).get(...values) || null;
                },
                async run() {
                    return { meta: { changes: Number(db.prepare(sql).run(...values).changes) } };
                }
            };
        }
    });
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
    return worker.fetch(new Request((options.origin || origin) + path, {
        method: options.method || (body === undefined ? "GET" : "POST"),
        headers,
        ...(body === undefined ? {} : { body: typeof body === "string" ? body : JSON.stringify(body) })
    }), env);
}

function provider(t, value = { r: "success", id: 3177088, username: "Verified", token: "private-provider-token" }) {
    const original = globalThis.fetch;
    const calls = [];
    globalThis.fetch = async (url, options) => {
        calls.push({ url, options });
        assert.equal(url, "https://bonk2.io/scripts/login_legacy.php");
        assert.equal(options.redirect, "manual");
        assert.equal(options.headers["Content-Type"], "application/x-www-form-urlencoded; charset=UTF-8");
        assert.equal(options.headers.Origin, "https://bonk.io");
        assert.equal(options.headers.Referer, "https://bonk.io/");
        assert.equal(options.headers.Authorization, undefined);
        assert.equal(options.headers.Cookie, undefined);
        assert.equal(new URLSearchParams(options.body).get("remember"), "false");
        return typeof value === "function" ? value(url, options) : Response.json(value);
    };
    t.after(() => { globalThis.fetch = original; });
    return calls;
}

async function signIn(env, body = {}, options) {
    const response = await request(env, "/api/bonk/login", { username: "typed-name", password: "private-test-password", ...body }, options);
    assert.equal(response.status, 200, await response.clone().text());
    return {
        response,
        body: await response.json(),
        cookie: response.headers.get("Set-Cookie").split(";")[0]
    };
}

test("verified provider identity creates a hashed HttpOnly session, without trusting browser identity or storing secrets", async t => {
    const env = environment(t);
    const calls = provider(t);
    const login = await signIn(env, { bonkId: "1", username: "typed-name", role: "admin", token: "browser-forgery" });
    assert.deepEqual(login.body, { account: { bonkId: "3177088", username: "Verified", avatarCode: null } });
    assert.equal(calls.length, 1);
    assert.equal(login.response.headers.get("Cache-Control"), "no-store");
    const cookie = login.response.headers.get("Set-Cookie");
    assert.match(cookie, /^__Host-bfd_session=[a-f0-9]{64}; Path=\/; Secure; HttpOnly; SameSite=Lax; Max-Age=86400$/);
    const row = env.db.prepare("SELECT * FROM user_sessions").get();
    assert.equal(row.bonk_id, "3177088");
    assert.equal(row.token_hash.length, 64);
    assert.notEqual(row.token_hash, login.cookie.split("=")[1]);
    assert.ok(row.expires_at > Date.now() + 86300000);
    const dump = JSON.stringify({ users: env.db.prepare("SELECT * FROM bonk_users").all(), sessions: env.db.prepare("SELECT * FROM user_sessions").all() });
    assert.doesNotMatch(dump, /private-provider-token|private-test-password|browser-forgery/);
    assert.deepEqual(await (await request(env, "/api/account", undefined, { cookie: login.cookie })).json(), login.body);
});

test("wrong password and unknown username produce the same concise error without creating a session", async t => {
    const env = environment(t);
    let reason = "password";
    provider(t, () => Response.json({ r: "fail", e: reason, token: "secret", debug: "private provider diagnostic" }));
    for (reason of ["password", "username", "username_fail", "password_fail"]) {
        const response = await request(env, "/api/bonk/login", { username: "demo", password: "wrong" });
        assert.equal(response.status, 401);
        assert.deepEqual(await response.json(), { error: "Unable to sign in. Check your Bonk username and password." });
        assert.equal(response.headers.get("Set-Cookie"), null);
    }
    assert.equal(env.db.prepare("SELECT COUNT(*) AS n FROM user_sessions").get().n, 0);
});

test("password whitespace, Unicode and form-sensitive characters reach Bonk unchanged", async t => {
    const env = environment(t);
    const password = "  p+&=%?#é漢字  ";
    const calls = provider(t);
    await signIn(env, { username: " SIoppy ", password });
    const form = new URLSearchParams(calls[0].options.body);
    assert.equal(form.get("username"), "SIoppy");
    assert.equal(form.get("password"), password);
});

test("invalid Unicode encoding is rejected before sending modified credentials", async t => {
    const env = environment(t);
    const calls = provider(t);
    const response = await request(env, "/api/bonk/login", { username: "demo", password: "bad\uD800" });
    assert.equal(response.status, 400);
    assert.equal(calls.length, 0);
});

test("unverified or malformed provider responses fail closed and do not expose provider diagnostics", async t => {
    const env = environment(t);
    let value;
    provider(t, () => Response.json(value));
    const failures = [null, [], {}, { r: "success", id: 1, username: "Verified" },
        { r: "success", id: "-1", username: "Verified", token: "secret" },
        { r: "success", id: "9007199254740992", username: "Verified", token: "secret" },
        { r: "success", id: 1, username: " ", token: "secret" },
        { r: "fail", e: "private-upstream-reason" }, { r: "error", debug: "private details" }];
    for (value of failures) {
        const response = await request(env, "/api/bonk/login", { username: "demo", password: "test" });
        assert.equal(response.status, 502);
        assert.deepEqual(await response.json(), { error: "Bonk sign-in is temporarily unavailable. Please try again shortly." });
    }
    assert.equal(env.db.prepare("SELECT COUNT(*) AS n FROM user_sessions").get().n, 0);
});

test("network failures, redirects, oversized bodies and invalid JSON never establish a session", async t => {
    const env = environment(t);
    let produce;
    const calls = provider(t, () => produce());
    const cases = [
        () => { throw new Error("private network details"); },
        () => new Response(null, { status: 302, headers: { Location: "https://evil.test" } }),
        () => new Response(null, { status: 403 }),
        () => new Response("not JSON"),
        () => new Response("x".repeat(512001)),
        () => new Response(null, { status: 204 })
    ];
    for (produce of cases) {
        const response = await request(env, "/api/bonk/login", { username: "demo", password: "test" });
        assert.equal(response.status, 502);
        assert.doesNotMatch(await response.text(), /private|evil\.test|not JSON/);
    }
    assert.equal(calls.length, cases.length);
    assert.equal(env.db.prepare("SELECT COUNT(*) AS n FROM user_sessions").get().n, 0);
});

test("CSRF, insecure transport and non-JSON requests fail before provider authentication", async t => {
    const env = environment(t);
    const calls = provider(t);
    const body = { username: "demo", password: "test" };
    const cases = [
        [{ noOrigin: true }, 403],
        [{ headers: { Origin: "https://evil.test" } }, 403],
        [{ headers: { Origin: "https://bonk.io" } }, 403],
        [{ headers: { "Sec-Fetch-Site": "cross-site" } }, 403],
        [{ headers: { "Content-Type": "text/plain" } }, 415],
        [{ origin: "http://bonk-football-division.com", headers: { Origin: "http://bonk-football-division.com" } }, 400]
    ];
    for (const [options, status] of cases) {
        assert.equal((await request(env, "/api/bonk/login", body, options)).status, status);
    }
    assert.equal(calls.length, 0);
});

test("request bodies are bounded even without Content-Length", async t => {
    const env = environment(t);
    const calls = provider(t);
    assert.equal((await request(env, "/api/bonk/login", { username: "demo", password: "test" }, { headers: { "Content-Length": "8193" } })).status, 413);
    assert.equal((await request(env, "/api/bonk/login", JSON.stringify({ username: "demo", password: "x".repeat(9000) }))).status, 400);
    for (const body of ["[]", "null", "not-json", "{}", JSON.stringify({ username: "demo", password: "" })]) {
        assert.equal((await request(env, "/api/bonk/login", body)).status, 400);
    }
    assert.equal(calls.length, 0);
});

test("IP and per-username budgets block calls and missing bindings fail closed", async t => {
    const env = environment(t);
    const calls = provider(t, { r: "fail", e: "password" });
    for (let i = 0; i < 10; i++) {
        assert.equal((await request(env, "/api/bonk/login", { username: " Demo ", password: "test" })).status, 401);
    }
    const limited = await request(env, "/api/bonk/login", { username: "dEmO", password: "test" });
    assert.equal(limited.status, 429);
    assert.equal(limited.headers.get("Retry-After"), "600");
    assert.equal(calls.length, 10);
    env.LOGIN_RATE_LIMITER = { async limit() { return { success: false }; } };
    assert.equal((await request(env, "/api/bonk/login", { username: "other", password: "test" })).status, 429);
    env.API_RATE_LIMITER = { async limit() { return { success: false }; } };
    assert.equal((await request(env, "/api/account")).status, 429);
    delete env.API_RATE_LIMITER;
    assert.equal((await request(env, "/api/account")).status, 503);
    assert.equal(calls.length, 10);
});

test("sessions expire on the server, forged browser identities grant nothing, and account responses are never cached", async t => {
    const env = environment(t);
    provider(t);
    const { cookie } = await signIn(env);
    const forged = await request(env, "/api/account", undefined, { headers: { Authorization: "Bearer fake", "X-Account-Session": "fake", Cookie: "bonkId=3177088; admin=true" } });
    assert.deepEqual(await forged.json(), { account: null });
    env.db.prepare("UPDATE user_sessions SET expires_at=?").run(Date.now() - 1);
    const expired = await request(env, "/api/account", undefined, { cookie });
    assert.equal(expired.headers.get("Cache-Control"), "no-store");
    assert.deepEqual(await expired.json(), { account: null });
});

test("successful re-login replaces the current browser session and logout revokes the replacement", async t => {
    const env = environment(t);
    provider(t);
    const first = await signIn(env);
    const second = await signIn(env, {}, { cookie: first.cookie });
    assert.notEqual(first.cookie, second.cookie);
    assert.deepEqual(await (await request(env, "/api/account", undefined, { cookie: first.cookie })).json(), { account: null });
    const logout = await request(env, "/api/bonk/logout", {}, { cookie: second.cookie });
    assert.equal(logout.status, 200);
    assert.match(logout.headers.get("Set-Cookie"), /__Host-bfd_session=;.*Max-Age=0/);
    assert.deepEqual(await (await request(env, "/api/account", undefined, { cookie: second.cookie })).json(), { account: null });
    assert.equal(env.db.prepare("SELECT COUNT(*) AS n FROM user_sessions").get().n, 0);
});

test("only the verified active avatar is retained, and invalid skin data falls back cleanly", async t => {
    const env = environment(t);
    let slot = 3;
    provider(t, () => Response.json({ r: "success", id: 1, username: "Verified", token: "secret", activeAvatarNumber: slot, avatar1: "first", avatar3: "third" }));
    assert.equal((await signIn(env, { avatarCode: "forged" })).body.account.avatarCode, "third");
    slot = 0;
    assert.equal((await signIn(env)).body.account.avatarCode, "first");
    slot = 8;
    assert.equal((await signIn(env)).body.account.avatarCode, null);
});

test("provider throttling stays a friendly retry response", async t => {
    const env = environment(t);
    provider(t, () => new Response(null, { status: 429 }));
    const response = await request(env, "/api/bonk/login", { username: "demo", password: "test" });
    assert.equal(response.status, 429);
    assert.deepEqual(await response.json(), { error: "Too many sign-in attempts. Please wait a moment and try again." });
});

test("unknown API paths remain JSON 404, wrong methods are rejected and static files use ASSETS", async t => {
    const env = environment(t);
    const missing = await request(env, "/api/private");
    assert.equal(missing.status, 404);
    assert.equal(missing.headers.get("Cache-Control"), "no-store");
    const wrongMethod = await request(env, "/api/bonk/login");
    assert.equal(wrongMethod.status, 405);
    assert.equal(wrongMethod.headers.get("Allow"), "POST");
    assert.equal(await (await request(env, "/css/main.css")).text(), "public asset");
});

test("daily cleanup removes only expired sessions and stale hashed attempt counters", async t => {
    const env = environment(t);
    provider(t);
    await signIn(env);
    env.db.prepare("INSERT INTO user_sessions VALUES (?, ?, ?)").run("expired", "3177088", Date.now() - 1);
    env.db.prepare("INSERT INTO bonk_login_attempts VALUES (?, ?, ?)").run("stale", Math.floor(Date.now() / 600000) - 145, 10);
    await worker.scheduled({}, env);
    assert.equal(env.db.prepare("SELECT COUNT(*) AS n FROM user_sessions").get().n, 1);
    assert.equal(env.db.prepare("SELECT COUNT(*) AS n FROM bonk_login_attempts").get().n, 1);
});
