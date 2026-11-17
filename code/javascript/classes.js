"use strict";

function renderClassesPage(initialClass = "") {
    if (typeof window.closeClassPanel === "function") {
        window.closeClassPanel();
    }

    const classes = [
        {
            name: "Weaver",
            trait: "Control",
            description: "Keeps the ball close and works around a challenge instead of forcing a way through.",
            attack: "Carries possession around pressure with small touches and changes of direction.",
            defence: "Moves around the opponent to reach the ball from an awkward angle.",
            tip: "Give them room to move. Sometimes a quick pass is safer than taking on another player."
        },
        {
            name: "Bulwark",
            trait: "Positioning",
            description: "Gets into position early and makes opponents work to get past them.",
            attack: "Puts their body between the ball and a challenge, giving a teammate time to get forward.",
            defence: "Holds a useful position between the ball and goal rather than following every touch.",
            tip: "Needs support when the ball moves past them. Holding ground still means adjusting to the play."
        },
        {
            name: "Catalyst",
            trait: "Initiative",
            description: "Gets a move started and gives everyone else something to react to.",
            attack: "Starts a combination, makes the first run or draws a challenge to open a passing lane.",
            defence: "Closes down the ball carrier and makes them choose their next touch sooner.",
            tip: "Teammates need to follow the first move. Going alone can leave a gap behind them."
        },
        {
            name: "Tactician",
            trait: "Anticipation",
            description: "Thinks about the next touch and tries to be there before it happens.",
            attack: "Places a touch where the next pass or shot will be easier, even if it means slowing down.",
            defence: "Reads a developing pass and steps into its path before the receiver gets there.",
            tip: "Needs a backup plan when the play changes. Waiting for the perfect moment can mean missing it."
        },
        {
            name: "Opportunist",
            trait: "Timing",
            description: "Spots a loose ball, a bad touch or an open angle and takes the chance.",
            attack: "Reaches rebounds and uses shooting angles that are only open for a moment.",
            defence: "Takes possession when an opponent pushes the ball too far or commits to a challenge.",
            tip: "Not every loose ball is worth leaving space for. A teammate may already have it covered."
        },
        {
            name: "Dynamo",
            trait: "Movement",
            description: "Stays involved and keeps coming back for the next part of the play.",
            attack: "Offers another passing option, follows up shots and gets into position for the second ball.",
            defence: "Gets back after losing possession and is ready to challenge again after the first attempt.",
            tip: "Needs somewhere useful to go. Constant movement should not mean chasing every ball."
        },
        {
            name: "Renegade",
            trait: "Unpredictability",
            description: "Takes an unexpected route and makes their own chances when the usual play is not working.",
            attack: "Uses an unusual touch, waits when a pass is expected or suddenly changes direction.",
            defence: "Challenges from an unexpected angle or steps in when most players would retreat.",
            tip: "Can be hard for teammates to read too. They do not have to play aggressively to be unpredictable."
        }
    ];

    const matchups = [
        { strong: "Weaver", weak: "Bulwark", reason: "Close control and direction changes let Weaver work around the route Bulwark is holding." },
        { strong: "Bulwark", weak: "Catalyst", reason: "Bulwark holds position through the first challenge and makes Catalyst commit." },
        { strong: "Bulwark", weak: "Opportunist", reason: "Bulwark shields loose balls and closes the quickest route to goal." },
        { strong: "Catalyst", weak: "Tactician", reason: "Catalyst starts the challenge early and forces Tactician to react before they can settle into position." },
        { strong: "Tactician", weak: "Renegade", reason: "Tactician covers where an unexpected touch could send the ball." },
        { strong: "Tactician", weak: "Opportunist", reason: "Tactician spots the open lane or likely rebound early and gets there first." },
        { strong: "Opportunist", weak: "Dynamo", reason: "Opportunist times a run into the space Dynamo leaves when chasing the ball or rejoining the attack." },
        { strong: "Dynamo", weak: "Catalyst", reason: "Dynamo recovers quickly after the first challenge and contests the second ball." },
        { strong: "Dynamo", weak: "Renegade", reason: "Dynamo can get back into the play after an unexpected touch sends it the other way." },
        { strong: "Renegade", weak: "Weaver", reason: "Renegade changes the timing of the challenge, making it harder for Weaver to draw a predictable commitment and slip around it." }
    ];
    const partnerships = [
        { names: ["Weaver", "Tactician"], reason: "Weaver can keep the ball moving while Tactician gets into position for the next touch." },
        { names: ["Bulwark", "Dynamo"], reason: "Bulwark holds space while Dynamo moves up to support or gets back after a lost ball." },
        { names: ["Bulwark", "Catalyst"], reason: "Bulwark covers behind the first challenge, giving Catalyst room to start the move." },
        { names: ["Catalyst", "Opportunist"], reason: "Catalyst draws the challenge; Opportunist looks for the loose ball or the gap it leaves." },
        { names: ["Tactician", "Renegade"], reason: "Tactician can cover the space behind an unexpected touch, giving Renegade room to improvise." },
        { names: ["Opportunist", "Renegade"], reason: "An unexpected touch from Renegade can leave a loose ball or open angle for Opportunist to use." }
    ];
    const classesByName = new Map(classes.map(playstyle => [playstyle.name, playstyle]));

    const section = document.createElement("section");
    section.className = "page-content classes-content";
    section.setAttribute("aria-labelledby", "class-guide-heading");

    const heading = document.createElement("h2");
    heading.id = "class-guide-heading";
    heading.className = "section-heading";
    heading.textContent = "Seven ways to play";

    const introduction = document.createElement("p");
    introduction.className = "muted";
    introduction.textContent = "Classes describe approach, not skill. Players can use more than one.";

    const grid = document.createElement("div");
    grid.className = "content-grid";

    const panel = document.createElement("dialog");
    panel.id = "class-playstyle-panel";
    panel.className = "class-panel";
    panel.setAttribute("aria-labelledby", "class-panel-title");
    panel.setAttribute("aria-describedby", "class-panel-description");

    const closeButton = document.createElement("button");
    closeButton.type = "button";
    closeButton.className = "class-panel-close";
    closeButton.setAttribute("aria-label", "Close playstyle panel");
    closeButton.autofocus = true;
    const closeIcon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    closeIcon.setAttribute("viewBox", "0 0 24 24");
    closeIcon.setAttribute("aria-hidden", "true");
    closeIcon.setAttribute("focusable", "false");
    closeIcon.setAttribute("fill", "none");
    closeIcon.setAttribute("stroke", "currentColor");
    closeIcon.setAttribute("stroke-width", "2");
    closeIcon.setAttribute("stroke-linecap", "round");
    const closePath = document.createElementNS("http://www.w3.org/2000/svg", "path");
    closePath.setAttribute("d", "M6 6l12 12M18 6 6 18");
    closeIcon.append(closePath);
    closeButton.append(closeIcon);

    const panelControls = document.createElement("div");
    panelControls.className = "class-panel-controls";
    panelControls.append(closeButton);

    const videoArea = document.createElement("div");
    videoArea.className = "class-video";

    const video = document.createElement("video");
    video.controls = true;
    video.playsInline = true;
    video.preload = "none";
    video.textContent = "Your browser does not support HTML video.";

    const videoPlaceholder = document.createElement("p");
    videoPlaceholder.className = "class-video-placeholder";
    videoPlaceholder.textContent = "Video not available yet";
    videoArea.append(video, videoPlaceholder);

    const panelContent = document.createElement("div");
    panelContent.className = "class-panel-content";

    const panelTitle = document.createElement("h2");
    panelTitle.id = "class-panel-title";
    panelTitle.tabIndex = -1;

    const panelDescription = document.createElement("p");
    panelDescription.id = "class-panel-description";

    const columns = document.createElement("div");
    columns.className = "class-panel-columns";

    function textSection(label) {
        const content = document.createElement("section");
        content.className = "class-panel-section";

        const title = document.createElement("h3");
        title.textContent = label;

        const description = document.createElement("p");
        content.append(title, description);
        return { content, description };
    }

    const offence = textSection("Offence");
    const defence = textSection("Defence");
    const teamwork = textSection("Playing together");
    teamwork.content.classList.add("class-panel-tip");
    columns.append(offence.content, defence.content);

    const relationships = document.createElement("section");
    relationships.className = "class-relationships";
    relationships.setAttribute("aria-labelledby", "class-relationships-heading");
    const relationshipsHeading = document.createElement("h3");
    relationshipsHeading.id = "class-relationships-heading";
    relationshipsHeading.textContent = "Matchups & teammates";
    const relationshipsNote = document.createElement("p");
    relationshipsNote.className = "class-relationships-note";
    relationshipsNote.textContent = "Potential matchups and pairings. Position, teammates and individual skill can change how they play out.";
    const relationshipsGrid = document.createElement("div");
    relationshipsGrid.className = "class-relationships-grid";

    function relationshipGroup(label, type) {
        const group = document.createElement("section");
        group.className = `class-relationship-group class-relationship-group--${type}`;
        group.dataset.relationship = type;
        const title = document.createElement("h4");
        title.id = `class-relationship-${type}`;
        title.textContent = label;
        group.setAttribute("aria-labelledby", title.id);
        const list = document.createElement("ul");
        list.className = "class-relationship-list";
        group.append(title, list);
        relationshipsGrid.append(group);
        return list;
    }

    const strongAgainst = relationshipGroup("Strong against", "strong");
    const weakAgainst = relationshipGroup("Weak against", "weak");
    const worksWith = relationshipGroup("Works well with", "teammates");
    relationships.append(relationshipsHeading, relationshipsNote, relationshipsGrid);
    panelContent.append(panelTitle, panelDescription, columns, teamwork.content, relationships);
    panel.append(panelControls, videoArea, panelContent);

    let activeTrigger = null;
    let panelOpen = false;
    let activeClassSlug = "";

    function updateClassRoute(slug) {
        if (!window.BonkRoutes) {
            return;
        }
        try {
            const url = new URL(window.location.href);
            url.hash = slug ? `classes/${slug}` : "classes";
            window.history.replaceState(window.history.state, "", url);
            window.BonkRoutes.sync();
        } catch {
            // A local preview can still show the panel when URL updates are restricted.
        }
    }

    function releasePanel() {
        if (!panelOpen) {
            return;
        }

        panelOpen = false;
        video.pause();

        if (document.fullscreenElement && panel.contains(document.fullscreenElement)
            && typeof document.exitFullscreen === "function") {
            try {
                Promise.resolve(document.exitFullscreen()).catch(() => {});
            } catch {
                // Fullscreen may already be closing when the panel is dismissed.
            }
        }

        document.body.classList.remove("class-panel-open");

        const trigger = activeTrigger;
        activeTrigger = null;

        if (trigger?.isConnected) {
            trigger.focus({ preventScroll: true });
        }
    }

    function closePanel(updateRoute = true) {
        const wasOpen = panelOpen;
        if (panel.open) {
            panel.close();
        }

        releasePanel();
        if (updateRoute && wasOpen && window.location.hash === `#classes/${activeClassSlug}`) {
            updateClassRoute("");
            document.title = "Classes | Bonk Football Division";
        }
    }

    window.closeClassPanel = () => closePanel(false);
    closeButton.addEventListener("click", () => closePanel());
    panel.addEventListener("cancel", event => {
        event.preventDefault();
        closePanel();
    });
    panel.addEventListener("close", () => {
        if (!panel.open) {
            releasePanel();
        }
    });
    panel.addEventListener("click", event => {
        if (event.target !== panel) {
            return;
        }

        const bounds = panel.getBoundingClientRect();
        const outside = event.clientX < bounds.left || event.clientX > bounds.right
            || event.clientY < bounds.top || event.clientY > bounds.bottom;

        if (outside) {
            closePanel();
        }
    });

    function fillRelationships(list, entries) {
        list.replaceChildren();
        for (const { name, reason } of entries) {
            const item = document.createElement("li");
            const relatedClass = document.createElement("button");
            relatedClass.type = "button";
            relatedClass.className = "class-relationship-link";
            relatedClass.textContent = name;
            relatedClass.setAttribute("aria-label", `Read ${name} playstyle`);
            relatedClass.addEventListener("click", () => openPanel(classesByName.get(name)));
            const description = document.createElement("p");
            description.textContent = reason;
            item.append(relatedClass, description);
            list.append(item);
        }
    }

    function openPanel(playstyle, trigger) {
        if (!panel.isConnected) {
            return;
        }

        const switchingClass = panel.open;
        activeClassSlug = playstyle.name.toLowerCase();
        video.pause();
        panelTitle.textContent = playstyle.name;
        panelDescription.textContent = playstyle.description;
        offence.description.textContent = playstyle.attack;
        defence.description.textContent = playstyle.defence;
        teamwork.description.textContent = playstyle.tip;
        fillRelationships(strongAgainst, matchups.filter(matchup => matchup.strong === playstyle.name)
            .map(matchup => ({ name: matchup.weak, reason: matchup.reason })));
        fillRelationships(weakAgainst, matchups.filter(matchup => matchup.weak === playstyle.name)
            .map(matchup => ({ name: matchup.strong, reason: matchup.reason })));
        fillRelationships(worksWith, partnerships.filter(partnership => partnership.names.includes(playstyle.name))
            .map(partnership => ({ name: partnership.names.find(name => name !== playstyle.name), reason: partnership.reason })));
        video.setAttribute("aria-label", `${playstyle.name} playstyle video`);
        if (!switchingClass) {
            activeTrigger = trigger;
            panel.showModal();
            panelOpen = true;
            document.body.classList.add("class-panel-open");
        } else {
            panelTitle.focus({ preventScroll: true });
        }
        panelContent.scrollTop = 0;
        updateClassRoute(activeClassSlug);
        document.title = `${playstyle.name} | Classes | Bonk Football Division`;
    }

    classes.forEach((playstyle, index) => {
        const card = document.createElement("article");
        card.className = "content-card class-card";

        const cardHeading = document.createElement("div");
        cardHeading.className = "class-card-heading";

        const number = document.createElement("span");
        number.className = "class-index";
        number.textContent = String(index + 1).padStart(2, "0");
        number.setAttribute("aria-hidden", "true");

        const title = document.createElement("h3");
        title.textContent = playstyle.name;

        const titleGroup = document.createElement("div");
        titleGroup.className = "class-title";
        titleGroup.append(number, title);

        const trait = document.createElement("span");
        trait.className = "class-trait";
        trait.textContent = playstyle.trait;
        cardHeading.append(titleGroup, trait);

        const description = document.createElement("p");
        description.className = "muted";
        description.textContent = playstyle.description;

        const action = document.createElement("button");
        action.type = "button";
        action.className = "card-action";
        action.textContent = "Read playstyle";
        action.setAttribute("aria-label", `Read ${playstyle.name} playstyle`);
        action.setAttribute("aria-haspopup", "dialog");
        action.setAttribute("aria-controls", panel.id);
        action.dataset.classSlug = playstyle.name.toLowerCase();
        action.addEventListener("click", () => openPanel(playstyle, action));

        card.append(cardHeading, description, action);
        grid.append(card);
    });

    const comparison = document.createElement("p");
    comparison.className = "muted";
    comparison.append(document.createTextNode("A class does not determine a player's tier. Skill is recorded separately in "));

    const assessments = document.createElement("a");
    assessments.href = "#assessments";
    assessments.textContent = "Assessments";
    comparison.append(assessments, document.createTextNode("."));

    section.append(heading, introduction, grid, comparison, panel);
    const initialSlug = typeof initialClass === "string" ? initialClass.toLowerCase() : "";
    const requestedClass = classes.find(playstyle => playstyle.name.toLowerCase() === initialSlug);
    if (requestedClass) {
        window.queueMicrotask(() => {
            if (section.isConnected) {
                openPanel(requestedClass, grid.querySelector(`[data-class-slug="${requestedClass.name.toLowerCase()}"]`));
            }
        });
    }
    return section;
}
