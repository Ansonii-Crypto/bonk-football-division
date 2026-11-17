"use strict";

(() => {
    const attributes = ["bold", "italic", "underline", "color", "font", "size"];
    const fonts = { sans: "Inter, system-ui, sans-serif", serif: "Georgia, 'Times New Roman', serif", mono: "'Courier New', monospace" };
    const sizes = { small: "0.85em", large: "1.2em" };
    const maximumRuns = 100;

    function boundary(text, index) {
        return index <= 0 || index >= text.length || !(text.charCodeAt(index - 1) >= 0xd800 && text.charCodeAt(index - 1) <= 0xdbff
            && text.charCodeAt(index) >= 0xdc00 && text.charCodeAt(index) <= 0xdfff);
    }

    function style(value) {
        const result = {};
        if (!value || typeof value !== "object") return result;
        for (const key of ["bold", "italic", "underline"]) if (value[key] === true) result[key] = true;
        if (typeof value.color === "string" && /^#[0-9a-f]{6}$/i.test(value.color)) result.color = value.color;
        if (Object.hasOwn(fonts, value.font)) result.font = value.font;
        if (Object.hasOwn(sizes, value.size)) result.size = value.size;
        return result;
    }

    function sameStyle(first, second) {
        return attributes.every(key => first[key] === second[key]);
    }

    function coalesce(runs) {
        const result = [];
        for (const run of runs.sort((first, second) => first.start - second.start || first.end - second.end)) {
            if (run.start >= run.end) continue;
            const previous = result.at(-1);
            if (previous && previous.end === run.start && sameStyle(previous, run)) previous.end = run.end;
            else result.push({ ...run });
        }
        return result;
    }

    function normalize(runs, text) {
        text = String(text ?? "");
        if (!Array.isArray(runs)) return [];
        const result = [];
        let end = 0;
        for (const run of runs.slice(0, maximumRuns).filter(run => run && typeof run === "object")
            .sort((first, second) => first.start - second.start || first.end - second.end)) {
            if (!Number.isInteger(run.start) || !Number.isInteger(run.end) || run.start < end || run.start < 0
                || run.end <= run.start || run.end > text.length || !boundary(text, run.start) || !boundary(text, run.end)) continue;
            const safe = style(run);
            if (!Object.keys(safe).length) continue;
            result.push({ start: run.start, end: run.end, ...safe });
            end = run.end;
        }
        return coalesce(result);
    }

    function apply(runs, text, start, end, patch = {}) {
        text = String(text ?? "");
        if (!patch || typeof patch !== "object" || Array.isArray(patch)) patch = {};
        const current = normalize(runs, text);
        if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end > text.length || start >= end
            || !boundary(text, start) || !boundary(text, end)) return current;
        const changes = {};
        const safe = style(patch);
        for (const key of attributes) {
            if (!Object.hasOwn(patch, key)) continue;
            if (patch[key] === null || patch[key] === false || key === "font" && patch[key] === "default"
                || key === "size" && patch[key] === "normal" || key === "color" && patch[key] === "") changes[key] = null;
            else if (Object.hasOwn(safe, key)) changes[key] = safe[key];
        }
        const points = [...new Set([0, text.length, start, end, ...current.flatMap(run => [run.start, run.end])])].sort((first, second) => first - second);
        const result = [];
        for (let index = 0; index < points.length - 1; index += 1) {
            const from = points[index];
            const to = points[index + 1];
            const existing = current.find(run => run.start <= from && run.end >= to);
            const values = existing ? style(existing) : {};
            if (from >= start && to <= end) {
                for (const [key, value] of Object.entries(changes)) {
                    if (value === null) delete values[key];
                    else values[key] = value;
                }
            }
            if (Object.keys(values).length) result.push({ start: from, end: to, ...values });
        }
        const merged = coalesce(result);
        if (merged.length > maximumRuns) throw new RangeError("This field has reached its formatting limit. Clear some formatting before adding more.");
        return merged;
    }

    function rebase(runs, oldText, newText) {
        oldText = String(oldText ?? "");
        newText = String(newText ?? "");
        const current = normalize(runs, oldText);
        if (oldText === newText) return current;
        let prefix = 0;
        while (prefix < oldText.length && prefix < newText.length && oldText[prefix] === newText[prefix]) prefix += 1;
        while (prefix > 0 && (!boundary(oldText, prefix) || !boundary(newText, prefix))) prefix -= 1;
        let suffix = 0;
        while (suffix < oldText.length - prefix && suffix < newText.length - prefix
            && oldText[oldText.length - suffix - 1] === newText[newText.length - suffix - 1]) suffix += 1;
        while (suffix > 0 && (!boundary(oldText, oldText.length - suffix) || !boundary(newText, newText.length - suffix))) suffix -= 1;
        const oldEnd = oldText.length - suffix;
        const newEnd = newText.length - suffix;
        const delta = newText.length - oldText.length;
        const result = [];
        for (const run of current) {
            const values = style(run);
            if (run.start < prefix) result.push({ start: run.start, end: Math.min(run.end, prefix), ...values });
            if (run.end > oldEnd) result.push({ start: Math.max(run.start, oldEnd) + delta, end: run.end + delta, ...values });
            if (newEnd > prefix && run.start < prefix && run.end > oldEnd) result.push({ start: prefix, end: newEnd, ...values });
        }
        return normalize(coalesce(result), newText);
    }

    function render(node, text, runs) {
        text = String(text ?? "");
        node.replaceChildren();
        const document = node.ownerDocument;
        let offset = 0;
        for (const run of normalize(runs, text)) {
            if (run.start > offset) node.append(document.createTextNode(text.slice(offset, run.start)));
            const span = document.createElement("span");
            span.className = "division-formatted-text";
            span.textContent = text.slice(run.start, run.end);
            if (run.bold) span.style.fontWeight = "700";
            if (run.italic) span.style.fontStyle = "italic";
            if (run.underline) span.style.textDecorationLine = "underline";
            if (run.color) span.style.color = run.color;
            if (run.font) span.style.fontFamily = fonts[run.font];
            if (run.size) span.style.fontSize = sizes[run.size];
            node.append(span);
            offset = run.end;
        }
        if (offset < text.length) node.append(document.createTextNode(text.slice(offset)));
        return node;
    }

    function fields(content = {}) {
        const result = Object.create(null);
        const add = (path, value) => { if (typeof value === "string") result[path] = value; };
        for (const key of ["name", "summary", "description"]) add(`general.${key}`, content[key]);
        add("participation.description", content.participation?.description);
        for (const [collection, prefix, keys] of [["timeline", "timeline", ["title", "description"]],
            ["campaigns", "campaigns", ["title", "description"]], ["referendums", "referendums", ["title", "description"]],
            ["customSections", "custom", ["title", "description"]], ["teams", "teams", ["name"]]]) {
            for (const item of Array.isArray(content[collection]) ? content[collection] : []) {
                if (!item || typeof item.id !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(item.id)) continue;
                for (const key of keys) add(`${prefix}.${item.id}.${key}`, item[key]);
            }
        }
        return result;
    }

    function sectionForPath(path) {
        if (typeof path !== "string") return "";
        const [section, id] = path.split(".");
        return section === "custom" ? `custom:${id}` : section;
    }

    window.DivisionText = { render, apply, rebase, fields, normalize, sectionForPath };
})();
