const SITE_NAME = "Bonk Football Division";
const SITE_ORIGIN = "https://bonk-football-division.com";
const DEFAULT_DESCRIPTION = "Player assessments, playstyle classes, and football events for the Bonk.io community.";
const CLASS_DESCRIPTIONS = {
    weaver: ["Weaver", "Keeps the ball close and works around a challenge instead of forcing a way through."],
    bulwark: ["Bulwark", "Gets into position early and makes opponents work to get past them."],
    catalyst: ["Catalyst", "Gets a move started and gives everyone else something to react to."],
    tactician: ["Tactician", "Thinks about the next touch and tries to be there before it happens."],
    opportunist: ["Opportunist", "Spots a loose ball, a bad touch or an open angle and takes the chance."],
    dynamo: ["Dynamo", "Stays involved and keeps coming back for the next part of the play."],
    renegade: ["Renegade", "Takes an unexpected route and makes their own chances when the usual play is not working."]
};

function plainText(value, maximum = 300) {
    return typeof value === "string"
        ? Array.from(value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim()).slice(0, maximum).join("")
        : "";
}

function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
}

function validId(value) {
    return /^[1-9][0-9]*$/.test(value) && Number.isSafeInteger(Number(value));
}

function route(pathname) {
    const path = pathname.length > 1 ? pathname.replace(/\/$/, "") : pathname;
    if (["/", "/home", "/index.html"].includes(path)) return { page: "home", path: "/" };
    if (["/assessments", "/players", "/tiers"].includes(path)) return { page: "assessments", path: "/assessments" };
    if (["/classes", "/divisions", "/account", "/profile", "/admin"].includes(path)) return { page: path.slice(1), path };
    const match = /^\/(assessments|divisions|classes)\/([^/]+)$/.exec(path);
    if (!match) return null;
    if (match[1] === "classes") return { page: "classes", item: match[2].toLowerCase(), path: `/classes/${match[2].toLowerCase()}` };
    // Invalid item identifiers still receive an unavailable HTML page, never an arbitrary database lookup.
    return { page: match[1], item: match[2], path, validId: validId(match[2]) };
}

function readableDate(value) {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return "";
    const date = new Date(`${value}T00:00:00Z`);
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
        ? new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(date)
        : "";
}

function unavailable(preview, page) {
    return { ...preview, title: `${page} unavailable | ${SITE_NAME}`,
        description: `This ${page.toLowerCase()} is not publicly available. Explore ${SITE_NAME} for player assessments, classes, and football events.`,
        status: 404, noindex: true };
}

async function previewFor(selected, env) {
    const preview = { title: SITE_NAME, description: DEFAULT_DESCRIPTION, path: selected.path,
        image: "preview", status: 200, noindex: false, private: false };
    if (selected.page === "home") return preview;
    if (selected.page === "classes") {
        Object.assign(preview, { title: `Classes | ${SITE_NAME}`,
            description: "Explore seven Bonk.io football playstyles, with offence, defence, potential matchups and teammate pairings.", image: "classes" });
        if (!selected.item) return preview;
        const playstyle = Object.hasOwn(CLASS_DESCRIPTIONS, selected.item) ? CLASS_DESCRIPTIONS[selected.item] : null;
        return playstyle ? { ...preview, title: `${playstyle[0]} | Classes | ${SITE_NAME}`,
            description: `${playstyle[1]} Explore this class's offence, defence, matchups and teammate pairings.` }
            : unavailable(preview, "Class");
    }
    if (["account", "profile", "admin"].includes(selected.page)) {
        const labels = { account: "Account center", profile: "Your profile", admin: "Management" };
        return { ...preview, title: `${labels[selected.page]} | ${SITE_NAME}`,
            description: "Sign in with your Bonk.io account to access your profile and account options. Administrator tools are available to authorised accounts.",
            private: true, noindex: true };
    }
    if (selected.page === "assessments") {
        Object.assign(preview, { title: `Assessments | ${SITE_NAME}`,
            description: "Browse Bonk.io football player assessments, compare six attributes, and find players by tier or playstyle.", image: "assessments" });
        if (!selected.item) return preview;
        if (!selected.validId) return unavailable(preview, "Assessment");
        try {
            // This is the public assessment view. Do not select private identity, notes, or session fields.
            const row = await env.DB.prepare(`SELECT player_name, class_name, assessment_date, total, tier
                FROM assessments WHERE id = ?`).bind(Number(selected.item)).first();
            if (!row) return unavailable(preview, "Assessment");
            const name = plainText(row.player_name, 100) || "Player";
            const tier = /^[SABCDEF]$/.test(row.tier) ? `${row.tier} Tier` : "Football assessment";
            const score = Number.isInteger(row.total) && row.total >= 0 && row.total <= 1800 ? `${row.total} / 1800 points` : "";
            const date = readableDate(row.assessment_date);
            return { ...preview, title: `${name} — ${tier} | ${SITE_NAME}`,
                description: plainText([name, tier, score, plainText(row.class_name, 100), date && `Assessed ${date}`].filter(Boolean).join(" · ")) };
        } catch {
            // A temporary database failure must not expose diagnostics or stop the client application loading.
            return { ...preview, private: true, noindex: true, status: 503 };
        }
    }
    if (selected.page === "divisions") {
        Object.assign(preview, { title: `Divisions | ${SITE_NAME}`,
            description: "Follow Bonk.io football events, tournament brackets, timelines, teams and published division updates.", image: "divisions" });
        if (!selected.item) return preview;
        if (!selected.validId) return unavailable(preview, "Division");
        try {
            // Only the published snapshot may appear in a link preview, including for signed-in managers.
            const row = await env.DB.prepare("SELECT published_json FROM divisions WHERE id = ? AND published_json IS NOT NULL")
                .bind(Number(selected.item)).first();
            if (!row) return unavailable(preview, "Division");
            const content = JSON.parse(row.published_json);
            const name = plainText(content.name, 120) || "Football division";
            const statuses = { registration: "Registration open", upcoming: "Upcoming", live: "Live", completed: "Completed", draft: "" };
            const date = readableDate(content.startDate);
            return { ...preview, title: `${name} | ${SITE_NAME}`,
                description: plainText([plainText(content.summary, 220) || "Follow the fixtures, teams and updates for this football event.",
                    Object.hasOwn(statuses, content.status) ? statuses[content.status] : "", date].filter(Boolean).join(" · ")) };
        } catch {
            return { ...preview, private: true, noindex: true, status: 503 };
        }
    }
    return preview;
}

function tags(preview) {
    const image = `${SITE_ORIGIN}/assets/social/${preview.image}.png`;
    const url = SITE_ORIGIN + preview.path;
    const meta = (name, value, attribute = "property") => `        <meta ${attribute}="${name}" content="${escapeHtml(value)}">`;
    return [
        `        <title>${escapeHtml(preview.title)}</title>`,
        meta("description", preview.description, "name"),
        `        <link rel="canonical" href="${escapeHtml(url)}">`,
        meta("og:site_name", SITE_NAME), meta("og:type", "website"),
        meta("og:title", preview.title), meta("og:description", preview.description), meta("og:url", url),
        meta("og:image", image), meta("og:image:secure_url", image), meta("og:image:type", "image/png"),
        meta("og:image:width", "1200"), meta("og:image:height", "630"),
        meta("og:image:alt", `${SITE_NAME} — ${preview.image === "preview" ? "Bonk.io football assessments, classes and divisions" : preview.image}`),
        meta("twitter:card", "summary_large_image", "name"), meta("twitter:title", preview.title, "name"),
        meta("twitter:description", preview.description, "name"), meta("twitter:image", image, "name"),
        ...(preview.noindex ? [meta("robots", "noindex, nofollow", "name")] : [])
    ].join("\n");
}

export async function handlePreviewRequest(request, env) {
    if (!["GET", "HEAD"].includes(request.method)) return null;
    const url = new URL(request.url);
    const selected = route(url.pathname);
    if (!selected) return null;
    // Fetch the root static asset directly. Asking the asset binding for index.html can cause a canonical redirect.
    const asset = await env.ASSETS.fetch(new Request(new URL("/", url.origin), { headers: { Accept: "text/html" } }));
    if (!asset.ok) return request.method === "HEAD" ? new Response(null, { status: asset.status, headers: asset.headers }) : asset;
    let html = await asset.text();
    if (!/<\/head\s*>/i.test(html)) {
        // Non-HTML asset stubs and fallback responses retain their ordinary behaviour.
        return new Response(request.method === "HEAD" ? null : html, { status: asset.status, headers: asset.headers });
    }
    let preview;
    if (selected.item && selected.validId && env.API_RATE_LIMITER) {
        // Deep-link previews have their own public budget and never read the visitor's account session.
        try {
            const ip = request.headers.get("CF-Connecting-IP") || "unknown";
            if (!(await env.API_RATE_LIMITER.limit({ key: `preview:${ip}` })).success) {
                preview = { ...await previewFor({ ...selected, item: undefined }, env), private: true, noindex: true, status: 429 };
            }
        } catch {
            preview = { ...await previewFor({ ...selected, item: undefined }, env), private: true, noindex: true, status: 503 };
        }
    }
    preview ||= await previewFor(selected, env);
    html = html.replace(/<title\b[^>]*>[\s\S]*?<\/title\s*>/gi, "")
        .replace(/<meta\b[^>]*>/gi, tag => /\b(?:name|property)\s*=\s*(["'])(?:description|og:[^"']+|twitter:[^"']+|robots)\1/i.test(tag) ? "" : tag)
        .replace(/<link\b[^>]*>/gi, tag => /\brel\s*=\s*(["'])canonical\1/i.test(tag) ? "" : tag)
        .replace(/(\b(?:src|href)\s*=\s*["'])(?:\.\.?\/)+(css|javascript|assets)\//gi, "$1/$2/")
        .replace(/<\/head\s*>/i, `${tags(preview)}\n    </head>`);
    const headers = new Headers(asset.headers);
    for (const name of ["Content-Length", "Content-Encoding", "ETag", "Last-Modified", "Set-Cookie"]) headers.delete(name);
    headers.set("Content-Type", "text/html; charset=utf-8");
    headers.set("Cache-Control", preview.private ? "no-store" : "public, max-age=60, s-maxage=60");
    headers.set("X-Content-Type-Options", "nosniff");
    if (preview.status === 429) headers.set("Retry-After", "60");
    if (preview.noindex) headers.set("X-Robots-Tag", "noindex, nofollow");
    return new Response(request.method === "HEAD" ? null : html, { status: preview.status, headers });
}
