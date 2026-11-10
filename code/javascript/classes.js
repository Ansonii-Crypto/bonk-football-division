"use strict";

function renderClassesPage() {
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
    closeButton.textContent = "\u00d7";

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
    panelContent.append(panelTitle, panelDescription, columns, teamwork.content);
    panel.append(closeButton, videoArea, panelContent);

    let activeTrigger = null;
    let panelOpen = false;

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

    function closePanel() {
        if (panel.open) {
            panel.close();
        }

        releasePanel();
    }

    window.closeClassPanel = closePanel;
    closeButton.addEventListener("click", closePanel);
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

    function openPanel(playstyle, trigger) {
        if (!panel.isConnected) {
            return;
        }

        video.pause();
        panelTitle.textContent = playstyle.name;
        panelDescription.textContent = playstyle.description;
        offence.description.textContent = playstyle.attack;
        defence.description.textContent = playstyle.defence;
        teamwork.description.textContent = playstyle.tip;
        video.setAttribute("aria-label", `${playstyle.name} playstyle video`);
        activeTrigger = trigger;
        panel.showModal();
        panelOpen = true;
        document.body.classList.add("class-panel-open");
        panel.scrollTop = 0;
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
    return section;
}
