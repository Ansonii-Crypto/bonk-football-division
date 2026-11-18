import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { Script } from "node:vm";
import { JSDOM } from "jsdom";

const source = readFileSync(new URL("../code/javascript/controls.js", import.meta.url), "utf8");
const tick = () => new Promise(resolve => setImmediate(resolve));

function page(t, html) {
    const dom = new JSDOM(`<!doctype html><html><body>${html}</body></html>`, { runScripts: "outside-only", pretendToBeVisual: true });
    t.after(() => dom.window.close());
    new Script(source, { filename: "controls.js" }).runInContext(dom.getInternalVMContext());
    return dom.window;
}

function key(window, node, name) {
    node.dispatchEvent(new window.KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true }));
}

test("custom menus keep native form values while supporting keyboard selection and disabled choices", t => {
    const window = page(t, '<form><label>Sort by<select name="sort"><option value="a">Alphabetical</option><option value="b" disabled>Blocked</option><option value="g">Greatest points</option></select></label></form>');
    const { document } = window;
    const select = document.querySelector("select");
    const trigger = document.querySelector(".bfd-select-trigger");
    assert.equal(trigger.getAttribute("role"), "combobox");
    assert.equal(select.getAttribute("aria-hidden"), "true");
    assert.equal(select.tabIndex, -1);
    let changes = 0;
    select.addEventListener("change", () => { changes += 1; });
    trigger.focus();
    key(window, trigger, "Enter");
    assert.equal(trigger.getAttribute("aria-expanded"), "true");
    assert.equal(document.querySelectorAll('[role="option"]').length, 3);
    key(window, trigger, "ArrowDown");
    assert.equal(document.querySelector(".bfd-select-option.is-active").textContent, "Greatest points");
    key(window, trigger, "Enter");
    assert.equal(select.value, "g");
    assert.equal(changes, 1);
    assert.equal(new window.FormData(document.querySelector("form")).get("sort"), "g");
    assert.equal(trigger.textContent, "Greatest points");
    assert.equal(trigger.getAttribute("aria-expanded"), "false");
    key(window, trigger, "a");
    key(window, trigger, "Enter");
    assert.equal(select.value, "a");
});

test("source value, disabled state, changing options and form reset stay in sync with the custom trigger", async t => {
    const window = page(t, '<form><fieldset><select aria-label="Font"><option value="a">Default</option><option value="b">Serif</option></select></fieldset></form>');
    const { document } = window;
    const select = document.querySelector("select");
    const trigger = document.querySelector(".bfd-select-trigger");
    select.value = "b";
    assert.equal(trigger.textContent, "Serif");
    select.disabled = true;
    assert.equal(trigger.disabled, true);
    trigger.click();
    assert.equal(trigger.getAttribute("aria-expanded"), "false");
    select.disabled = false;
    document.querySelector("fieldset").disabled = true;
    await tick();
    assert.equal(trigger.disabled, true);
    document.querySelector("fieldset").disabled = false;
    const option = document.createElement("option"); option.value = "c"; option.textContent = "Monospace";
    select.append(option);
    await tick();
    select.selectedIndex = 2;
    assert.equal(trigger.textContent, "Monospace");
    document.querySelector("form").reset();
    await tick();
    assert.equal(trigger.textContent, "Default");
    trigger.click();
    assert.equal(document.querySelectorAll('[role="option"]').length, 3);
    assert.equal(trigger.disabled, false);
});

test("only one menu remains open, outside clicks dismiss it and removing its source removes the popup", async t => {
    const window = page(t, '<select aria-label="One"><option>A</option></select><select aria-label="Two"><option>B</option></select><button id="outside">Outside</button>');
    const { document } = window;
    const [first, second] = document.querySelectorAll(".bfd-select-trigger");
    first.click();
    second.click();
    assert.equal(first.getAttribute("aria-expanded"), "false");
    assert.equal(second.getAttribute("aria-expanded"), "true");
    assert.equal(document.querySelectorAll(".bfd-select-list").length, 1);
    document.querySelector("#outside").dispatchEvent(new window.MouseEvent("pointerdown", { bubbles: true }));
    assert.equal(second.getAttribute("aria-expanded"), "false");
    second.click();
    second.closest(".bfd-select").remove();
    await tick();
    assert.equal(document.querySelectorAll(".bfd-select-list").length, 0);
});

test("formatting menus preserve the text field focus and range while applying font choices", t => {
    const window = page(t, '<textarea>Selected phrase</textarea><div class="division-format-panel"><select data-format-property="font" aria-label="Font"><option value="default">Default</option><option value="serif">Serif</option></select></div>');
    const { document } = window;
    const text = document.querySelector("textarea");
    text.focus(); text.setSelectionRange(0, 8);
    const trigger = document.querySelector(".bfd-select-trigger");
    const down = new window.MouseEvent("pointerdown", { bubbles: true, cancelable: true });
    trigger.dispatchEvent(down);
    assert.equal(down.defaultPrevented, true);
    trigger.click();
    const option = [...document.querySelectorAll('[role="option"]')].find(node => node.textContent === "Serif");
    option.dispatchEvent(new window.MouseEvent("pointerdown", { bubbles: true, cancelable: true }));
    option.click();
    assert.equal(document.activeElement, text);
    assert.equal(text.selectionStart, 0);
    assert.equal(text.selectionEnd, 8);
    assert.equal(document.querySelector("select").value, "serif");
    assert.equal(trigger.getAttribute("aria-expanded"), "false");
});

test("caption clicks do not activate inputs while deliberate radio labels and control clicks still work", t => {
    const window = page(t, '<label><span id="name-caption">Player name</span><input id="name"></label><label for="name" id="external-caption">Name</label><label class="division-poll-choice"><input type="radio" name="answer"><span id="answer-caption">Saturday</span></label>');
    const { document } = window;
    const field = document.querySelector("#name");
    const captionClick = new window.MouseEvent("click", { bubbles: true, cancelable: true });
    document.querySelector("#name-caption").dispatchEvent(captionClick);
    assert.equal(captionClick.defaultPrevented, true);
    const externalClick = new window.MouseEvent("click", { bubbles: true, cancelable: true });
    document.querySelector("#external-caption").dispatchEvent(externalClick);
    assert.equal(externalClick.defaultPrevented, true);
    const inputClick = new window.MouseEvent("click", { bubbles: true, cancelable: true });
    field.dispatchEvent(inputClick);
    assert.equal(inputClick.defaultPrevented, false);
    document.querySelector("#answer-caption").click();
    assert.equal(document.querySelector('input[type="radio"]').checked, true);
});

test("menus escape option text and expose caption associations without moving native controls out of their form", t => {
    const window = page(t, '<form><div><span id="caption">Role</span><select aria-labelledby="caption"><option>&lt;img src=x onerror=alert(1)&gt;</option></select></div></form>');
    const { document } = window;
    const select = document.querySelector("select");
    const trigger = document.querySelector(".bfd-select-trigger");
    assert.ok(trigger.getAttribute("aria-labelledby").startsWith("caption "));
    assert.equal(select.form, document.querySelector("form"));
    trigger.click();
    assert.equal(document.querySelector("img"), null);
    assert.equal(document.querySelector('[role="option"]').textContent, '<img src=x onerror=alert(1)>');
    key(window, trigger, "Escape");
    assert.equal(trigger.getAttribute("aria-expanded"), "false");
});

test("a corrected required selection clears the custom trigger's invalid state", t => {
    const window = page(t, '<form><select required aria-label="Role"><option value="">Choose a role</option><option value="editor">Editor</option></select></form>');
    const { document } = window;
    const source = document.querySelector("select");
    const trigger = document.querySelector(".bfd-select-trigger");
    source.dispatchEvent(new window.Event("invalid", { cancelable: true }));
    assert.equal(trigger.getAttribute("aria-invalid"), "true");
    source.value = "editor";
    assert.equal(trigger.hasAttribute("aria-invalid"), false);
});
