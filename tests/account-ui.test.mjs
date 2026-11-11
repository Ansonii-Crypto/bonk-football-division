import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { Script } from "node:vm";
import { JSDOM } from "jsdom";

const root = new URL("../", import.meta.url);
const html = readFileSync(new URL("code/html/index.html", root), "utf8");
const verifiedAccount = { bonkId: "3177088", username: "VerifiedPlayer", avatarCode: null };
const tick = () => new Promise(resolve => setImmediate(resolve));

async function page(t, fetcher, url = "https://bonk-football-division.com/#account") {
    const dom = new JSDOM(html, { url, runScripts: "outside-only", pretendToBeVisual: true });
    t.after(() => dom.window.close());
    const { window } = dom;
    window.fetch = fetcher;
    window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
    window.scrollTo = () => {};
    for (const script of window.document.querySelectorAll("script[src]")) {
        const name = script.getAttribute("src").split("/").at(-1);
        new Script(readFileSync(new URL(`code/javascript/${name}`, root), "utf8"), { filename: name })
            .runInContext(dom.getInternalVMContext());
    }
    await tick();
    return window;
}

function fillAndSubmit(window, username = "typed-user", password = "test-only-password") {
    const form = window.document.querySelector(".account-form");
    assert.ok(form, "the account sign-in form is visible");
    form.elements.username.value = username;
    form.elements.password.value = password;
    form.dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
    return form;
}

function nextRoute(window) {
    return new Promise(resolve => window.addEventListener("hashchange", resolve, { once: true }));
}

async function navigate(window, hash) {
    assert.notEqual(window.location.hash, hash);
    const changed = nextRoute(window);
    window.location.hash = hash;
    await changed;
}

test("sign-in preserves username and password characters and replaces Account with the verified identity", async t => {
    const calls = [];
    let resolveLogin;
    const window = await page(t, async (path, options) => {
        calls.push({ path, options });
        return path === "/api/account" ? Response.json({ account: null })
            : new Promise(resolve => { resolveLogin = resolve; });
    });
    const { document } = window;
    assert.equal(document.querySelector("#bonk-password").type, "password");
    assert.equal(document.querySelector("#bonk-password").autocomplete, "current-password");
    const rawPassword = "  p+&=%?#é😀  ";
    const form = fillAndSubmit(window, "  typed-user  ", rawPassword);
    form.dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
    assert.equal(calls.filter(call => call.path === "/api/bonk/login").length, 1);
    const login = calls.at(-1);
    assert.deepEqual(JSON.parse(login.options.body), { username: "  typed-user  ", password: rawPassword });
    assert.equal(login.options.credentials, "same-origin");
    assert.equal(login.options.redirect, "error");
    assert.equal(form.querySelector("fieldset").disabled, true);
    const returned = nextRoute(window);
    resolveLogin(Response.json({ account: verifiedAccount }));
    await returned;
    assert.equal(form.elements.password.value, "");
    assert.equal(document.querySelector(".account-menu-username").textContent, "VerifiedPlayer");
    assert.equal(window.location.hash, "#home", "direct account visits return to Home after sign-in");
    await navigate(window, "#account");
    assert.match(document.querySelector(".account-id").textContent, /3177088/);
    assert.equal(document.querySelector(".account-form"), null);
    assert.equal(window.localStorage.length, 0);
    assert.equal(window.sessionStorage.length, 0);
    assert.equal(document.cookie, "", "the UI never writes its own session cookie");
});

test("failed credentials show a concise error, clear the password, and allow another attempt", async t => {
    let attempts = 0;
    const window = await page(t, async path => {
        if (path === "/api/account") {
            return Response.json({ account: null });
        }
        attempts += 1;
        return attempts === 1
            ? Response.json({ error: "Unable to sign in. Check your Bonk username and password." }, { status: 401 })
            : Response.json({ account: verifiedAccount });
    });
    const form = fillAndSubmit(window);
    await tick();
    assert.match(form.querySelector("[role=status]").textContent, /Check your Bonk username and password/);
    assert.equal(form.elements.password.value, "");
    assert.equal(form.querySelector("fieldset").disabled, false);
    assert.equal(window.document.querySelector(".account-menu"), null);
    fillAndSubmit(window);
    await tick();
    assert.ok(window.document.querySelector(".account-menu"));
});

test("successful sign-in returns to the previous page while a failed attempt stays on Account", async t => {
    let attempts = 0;
    const window = await page(t, async path => {
        if (path === "/api/account") {
            return Response.json({ account: null });
        }
        attempts += 1;
        return attempts === 1
            ? Response.json({ error: "Unable to sign in." }, { status: 401 })
            : Response.json({ account: verifiedAccount });
    }, "https://bonk-football-division.com/#classes");
    await navigate(window, "#account");
    fillAndSubmit(window);
    await tick();
    assert.equal(window.location.hash, "#account");
    const returned = nextRoute(window);
    fillAndSubmit(window);
    await returned;
    assert.equal(window.location.hash, "#classes");
    assert.equal(window.document.querySelector("#app").dataset.page, "classes");
});

test("sign-in restores the assessment view captured after filters changed the URL", async t => {
    const window = await page(t, async path => Response.json({ account: path === "/api/account" ? null : verifiedAccount }),
        "https://bonk-football-division.com/#assessments");
    const search = window.document.querySelector(".assessment-search");
    search.value = "keeper";
    search.dispatchEvent(new window.Event("input", { bubbles: true }));
    const previousView = window.location.hash;
    assert.match(previousView, /q=keeper/);
    await navigate(window, "#account");
    const returned = nextRoute(window);
    fillAndSubmit(window);
    await returned;
    assert.equal(window.location.hash, previousView);
    assert.equal(window.document.querySelector(".assessment-search").value, "keeper");
});

test("a signed-out profile can lead to sign-in and return to the same profile", async t => {
    const window = await page(t, async path => Response.json({ account: path === "/api/account" ? null : verifiedAccount }),
        "https://bonk-football-division.com/#profile");
    const signInLink = window.document.querySelector("#profile-sign-in");
    assert.ok(signInLink);
    await navigate(window, "#account");
    const returned = nextRoute(window);
    fillAndSubmit(window);
    await returned;
    assert.equal(window.location.hash, "#profile");
    assert.match(window.document.querySelector("#app").textContent, /VerifiedPlayer/);
    assert.match(window.document.querySelector("#app").textContent, /3177088/);
    assert.equal(window.document.querySelector(".account-menu-trigger").getAttribute("aria-current"), "page");
    assert.equal(window.document.querySelector(".account-menu-options a[href='#profile']").getAttribute("aria-current"), "page");
    assert.equal(window.document.querySelector(".account-menu-options a[href='#account']").hasAttribute("aria-current"), false);
});

test("the account center can copy an ID or offer selectable text when clipboard access is unavailable", async t => {
    const window = await page(t, async () => Response.json({ account: verifiedAccount }));
    const { document } = window;
    assert.ok(document.querySelector("a[href='#profile']"));
    const copied = [];
    Object.defineProperty(window.navigator, "clipboard", {
        configurable: true,
        value: { writeText: async value => copied.push(value) }
    });
    document.querySelector(".account-copy-id").click();
    await tick();
    assert.deepEqual(copied, ["3177088"]);
    assert.match(document.querySelector(".account-copy-status").textContent, /Copied/);
    Object.defineProperty(window.navigator, "clipboard", { configurable: true, value: undefined });
    document.querySelector(".account-copy-id").click();
    await tick();
    const fallback = document.querySelector(".account-id-select");
    assert.equal(fallback.value, "3177088");
    assert.equal(fallback.readOnly, true);
});

test("existing sessions support keyboard dropdown navigation and server-confirmed sign-out", async t => {
    let failLogout = true;
    const window = await page(t, async (path, options) => {
        if (path === "/api/account") {
            return Response.json({ account: verifiedAccount });
        }
        assert.equal(path, "/api/bonk/logout");
        assert.deepEqual(JSON.parse(options.body), {});
        return failLogout ? Response.json({ error: "Please try again." }, { status: 503 }) : Response.json({ ok: true });
    });
    const { document } = window;
    const menu = document.querySelector(".account-menu");
    const summary = menu.querySelector("summary");
    summary.focus();
    summary.dispatchEvent(new window.KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    assert.equal(menu.open, true);
    assert.equal(document.activeElement.textContent, "Account center");
    menu.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    assert.equal(menu.open, false);
    assert.equal(document.activeElement, summary);
    menu.open = true;
    document.querySelector("h1").click();
    assert.equal(menu.open, false);
    const logout = document.querySelector(".account-panel .account-logout");
    logout.click();
    await tick();
    assert.ok(document.querySelector(".account-menu"), "failed sign-out keeps the current identity");
    assert.match(document.querySelector(".account-dashboard-card .account-status").textContent, /Please try again/);
    failLogout = false;
    logout.click();
    await tick();
    assert.ok(document.querySelector(".account-form"));
    assert.equal(document.querySelector(".account-menu"), null);
});

test("expired sessions return to the login form on refresh", async t => {
    let account = verifiedAccount;
    const window = await page(t, async () => Response.json({ account }));
    assert.ok(window.document.querySelector(".account-menu"));
    account = null;
    await window.BonkAccount.refresh(true);
    assert.ok(window.document.querySelector(".account-form"));
    assert.equal(window.document.querySelector(".account-menu"), null);
});

test("an older session refresh cannot overwrite a completed login", async t => {
    let reads = 0;
    let resolveOldRefresh;
    const window = await page(t, async path => {
        if (path === "/api/bonk/login") {
            return Response.json({ account: verifiedAccount });
        }
        reads += 1;
        return reads === 1 ? Response.json({ account: null })
            : new Promise(resolve => { resolveOldRefresh = resolve; });
    });
    const pending = window.BonkAccount.refresh(true);
    fillAndSubmit(window);
    await tick();
    assert.ok(window.document.querySelector(".account-menu"));
    resolveOldRefresh(Response.json({ account: null }));
    await pending;
    assert.equal(window.document.querySelector(".account-menu-username").textContent, "VerifiedPlayer");
});

test("session changes leave assessment search and rendered content in place", async t => {
    let account = null;
    const window = await page(t, async () => Response.json({ account }), "https://bonk-football-division.com/#assessments");
    const search = window.document.querySelector(".assessment-search");
    search.value = "unfinished search";
    account = verifiedAccount;
    await window.BonkAccount.refresh(true);
    assert.equal(window.document.querySelector(".assessment-search"), search);
    assert.equal(search.value, "unfinished search");
    assert.equal(window.document.querySelector("#app").dataset.page, "assessments");
});

test("account details are text, even if the provider username contains markup", async t => {
    const username = '<img src=x onerror="alert(1)">';
    const window = await page(t, async () => Response.json({ account: { ...verifiedAccount, username } }));
    assert.equal(window.document.querySelector(".account-name").textContent, username);
    assert.equal(window.document.querySelector(".account-menu-username").textContent, username);
    assert.equal(window.document.querySelector(".account-content img"), null);
});

test("an unavailable or malformed account API can be retried without exposing a login form", async t => {
    let available = false;
    const window = await page(t, async () => available ? Response.json({ account: null }) : new Response("<html>not JSON</html>"));
    assert.match(window.document.querySelector(".account-panel").textContent, /Account unavailable/);
    assert.equal(window.document.querySelector(".account-form"), null);
    available = true;
    window.document.querySelector(".account-panel button").click();
    await tick();
    assert.ok(window.document.querySelector(".account-form"));
});

test("file previews and insecure remote HTTP pages never send login requests", async t => {
    for (const url of ["file:///preview/index.html#account", "http://bonk-football-division.com/#account"]) {
        let calls = 0;
        const window = await page(t, async () => {
            calls += 1;
            return Response.json({ account: null });
        }, url);
        assert.equal(calls, 0, url);
        assert.equal(window.document.querySelector(".account-form"), null, url);
        assert.match(window.document.querySelector(".account-panel").textContent, /Account unavailable/);
    }
});
