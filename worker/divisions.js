const SECTIONS = ["general", "appearance", "participation", "timeline", "teams", "bracket", "campaigns", "referendums", "polls", "custom"];
const OPTIONAL_SECTIONS = ["participation", "timeline", "teams", "bracket", "campaigns", "referendums", "polls"];
const GENERAL_FIELDS = ["name", "summary", "description", "status", "startDate", "endDate"];
const ROLES = ["director", "organizer", "editor"];
const CONTENT_FIELDS = [...GENERAL_FIELDS, "appearance", "textStyles", "sectionOrder", "customSections", "archivedSections", "participation", "timeline", "campaigns", "referendums", "polls", "teams", "results"];

function object(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}

function integer(value, maximum = Number.MAX_SAFE_INTEGER) {
    const text = String(value ?? "");
    const number = Number(text);
    return /^[1-9][0-9]*$/.test(text) && Number.isSafeInteger(number) && number <= maximum ? number : null;
}

function text(value, maximum, required = false) {
    return typeof value === "string" && value.length <= maximum && (!required || value.trim().length > 0)
        && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value);
}

function identifier(value) {
    return typeof value === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(value);
}

function appearance(content) {
    const value = { backgroundColor: content.appearance?.backgroundColor ?? "", backgroundImage: content.appearance?.backgroundImage ?? "" };
    for (const key of ["bannerColor", "bannerImage"]) {
        if (Object.hasOwn(content.appearance || {}, key)) value[key] = content.appearance[key];
    }
    return value;
}

function customSections(content) {
    return Array.isArray(content.customSections) ? content.customSections : [];
}

function polls(content) {
    return Array.isArray(content.polls) ? content.polls : [];
}

function archivedSections(content) {
    return Array.isArray(content.archivedSections) ? content.archivedSections : [];
}

function restrictedArchives(content) {
    return archivedSections(content).filter(section => !["campaigns", "referendums", "polls", "custom"].includes(section.type))
        .sort((first, second) => first.id.localeCompare(second.id));
}

function sectionOrder(content) {
    if (Array.isArray(content.sectionOrder)) {
        return [...content.sectionOrder];
    }
    const builtIn = OPTIONAL_SECTIONS.filter(key => key === "participation"
        || key === "bracket" && content.teams?.length >= 2
        || key !== "bracket" && Array.isArray(content[key]) && content[key].length > 0);
    if (["live", "completed"].includes(content.status) && builtIn.includes("bracket")) {
        builtIn.splice(builtIn.indexOf("bracket"), 1);
        builtIn.unshift("bracket");
    }
    return [...builtIn, ...customSections(content).map(section => `custom:${section.id}`)];
}

function validAppearance(value) {
    if (value === undefined) {
        return true;
    }
    if (!object(value) || Object.keys(value).some(key => !["backgroundColor", "backgroundImage", "bannerColor", "bannerImage"].includes(key))) {
        return false;
    }
    for (const [colorKey, imageKey] of [["backgroundColor", "backgroundImage"], ["bannerColor", "bannerImage"]]) {
        const color = value[colorKey] === undefined ? "" : value[colorKey];
        const image = value[imageKey] === undefined ? "" : value[imageKey];
        if (typeof color !== "string" || color !== "" && !/^#[0-9a-f]{6}$/i.test(color)
            || typeof image !== "string" || image.length > 2048 || /[\u0000-\u0020\u007f]/.test(image)) return false;
        if (image === "") continue;
        try {
            const url = new URL(image);
            if (!/^https:\/\//i.test(image) || url.protocol !== "https:" || !url.hostname || url.username || url.password) return false;
        } catch {
            return false;
        }
    }
    return true;
}

function styledText(content, path) {
    if (["general.name", "general.summary", "general.description"].includes(path)) return content[path.slice(8)];
    if (path === "participation.description") return content.participation.description;
    const match = /^(timeline|campaigns|referendums|polls|custom|teams)\.([A-Za-z0-9_-]{1,64})\.(title|description|name)$/.exec(path);
    if (!match || match[1] === "teams" && match[3] !== "name" || match[1] !== "teams" && match[3] === "name") return null;
    const collection = match[1] === "custom" ? customSections(content) : content[match[1]];
    return (Array.isArray(collection) ? collection : []).find(item => item.id === match[2])?.[match[3]] ?? null;
}

function validTextStyles(content) {
    const styles = content.textStyles;
    if (styles === undefined) return true;
    if (!object(styles) || Object.keys(styles).length > 200) return false;
    let total = 0;
    const boundary = (value, index) => index === 0 || index === value.length
        || !(value.charCodeAt(index - 1) >= 0xd800 && value.charCodeAt(index - 1) <= 0xdbff
            && value.charCodeAt(index) >= 0xdc00 && value.charCodeAt(index) <= 0xdfff);
    for (const [path, runs] of Object.entries(styles)) {
        const value = styledText(content, path);
        if (typeof value !== "string" || !Array.isArray(runs) || runs.length > 100) return false;
        total += runs.length;
        if (total > 1000) return false;
        let end = 0;
        for (const run of runs) {
            if (!object(run) || Object.keys(run).some(key => !["start", "end", "bold", "italic", "underline", "color", "font", "size"].includes(key))
                || !Number.isInteger(run.start) || !Number.isInteger(run.end) || run.start < end || run.end <= run.start || run.end > value.length
                || !boundary(value, run.start) || !boundary(value, run.end)
                || ["bold", "italic", "underline"].some(key => run[key] !== undefined && run[key] !== true)
                || run.color !== undefined && (typeof run.color !== "string" || !/^#[0-9a-f]{6}$/i.test(run.color))
                || run.font !== undefined && !["default", "sans", "serif", "mono"].includes(run.font)
                || run.size !== undefined && !["small", "normal", "large"].includes(run.size)) return false;
            end = run.end;
        }
    }
    return true;
}

function editorTextStyle(path) {
    return path === "general.description" || /^(campaigns|referendums|polls|custom)\./.test(path);
}

function restrictedTextStyles(content) {
    return Object.entries(content.textStyles || {}).filter(([path]) => !editorTextStyle(path))
        .sort(([first], [second]) => first.localeCompare(second))
        .map(([path, runs]) => [path, runs.map(run => Object.fromEntries(Object.keys(run).sort().map(key => [key, run[key]])))]);
}

function date(value) {
    if (value === "") {
        return true;
    }
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        return false;
    }
    const parsed = new Date(value);
    const [year, month, day] = value.slice(0, 10).split("-").map(Number);
    const check = new Date(Date.UTC(year, month - 1, day));
    return Number.isFinite(parsed.getTime()) && year >= 1900 && year <= 2100
        && check.getUTCFullYear() === year && check.getUTCMonth() === month - 1 && check.getUTCDate() === day;
}

export function divisionRequestMethods(path) {
    if (/^\/api\/divisions\/[1-9][0-9]*\/polls$/.test(path)) return "GET";
    if (/^\/api\/divisions\/[1-9][0-9]*\/polls\/[A-Za-z0-9_-]{1,64}\/vote$/.test(path)) return "POST";
    if (path === "/api/divisions" || /^\/api\/divisions\/[1-9][0-9]*$/.test(path)
        || path === "/api/manage/divisions") {
        return "GET";
    }
    if (path === "/api/admin/divisions") {
        return "POST";
    }
    if (/^\/api\/manage\/divisions\/[1-9][0-9]*$/.test(path)) {
        return "GET, PUT";
    }
    if (/^\/api\/manage\/divisions\/[1-9][0-9]*\/(?:publish|unpublish)$/.test(path)) {
        return "POST";
    }
    if (/^\/api\/manage\/divisions\/[1-9][0-9]*\/members$/.test(path)) {
        return "GET, POST";
    }
    if (/^\/api\/manage\/divisions\/[1-9][0-9]*\/members\/[1-9][0-9]*$/.test(path)) {
        return "DELETE";
    }
    return null;
}

function defaultContent(name, summary) {
    return {
        name, summary, description: "", status: "upcoming", startDate: "", endDate: "",
        appearance: { backgroundColor: "", backgroundImage: "" },
        sectionOrder: [],
        customSections: [],
        archivedSections: [],
        participation: { mode: "solo", teamSize: 1, registration: "closed", description: "" },
        timeline: [], campaigns: [], referendums: [], polls: [], teams: [], results: {}
    };
}

function validateContent(content, positiveBonkId, validateArchives = true) {
    if (!object(content) || Object.keys(content).some(key => !CONTENT_FIELDS.includes(key))) {
        return "Send the division's content in the supported format.";
    }
    if (!text(content.name, 120, true) || !text(content.summary, 300) || !text(content.description, 6000)) {
        return "Enter a division name (up to 120 characters), a short summary, and a description up to 6000 characters.";
    }
    if (!validAppearance(content.appearance)) {
        return "Use six-digit hex background and banner colors and optional absolute HTTPS image URLs without login details.";
    }
    if (content.customSections !== undefined && (!Array.isArray(content.customSections) || content.customSections.length > 20)) {
        return "Use at most 20 custom page sections.";
    }
    const custom = customSections(content);
    const customIds = new Set();
    for (const section of custom) {
        if (!object(section) || !identifier(section.id) || customIds.has(section.id)
            || Object.keys(section).some(key => !["id", "title", "description"].includes(key))
            || !text(section.title, 120, true) || !text(section.description, 6000)) {
            return "Each custom section needs a unique ID, a title up to 120 characters and text up to 6000 characters.";
        }
        customIds.add(section.id);
    }
    const validSectionKey = key => OPTIONAL_SECTIONS.includes(key)
        || typeof key === "string" && key.startsWith("custom:") && customIds.has(key.slice(7));
    if (content.sectionOrder !== undefined && (!Array.isArray(content.sectionOrder)
        || content.sectionOrder.length > OPTIONAL_SECTIONS.length + 20
        || new Set(content.sectionOrder).size !== content.sectionOrder.length
        || content.sectionOrder.some(key => !validSectionKey(key)))) {
        return "Choose each supported page section at most once in the section order.";
    }
    if (!["upcoming", "registration", "live", "completed"].includes(content.status)
        || !date(content.startDate) || !date(content.endDate)) {
        return "Choose a listed event status and valid start and end dates.";
    }
    if (content.startDate && content.endDate && new Date(content.startDate) > new Date(content.endDate)) {
        return "The end date must be on or after the start date.";
    }
    const participation = content.participation;
    if (!object(participation) || !["solo", "teams"].includes(participation.mode)
        || !Number.isInteger(participation.teamSize) || participation.teamSize < 1 || participation.teamSize > 4
        || participation.mode === "solo" && participation.teamSize !== 1
        || !["open", "invite-only", "closed"].includes(participation.registration)
        || !text(participation.description, 2000)) {
        return "Choose a participation format from 1v1 to 4v4 and a listed registration status.";
    }
    for (const [key, maximum] of [["timeline", 30], ["campaigns", 20], ["referendums", 20], ["teams", 16]]) {
        if (!Array.isArray(content[key]) || content[key].length > maximum) {
            return `Use at most ${maximum} ${key} entries.`;
        }
        const ids = new Set();
        for (const item of content[key]) {
            if (!object(item) || !identifier(item.id) || ids.has(item.id)) {
                return `Every ${key} entry needs a unique ID.`;
            }
            ids.add(item.id);
        }
    }
    if (content.timeline.some(item => !text(item.title, 120, true) || !date(item.date)
        || !text(item.description, 1000))) {
        return "Each timeline stage needs a title, a valid optional date, and a description up to 1000 characters.";
    }
    if (content.campaigns.some(item => !text(item.title, 120, true) || !text(item.description, 2000))) {
        return "Each campaign needs a title and a description up to 2000 characters.";
    }
    if (content.referendums.some(item => !text(item.title, 200, true) || !text(item.description, 2000)
        || !["planned", "open", "closed"].includes(item.status) || !Array.isArray(item.options)
        || item.options.length < 2 || item.options.length > 8 || item.options.some(option => !text(option, 120, true)))) {
        return "Each referendum needs a question, a listed status, and two to eight options.";
    }
    if (content.polls !== undefined && (!Array.isArray(content.polls) || content.polls.length > 20)) {
        return "Use at most 20 polls.";
    }
    const pollIds = new Set();
    for (const poll of polls(content)) {
        if (!object(poll) || !identifier(poll.id) || pollIds.has(poll.id)
            || Object.keys(poll).some(key => !["id", "title", "description", "options", "status"].includes(key))
            || !text(poll.title, 200, true) || !text(poll.description, 2000)
            || !["planned", "open", "closed"].includes(poll.status) || !Array.isArray(poll.options)
            || poll.options.length < 2 || poll.options.length > 8 || poll.options.some(option => !text(option, 120, true))
            || new Set(poll.options.map(option => option.trim().toLowerCase())).size !== poll.options.length) {
            return "Each poll needs a unique ID, a question up to 200 characters, a listed status, and two to eight distinct choices.";
        }
        pollIds.add(poll.id);
    }
    const teamIds = new Set(content.teams.map(team => team.id));
    const rosterNames = new Set();
    const rosterIds = new Set();
    for (const team of content.teams) {
        if (!text(team.name, 100, true) || !Array.isArray(team.players) || !team.players.length
            || team.players.length > participation.teamSize) {
            return `Each entrant needs a name and one to ${participation.teamSize} players.`;
        }
        for (const player of team.players) {
            if (!object(player) || !text(player.username, 100, true)
                || player.bonkId !== null && player.bonkId !== undefined && !positiveBonkId(player.bonkId)) {
                return "Enter each roster username and a valid optional Bonk player ID.";
            }
            const name = player.username.toLowerCase();
            if (rosterNames.has(name) || player.bonkId && rosterIds.has(String(player.bonkId))) {
                return "A player can appear only once in the division roster.";
            }
            rosterNames.add(name);
            if (player.bonkId) {
                rosterIds.add(String(player.bonkId));
            }
        }
    }
    if (!object(content.results) || Object.keys(content.results).length > 15) {
        return "Use at most 15 bracket results.";
    }
    const slots = Math.max(2, 2 ** Math.ceil(Math.log2(Math.max(content.teams.length, 1))));
    const rounds = Math.log2(slots);
    for (const [key, result] of Object.entries(content.results)) {
        const match = /^([0-3])-([0-7])$/.exec(key);
        if (!match || Number(match[1]) >= rounds || Number(match[2]) >= slots / 2 ** (Number(match[1]) + 1)
            || !object(result) || ![result.teamAId, result.teamBId].every(id => id === null || teamIds.has(id))
            || result.teamAId !== null && result.teamAId === result.teamBId
            || ![result.scoreA, result.scoreB].every(score => score === null || Number.isInteger(score) && score >= 0 && score <= 99)
            || (result.scoreA !== null || result.scoreB !== null) && (!result.teamAId || !result.teamBId)) {
            return "Bracket results need valid match positions, entrant IDs, and scores from 0 to 99.";
        }
    }
    if (!validTextStyles(content)) {
        return "Use supported text formatting with valid field names and non-overlapping ranges within the field's text.";
    }
    if (validateArchives) {
        if (content.archivedSections !== undefined && (!Array.isArray(content.archivedSections) || content.archivedSections.length > 30)) {
            return "Keep at most 30 archived sections. Remove older archives before saving more.";
        }
        const keysByType = { participation: ["participation"], timeline: ["timeline"], teams: ["teams", "results"],
            bracket: ["teams", "results"], campaigns: ["campaigns"], referendums: ["referendums"], polls: ["polls"], custom: ["customSections"] };
        const archiveIds = new Set();
        for (const archive of archivedSections(content)) {
            if (!object(archive) || !identifier(archive.id) || archiveIds.has(archive.id)
                || Object.keys(archive).some(key => !["id", "type", "title", "archivedAt", "content", "textStyles"].includes(key))
                || !Object.hasOwn(keysByType, archive.type) || !text(archive.title, 120)
                || !Number.isSafeInteger(archive.archivedAt) || archive.archivedAt < 0 || !object(archive.content)) {
                return "Each archived section needs a unique ID, a supported template, a title and an archive time.";
            }
            archiveIds.add(archive.id);
            const keys = keysByType[archive.type];
            if (Object.keys(archive.content).length !== keys.length || keys.some(key => !Object.hasOwn(archive.content, key))
                || archive.type === "custom" && (!Array.isArray(archive.content.customSections) || archive.content.customSections.length !== 1)) {
                return "Archived sections must contain only the content for their own template.";
            }
            if (archive.textStyles !== undefined && (!object(archive.textStyles) || Object.keys(archive.textStyles).some(path => {
                if (archive.type === "participation") return path !== "participation.description";
                const prefix = archive.type === "custom" ? "custom" : ["teams", "bracket"].includes(archive.type) ? "teams" : archive.type;
                return !path.startsWith(`${prefix}.`);
            }))) {
                return "Archived formatting must belong to that section's own text fields.";
            }
            const sample = { ...defaultContent("Archived section", ""),
                participation: { mode: "teams", teamSize: 4, registration: "closed", description: "" },
                ...archive.content, ...(archive.textStyles === undefined ? {} : { textStyles: archive.textStyles }) };
            const error = validateContent(sample, positiveBonkId, false);
            if (error) return `Archived section: ${error}`;
        }
    }
    return null;
}

function permissions(role) {
    return {
        editSections: role === "editor" ? ["general", "appearance", "campaigns", "referendums", "polls", "custom"] : [...SECTIONS],
        generalFields: role === "editor" ? ["description"] : [...GENERAL_FIELDS],
        publish: ["site-admin", "director"].includes(role),
        manageMembers: ["site-admin", "director"].includes(role),
        assignRoles: role === "site-admin" ? [...ROLES] : role === "director" ? ["organizer", "editor"] : []
    };
}

function managedDivision(row, role) {
    const content = JSON.parse(row.draft_json);
    content.appearance = appearance(content);
    content.customSections = customSections(content);
    content.polls = polls(content);
    content.archivedSections = archivedSections(content);
    content.sectionOrder = sectionOrder(content);
    return {
        id: row.id, content, version: row.version,
        publishedAt: row.published_at, publishedVersion: row.published_version,
        updatedAt: row.updated_at, role, permissions: permissions(role)
    };
}

function publicContent(serialized) {
    const content = JSON.parse(serialized);
    delete content.archivedSections;
    content.appearance = appearance(content);
    content.customSections = customSections(content);
    content.polls = polls(content);
    content.sectionOrder = sectionOrder(content);
    content.teams = content.teams.map(team => ({
        ...team,
        players: team.players.map(player => ({ username: player.username }))
    }));
    return content;
}

function summary(row, managed = false) {
    const content = JSON.parse(managed ? row.draft_json : row.published_json);
    const data = { id: row.id, name: content.name, summary: content.summary, status: content.status,
        appearance: appearance(content),
        participation: { mode: content.participation?.mode ?? "solo", teamSize: content.participation?.teamSize ?? 1,
            registration: content.participation?.registration ?? "closed" },
        entrantCount: Array.isArray(content.teams) ? content.teams.length : 0,
        startDate: content.startDate, endDate: content.endDate, publishedAt: row.published_at,
        updatedAt: managed ? row.updated_at : row.published_at };
    if (managed) {
        Object.assign(data, { version: row.version, publishedVersion: row.published_version,
            role: row.role, permissions: permissions(row.role) });
    }
    return data;
}

async function managedRow(env, id, account, json) {
    if (!account) {
        return { response: json({ error: "Sign in to manage a division." }, 401) };
    }
    const row = await env.DB.prepare("SELECT * FROM divisions WHERE id = ?").bind(id).first();
    if (!row) {
        return { response: json({ error: "Division not found." }, 404) };
    }
    const member = account.isAdmin ? null : await env.DB.prepare("SELECT role FROM division_members WHERE division_id = ? AND bonk_id = ?")
        .bind(id, account.bonkId).first();
    const role = account.isAdmin ? "site-admin" : member?.role;
    return role ? { row, role } : { response: json({ error: "You do not manage this division." }, 403) };
}

async function listDivisions(env, url, account, managed, json) {
    if (managed && !account) {
        return json({ error: "Sign in to view your divisions." }, 401);
    }
    const page = integer(url.searchParams.get("page") || "1", 100000);
    const limit = integer(url.searchParams.get("limit") || "12", 24);
    if (!page || !limit) {
        return json({ error: "Choose a valid division page and page size." }, 400);
    }
    const status = url.searchParams.get("status") ?? "all";
    const publication = url.searchParams.get("publication") ?? "all";
    if (!managed && !["all", "live", "upcoming", "registration", "completed"].includes(status)) {
        return json({ error: "Choose a valid event status." }, 400);
    }
    if (managed && !["all", "drafts"].includes(publication)) {
        return json({ error: "Choose all managed divisions or drafts." }, 400);
    }
    const scoped = managed && !account.isAdmin;
    const from = scoped ? "divisions d JOIN division_members m ON d.id = m.division_id" : "divisions d";
    const conditions = [];
    const bindings = [];
    const publicStatus = "json_extract(d.published_json, '$.status')";
    if (scoped) {
        conditions.push("m.bonk_id = ?");
        bindings.push(account.bonkId);
    }
    if (!managed) {
        conditions.push("d.published_json IS NOT NULL");
        if (status === "upcoming") {
            conditions.push(`${publicStatus} IN ('upcoming', 'registration')`);
        } else if (status !== "all") {
            conditions.push(`${publicStatus} = ?`);
            bindings.push(status);
        }
    } else if (publication === "drafts") {
        conditions.push("(d.published_json IS NULL OR d.published_version IS NULL OR d.version != d.published_version)");
    }
    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const count = await env.DB.prepare(`SELECT COUNT(*) AS total FROM ${from} ${where}`).bind(...bindings).first();
    const total = count?.total || 0;
    const pages = Math.max(1, Math.ceil(total / limit));
    const actualPage = Math.min(page, pages);
    const roleColumn = scoped ? "m.role" : "'site-admin' AS role";
    const order = managed ? "d.updated_at DESC, d.id DESC" : `CASE ${publicStatus}
        WHEN 'live' THEN 0 WHEN 'upcoming' THEN 1 WHEN 'registration' THEN 1 WHEN 'completed' THEN 2 ELSE 3 END ASC,
        CASE WHEN ${publicStatus} IN ('upcoming', 'registration')
            THEN COALESCE(NULLIF(json_extract(d.published_json, '$.startDate'), ''), '9999-12-31') END ASC,
        d.published_at DESC, d.id DESC`;
    const rows = await env.DB.prepare(`SELECT d.*, ${roleColumn} FROM ${from} ${where} ORDER BY ${order} LIMIT ? OFFSET ?`)
        .bind(...bindings, limit, (actualPage - 1) * limit).all();
    return json({ divisions: rows.results.map(row => summary(row, managed)), total, pages, page: actualPage });
}

async function members(env, id) {
    const rows = await env.DB.prepare(`SELECT m.bonk_id, u.username, m.role FROM division_members m
        JOIN bonk_users u ON u.bonk_id = m.bonk_id WHERE m.division_id = ?
        ORDER BY CASE m.role WHEN 'director' THEN 0 WHEN 'organizer' THEN 1 ELSE 2 END, u.username COLLATE NOCASE`)
        .bind(id).all();
    return { members: rows.results.map(row => ({ bonkId: row.bonk_id, username: row.username, role: row.role })) };
}

async function pollRevision(poll) {
    const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify([poll.title, poll.options])));
    return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, "0")).join("");
}

async function pollResults(env, row, account) {
    const content = JSON.parse(row.published_json);
    const visible = sectionOrder(content).includes("polls") ? polls(content) : [];
    const results = await Promise.all(visible.map(async poll => ({
        id: poll.id, title: poll.title, options: [...poll.options], status: poll.status, revision: await pollRevision(poll),
        counts: poll.options.map(() => 0), total: 0, selectedOption: null, canVote: Boolean(account && poll.status === "open")
    })));
    if (results.length) {
        const rows = await env.DB.prepare(`SELECT poll_id, revision, option_index, COUNT(*) AS votes,
            MAX(CASE WHEN bonk_id = ? THEN 1 ELSE 0 END) AS own_vote
            FROM division_poll_votes WHERE division_id = ? AND (${results.map(() => "(poll_id = ? AND revision = ?)").join(" OR ")})
            GROUP BY poll_id, revision, option_index`)
            .bind(account?.bonkId || "", row.id, ...results.flatMap(poll => [poll.id, poll.revision])).all();
        for (const count of rows.results) {
            const poll = results.find(poll => poll.id === count.poll_id && poll.revision === count.revision);
            if (!poll || !Number.isInteger(count.option_index) || count.option_index < 0 || count.option_index >= poll.counts.length) continue;
            poll.counts[count.option_index] = Number(count.votes);
            poll.total += Number(count.votes);
            if (count.own_vote) poll.selectedOption = count.option_index;
        }
    }
    return { polls: results, signedIn: Boolean(account) };
}

async function handlePollRequest(request, env, id, pollId, account, readJson, json) {
    if (request.method === "POST" && !account) return json({ error: "Sign in with your Bonk account to vote." }, 401);
    const row = await env.DB.prepare("SELECT id, published_json FROM divisions WHERE id = ? AND published_json IS NOT NULL").bind(id).first();
    if (!row) return json({ error: "Division not found." }, 404);
    if (request.method === "GET") return json(await pollResults(env, row, account));
    const content = JSON.parse(row.published_json);
    const poll = sectionOrder(content).includes("polls") ? polls(content).find(item => item.id === pollId) : null;
    if (!poll) return json({ error: "That poll is not publicly available." }, 404);
    if (poll.status !== "open") return json({ error: "That poll is not open for voting." }, 409);
    const body = await readJson(request);
    if (!body || Object.keys(body).some(key => !["option", "revision"].includes(key))
        || !Number.isInteger(body.option) || body.option < 0 || body.option >= poll.options.length
        || typeof body.revision !== "string" || !/^[a-f0-9]{64}$/.test(body.revision)) {
        return json({ error: "Choose one of the current poll options." }, 400);
    }
    const revision = await pollRevision(poll);
    if (body.revision !== revision) return json({ error: "This poll changed. Refresh it before voting." }, 409);
    // The publication check and write share one SQLite statement so a concurrent
    // close, removal or publication cannot authorise a vote against a stale poll.
    const saved = await env.DB.prepare(`INSERT INTO division_poll_votes (division_id, poll_id, revision, bonk_id, option_index, updated_at)
        SELECT ?, ?, ?, ?, ?, ? FROM divisions WHERE id = ? AND published_json = ?
        ON CONFLICT(division_id, poll_id, revision, bonk_id) DO UPDATE SET
            option_index = excluded.option_index, updated_at = excluded.updated_at
        RETURNING option_index`)
        .bind(id, poll.id, revision, account.bonkId, body.option, Date.now(), id, row.published_json).first();
    if (!saved) return json({ error: "This division changed. Refresh the poll before voting." }, 409);
    return json(await pollResults(env, row, account));
}

export async function handleDivisionRequest(request, env, url, account, readJson, json, positiveBonkId) {
    const path = url.pathname;
    if (path === "/api/divisions" || path === "/api/manage/divisions") {
        return listDivisions(env, url, account, path.startsWith("/api/manage/"), json);
    }
    if (path === "/api/admin/divisions") {
        if (!account) {
            return json({ error: "Sign in to create a division." }, 401);
        }
        if (!account.isAdmin) {
            return json({ error: "Only a site administrator can create a division." }, 403);
        }
        const body = await readJson(request);
        if (!body || !text(body.name, 120, true) || !text(body.summary ?? "", 300)) {
            return json({ error: "Enter a division name up to 120 characters and a short summary." }, 400);
        }
        const timestamp = Date.now();
        const row = await env.DB.prepare(`INSERT INTO divisions (draft_json, created_at, updated_at, created_by_bonk_id)
            VALUES (?, ?, ?, ?) RETURNING *`)
            .bind(JSON.stringify(defaultContent(body.name, body.summary ?? "")), timestamp, timestamp, account.bonkId).first();
        return json({ division: managedDivision(row, "site-admin") }, 201);
    }
    const parts = path.split("/");
    const isPublic = parts[2] === "divisions";
    const id = integer(parts[isPublic ? 3 : 4]);
    if (!id) {
        return json({ error: "Division not found." }, 404);
    }
    if (isPublic) {
        if (parts[4] === "polls") return handlePollRequest(request, env, id, parts[5], account, readJson, json);
        const row = await env.DB.prepare("SELECT * FROM divisions WHERE id = ? AND published_json IS NOT NULL").bind(id).first();
        return row ? json({ division: { id: row.id, content: publicContent(row.published_json),
            publishedAt: row.published_at, updatedAt: row.published_at } }) : json({ error: "Division not found." }, 404);
    }
    const access = await managedRow(env, id, account, json);
    if (access.response) {
        return access.response;
    }
    const { row, role } = access;
    const rights = permissions(role);
    const action = parts[5];
    if (action === "members") {
        if (request.method === "GET") {
            return json(await members(env, id));
        }
        if (!rights.manageMembers) {
            return json({ error: "Only a division director or site administrator can manage roles." }, 403);
        }
        const body = request.method === "POST" ? await readJson(request) : null;
        let bonkId;
        if (request.method === "DELETE") {
            bonkId = positiveBonkId(parts[6]);
            if (!bonkId) return json({ error: "Enter a valid Bonk player ID." }, 400);
        } else {
            if (!object(body)) return json({ error: "Enter a Bonk username or player ID." }, 400);
            if (!rights.assignRoles.includes(body.role)) {
                return json({ error: "Choose a role you are allowed to assign." }, 403);
            }
            const hasId = body.bonkId !== undefined && body.bonkId !== null && body.bonkId !== "";
            const hasName = body.username !== undefined && body.username !== null && body.username !== "";
            const hasAccount = body.account !== undefined && body.account !== null && body.account !== "";
            if (hasAccount && (hasId || hasName) || !hasId && !hasName && !hasAccount
                || hasName && !text(body.username, 100, true) || hasAccount && !text(body.account, 100, true)) {
                return json({ error: "Enter a Bonk username or player ID. Use the separate name and ID fields together only when they identify the same account." }, 400);
            }
            let target;
            if (hasId) {
                bonkId = positiveBonkId(body.bonkId);
                if (!bonkId) return json({ error: "Enter a valid Bonk player ID." }, 400);
                target = await env.DB.prepare("SELECT bonk_id, username FROM bonk_users WHERE bonk_id = ?").bind(bonkId).first();
                if (target && hasName && target.username.toLowerCase() !== body.username.toLowerCase()) {
                    return json({ error: "The Bonk username and player ID do not match. Check the account details before assigning a role." }, 400);
                }
            } else {
                // Resolve only identities verified by a prior sign-in. Keep significant
                // username spaces and use equality, never a partial-name match.
                const name = hasName ? body.username : body.account;
                const matches = await env.DB.prepare("SELECT bonk_id, username FROM bonk_users WHERE username = ? COLLATE NOCASE LIMIT 2")
                    .bind(name).all();
                const candidates = new Map(matches.results.map(user => [user.bonk_id, user]));
                const numericId = hasAccount ? positiveBonkId(name) : null;
                if (numericId) {
                    const byId = await env.DB.prepare("SELECT bonk_id, username FROM bonk_users WHERE bonk_id = ?").bind(numericId).first();
                    if (byId) candidates.set(byId.bonk_id, byId);
                }
                if (candidates.size > 1) {
                    return json({ error: "More than one account matches. Enter the Bonk player ID in the player ID field to choose the account explicitly." }, 409);
                }
                target = candidates.values().next().value;
                bonkId = target?.bonk_id;
            }
            if (!target) {
                return json({ error: "That Bonk account must sign in to this site before receiving a role. Check the username or player ID." }, 400);
            }
        }
        const existing = await env.DB.prepare("SELECT role FROM division_members WHERE division_id = ? AND bonk_id = ?").bind(id, bonkId).first();
        if (role !== "site-admin" && existing?.role === "director") {
            return json({ error: "Only a site administrator can change a director's role." }, 403);
        }
        if (request.method === "DELETE") {
            if (!existing) {
                return json({ error: "This account has no division role." }, 404);
            }
            const removed = await env.DB.prepare(`DELETE FROM division_members WHERE division_id = ? AND bonk_id = ?
                ${role === "site-admin" ? "" : "AND role != 'director'"} RETURNING bonk_id`)
                .bind(id, bonkId).first();
            if (!removed) {
                return json({ error: "This role changed. Reload the management list before changing it." }, role === "site-admin" ? 404 : 403);
            }
        } else {
            const assigned = await env.DB.prepare(`INSERT INTO division_members (division_id, bonk_id, role, assigned_by_bonk_id, updated_at)
                VALUES (?, ?, ?, ?, ?) ON CONFLICT(division_id, bonk_id) DO UPDATE SET
                role = excluded.role, assigned_by_bonk_id = excluded.assigned_by_bonk_id, updated_at = excluded.updated_at
                ${role === "site-admin" ? "" : "WHERE division_members.role != 'director'"} RETURNING bonk_id`)
                .bind(id, bonkId, body.role, account.bonkId, Date.now()).first();
            if (!assigned) {
                return json({ error: "Only a site administrator can change a director's role." }, 403);
            }
        }
        return json(await members(env, id));
    }
    if (!action && request.method === "GET") {
        return json({ division: managedDivision(row, role) });
    }
    const body = await readJson(request);
    if (!body || !integer(body.version)) {
        return json({ error: "Reload the division before saving or publishing." }, 400);
    }
    if (body.version !== row.version) {
        return json({ error: "This division changed elsewhere. Reload it before saving." }, 409);
    }
    if (action === "publish" || action === "unpublish") {
        if (!rights.publish) {
            return json({ error: "Only a director or site administrator can publish a division." }, 403);
        }
        const updated = action === "publish"
            ? await env.DB.prepare(`UPDATE divisions SET published_json = draft_json, published_version = version,
                published_at = ? WHERE id = ? AND version = ? RETURNING *`).bind(Date.now(), id, body.version).first()
            : await env.DB.prepare(`UPDATE divisions SET published_json = NULL, published_version = NULL,
                published_at = NULL WHERE id = ? AND version = ? RETURNING *`).bind(id, body.version).first();
        return updated ? json({ division: managedDivision(updated, role) })
            : json({ error: "This division changed elsewhere. Reload it before publishing." }, 409);
    }
    const error = validateContent(body.content, positiveBonkId);
    if (error) {
        return json({ error }, 400);
    }
    if (role === "editor") {
        const previous = JSON.parse(row.draft_json);
        const editorSections = new Set(["campaigns", "referendums", "polls"]);
        const restrictedOrder = content => sectionOrder(content).filter(key => !editorSections.has(key) && !key.startsWith("custom:"));
        if (JSON.stringify(restrictedOrder(previous)) !== JSON.stringify(restrictedOrder(body.content))) {
            return json({ error: "Editors can change only campaign, referendum, poll and custom sections in the page layout." }, 403);
        }
        if (JSON.stringify(restrictedTextStyles(previous)) !== JSON.stringify(restrictedTextStyles(body.content))) {
            return json({ error: "Editors can format the description, campaigns, referendums, polls and custom sections only." }, 403);
        }
        if (JSON.stringify(restrictedArchives(previous)) !== JSON.stringify(restrictedArchives(body.content))) {
            return json({ error: "Editors can manage archived campaigns, referendums, polls and text sections only." }, 403);
        }
        const allowed = new Set(["description", "appearance", "textStyles", "sectionOrder", "customSections", "archivedSections", "campaigns", "referendums", "polls"]);
        if (CONTENT_FIELDS.some(key => !allowed.has(key) && JSON.stringify(previous[key]) !== JSON.stringify(body.content[key]))) {
            return json({ error: "Editors can update appearance, the description, campaigns, referendums, polls and custom sections only." }, 403);
        }
    }
    const updated = await env.DB.prepare(`UPDATE divisions SET draft_json = ?, version = version + 1,
        updated_at = ? WHERE id = ? AND version = ? RETURNING *`)
        .bind(JSON.stringify(body.content), Date.now(), id, body.version).first();
    return updated ? json({ division: managedDivision(updated, role) })
        : json({ error: "This division changed elsewhere. Reload it before saving." }, 409);
}
