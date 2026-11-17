import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { JSDOM } from "jsdom";
import { handlePreviewRequest } from "../previews.js";

const origin = "https://bonk-football-division.com";
const html = `<!doctype html><html><head><meta charset="utf-8"><title>Old title</title>
    <meta name="description" content="old description"><meta property="og:title" content="Old OG">
    <meta name="twitter:card" content="summary"><link rel="canonical" href="https://old.example/">
    <link rel="stylesheet" href="./css/main.css"><script src="../javascript/main.js" defer></script></head>
    <body><main id="app"></main></body></html>`;

function environment(t) {
    const db = new DatabaseSync(":memory:");
    db.exec("PRAGMA foreign_keys=ON");
    for (const name of ["0001_bonk_accounts.sql", "0002_assessments.sql", "0003_divisions.sql"]) {
        db.exec(readFileSync(new URL(`../migrations/${name}`, import.meta.url), "utf8"));
    }
    db.exec("INSERT INTO bonk_users(bonk_id, username, updated_at) VALUES ('3177088', 'PrivateAdmin', 1)");
    t.after(() => db.close());
    const queries = [];
    const assets = [];
    return { db, queries, assets,
        DB: { prepare(sql) {
            queries.push(sql);
            return { bind(...values) { return { async first() { return db.prepare(sql).get(...values) || null; } }; } };
        } },
        ASSETS: { async fetch(request) {
            assets.push(request);
            return new Response(html, { headers: { "Content-Type": "text/html", "ETag": "old-etag", "Set-Cookie": "stale=1", "Last-Modified": "old-date" } });
        } }
    };
}

const request = (env, path, method = "GET", headers = {}) => handlePreviewRequest(new Request(origin + path, { method, headers }), env);
const documentFor = html => new JSDOM(html).window.document;
const meta = (document, property) => document.querySelector(`meta[property="${property}"], meta[name="${property}"]`)?.content;

test("public page previews are available in the initial HTML and use page-specific social images", async t => {
    const env = environment(t);
    for (const [path, title, image] of [["/", "Bonk Football Division", "preview"], ["/assessments?tiers=S", "Assessments | Bonk Football Division", "assessments"],
        ["/classes", "Classes | Bonk Football Division", "classes"], ["/divisions", "Divisions | Bonk Football Division", "divisions"],
        ["/classes/renegade", "Renegade | Classes | Bonk Football Division", "classes"]]) {
        const response = await request(env, path);
        assert.equal(response.status, 200);
        const document = documentFor(await response.text());
        assert.equal(document.title, title);
        assert.equal(meta(document, "og:title"), title);
        assert.equal(document.querySelectorAll('meta[property="og:title"]').length, 1);
        assert.equal(document.querySelectorAll('meta[name="description"]').length, 1);
        assert.equal(document.querySelectorAll('link[rel="canonical"]').length, 1);
        assert.equal(meta(document, "og:image"), `${origin}/assets/social/${image}.png`);
        assert.equal(meta(document, "og:image:width"), "1200");
        assert.equal(meta(document, "og:image:height"), "630");
        assert.equal(meta(document, "twitter:card"), "summary_large_image");
        assert.match(response.headers.get("Cache-Control"), /^public,/);
        assert.equal(response.headers.get("ETag"), null);
        assert.equal(response.headers.get("Set-Cookie"), null);
        assert.equal(document.querySelector('link[rel="stylesheet"]').getAttribute("href"), "/css/main.css");
        assert.equal(document.querySelector("script").getAttribute("src"), "/javascript/main.js");
        assert.equal(document.querySelectorAll("#app").length, 1);
    }
    assert.equal(env.queries.length, 0);
    assert.ok(env.assets.every(asset => new URL(asset.url).pathname === "/" && asset.method === "GET"));
    const head = await request(env, "/classes", "HEAD");
    assert.equal(head.status, 200);
    assert.equal(await head.text(), "");
    assert.equal(head.headers.get("Content-Type"), "text/html; charset=utf-8");
});

test("assessment previews use public details, safely escape names and ignore query strings in the canonical URL", async t => {
    const env = environment(t);
    const name = 'Aster & "friends" <img src=x onerror=alert(1)>';
    env.db.prepare(`INSERT INTO assessments(player_name, player_bonk_id, class_name, assessment_date, notes,
        control, execution, defending, reaction_time, chemistry, game_sense, total, tier, created_at, updated_at,
        created_by_bonk_id, created_by_name, updated_by_bonk_id, updated_by_name)
        VALUES (?, 'private-player-id', 'Weaver', '2026-11-14', 'PRIVATE NOTES', 280, 280, 280, 280, 280, 280, 1680, 'S', 1, 1, '3177088', 'PrivateAdmin', '3177088', 'PrivateAdmin')`)
        .run(name);
    const response = await request(env, "/assessments/1?username=DO_NOT_REFLECT", "GET", { Cookie: "__Host-bfd_session=private" });
    const text = await response.text();
    const document = documentFor(text);
    assert.equal(meta(document, "og:title"), `${name} — S Tier | Bonk Football Division`);
    assert.equal(meta(document, "og:url"), `${origin}/assessments/1`);
    assert.equal(document.querySelector('link[rel="canonical"]').href, `${origin}/assessments/1`);
    assert.match(meta(document, "og:description"), /1680 \/ 1800 points · Weaver · Assessed 14 November 2026/);
    assert.equal(document.querySelector("img"), null);
    assert.equal(document.querySelectorAll("script").length, 1);
    for (const privateValue of ["private-player-id", "PRIVATE NOTES", "PrivateAdmin", "DO_NOT_REFLECT"]) assert.equal(text.includes(privateValue), false);
    assert.ok(env.queries.every(sql => !/\bSELECT\s+\*|notes|bonk_id|sessions/i.test(sql)));
    assert.ok(env.assets.every(asset => !asset.headers.has("Cookie")));
});

test("division previews read the published snapshot even for managers and never expose private or withdrawn drafts", async t => {
    const env = environment(t);
    const draft = JSON.stringify({ name: "PRIVATE NAME", summary: "PRIVATE SUMMARY", teams: [{ bonkId: "private-id" }] });
    const published = JSON.stringify({ name: 'Public "Cup" & friends', summary: "Published football fixtures.", status: "registration", startDate: "2026-11-21" });
    env.db.prepare(`INSERT INTO divisions(draft_json, published_json, created_at, updated_at, created_by_bonk_id)
        VALUES (?, ?, 1, 1, '3177088')`).run(draft, published);
    env.db.prepare(`INSERT INTO divisions(draft_json, created_at, updated_at, created_by_bonk_id)
        VALUES (?, 1, 1, '3177088')`).run(draft);
    const response = await request(env, "/divisions/1", "GET", { Cookie: "__Host-bfd_session=private" });
    const text = await response.text();
    const document = documentFor(text);
    assert.equal(meta(document, "og:title"), 'Public "Cup" & friends | Bonk Football Division');
    assert.match(meta(document, "og:description"), /Published football fixtures\. · Registration open · 21 November 2026/);
    assert.equal(meta(document, "og:image"), `${origin}/assets/social/divisions.png`);
    assert.equal(text.includes("PRIVATE"), false);
    assert.equal(text.includes("private-id"), false);
    const privateResponse = await request(env, "/divisions/2");
    assert.equal(privateResponse.status, 404);
    assert.equal((await privateResponse.text()).includes("PRIVATE"), false);
    env.db.exec("UPDATE divisions SET published_json = NULL WHERE id = 1");
    const withdrawn = await request(env, "/divisions/1");
    assert.equal(withdrawn.status, 404);
    assert.equal((await withdrawn.text()).includes("Public &quot;Cup&quot;"), false);
    assert.ok(env.queries.every(sql => /SELECT published_json FROM divisions/.test(sql) && !/draft_json/.test(sql)));
});

test("account and management links have generic private previews, while invalid and unavailable items fail safely", async t => {
    const env = environment(t);
    for (const path of ["/account", "/profile", "/admin"]) {
        const response = await request(env, path, "GET", { Cookie: "private-cookie" });
        assert.equal(response.status, 200);
        assert.equal(response.headers.get("Cache-Control"), "no-store");
        assert.equal(response.headers.get("X-Robots-Tag"), "noindex, nofollow");
        assert.equal((await response.text()).includes("private-cookie"), false);
    }
    assert.equal(env.queries.length, 0);
    for (const path of ["/divisions/not-an-id", "/assessments/9007199254740992", "/classes/__proto__"]) {
        const response = await request(env, path);
        assert.equal(response.status, 404);
    }
    assert.equal(env.queries.length, 0);
    const missing = await request(env, "/assessments/999");
    assert.equal(missing.status, 404);
    env.DB.prepare = () => { throw new Error("PRIVATE DATABASE DIAGNOSTIC"); };
    const unavailable = await request(env, "/divisions/1");
    assert.equal(unavailable.status, 503);
    assert.equal(unavailable.headers.get("Cache-Control"), "no-store");
    assert.equal((await unavailable.text()).includes("PRIVATE DATABASE DIAGNOSTIC"), false);
});

test("deep-link preview throttling fails safely without a database read or account session", async t => {
    const env = environment(t);
    const keys = [];
    env.API_RATE_LIMITER = { async limit({ key }) { keys.push(key); return { success: false }; } };
    const response = await request(env, "/divisions/1", "GET", { "CF-Connecting-IP": "192.0.2.1", Cookie: "private-cookie" });
    assert.equal(response.status, 429);
    assert.equal(response.headers.get("Retry-After"), "60");
    assert.equal(response.headers.get("Cache-Control"), "no-store");
    assert.deepEqual(keys, ["preview:192.0.2.1"]);
    assert.equal(env.queries.length, 0);
    assert.equal((await response.text()).includes("private-cookie"), false);
    env.API_RATE_LIMITER.limit = async () => { throw new Error("PRIVATE RATE LIMIT DIAGNOSTIC"); };
    const unavailable = await request(env, "/assessments/1");
    assert.equal(unavailable.status, 503);
    assert.equal((await unavailable.text()).includes("PRIVATE RATE LIMIT DIAGNOSTIC"), false);
    assert.equal(env.queries.length, 0);
});

test("assets, APIs and unsupported methods pass through, and non-HTML assets keep their fallback response", async t => {
    const env = environment(t);
    for (const path of ["/javascript/main.js", "/assets/social/preview.png", "/api/assessments", "/unknown"]) assert.equal(await request(env, path), null);
    assert.equal(await request(env, "/classes", "POST"), null);
    assert.equal(env.assets.length, 0);
    env.ASSETS.fetch = async () => new Response("static fallback", { headers: { "Content-Type": "text/plain" } });
    assert.equal(await (await request(env, "/")).text(), "static fallback");
    assert.equal(await (await request(env, "/", "HEAD")).text(), "");
});
