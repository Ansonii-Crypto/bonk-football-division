const SECTIONS = ["general", "participation", "timeline", "teams", "bracket", "campaigns", "referendums"];
const GENERAL_FIELDS = ["name", "summary", "description", "status", "startDate", "endDate"];
const ROLES = ["director", "organizer", "editor"];
const CONTENT_FIELDS = [...GENERAL_FIELDS, "participation", "timeline", "campaigns", "referendums", "teams", "results"];

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
        participation: { mode: "solo", teamSize: 1, registration: "closed", description: "" },
        timeline: [], campaigns: [], referendums: [], teams: [], results: {}
    };
}

function validateContent(content, positiveBonkId) {
    if (!object(content) || Object.keys(content).some(key => !CONTENT_FIELDS.includes(key))) {
        return "Send the division's content in the supported format.";
    }
    if (!text(content.name, 120, true) || !text(content.summary, 300) || !text(content.description, 6000)) {
        return "Enter a division name (up to 120 characters), a short summary, and a description up to 6000 characters.";
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
    return null;
}

function permissions(role) {
    return {
        editSections: role === "editor" ? ["general", "campaigns", "referendums"] : [...SECTIONS],
        generalFields: role === "editor" ? ["description"] : [...GENERAL_FIELDS],
        publish: ["site-admin", "director"].includes(role),
        manageMembers: ["site-admin", "director"].includes(role),
        assignRoles: role === "site-admin" ? [...ROLES] : role === "director" ? ["organizer", "editor"] : []
    };
}

function managedDivision(row, role) {
    return {
        id: row.id, content: JSON.parse(row.draft_json), version: row.version,
        publishedAt: row.published_at, publishedVersion: row.published_version,
        updatedAt: row.updated_at, role, permissions: permissions(role)
    };
}

function publicContent(serialized) {
    const content = JSON.parse(serialized);
    content.teams = content.teams.map(team => ({
        ...team,
        players: team.players.map(player => ({ username: player.username }))
    }));
    return content;
}

function summary(row, managed = false) {
    const content = JSON.parse(managed ? row.draft_json : row.published_json);
    const data = { id: row.id, name: content.name, summary: content.summary, status: content.status,
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
    const scoped = managed && !account.isAdmin;
    const from = scoped ? "divisions d JOIN division_members m ON d.id = m.division_id" : "divisions d";
    const where = scoped ? "WHERE m.bonk_id = ?" : managed ? "" : "WHERE d.published_json IS NOT NULL";
    const bindings = scoped ? [account.bonkId] : [];
    const count = await env.DB.prepare(`SELECT COUNT(*) AS total FROM ${from} ${where}`).bind(...bindings).first();
    const total = count?.total || 0;
    const pages = Math.max(1, Math.ceil(total / limit));
    const actualPage = Math.min(page, pages);
    const roleColumn = scoped ? "m.role" : "'site-admin' AS role";
    const order = managed ? "d.updated_at" : "d.published_at";
    const rows = await env.DB.prepare(`SELECT d.*, ${roleColumn} FROM ${from} ${where} ORDER BY ${order} DESC, d.id DESC LIMIT ? OFFSET ?`)
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
        const bonkId = positiveBonkId(request.method === "DELETE" ? parts[6] : body?.bonkId);
        if (!bonkId) {
            return json({ error: "Enter a valid Bonk player ID." }, 400);
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
            if (!rights.assignRoles.includes(body?.role)) {
                return json({ error: "Choose a role you are allowed to assign." }, 403);
            }
            const target = await env.DB.prepare("SELECT bonk_id FROM bonk_users WHERE bonk_id = ?").bind(bonkId).first();
            if (!target) {
                return json({ error: "That Bonk account must sign in to this site before receiving a role." }, 400);
            }
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
        const allowed = new Set(["description", "campaigns", "referendums"]);
        if (CONTENT_FIELDS.some(key => !allowed.has(key) && JSON.stringify(previous[key]) !== JSON.stringify(body.content[key]))) {
            return json({ error: "Editors can update the description, campaigns and referendums only." }, 403);
        }
    }
    const updated = await env.DB.prepare(`UPDATE divisions SET draft_json = ?, version = version + 1,
        updated_at = ? WHERE id = ? AND version = ? RETURNING *`)
        .bind(JSON.stringify(body.content), Date.now(), id, body.version).first();
    return updated ? json({ division: managedDivision(updated, role) })
        : json({ error: "This division changed elsewhere. Reload it before saving." }, 409);
}
