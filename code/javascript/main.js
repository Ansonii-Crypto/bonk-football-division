"use strict";

const pages = {
    home: {
        label: "Home",
        title: "Bonk Football Division",
        description: "Player assessments, playstyles, and a home for Bonk.io football competitions."
    },
    assessments: {
        label: "Assessments",
        title: "Assessments",
        description: "Find players, compare their attributes, and explore the tiers in one place.",
        render: renderAssessmentsPage
    },
    classes: {
        label: "Classes",
        title: "Classes",
        description: "The different ways players approach the game, in attack and defence.",
        render: renderClassesPage
    },
    divisions: {
        label: "Divisions",
        title: "Divisions",
        description: "A future home for championship partners and community competitions.",
        render: renderDivisionsPage
    },
    account: {
        label: "Account",
        title: "Account center",
        description: "Your Bonk account and profile in one place.",
        render: () => window.BonkAccount.renderPage()
    },
    profile: {
        title: "Your profile",
        description: "Your Bonk identity on Bonk Football Division.",
        render: () => window.BonkAccount.renderProfilePage()
    },
    admin: {
        title: "Management",
        description: "Review and manage football assessments.",
        render: () => window.BonkAdmin.renderPage()
    }
};

const app = document.querySelector("#app");
const header = document.querySelector("#site-header");

document.addEventListener("dragstart", event => {
    if (event.target.closest?.("img, picture, svg, canvas, input[type='image']")) {
        event.preventDefault();
    }
});

function createNavigation() {
    header.innerHTML = `
        <nav class="navigation" aria-label="Main navigation">
            <a class="navigation-brand" href="#home" aria-label="Bonk Football Division home">
                <span class="brand-mark" aria-hidden="true"></span>
                <span class="brand-name">Bonk Football<span>Division</span></span>
            </a>
            <button class="navigation-toggle" type="button" aria-expanded="false" aria-controls="primary-navigation" aria-label="Open navigation">
                <span>Menu</span>
                <span class="navigation-toggle-icon" aria-hidden="true">
                    <span></span>
                    <span></span>
                    <span></span>
                </span>
            </button>
            <ul id="primary-navigation" class="navigation-links"></ul>
        </nav>
    `;

    const list = header.querySelector(".navigation-links");

    for (const [id, page] of Object.entries(pages)) {
        if (id === "profile" || id === "admin") {
            continue;
        }
        const item = document.createElement("li");
        const link = document.createElement("a");
        link.href = `#${id}`;
        link.textContent = page.label;
        link.dataset.page = id;

        if (id === "account") {
            item.classList.add("navigation-account");
        }

        item.append(link);
        list.append(item);

        if (id === "account") {
            window.BonkAccount.mountNavigation(item);
        }
    }

    const navigation = header.querySelector(".navigation");
    const toggle = header.querySelector(".navigation-toggle");

    function setMenuOpen(open) {
        navigation.classList.toggle("is-open", open);
        toggle.setAttribute("aria-expanded", String(open));
        toggle.setAttribute("aria-label", open ? "Close navigation" : "Open navigation");
        if (!open) {
            window.BonkAccount.closeMenu();
        }
    }

    toggle.addEventListener("click", () => {
        setMenuOpen(toggle.getAttribute("aria-expanded") !== "true");
    });

    header.addEventListener("click", event => {
        const link = event.target.closest("a");
        if (!link || !header.contains(link)) {
            return;
        }
        if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) {
            return;
        }

        setMenuOpen(false);

        if (window.location.hash === link.hash) {
            app.focus({ preventScroll: true });
        }
    });

    document.addEventListener("keydown", event => {
        if (event.key === "Escape" && toggle.getAttribute("aria-expanded") === "true") {
            setMenuOpen(false);
            toggle.focus();
        }
    });

    document.addEventListener("click", event => {
        if (!navigation.contains(event.target)) {
            setMenuOpen(false);
        }
    });

    window.matchMedia("(max-width: 48rem)").addEventListener("change", event => {
        const focusedLinkWillHide = event.matches && list.contains(document.activeElement);
        setMenuOpen(false);

        if (focusedLinkWillHide) {
            toggle.focus();
        }
    });

    return () => setMenuOpen(false);
}

function renderPage() {
    window.closeClassPanel?.();

    const requestedHash = window.location.hash.slice(1);
    const queryStart = requestedHash.indexOf("?");
    const requestedRoute = queryStart === -1 ? requestedHash : requestedHash.slice(0, queryStart);
    const parameters = queryStart === -1 ? null : new URLSearchParams(requestedHash.slice(queryStart + 1));
    const requestedPage = ["players", "tiers"].includes(requestedRoute) ? "assessments" : requestedRoute;
    let pageId = Object.hasOwn(pages, requestedPage) ? requestedPage : "home";
    let page = pages[pageId];

    if (requestedRoute.startsWith("assessments/")) {
        pageId = "assessments";
        let playerId = "";

        try {
            playerId = decodeURIComponent(requestedRoute.slice("assessments/".length));
        } catch {
            // Invalid bookmark text shows the same missing-profile page.
        }

        page = window.getAssessmentProfile(playerId) || {
            title: "Player not found",
            description: "This assessment is not available.",
            render() {
                const content = document.createElement("section");
                content.className = "page-content";
                const back = document.createElement("a");
                back.href = "#assessments";
                back.className = "text-link";
                back.textContent = "Back to assessments";
                content.append(back);
                return content;
            }
        };
    }
    const introduction = document.createElement("section");
    introduction.className = "page-introduction";

    const eyebrow = document.createElement("p");
    eyebrow.className = "page-eyebrow";
    eyebrow.textContent = pageId === "home" ? "Bonk.io football" : "Bonk Football Division";

    const heading = document.createElement("h1");
    heading.className = "page-title";
    heading.textContent = page.title;

    const description = document.createElement("p");
    description.className = "page-description";
    description.textContent = page.description;

    introduction.append(eyebrow, heading, description);
    app.classList.toggle("page--home", pageId === "home");
    app.classList.toggle("page--assessment-browser", pageId === "assessments" && !requestedRoute.startsWith("assessments/"));
    app.dataset.page = pageId;

    if (pageId === "home") {
        const accent = document.createElement("span");
        accent.className = "title-accent";
        accent.textContent = "Division";
        heading.replaceChildren(document.createTextNode("Bonk Football "), accent);

        const actions = document.createElement("div");
        actions.className = "page-actions";

        for (const [id, label, className] of [
            ["assessments", "View assessments", "button-primary"],
            ["classes", "Explore classes", "button-secondary"]
        ]) {
            const link = document.createElement("a");
            link.href = `#${id}`;
            link.className = className;
            link.textContent = label;
            actions.append(link);
        }

        introduction.append(actions);

        const illustration = document.createElement("div");
        illustration.className = "pitch-illustration";
        illustration.setAttribute("aria-hidden", "true");
        illustration.innerHTML = `
            <div class="pitch-halo pitch-halo--ice"></div>
            <div class="pitch-halo pitch-halo--fire"></div>
            <div class="pitch-surface">
                <div class="pitch-outline"></div>
                <div class="pitch-halfway"></div>
                <div class="pitch-center"></div>
                <div class="pitch-area pitch-area--left"></div>
                <div class="pitch-area pitch-area--right"></div>
                <div class="pitch-player pitch-player--ice"></div>
                <div class="pitch-player pitch-player--fire"></div>
                <div class="pitch-ball"></div>
            </div>
        `;

        app.replaceChildren(introduction, illustration);
    } else {
        app.replaceChildren(introduction);

        if (page.render) {
            app.append(page.render(parameters));
        }
    }

    header.querySelectorAll("[data-page]").forEach(link => {
        if (link.dataset.page === pageId || ["profile", "admin"].includes(pageId) && link.classList.contains("account-menu-trigger")) {
            link.setAttribute("aria-current", "page");
        } else {
            link.removeAttribute("aria-current");
        }
    });

    document.title = pageId === "home" ? page.title : `${page.title} | Bonk Football Division`;
}

const closeNavigation = createNavigation();
renderPage();

let loginReturnHash = null;

function returnableHash(hash) {
    const route = hash.slice(1).split("?", 1)[0];
    return ["home", "assessments", "players", "tiers", "classes", "divisions", "profile", "admin"].includes(route)
        || route.startsWith("assessments/");
}

window.addEventListener("bonk-login-success", () => {
    if (window.location.hash !== "#account") {
        return;
    }

    const destination = loginReturnHash && returnableHash(loginReturnHash) ? loginReturnHash : "#home";
    loginReturnHash = null;
    window.location.hash = destination;
});

window.addEventListener("bonk-account-change", () => {
    if (["account", "profile", "admin"].includes(app.dataset.page)) {
        renderPage();
    }
});
window.BonkAccount.init();

document.querySelector(".skip-link").addEventListener("click", event => {
    if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) {
        return;
    }

    event.preventDefault();
    app.focus();
});

window.addEventListener("hashchange", event => {
    if (window.location.hash === "#account") {
        try {
            const previousHash = new URL(event.oldURL).hash;
            if (returnableHash(previousHash)) {
                loginReturnHash = previousHash;
            }
        } catch {
            loginReturnHash = null;
        }
    }
    closeNavigation();
    renderPage();
    if (["account", "profile", "admin"].includes(app.dataset.page)) {
        window.BonkAccount.refresh();
    }
    app.focus({ preventScroll: true });
    window.scrollTo(0, 0);
});
