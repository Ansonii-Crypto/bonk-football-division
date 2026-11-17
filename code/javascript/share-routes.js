"use strict";

(() => {
    const pages = new Set(["home", "assessments", "classes", "divisions", "account", "profile", "admin"]);
    const classNames = new Set(["weaver", "bulwark", "catalyst", "tactician", "opportunist", "dynamo", "renegade"]);
    const viewParameters = ["view", "q", "tiers", "initials", "sort", "page"];
    const web = ["https:", "http:"].includes(window.location.protocol);
    let lastSyncedUrl = window.location.href;

    function parse(value) {
        if (typeof value !== "string") return null;
        const text = value.replace(/^#/, "").replace(/^\/+/, "");
        const queryAt = text.indexOf("?");
        let route = (queryAt < 0 ? text : text.slice(0, queryAt)).replace(/\/+$/, "") || "home";
        if (["players", "tiers"].includes(route)) route = "assessments";
        const match = /^(assessments|divisions)\/([1-9][0-9]*)$/.exec(route);
        const classMatch = /^classes\/([A-Za-z]+)$/.exec(route);
        if (!pages.has(route) && !(match && Number.isSafeInteger(Number(match[2])))
            && !(classMatch && classNames.has(classMatch[1].toLowerCase()))) return null;
        if (classMatch) route = `classes/${classMatch[1].toLowerCase()}`;
        const parameters = new URLSearchParams(queryAt < 0 ? "" : text.slice(queryAt + 1));
        const filters = new URLSearchParams();
        if (route === "assessments") {
            for (const key of viewParameters) if (parameters.has(key)) filters.set(key, parameters.get(key));
        }
        return { route, path: route === "home" ? "/" : `/${route}`, search: filters.toString() };
    }

    function locationRoute() {
        return window.location.pathname === "/index.html" ? parse("home") : parse(window.location.pathname);
    }

    function sync() {
        lastSyncedUrl = window.location.href;
        if (!web || !locationRoute()) return;
        const route = parse(window.location.hash) || parse("home");
        const url = new URL(window.location.href);
        url.pathname = route.path;
        // Preserve unrelated parameters such as campaign tags; route filters
        // belong to the current assessment view and must not follow other tabs.
        for (const key of viewParameters) url.searchParams.delete(key);
        for (const [key, value] of new URLSearchParams(route.search)) url.searchParams.set(key, value);
        if (url.href !== window.location.href) window.history.replaceState(window.history.state, "", url);
        lastSyncedUrl = window.location.href;
    }

    function shareUrl(hashOrRoute = window.location.hash) {
        const route = parse(hashOrRoute) || parse("home");
        const url = new URL(window.location.href);
        if (!web || !locationRoute()) {
            url.hash = hashOrRoute;
            return url.href;
        }
        url.pathname = route.path;
        url.search = route.search;
        url.hash = "";
        return url.href;
    }

    window.BonkRoutes = { sync, shareUrl, get lastSyncedUrl() { return lastSyncedUrl; } };

    // The existing router continues to use fragments. Clean links hydrate that
    // route before the application starts, while the server can read the path
    // to supply the corresponding Discord preview without running JavaScript.
    if (web && !window.location.hash && locationRoute()) {
        const route = parse(`${window.location.pathname}${window.location.search}`);
        if (route && route.route !== "home") {
            const url = new URL(window.location.href);
            url.hash = `${route.route}${route.search ? `?${route.search}` : ""}`;
            window.history.replaceState(window.history.state, "", url);
        }
    }
    sync();
})();
