const CLASS_NAMES = new Set(["Weaver", "Bulwark", "Catalyst", "Tactician", "Opportunist", "Dynamo", "Renegade"]);
const STAT_COLUMNS = ["control", "execution", "defending", "reaction_time", "chemistry", "game_sense"];
const MUTABLE_COLUMNS = ["player_name", "player_bonk_id", "class_name", "assessment_date", "notes", ...STAT_COLUMNS, "total", "tier"];
const INITIAL_SQL = "CASE WHEN UPPER(SUBSTR(TRIM(player_name), 1, 1)) BETWEEN 'A' AND 'Z' THEN UPPER(SUBSTR(TRIM(player_name), 1, 1)) ELSE '#' END";
const SORT_SQL = {
    descending: "total DESC, assessment_date ASC, id ASC",
    ascending: "total ASC, assessment_date ASC, id ASC",
    newest: "updated_at DESC, id DESC",
    oldest: "updated_at ASC, id ASC",
    alphabetical: "player_name COLLATE NOCASE ASC, id ASC"
};

function positiveInteger(value, maximum) {
    if (!/^[1-9][0-9]*$/.test(String(value))) {
        return null;
    }
    const number = Number(value);
    return Number.isSafeInteger(number) && number <= maximum ? number : null;
}

function validDate(value) {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        return false;
    }
    const [year, month, day] = value.split("-").map(Number);
    if (year < 1900 || year > 2100) {
        return false;
    }
    const date = new Date(Date.UTC(year, month - 1, day));
    return date.getUTCFullYear() === year && date.getUTCMonth() + 1 === month && date.getUTCDate() === day;
}

function tierFromTotal(total) {
    const average = total / 6;
    return average >= 257 ? "S" : average >= 215 ? "A" : average >= 172 ? "B"
        : average >= 129 ? "C" : average >= 86 ? "D" : average >= 43 ? "E" : "F";
}

function validateAssessment(body, positiveBonkId) {
    if (!body || typeof body.playerName !== "string" || !body.playerName.trim() || body.playerName.trim().length > 100) {
        return { error: "Enter a player name (up to 100 characters)." };
    }
    if (body.playerBonkId !== undefined && body.playerBonkId !== null && body.playerBonkId !== ""
        && !positiveBonkId(body.playerBonkId)) {
        return { error: "Enter a valid Bonk player ID or leave it blank." };
    }
    if (typeof body.className !== "string" || body.className !== "" && !CLASS_NAMES.has(body.className)) {
        return { error: "Choose a listed class or leave it blank." };
    }
    if (!validDate(body.date)) {
        return { error: "Enter a valid assessment date." };
    }
    if (!Array.isArray(body.values) || body.values.length !== 6
        || body.values.some(value => !Number.isInteger(value) || value < 0 || value > 300)) {
        return { error: "Enter all six scores as whole numbers from 0 to 300." };
    }
    if (body.notes !== undefined && (typeof body.notes !== "string" || body.notes.length > 4000)) {
        return { error: "Notes must be at most 4000 characters." };
    }
    const total = body.values.reduce((sum, value) => sum + value, 0);
    return {
        values: [body.playerName.trim(), body.playerBonkId ? positiveBonkId(body.playerBonkId) : null,
            body.className, body.date, body.notes || "", ...body.values, total, tierFromTotal(total)]
    };
}

function assessmentRow(row, isAdmin) {
    const data = {
        id: row.id,
        name: row.player_name,
        playerName: row.player_name,
        className: row.class_name,
        date: row.assessment_date,
        values: STAT_COLUMNS.map(column => row[column]),
        total: row.total,
        tier: row.tier,
        notes: row.notes,
        assessorName: row.updated_by_name,
        updatedAt: row.updated_at
    };
    if (isAdmin) {
        Object.assign(data, {
            playerBonkId: row.player_bonk_id,
            createdAt: row.created_at,
            createdByBonkId: row.created_by_bonk_id,
            createdByName: row.created_by_name,
            updatedByBonkId: row.updated_by_bonk_id,
            updatedByName: row.updated_by_name,
            version: row.version
        });
    }
    return data;
}

function commaFilter(value, pattern, maximum) {
    if (value === null || value === "") {
        return [];
    }
    const entries = [...new Set(value.split(","))];
    return entries.length <= maximum && entries.every(entry => pattern.test(entry)) ? entries : null;
}

function listParameters(url, isAdmin) {
    const sort = url.searchParams.get("sort") || (isAdmin ? "newest" : "descending");
    const normalizedSort = { points_desc: "descending", points_asc: "ascending", name_asc: "alphabetical" }[sort] || sort;
    if (!Object.hasOwn(SORT_SQL, normalizedSort) || !isAdmin && sort === "oldest") {
        return null;
    }
    const page = positiveInteger(url.searchParams.get("page") || "1", 100000);
    const limit = positiveInteger(url.searchParams.get("limit") || "12", 50);
    const q = url.searchParams.get("q")?.trim() || "";
    const tiers = commaFilter(url.searchParams.get("tiers"), /^[SABCDEF]$/, 7);
    const initials = commaFilter(url.searchParams.get("initials"), /^[A-Z#]$/, 27);
    if (!page || !limit || q.length > 200 || !tiers || !initials) {
        return null;
    }
    return { sort: normalizedSort, page, limit, q, tiers, initials };
}

async function listAssessments(env, url, isAdmin, json) {
    const params = listParameters(url, isAdmin);
    if (!params) {
        return json({ error: "Invalid assessment filters." }, 400);
    }
    const clauses = [];
    const bindings = [];
    if (params.q) {
        clauses.push(isAdmin
            ? "(INSTR(LOWER(player_name), LOWER(?)) > 0 OR INSTR(LOWER(class_name), LOWER(?)) > 0 OR INSTR(COALESCE(player_bonk_id, ''), ?) > 0)"
            : "(INSTR(LOWER(player_name), LOWER(?)) > 0 OR INSTR(LOWER(class_name), LOWER(?)) > 0)");
        bindings.push(params.q, params.q);
        if (isAdmin) {
            bindings.push(params.q);
        }
    }
    if (params.tiers.length) {
        clauses.push(`tier IN (${params.tiers.map(() => "?").join(", ")})`);
        bindings.push(...params.tiers);
    }
    if (params.initials.length) {
        clauses.push(`${INITIAL_SQL} IN (${params.initials.map(() => "?").join(", ")})`);
        bindings.push(...params.initials);
    }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const count = await env.DB.prepare(`SELECT COUNT(*) AS total FROM assessments ${where}`).bind(...bindings).first();
    const total = count?.total || 0;
    const pages = Math.max(1, Math.ceil(total / params.limit));
    const page = Math.min(params.page, pages);
    const result = await env.DB.prepare(`SELECT * FROM assessments ${where} ORDER BY ${SORT_SQL[params.sort]} LIMIT ? OFFSET ?`)
        .bind(...bindings, params.limit, (page - 1) * params.limit).all();
    const response = { assessments: result.results.map(row => assessmentRow(row, isAdmin)), total, pages, page };
    if (!isAdmin) {
        const [tierRows, initialRows] = await Promise.all([
            env.DB.prepare("SELECT DISTINCT tier FROM assessments").all(),
            env.DB.prepare(`SELECT DISTINCT ${INITIAL_SQL} AS initial FROM assessments`).all()
        ]);
        const populatedTiers = new Set(tierRows.results.map(row => row.tier));
        response.availableTiers = [..."SABCDEF"].filter(tier => populatedTiers.has(tier));
        response.availableInitials = initialRows.results.map(row => row.initial).sort((a, b) => a === "#" ? -1 : b === "#" ? 1 : a.localeCompare(b));
    }
    return json(response);
}

async function getAssessment(env, id, isAdmin, json) {
    const row = await env.DB.prepare("SELECT * FROM assessments WHERE id = ?").bind(id).first();
    return row ? json({ assessment: assessmentRow(row, isAdmin) }) : json({ error: "Assessment not found." }, 404);
}

async function createAssessment(request, env, account, readJson, json, positiveBonkId) {
    const checked = validateAssessment(await readJson(request), positiveBonkId);
    if (checked.error) {
        return json({ error: checked.error }, 400);
    }
    const timestamp = Date.now();
    const columns = [...MUTABLE_COLUMNS, "created_at", "updated_at", "created_by_bonk_id", "created_by_name", "updated_by_bonk_id", "updated_by_name"];
    const values = [...checked.values, timestamp, timestamp, account.bonkId, account.username, account.bonkId, account.username];
    const row = await env.DB.prepare(`INSERT INTO assessments (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")}) RETURNING *`)
        .bind(...values).first();
    return json({ assessment: assessmentRow(row, true) }, 201);
}

async function updateAssessment(request, env, id, account, readJson, json, positiveBonkId) {
    const body = await readJson(request);
    const checked = validateAssessment(body, positiveBonkId);
    if (checked.error) {
        return json({ error: checked.error }, 400);
    }
    if (!positiveInteger(body.version, Number.MAX_SAFE_INTEGER)) {
        return json({ error: "Refresh this assessment before editing it." }, 400);
    }
    const set = MUTABLE_COLUMNS.map(column => `${column} = ?`).join(", ");
    const row = await env.DB.prepare(`UPDATE assessments SET ${set}, updated_at = ?, updated_by_bonk_id = ?, updated_by_name = ?, version = version + 1 WHERE id = ? AND version = ? RETURNING *`)
        .bind(...checked.values, Date.now(), account.bonkId, account.username, id, body.version).first();
    if (row) {
        return json({ assessment: assessmentRow(row, true) });
    }
    const exists = await env.DB.prepare("SELECT id FROM assessments WHERE id = ?").bind(id).first();
    return json({ error: exists ? "This assessment changed. Refresh it before editing." : "Assessment not found." }, exists ? 409 : 404);
}

export async function handleAssessmentRequest(request, env, url, account, readJson, json, positiveBonkId) {
    const isAdminRoute = url.pathname.startsWith("/api/admin/");
    if (isAdminRoute && !account) {
        return json({ error: "Sign in to manage assessments." }, 401);
    }
    if (isAdminRoute && !account.isAdmin) {
        return json({ error: "Administrator access is required." }, 403);
    }
    const collection = isAdminRoute ? "/api/admin/assessments" : "/api/assessments";
    if (url.pathname === collection) {
        return request.method === "GET" ? listAssessments(env, url, isAdminRoute, json)
            : createAssessment(request, env, account, readJson, json, positiveBonkId);
    }
    const id = positiveInteger(url.pathname.slice(collection.length + 1), Number.MAX_SAFE_INTEGER);
    if (!id) {
        return json({ error: "Assessment not found." }, 404);
    }
    return request.method === "GET" ? getAssessment(env, id, isAdminRoute, json)
        : updateAssessment(request, env, id, account, readJson, json, positiveBonkId);
}
