"use strict";

(() => {
    const state = {
        account: null,
        checked: false,
        unavailable: "",
        pending: false,
        error: ""
    };
    let requestVersion = 0;
    let refreshPromise = null;
    let lastChecked = 0;
    let navigationItem = null;
    let initialized = false;

    function element(tag, className, text) {
        const node = document.createElement(tag);
        if (className) {
            node.className = className;
        }
        if (text !== undefined) {
            node.textContent = text;
        }
        return node;
    }

    function avatar(account, large = false) {
        const node = element("span", `account-avatar${large ? " account-avatar--large" : ""}`,
            Array.from(account.username)[0]?.toUpperCase() || "?");
        node.setAttribute("aria-hidden", "true");
        return node;
    }

    function validAccount(account) {
        return account && typeof account.username === "string" && account.username.length > 0
            && account.username.length <= 100 && typeof account.bonkId === "string"
            && /^[1-9]\d{0,15}$/.test(account.bonkId)
            && Number.isSafeInteger(Number(account.bonkId));
    }

    function notify() {
        updateNavigation();
        window.dispatchEvent(new CustomEvent("bonk-account-change"));
    }

    async function request(path, body) {
        if (!["http:", "https:"].includes(window.location.protocol)) {
            throw new Error("Account sign-in needs the website server. Open the live site or use the local Wrangler preview.");
        }
        if (window.location.protocol !== "https:"
            && !["localhost", "127.0.0.1", "[::1]"].includes(window.location.hostname)) {
            throw new Error("Please open the HTTPS version of this website to sign in securely.");
        }

        const controller = new AbortController();
        const timeout = window.setTimeout(() => controller.abort(), 25000);
        try {
            const response = await fetch(path, {
                method: body === undefined ? "GET" : "POST",
                headers: body === undefined
                    ? { Accept: "application/json" }
                    : { Accept: "application/json", "Content-Type": "application/json" },
                body: body === undefined ? undefined : JSON.stringify(body),
                credentials: "same-origin",
                cache: "no-store",
                redirect: "error",
                signal: controller.signal
            });
            const data = await response.json().catch(() => null);
            if (!response.ok) {
                const message = typeof data?.error === "string" && data.error.length <= 240
                    ? data.error
                    : response.status === 429
                        ? "Too many attempts. Please wait a little before trying again."
                        : "Account sign-in is unavailable right now. Please try again.";
                throw new Error(message);
            }
            if (!data || typeof data !== "object") {
                throw new Error("Account sign-in is unavailable right now. Please try again.");
            }
            return data;
        } catch (error) {
            if (error.name === "AbortError") {
                throw new Error("The sign-in request took too long. Please try again.");
            }
            if (error instanceof TypeError) {
                throw new Error("Unable to reach the account service. Check your connection and try again.");
            }
            throw error;
        } finally {
            window.clearTimeout(timeout);
        }
    }

    async function refresh(force = false) {
        if (state.pending || refreshPromise || (!force && state.checked && Date.now() - lastChecked < 30000)) {
            return refreshPromise;
        }

        const version = ++requestVersion;
        refreshPromise = (async () => {
            try {
                const data = await request("/api/account");
                if (data.account !== null && !validAccount(data.account)) {
                    throw new Error("Account sign-in is unavailable right now. Please try again.");
                }
                if (version !== requestVersion) {
                    return;
                }
                const changed = !state.checked || state.unavailable
                    || JSON.stringify(state.account) !== JSON.stringify(data.account);
                state.account = data.account;
                state.checked = true;
                state.unavailable = "";
                lastChecked = Date.now();
                if (changed) {
                    notify();
                }
            } catch (error) {
                if (version === requestVersion && !state.checked) {
                    state.checked = true;
                    state.unavailable = error.message;
                    notify();
                }
            } finally {
                refreshPromise = null;
            }
        })();
        return refreshPromise;
    }

    async function logout(button, status) {
        if (state.pending) {
            return;
        }
        state.pending = true;
        state.error = "";
        const version = ++requestVersion;
        button.disabled = true;
        status.textContent = "Signing out…";
        try {
            await request("/api/bonk/logout", {});
            if (version === requestVersion) {
                state.account = null;
                state.checked = true;
                state.unavailable = "";
                lastChecked = Date.now();
            }
        } catch (error) {
            state.error = error.message;
            status.textContent = error.message;
            state.pending = false;
            if (!button.isConnected) {
                notify();
            }
            return;
        } finally {
            state.pending = false;
            button.disabled = false;
        }
        const restoreFocus = navigationItem?.contains(document.activeElement);
        const focusPage = button.isConnected && document.querySelector("#app")?.contains(button);
        notify();
        if (restoreFocus) {
            navigationItem.querySelector("a").focus();
        } else if (focusPage) {
            document.querySelector("#bonk-username")?.focus({ preventScroll: true });
        }
    }

    function closeMenu(focus = false) {
        const menu = navigationItem?.querySelector("details");
        if (menu?.open) {
            menu.open = false;
            if (focus) {
                menu.querySelector("summary").focus();
            }
        }
    }

    function updateNavigation() {
        if (!navigationItem) {
            return;
        }
        const currentPage = document.querySelector("#app")?.dataset.page === "account";
        if (!state.account) {
            const link = element("a", "", "Account");
            link.href = "#account";
            link.dataset.page = "account";
            if (currentPage) {
                link.setAttribute("aria-current", "page");
            }
            navigationItem.replaceChildren(link);
            return;
        }

        const menu = element("details", "account-menu");
        const summary = element("summary", "account-menu-trigger");
        summary.dataset.page = "account";
        if (currentPage) {
            summary.setAttribute("aria-current", "page");
        }
        const username = element("span", "account-menu-username", state.account.username);
        const arrow = element("span", "account-menu-arrow", "▾");
        arrow.setAttribute("aria-hidden", "true");
        summary.append(avatar(state.account), username, arrow);
        const options = element("div", "account-menu-options");
        const accountLink = element("a", "", "Account");
        accountLink.href = "#account";
        accountLink.addEventListener("click", () => closeMenu());
        const signOut = element("button", "account-logout", "Log out");
        signOut.type = "button";
        signOut.disabled = state.pending;
        const status = element("p", "account-menu-status");
        status.setAttribute("role", "status");
        if (state.pending) {
            status.textContent = "Signing out…";
        }
        signOut.addEventListener("click", () => logout(signOut, status));
        options.append(accountLink, signOut, status);
        menu.append(summary, options);
        menu.addEventListener("keydown", event => {
            if (event.key === "Escape" && menu.open) {
                event.preventDefault();
                event.stopPropagation();
                closeMenu(true);
                return;
            }
            if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
                return;
            }
            event.preventDefault();
            menu.open = true;
            const actions = [accountLink, signOut];
            const index = actions.indexOf(document.activeElement);
            const next = event.key === "Home" ? 0 : event.key === "End" ? actions.length - 1
                : index < 0 ? (event.key === "ArrowUp" ? actions.length - 1 : 0)
                : event.key === "ArrowDown" ? (index + 1) % actions.length
                    : (index - 1 + actions.length) % actions.length;
            actions[next].focus();
        });
        navigationItem.replaceChildren(menu);
    }

    function renderPage() {
        const section = element("section", "account-content");
        section.setAttribute("aria-label", "Your account");
        if (!state.checked) {
            const status = element("p", "account-status", "Checking your session…");
            status.setAttribute("role", "status");
            section.append(status);
            return section;
        }
        if (state.unavailable) {
            const panel = element("div", "account-panel");
            const heading = element("h2", "", "Account unavailable");
            const status = element("p", "account-status", state.unavailable);
            status.setAttribute("role", "status");
            const retry = element("button", "account-button", "Try again");
            retry.type = "button";
            retry.addEventListener("click", async () => {
                state.checked = false;
                state.unavailable = "";
                notify();
                await refresh(true);
            });
            panel.append(heading, status, retry);
            section.append(panel);
            return section;
        }

        if (state.account) {
            const panel = element("div", "account-panel");
            const identity = element("div", "account-identity");
            const name = element("h2", "account-name", state.account.username);
            name.tabIndex = -1;
            identity.append(avatar(state.account, true), name);
            const identifier = element("p", "account-id", `Bonk account ID: ${state.account.bonkId}`);
            const note = element("p", "account-note", "You are signed in with your Bonk.io account.");
            const status = element("p", "account-status");
            status.setAttribute("role", "status");
            status.textContent = state.pending ? "Signing out…" : state.error;
            const signOut = element("button", "account-button account-logout", "Log out");
            signOut.type = "button";
            signOut.disabled = state.pending;
            signOut.addEventListener("click", () => logout(signOut, status));
            panel.append(identity, identifier, note, signOut, status);
            section.append(panel);
            return section;
        }

        const panel = element("div", "account-panel");
        panel.append(element("h2", "", "Sign in with Bonk.io"));
        const form = element("form", "account-form");
        form.method = "post";
        form.action = "/api/bonk/login";
        const fields = element("fieldset", "account-fields");
        fields.disabled = state.pending;
        const legend = element("legend", "account-visually-hidden", "Bonk.io sign-in details");
        fields.append(legend);

        const usernameLabel = element("label", "", "Bonk username");
        usernameLabel.htmlFor = "bonk-username";
        const username = element("input");
        username.id = "bonk-username";
        username.name = "username";
        username.type = "text";
        username.autocomplete = "username";
        username.autocapitalize = "none";
        username.spellcheck = false;
        username.maxLength = 100;
        username.required = true;

        const passwordLabel = element("label", "", "Bonk password");
        passwordLabel.htmlFor = "bonk-password";
        const password = element("input");
        password.id = "bonk-password";
        password.name = "password";
        password.type = "password";
        password.autocomplete = "current-password";
        password.maxLength = 1024;
        password.required = true;
        password.setAttribute("aria-describedby", "account-credential-note");
        const note = element("p", "account-note", "Your password is sent securely through our server to Bonk.io to verify your account. We do not save your password. Your browser may offer to save it.");
        note.id = "account-credential-note";
        const status = element("p", "account-status");
        status.setAttribute("role", "status");
        status.textContent = state.pending ? "Signing in…" : state.error;
        const submit = element("button", "account-button", "Sign in");
        submit.type = "submit";
        fields.append(usernameLabel, username, passwordLabel, password, note, submit);
        form.append(fields, status);
        form.addEventListener("submit", async event => {
            event.preventDefault();
            if (state.pending) {
                return;
            }
            const credentials = { username: username.value.trim(), password: password.value };
            state.pending = true;
            state.error = "";
            const version = ++requestVersion;
            fields.disabled = true;
            status.textContent = "Signing in…";
            try {
                const data = await request("/api/bonk/login", credentials);
                if (!validAccount(data.account)) {
                    throw new Error("The sign-in response could not be verified. Please try again.");
                }
                if (version === requestVersion) {
                    state.account = data.account;
                    state.checked = true;
                    state.unavailable = "";
                    lastChecked = Date.now();
                }
            } catch (error) {
                state.error = error.message;
                status.textContent = error.message;
                state.pending = false;
                if (!form.isConnected) {
                    notify();
                }
                return;
            } finally {
                credentials.password = "";
                password.value = "";
                fields.disabled = false;
                state.pending = false;
            }
            const restoreFocus = form.isConnected;
            notify();
            if (restoreFocus) {
                document.querySelector(".account-name")?.focus({ preventScroll: true });
            }
        });
        panel.append(form);
        section.append(panel);
        return section;
    }

    window.BonkAccount = {
        renderPage,
        refresh,
        closeMenu,
        mountNavigation(item) {
            navigationItem = item;
            updateNavigation();
        },
        init() {
            if (initialized) {
                return;
            }
            initialized = true;
            document.addEventListener("click", event => {
                if (!navigationItem?.contains(event.target)) {
                    closeMenu();
                }
            });
            window.addEventListener("focus", () => refresh());
            window.addEventListener("pageshow", event => {
                if (event.persisted) {
                    refresh(true);
                }
            });
            refresh(true);
        }
    };
})();
