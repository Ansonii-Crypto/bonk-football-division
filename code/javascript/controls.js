"use strict";

(() => {
    const controls = new WeakMap();
    const connected = new Set();
    const prototype = window.HTMLSelectElement.prototype;
    let sequence = 0;
    let opened = null;

    function labelFor(source) {
        const labelledBy = source.getAttribute("aria-labelledby");
        if (labelledBy) return { labelledBy };
        const explicit = source.getAttribute("aria-label");
        if (explicit) return { label: explicit };
        const label = source.labels?.[0];
        if (label) {
            let caption = [...label.children].find(node => node.tagName === "SPAN" && !node.contains(source));
            if (!caption) {
                const text = [...label.childNodes].filter(node => node.nodeType === Node.TEXT_NODE && node.textContent.trim());
                if (text.length) {
                    caption = document.createElement("span");
                    caption.className = "bfd-field-caption";
                    text[0].before(caption);
                    for (const node of text) caption.append(node);
                }
            }
            if (caption) {
                caption.id ||= `bfd-select-caption-${++sequence}`;
                return { labelledBy: caption.id };
            }
        }
        return { label: source.title || source.name || "Select an option" };
    }

    function disabledOption(option) {
        return option.disabled || option.hidden || option.parentElement?.tagName === "OPTGROUP" && option.parentElement.disabled;
    }

    function position(record) {
        if (!record.source.isConnected || record.trigger.matches(":disabled")) { close(); return; }
        const rect = record.trigger.getBoundingClientRect();
        const margin = 8;
        const viewportWidth = window.innerWidth || document.documentElement.clientWidth;
        const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
        if (rect.bottom < 0 || rect.top > viewportHeight) { close(); return; }
        const width = Math.min(Math.max(rect.width, 160), Math.max(0, viewportWidth - margin * 2));
        const below = Math.max(0, viewportHeight - rect.bottom - margin * 2);
        const above = Math.max(0, rect.top - margin * 2);
        const upward = below < Math.min(record.list.scrollHeight || 200, 160) && above > below;
        record.list.style.width = `${width}px`;
        record.list.style.maxHeight = `${Math.max(48, Math.min(320, upward ? above : below))}px`;
        record.list.style.left = `${Math.max(margin, Math.min(rect.left, viewportWidth - width - margin))}px`;
        const height = record.list.getBoundingClientRect().height;
        record.list.style.top = `${upward ? Math.max(margin, rect.top - height - margin) : rect.bottom + margin}px`;
        record.list.dataset.placement = upward ? "above" : "below";
    }

    function revealActive(record) {
        for (const [index, item] of record.items.entries()) item.classList.toggle("is-active", index === record.active);
        const option = record.items[record.active];
        if (option) {
            record.trigger.setAttribute("aria-activedescendant", option.id);
            option.scrollIntoView?.({ block: "nearest" });
        } else record.trigger.removeAttribute("aria-activedescendant");
    }

    function close(restoreFocus = false) {
        const record = opened;
        if (!record) return;
        opened = null;
        record.trigger.setAttribute("aria-expanded", "false");
        record.trigger.removeAttribute("aria-activedescendant");
        try { if (typeof record.list.hidePopover === "function") record.list.hidePopover(); } catch {}
        record.list.hidden = true;
        record.list.remove();
        record.search = ""; record.searchedAt = 0;
        record.source.dispatchEvent(new Event("bfd-select-close"));
        if (restoreFocus && record.trigger.isConnected) record.trigger.focus({ preventScroll: true });
    }

    function select(record, index) {
        const option = record.source.options[index];
        if (!option || disabledOption(option) || record.source.matches(":disabled")) return;
        const changed = record.source.selectedIndex !== index;
        record.source.selectedIndex = index;
        close();
        if (changed || record.preserveFocus) {
            record.source.dispatchEvent(new Event("input", { bubbles: true }));
            record.source.dispatchEvent(new Event("change", { bubbles: true }));
        }
    }

    function optionNode(record, option, index) {
        const item = document.createElement("div");
        item.className = "bfd-select-option";
        item.id = `${record.list.id}-option-${index}`;
        item.setAttribute("role", "option");
        item.textContent = option.label;
        item.addEventListener("pointerdown", event => event.preventDefault());
        item.addEventListener("pointermove", () => {
            if (!disabledOption(option)) { record.active = index; revealActive(record); }
        });
        item.addEventListener("click", () => select(record, index));
        return item;
    }

    function refresh(record) {
        const { source, trigger, value, wrapper } = record;
        trigger.className = `${[...source.classList].filter(name => name !== "bfd-select-source").join(" ")} bfd-select-trigger`;
        trigger.disabled = source.matches(":disabled");
        trigger.setAttribute("aria-disabled", String(trigger.disabled));
        trigger.setAttribute("aria-required", String(source.required));
        if (source.validity.valid) trigger.removeAttribute("aria-invalid");
        wrapper.hidden = source.hidden;
        const label = labelFor(source);
        if (label.labelledBy) {
            trigger.setAttribute("aria-labelledby", `${label.labelledBy} ${value.id}`);
            trigger.removeAttribute("aria-label");
        } else {
            trigger.setAttribute("aria-label", `${label.label}: ${source.options[source.selectedIndex]?.label || "Choose an option"}`);
            trigger.removeAttribute("aria-labelledby");
        }
        if (source.hasAttribute("aria-describedby")) trigger.setAttribute("aria-describedby", source.getAttribute("aria-describedby"));
        else trigger.removeAttribute("aria-describedby");
        value.textContent = source.options[source.selectedIndex]?.label || "Choose an option";
        record.preserveFocus = Boolean(source.closest(".division-format-panel") || source.hasAttribute("data-format-property"));
        const options = [...source.options];
        const signature = JSON.stringify([...source.children].map(child => child.tagName === "OPTGROUP"
            ? [child.label, child.disabled, [...child.children].map(option => [option.value, option.label, option.disabled, option.hidden])]
            : [child.value, child.label, child.disabled, child.hidden]));
        if (signature !== record.signature) {
            record.signature = signature;
            record.items = options.map((option, index) => optionNode(record, option, index));
            record.list.replaceChildren();
            for (const child of source.children) {
                if (child.tagName === "OPTGROUP") {
                    const title = document.createElement("div");
                    title.className = "bfd-select-group"; title.setAttribute("aria-hidden", "true"); title.textContent = child.label;
                    record.list.append(title);
                    for (const option of child.children) record.list.append(record.items[options.indexOf(option)]);
                } else if (child.tagName === "OPTION") record.list.append(record.items[options.indexOf(child)]);
            }
        }
        for (const [index, item] of record.items.entries()) {
            item.setAttribute("aria-selected", String(index === source.selectedIndex));
            item.setAttribute("aria-disabled", String(disabledOption(options[index])));
            item.hidden = options[index].hidden;
        }
        if (opened === record) {
            if (trigger.disabled || source.hidden) close();
            else { revealActive(record); position(record); }
        }
    }

    function open(record, direction = 1) {
        refresh(record);
        if (record.trigger.disabled || record.source.hidden || !record.source.options.length) return;
        if (opened && opened !== record) close();
        if (opened === record) return;
        opened = record;
        record.active = record.source.selectedIndex;
        if (record.active < 0 || disabledOption(record.source.options[record.active])) {
            const enabled = [...record.source.options].map((option, index) => disabledOption(option) ? -1 : index).filter(index => index >= 0);
            record.active = direction < 0 ? enabled.at(-1) : enabled[0];
        }
        (record.source.closest("dialog[open]") || document.body).append(record.list);
        record.list.hidden = false;
        try { if (typeof record.list.showPopover === "function") record.list.showPopover(); } catch {}
        record.trigger.setAttribute("aria-expanded", "true");
        position(record); revealActive(record);
        record.source.dispatchEvent(new Event("bfd-select-open"));
    }

    function key(record, event) {
        const keys = ["ArrowDown", "ArrowUp", "Home", "End", "Enter", " ", "Escape", "Tab"];
        if (!keys.includes(event.key) && !(event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey)) return;
        if (event.key === "Tab") { close(); return; }
        if (event.key === "Escape") {
            if (opened === record) { event.preventDefault(); event.stopPropagation(); close(!record.preserveFocus); }
            return;
        }
        event.preventDefault();
        if (event.key === "Enter" || event.key === " ") {
            if (opened === record) select(record, record.active);
            else open(record);
            return;
        }
        const wasOpen = opened === record;
        if (!wasOpen) open(record, event.key === "ArrowUp" ? -1 : 1);
        if (opened !== record) return;
        const enabled = [...record.source.options].map((option, index) => disabledOption(option) ? -1 : index).filter(index => index >= 0);
        if (!enabled.length) return;
        if (event.key === "Home") record.active = enabled[0];
        else if (event.key === "End") record.active = enabled.at(-1);
        else if (event.key === "ArrowDown" && wasOpen) record.active = enabled[(Math.max(0, enabled.indexOf(record.active)) + 1) % enabled.length];
        else if (event.key === "ArrowUp" && wasOpen) record.active = enabled[(Math.max(0, enabled.indexOf(record.active)) - 1 + enabled.length) % enabled.length];
        else if (event.key.length === 1) {
            const now = Date.now();
            record.search = now - record.searchedAt < 700 ? record.search + event.key.toLocaleLowerCase() : event.key.toLocaleLowerCase();
            record.searchedAt = now;
            const repeated = [...record.search].every(character => character === record.search[0]);
            const search = repeated ? record.search[0] : record.search;
            const start = repeated ? enabled.indexOf(record.active) + 1 : 0;
            const ordered = [...enabled.slice(start), ...enabled.slice(0, start)];
            const found = ordered.find(index => record.source.options[index].label.toLocaleLowerCase().startsWith(search));
            if (found !== undefined) record.active = found;
        }
        revealActive(record);
    }

    function enhance(source) {
        if (source.multiple || source.size > 1 || source.dataset.nativeSelect === "true") return;
        if (controls.has(source)) { const record = controls.get(source); connected.add(record); refresh(record); return; }
        const wrapper = document.createElement("span"); wrapper.className = "bfd-select";
        const trigger = document.createElement("button"); trigger.type = "button"; trigger.setAttribute("role", "combobox");
        trigger.setAttribute("aria-haspopup", "listbox"); trigger.setAttribute("aria-expanded", "false");
        const value = document.createElement("span"); value.className = "bfd-select-value"; value.id = `bfd-select-value-${++sequence}`;
        trigger.append(value);
        const list = document.createElement("div"); list.className = "bfd-select-list"; list.id = `bfd-select-list-${++sequence}`;
        list.setAttribute("role", "listbox"); list.setAttribute("popover", "manual"); list.hidden = true;
        trigger.setAttribute("aria-controls", list.id);
        const record = { source, wrapper, trigger, value, list, items: [], signature: "", active: -1, preserveFocus: false, search: "", searchedAt: 0 };
        controls.set(source, record); connected.add(record);
        source.before(wrapper); wrapper.append(source, trigger);
        source.classList.add("bfd-select-source"); source.tabIndex = -1; source.setAttribute("aria-hidden", "true");
        for (const name of ["value", "selectedIndex", "disabled", "required"]) {
            const descriptor = Object.getOwnPropertyDescriptor(prototype, name);
            if (!descriptor?.get || !descriptor.set) continue;
            try { Object.defineProperty(source, name, { configurable: true, get() { return descriptor.get.call(this); }, set(value) { descriptor.set.call(this, value); refresh(record); } }); } catch {}
        }
        source.addEventListener("input", () => refresh(record));
        source.addEventListener("change", () => refresh(record));
        source.addEventListener("focus", () => trigger.focus({ preventScroll: true }));
        source.addEventListener("invalid", event => { event.preventDefault(); trigger.setAttribute("aria-invalid", "true"); trigger.focus({ preventScroll: true }); });
        trigger.addEventListener("pointerdown", event => { if (record.preserveFocus) event.preventDefault(); });
        trigger.addEventListener("click", () => opened === record ? close() : open(record));
        trigger.addEventListener("keydown", event => key(record, event));
        refresh(record);
    }

    function scan(root = document) {
        if (root instanceof HTMLSelectElement && root.isConnected) enhance(root);
        for (const source of root.querySelectorAll?.("select") || []) if (source.isConnected) enhance(source);
    }

    const observer = new MutationObserver(mutations => {
        const refreshes = new Set();
        for (const mutation of mutations) {
            for (const node of mutation.addedNodes || []) if (node.nodeType === Node.ELEMENT_NODE) scan(node);
            const target = mutation.target.nodeType === Node.ELEMENT_NODE ? mutation.target : mutation.target.parentElement;
            const source = target instanceof HTMLSelectElement ? target : target?.closest?.("select");
            if (source && controls.has(source)) refreshes.add(controls.get(source));
            if (mutation.type === "attributes" && mutation.target.tagName === "FIELDSET") {
                for (const select of mutation.target.querySelectorAll("select")) if (controls.has(select)) refreshes.add(controls.get(select));
            }
        }
        for (const record of connected) if (!record.source.isConnected) {
            if (opened === record) close(); record.list.remove(); connected.delete(record);
        }
        for (const record of refreshes) if (record.source.isConnected) refresh(record);
    });
    observer.observe(document.documentElement, { subtree: true, childList: true, characterData: true, attributes: true,
        attributeFilter: ["disabled", "required", "hidden", "label", "selected", "value", "aria-label", "aria-labelledby", "aria-describedby", "class"] });

    document.addEventListener("pointerdown", event => {
        if (opened && !opened.wrapper.contains(event.target) && !opened.list.contains(event.target)) close();
    }, true);
    document.addEventListener("keydown", event => {
        if (opened?.preserveFocus && event.target !== opened.trigger) key(opened, event);
    }, true);
    document.addEventListener("click", event => {
        const label = event.target.closest?.("label");
        if (!label) return;
        const source = label.control || label.querySelector("input, textarea, select");
        if (!source || source.matches("input[type=radio], input[type=checkbox]") || label.classList.contains("division-poll-choice")) return;
        const interactive = event.target.closest("button, a, input, textarea, select, [role=combobox], [role=option], [contenteditable=true]");
        if (!interactive || !label.contains(interactive)) event.preventDefault();
    }, true);
    document.addEventListener("reset", event => window.queueMicrotask(() => { for (const source of event.target.querySelectorAll("select")) if (controls.has(source)) refresh(controls.get(source)); }), true);
    document.addEventListener("scroll", () => { if (opened) position(opened); }, true);
    window.addEventListener("resize", () => { if (opened) position(opened); });
    window.visualViewport?.addEventListener("resize", () => { if (opened) position(opened); });
    window.addEventListener("hashchange", () => close());
    window.BonkControls = { enhance: scan, close };
    scan();
})();
