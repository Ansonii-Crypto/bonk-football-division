import { handleAssessmentRequest } from "./assessments.js";

const SESSION_COOKIE = "__Host-bfd_session";
const SESSION_SECONDS = 24 * 60 * 60;
const MAX_REQUEST_BYTES = 8192;
const MAX_PROVIDER_BYTES = 512000;
const PROVIDER_URL = "https://bonk2.io/scripts/login_legacy.php";
const UNAVAILABLE = "Bonk sign-in is temporarily unavailable. Please try again shortly.";
const PRIMARY_ADMIN_BONK_ID = "3177088";

function json(data, status = 200, extraHeaders = {}) {
    return new Response(JSON.stringify(data), {
        status,
        headers: {
            "Content-Type": "application/json; charset=utf-8",
            "Cache-Control": "no-store",
            "X-Content-Type-Options": "nosniff",
            ...extraHeaders
        }
    });
}

function sessionCookie(token, age = SESSION_SECONDS) {
    return `${SESSION_COOKIE}=${token}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${age}`;
}

function sessionToken(request) {
    return request.headers.get("Cookie")?.match(/(?:^|;\s*)__Host-bfd_session=([a-f0-9]{64})(?:;|$)/)?.[1] || null;
}

async function digest(value) {
    const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
    return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, "0")).join("");
}

function randomToken() {
    return Array.from(crypto.getRandomValues(new Uint8Array(32)), byte => byte.toString(16).padStart(2, "0")).join("");
}

function positiveBonkId(value) {
    const text = String(value ?? "");
    return /^[1-9][0-9]{0,15}$/.test(text) && Number.isSafeInteger(Number(text)) ? text : null;
}

async function readBoundedBody(body, maximum) {
    const reader = body?.getReader();
    if (!reader) {
        return null;
    }
    const chunks = [];
    let size = 0;
    try {
        for (;;) {
            const { done, value } = await reader.read();
            if (done) {
                break;
            }
            size += value.byteLength;
            if (size > maximum) {
                await reader.cancel();
                return null;
            }
            chunks.push(value);
        }
    } finally {
        reader.releaseLock();
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
    }
    return new TextDecoder().decode(bytes);
}

async function readJson(request) {
    const text = await readBoundedBody(request.body, MAX_REQUEST_BYTES);
    if (text === null) {
        return null;
    }
    try {
        const value = JSON.parse(text);
        return value && typeof value === "object" && !Array.isArray(value) ? value : null;
    } catch {
        return null;
    }
}

async function authenticateWithBonk(username, password) {
    // Preserve the password exactly. The legacy provider accepts form-encoded
    // credentials, not a hash or a trimmed/normalised password.
    const form = new URLSearchParams({ username, password, remember: "false" }).toString();
    const decoded = new URLSearchParams(form);
    if (decoded.get("username") !== username || decoded.get("password") !== password) {
        return { error: "Please re-enter your Bonk username and password.", status: 400 };
    }
    const unavailable = { error: UNAVAILABLE, status: 502 };
    let response;
    try {
        response = await fetch(PROVIDER_URL, {
            method: "POST",
            redirect: "manual",
            signal: AbortSignal.timeout(20000),
            headers: {
                "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
                Accept: "application/json",
                Origin: "https://bonk.io",
                Referer: "https://bonk.io/"
            },
            body: form
        });
        if (!response.ok) {
            return response.status === 429
                ? { error: "Too many sign-in attempts. Please wait a moment and try again.", status: 429 }
                : unavailable;
        }
        const text = await readBoundedBody(response.body, MAX_PROVIDER_BYTES);
        if (text === null) {
            return unavailable;
        }
        const data = JSON.parse(text);
        if (!data || typeof data !== "object" || Array.isArray(data) || typeof data.r !== "string") {
            return unavailable;
        }
        if (data.r !== "success") {
            return data.r === "fail" && ["username", "password", "username_fail", "password_fail"].includes(data.e)
                ? { error: "Unable to sign in. Check your Bonk username and password.", status: 401 }
                : unavailable;
        }
        const bonkId = positiveBonkId(data.id);
        if (!bonkId || typeof data.token !== "string" || !data.token.trim()
            || typeof data.username !== "string" || !data.username.trim() || data.username.length > 100) {
            return unavailable;
        }
        const selected = Number(data.activeAvatarNumber ?? data.activeavatarnumber);
        const slot = selected === 0 ? 1 : selected;
        const code = Number.isInteger(slot) && slot >= 1 && slot <= 5 ? data[`avatar${slot}`] : null;
        const avatarCode = typeof code === "string" && code.length > 0 && code.length <= 20000 ? code : null;
        // The upstream token is deliberately discarded. It is never a site session.
        return { account: { bonkId, username: data.username, avatarCode } };
    } catch {
        return unavailable;
    }
}

async function getAccount(request, env) {
    const token = sessionToken(request);
    if (!token) {
        return null;
    }
    const row = await env.DB.prepare(`
        SELECT u.bonk_id, u.username, u.avatar_code
        FROM user_sessions s JOIN bonk_users u ON u.bonk_id = s.bonk_id
        WHERE s.token_hash = ? AND s.expires_at > ?
    `).bind(await digest(token), Date.now()).first();
    return row ? { bonkId: row.bonk_id, username: row.username, avatarCode: row.avatar_code,
        isAdmin: row.bonk_id === PRIMARY_ADMIN_BONK_ID } : null;
}

async function login(request, env) {
    const body = await readJson(request);
    if (!body || typeof body.username !== "string" || !body.username.trim() || body.username.length > 100
        || typeof body.password !== "string" || !body.password || body.password.length > 1024) {
        return json({ error: "Enter your Bonk username and password." }, 400);
    }
    const timestamp = Date.now();
    const identityHash = await digest(body.username.trim().toLowerCase());
    const attempt = await env.DB.prepare(`
        INSERT INTO bonk_login_attempts(identity_hash, window, attempts) VALUES (?, ?, 1)
        ON CONFLICT(identity_hash) DO UPDATE SET window = excluded.window,
            attempts = CASE WHEN bonk_login_attempts.window = excluded.window
                THEN bonk_login_attempts.attempts + 1 ELSE 1 END
        RETURNING attempts
    `).bind(identityHash, Math.floor(timestamp / 600000)).first();
    if (attempt.attempts > 10) {
        return json({ error: "Too many sign-in attempts. Try again in ten minutes." }, 429, { "Retry-After": "600" });
    }
    const verified = await authenticateWithBonk(body.username.trim(), body.password);
    body.password = "";
    if (verified.error) {
        return json({ error: verified.error }, verified.status);
    }
    const { account } = verified;
    account.isAdmin = account.bonkId === PRIMARY_ADMIN_BONK_ID;
    const token = randomToken();
    const previous = sessionToken(request);
    const statements = [
        env.DB.prepare(`
            INSERT INTO bonk_users(bonk_id, username, avatar_code, updated_at) VALUES (?, ?, ?, ?)
            ON CONFLICT(bonk_id) DO UPDATE SET username = excluded.username,
                avatar_code = excluded.avatar_code, updated_at = excluded.updated_at
        `).bind(account.bonkId, account.username, account.avatarCode, timestamp),
        env.DB.prepare("INSERT INTO user_sessions(token_hash, bonk_id, expires_at) VALUES (?, ?, ?)")
            .bind(await digest(token), account.bonkId, timestamp + SESSION_SECONDS * 1000),
        env.DB.prepare("DELETE FROM user_sessions WHERE expires_at <= ?").bind(timestamp),
        env.DB.prepare("DELETE FROM bonk_login_attempts WHERE window < ?").bind(Math.floor(timestamp / 600000) - 144)
    ];
    if (previous) {
        statements.push(env.DB.prepare("DELETE FROM user_sessions WHERE token_hash = ?").bind(await digest(previous)));
    }
    await env.DB.batch(statements);
    return json({ account }, 200, { "Set-Cookie": sessionCookie(token) });
}

async function logout(request, env) {
    if (!await readJson(request)) {
        return json({ error: "Send a valid JSON request." }, 400);
    }
    const token = sessionToken(request);
    if (token) {
        await env.DB.prepare("DELETE FROM user_sessions WHERE token_hash = ?").bind(await digest(token)).run();
    }
    return json({ ok: true }, 200, { "Set-Cookie": sessionCookie("", 0) });
}

async function api(request, env, url) {
    const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if (url.protocol !== "https:" && !local) {
        return json({ error: "Please use HTTPS to sign in." }, 400);
    }
    const origin = request.headers.get("Origin");
    if ((origin && origin !== url.origin) || request.headers.get("Sec-Fetch-Site") === "cross-site"
        || (request.method !== "GET" && origin !== url.origin)) {
        return json({ error: "Untrusted request origin." }, 403);
    }
    if (!env.DB || !env.API_RATE_LIMITER || !env.LOGIN_RATE_LIMITER) {
        return json({ error: "Account sign-in is temporarily unavailable. Please try again shortly." }, 503);
    }
    const ip = request.headers.get("CF-Connecting-IP") || "unknown";
    if (!(await env.API_RATE_LIMITER.limit({ key: `api:${ip}` })).success) {
        return json({ error: "Too many requests. Please wait a moment and try again." }, 429, { "Retry-After": "60" });
    }
    const assessmentCollection = ["/api/assessments", "/api/admin/assessments"].includes(url.pathname);
    const assessmentItem = /^\/api\/(?:admin\/)?assessments\/[1-9][0-9]*$/.test(url.pathname);
    const expectedMethod = url.pathname === "/api/account" || url.pathname === "/api/assessments" ? "GET"
        : ["/api/bonk/login", "/api/bonk/logout"].includes(url.pathname) ? "POST"
        : url.pathname === "/api/admin/assessments" ? "GET, POST"
        : assessmentItem && url.pathname.startsWith("/api/admin/") ? "GET, PUT"
        : assessmentItem ? "GET" : null;
    if (!expectedMethod) {
        return json({ error: "Not found." }, 404);
    }
    if (!expectedMethod.split(", ").includes(request.method)) {
        return json({ error: "Method not allowed." }, 405, { Allow: expectedMethod });
    }
    if (["POST", "PUT"].includes(request.method)) {
        if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get("Content-Type") || "")) {
            return json({ error: "Send a JSON request." }, 415);
        }
        const length = Number(request.headers.get("Content-Length"));
        if (Number.isFinite(length) && length > MAX_REQUEST_BYTES) {
            return json({ error: "That request is too large." }, 413);
        }
    }
    if (url.pathname === "/api/account") {
        return json({ account: await getAccount(request, env) });
    }
    if (url.pathname === "/api/bonk/login") {
        if (!(await env.LOGIN_RATE_LIMITER.limit({ key: `login:${ip}` })).success) {
            return json({ error: "Too many sign-in attempts. Please wait a moment and try again." }, 429, { "Retry-After": "60" });
        }
        return login(request, env);
    }
    if (url.pathname === "/api/bonk/logout") {
        return logout(request, env);
    }
    if (assessmentCollection || assessmentItem) {
        const account = url.pathname.startsWith("/api/admin/") ? await getAccount(request, env) : null;
        return handleAssessmentRequest(request, env, url, account, readJson, json, positiveBonkId);
    }
    return json({ error: "Not found." }, 404);
}

export default {
    async fetch(request, env) {
        const url = new URL(request.url);
        if (url.pathname !== "/api" && !url.pathname.startsWith("/api/")) {
            return env.ASSETS.fetch(request);
        }
        try {
            return await api(request, env, url);
        } catch {
            // Never include exception text, request bodies, or provider data in responses/logs.
            return json({ error: url.pathname.startsWith("/api/assessments") || url.pathname.startsWith("/api/admin/assessments")
                ? "Assessments are temporarily unavailable. Please try again shortly."
                : "Account sign-in is temporarily unavailable. Please try again shortly." }, 503);
        }
    },
    async scheduled(_controller, env) {
        const timestamp = Date.now();
        await env.DB.batch([
            env.DB.prepare("DELETE FROM user_sessions WHERE expires_at <= ?").bind(timestamp),
            env.DB.prepare("DELETE FROM bonk_login_attempts WHERE window < ?").bind(Math.floor(timestamp / 600000) - 144)
        ]);
    }
};
