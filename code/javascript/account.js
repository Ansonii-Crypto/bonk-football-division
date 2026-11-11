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
            Array.from(account.username.trimStart())[0]?.toUpperCase() || "?");
        node.setAttribute("aria-hidden", "true");
        return node;
    }

    function validAccount(account) {
        return account && typeof account.username === "string" && account.username.length > 0
            && account.username.length <= 100 && typeof account.bonkId === "string"
            && /^[1-9]\d{0,15}$/.test(account.bonkId)
            && Number.isSafeInteger(Number(account.bonkId))
            && (account.isAdmin === undefined || typeof account.isAdmin === "boolean");
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
            document.querySelector("#bonk-username, #profile-sign-in")?.focus({ preventScroll: true });
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
        const currentPage = ["account", "profile", "admin"].includes(document.querySelector("#app")?.dataset.page);
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
        options.setAttribute("aria-label", "Account options");
        const accountLink = element("a", "", "Account center");
        accountLink.href = "#account";
        accountLink.dataset.page = "account";
        accountLink.addEventListener("click", () => closeMenu());
        const profileLink = element("a", "", "Profile");
        profileLink.href = "#profile";
        profileLink.dataset.page = "profile";
        profileLink.addEventListener("click", () => closeMenu());
        const adminLink = state.account.isAdmin === true ? element("a", "", "Admin center") : null;
        if (adminLink) {
            adminLink.href = "#admin";
            adminLink.dataset.page = "admin";
            adminLink.addEventListener("click", () => closeMenu());
        }
        const signOut = element("button", "account-logout", "Log out");
        signOut.type = "button";
        signOut.disabled = state.pending;
        const status = element("p", "account-menu-status");
        status.setAttribute("role", "status");
        if (state.pending) {
            status.textContent = "Signing out…";
        }
        signOut.addEventListener("click", () => logout(signOut, status));
        options.append(accountLink, profileLink);
        if (adminLink) {
            options.append(adminLink);
        }
        options.append(signOut, status);
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
            const actions = [accountLink, profileLink, ...(adminLink ? [adminLink] : []), signOut];
            const index = actions.indexOf(document.activeElement);
            const next = event.key === "Home" ? 0 : event.key === "End" ? actions.length - 1
                : index < 0 ? (event.key === "ArrowUp" ? actions.length - 1 : 0)
                : event.key === "ArrowDown" ? (index + 1) % actions.length
                    : (index - 1 + actions.length) % actions.length;
            actions[next].focus();
        });
        navigationItem.replaceChildren(menu);
    }

    function renderSessionStatus(section) {
        if (!state.checked) {
            const status = element("p", "account-status", "Checking your session…");
            status.setAttribute("role", "status");
            section.append(status);
            return true;
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
            return true;
        }
        return false;
    }

    function renderPage() {
        const section = element("section", "account-content");
        section.setAttribute("aria-label", "Account center");
        if (renderSessionStatus(section)) {
            section.classList.add("account-content--narrow");
            return section;
        }

        if (state.account) {
            section.classList.add("account-content--dashboard");
            const panel = element("div", "account-panel account-overview");
            const kicker = element("p", "account-kicker", "Connected to Bonk.io");
            const identity = element("div", "account-identity");
            const name = element("h2", "account-name", state.account.username);
            name.tabIndex = -1;
            const identityText = element("div", "account-identity-text");
            const idLine = element("div", "account-id-line");
            const identifier = element("p", "account-id", `Bonk player ID: ${state.account.bonkId}`);
            const copyId = element("button", "account-copy-id", "Copy ID");
            copyId.type = "button";
            copyId.setAttribute("aria-label", "Copy Bonk player ID");
            const copyStatus = element("span", "account-copy-status");
            copyStatus.setAttribute("role", "status");
            copyId.addEventListener("click", async () => {
                const id = state.account.bonkId;
                copyStatus.replaceChildren();
                try {
                    if (!navigator.clipboard?.writeText) {
                        throw new Error("Clipboard unavailable");
                    }
                    await navigator.clipboard.writeText(id);
                    copyStatus.textContent = "Copied";
                } catch {
                    const selectable = element("input", "account-id-select");
                    selectable.type = "text";
                    selectable.readOnly = true;
                    selectable.value = id;
                    selectable.setAttribute("aria-label", "Bonk player ID to copy");
                    copyStatus.append("Select the ID: ", selectable);
                    selectable.focus();
                    selectable.select();
                }
            });
            idLine.append(identifier, copyId, copyStatus);
            identityText.append(name, idLine);
            identity.append(avatar(state.account, true), identityText);
            panel.append(kicker, identity);

            const cards = element("div", "account-dashboard-grid");
            const profile = element("section", "account-panel account-dashboard-card");
            profile.append(element("p", "account-card-kicker", "Your space"));
            profile.append(element("h2", "", "Profile"));
            profile.append(element("p", "account-note", "View the identity linked to your Bonk account."));
            const profileLink = element("a", "account-button account-button--outline", "View profile");
            profileLink.href = "#profile";
            profile.append(profileLink);

            const sessionPanel = element("section", "account-panel account-dashboard-card");
            sessionPanel.append(element("p", "account-card-kicker", "Account access"));
            sessionPanel.append(element("h2", "", "Session"));
            sessionPanel.append(element("p", "account-note", "This device stays signed in for up to 24 hours. You can end this session at any time."));
            const status = element("p", "account-status");
            status.setAttribute("role", "status");
            status.textContent = state.pending ? "Signing out…" : state.error;
            const signOut = element("button", "account-button account-logout", "Log out");
            signOut.type = "button";
            signOut.disabled = state.pending;
            signOut.addEventListener("click", () => logout(signOut, status));
            sessionPanel.append(signOut, status);
            cards.append(profile);
            if (state.account.isAdmin === true) {
                const management = element("section", "account-panel account-dashboard-card");
                management.append(element("p", "account-card-kicker", "Administration"));
                management.append(element("h2", "", "Management"));
                management.append(element("p", "account-note", "View, create, and update football assessments."));
                const manageLink = element("a", "account-button account-button--outline", "Open admin center");
                manageLink.href = "#admin";
                management.append(manageLink);
                cards.append(management);
            }
            cards.append(sessionPanel);
            section.append(panel, cards);
            return section;
        }

        section.classList.add("account-content--narrow");
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
            window.dispatchEvent(new Event("bonk-login-success"));
            if (restoreFocus && window.location.hash === "#account") {
                document.querySelector(".account-name")?.focus({ preventScroll: true });
            }
        });
        panel.append(form);
        section.append(panel);
        return section;
    }

    function renderProfilePage() {
        const section = element("section", "account-content account-content--profile");
        section.setAttribute("aria-label", "Your Bonk profile");
        if (renderSessionStatus(section)) {
            section.classList.add("account-content--narrow");
            return section;
        }
        if (!state.account) {
            section.classList.add("account-content--narrow");
            const panel = element("div", "account-panel");
            panel.append(element("h2", "", "Sign in to view your profile"));
            panel.append(element("p", "account-note", "Your profile is linked to your Bonk.io account."));
            const signIn = element("a", "account-button", "Sign in");
            signIn.id = "profile-sign-in";
            signIn.href = "#account";
            panel.append(signIn);
            section.append(panel);
            return section;
        }

        const layout = element("div", "account-profile-layout");
        const navigation = element("nav", "account-panel account-profile-navigation");
        navigation.setAttribute("aria-label", "Profile sections");
        navigation.append(element("p", "account-card-kicker", "Your profile"));
        const general = element("a", "account-profile-nav-link", "General information");
        general.href = "#profile";
        general.setAttribute("aria-current", "page");
        const back = element("a", "account-profile-home", "← Account center");
        back.href = "#account";
        navigation.append(general, back);

        const panel = element("div", "account-panel account-profile-panel");
        panel.append(element("p", "account-kicker", "General information"));
        const identity = element("div", "account-identity");
        const name = element("h2", "account-name", state.account.username);
        identity.append(avatar(state.account, true), name);
        panel.append(identity);

        const details = element("dl", "account-profile-details");
        for (const [label, value] of [
            ["Bonk username", state.account.username],
            ["Bonk player ID", state.account.bonkId]
        ]) {
            const row = element("div", "account-profile-detail");
            row.append(element("dt", "", label), element("dd", "", value));
            details.append(row);
        }
        panel.append(details);
        layout.append(navigation, panel);
        section.append(layout);
        return section;
    }

    window.BonkAccount = {
        renderPage,
        renderProfilePage,
        refresh,
        closeMenu,
        session() {
            return { checked: state.checked, account: state.account, unavailable: state.unavailable };
        },
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
