import { intro, tests as testSeed } from "./seeds.js";
import {
  applyTapeEdits,
  calculateTape,
  resultBlockAt,
} from "./tape-engine.js";
import { TapeHistory } from "./tape-history.js";
import {
  applyBeforeInput,
  bindHistoryControl,
  removeResultBlockAt,
} from "./tape-input.js";

const STORAGE_KEY = "qwiktape.android.v1";
const tapeElement = document.querySelector("#tape");
const tabsElement = document.querySelector("#tabs");
const statusElement = document.querySelector("#status");
const diagnosticsElement = document.querySelector("#diagnostics");
const histories = new Map();

function id() {
  return globalThis.crypto?.randomUUID?.() ?? `tape-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function initialState() {
  const introId = id();
  const testsId = id();
  return {
    tapes: [
      { id: introId, title: "Introduction", text: intro },
      { id: testsId, title: "Tests", text: testSeed },
    ],
    openIds: [introId, testsId],
    activeId: introId,
    settings: {
      locale: "1,234,567.89",
      decimalDigits: 2,
      padding: 10,
      replaceOperators: true,
      escapeClears: false,
    },
  };
}

function loadState() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (!parsed?.tapes?.length || !parsed?.activeId) return initialState();
    return { ...initialState(), ...parsed, settings: { ...initialState().settings, ...parsed.settings } };
  } catch (_error) {
    return initialState();
  }
}

let state = loadState();

function activeTape() {
  return state.tapes.find((tape) => tape.id === state.activeId);
}

function historyFor(tape = activeTape()) {
  if (!histories.has(tape.id)) histories.set(tape.id, new TapeHistory(tape.text));
  return histories.get(tape.id);
}

function persist() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function selectionAfterEdits(position, edits) {
  return [...edits]
    .sort((left, right) => left.start - right.start)
    .reduce((next, edit) => {
      if (edit.end <= next) return next + edit.replacement.length - (edit.end - edit.start);
      if (edit.start < next) return edit.start + edit.replacement.length;
      return next;
    }, position);
}

function lineAt(text, offset) {
  return text.slice(0, offset).split("\n").length;
}

function recalculate({ formatCurrentLine = false, record = true } = {}) {
  const source = tapeElement.value;
  const selectionStart = tapeElement.selectionStart;
  const selectionEnd = tapeElement.selectionEnd;
  const currentLine = lineAt(source, selectionStart);
  const result = calculateTape({ text: source, ...state.settings });
  const edits = result.edits.filter((edit) => {
    if (edit.kind === "insert-result") return false;
    return formatCurrentLine || edit.line !== currentLine;
  });
  const nextText = applyTapeEdits(source, edits);
  const nextStart = selectionAfterEdits(selectionStart, edits);
  const nextEnd = selectionAfterEdits(selectionEnd, edits);
  if (nextText !== source) {
    tapeElement.value = nextText;
    tapeElement.setSelectionRange(nextStart, nextEnd);
  }

  const tape = activeTape();
  tape.text = nextText;
  if (record) historyFor(tape).commit(nextText);
  else historyFor(tape).replaceCurrent(nextText);
  persist();
  renderDiagnostics(result);
  return { ...result, text: nextText };
}

function renderDiagnostics(result) {
  const errors = result.diagnostics.filter((item) => item.kind !== "parser" || item.message);
  diagnosticsElement.textContent = errors.slice(0, 3).map((item) => item.message).join(" · ");
  statusElement.textContent = `${result.variables ? Object.keys(result.variables).length : 0} names · ${errors.length} issues`;
}

function renderTabs() {
  tabsElement.replaceChildren();
  for (const openId of state.openIds) {
    const tape = state.tapes.find((item) => item.id === openId);
    if (!tape) continue;
    const button = document.createElement("button");
    button.className = "tab";
    button.type = "button";
    button.role = "tab";
    button.ariaSelected = String(openId === state.activeId);
    button.innerHTML = `<span class="tab-name"></span><span class="tab-close" aria-hidden="true">×</span>`;
    button.querySelector(".tab-name").textContent = tape.title;
    button.addEventListener("click", (event) => {
      if (event.target.closest(".tab-close")) closeTape(openId);
      else activateTape(openId);
    });
    tabsElement.append(button);
  }
}

function activateTape(tapeId) {
  const tape = state.tapes.find((item) => item.id === tapeId);
  if (!tape) return;
  if (!state.openIds.includes(tapeId)) state.openIds.push(tapeId);
  state.activeId = tapeId;
  tapeElement.value = tape.text;
  tapeElement.setSelectionRange(tape.text.length, tape.text.length);
  historyFor(tape);
  renderTabs();
  recalculate({ record: false });
  tapeElement.focus();
}

function createTape() {
  const tape = { id: id(), title: "Untitled tape", text: "" };
  state.tapes.push(tape);
  state.openIds.push(tape.id);
  activateTape(tape.id);
}

function closeTape(tapeId = state.activeId) {
  if (state.openIds.length === 1) return;
  const index = state.openIds.indexOf(tapeId);
  state.openIds = state.openIds.filter((openId) => openId !== tapeId);
  if (state.activeId === tapeId) {
    state.activeId = state.openIds[Math.max(0, index - 1)] ?? state.openIds[0];
    activateTape(state.activeId);
  } else {
    renderTabs();
    persist();
  }
}

function renameTape(tapeId = state.activeId) {
  const tape = state.tapes.find((item) => item.id === tapeId);
  if (!tape) return;
  const title = prompt("Tape name", tape.title)?.trim();
  if (!title) return;
  tape.title = title;
  renderTabs();
  renderBrowseList();
  persist();
}

function deleteTape(tapeId) {
  const tape = state.tapes.find((item) => item.id === tapeId);
  if (!tape || !confirm(`Delete “${tape.title}”? This cannot be undone.`)) return;
  state.tapes = state.tapes.filter((item) => item.id !== tapeId);
  state.openIds = state.openIds.filter((openId) => openId !== tapeId);
  histories.delete(tapeId);
  if (state.tapes.length === 0) {
    createTape();
    return;
  }
  if (state.openIds.length === 0) state.openIds.push(state.tapes[0].id);
  if (state.activeId === tapeId) state.activeId = state.openIds[0];
  activateTape(state.activeId);
  renderBrowseList();
}

function cycleTape() {
  const index = state.openIds.indexOf(state.activeId);
  activateTape(state.openIds[(index + 1) % state.openIds.length]);
}

function renderBrowseList() {
  const list = document.querySelector("#browse-list");
  list.replaceChildren();
  for (const tape of state.tapes) {
    const row = document.createElement("div");
    row.className = "browse-row";
    const open = document.createElement("button");
    open.type = "button";
    open.className = "browse-open";
    open.textContent = tape.title;
    open.addEventListener("click", () => {
      activateTape(tape.id);
      document.querySelector("#browse-dialog").close();
    });
    const rename = document.createElement("button");
    rename.type = "button";
    rename.textContent = "Rename";
    rename.addEventListener("click", () => renameTape(tape.id));
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "danger";
    remove.textContent = "Delete";
    remove.addEventListener("click", () => deleteTape(tape.id));
    row.append(open, rename, remove);
    list.append(row);
  }
}

function restoreFromHistory(direction) {
  const history = historyFor();
  const restored = direction === "undo" ? history.undo() : history.redo();
  tapeElement.value = restored;
  tapeElement.setSelectionRange(restored.length, restored.length);
  recalculate({ formatCurrentLine: true, record: false });
}

function removeResultBlock(block) {
  const outcome = removeResultBlockAt({
    text: tapeElement.value,
    selectionStart: tapeElement.selectionStart,
    settings: state.settings,
  });
  if (outcome) applyEnterOutcome(outcome);
}

function applyEnterOutcome(outcome) {
  tapeElement.value = outcome.text;
  tapeElement.setSelectionRange(outcome.selectionStart, outcome.selectionEnd);
  recalculate();
}

function enterInput(inputType = "insertLineBreak") {
  return applyBeforeInput({
    inputType,
    text: tapeElement.value,
    selectionStart: tapeElement.selectionStart,
    selectionEnd: tapeElement.selectionEnd,
    settings: state.settings,
  });
}

tapeElement.addEventListener("input", () => recalculate());

tapeElement.addEventListener("beforeinput", (event) => {
  const outcome = enterInput(event.inputType);
  if (!outcome) return;
  event.preventDefault();
  applyEnterOutcome(outcome);
});

tapeElement.addEventListener("blur", () => recalculate({ formatCurrentLine: true }));

tapeElement.addEventListener("keydown", (event) => {
  const control = event.ctrlKey || event.metaKey;
  if (control && !event.altKey) {
    const key = event.key.toLowerCase();
    if (key === "z") {
      event.preventDefault();
      restoreFromHistory(event.shiftKey ? "redo" : "undo");
      return;
    }
    if (key === "y") {
      event.preventDefault();
      restoreFromHistory("redo");
      return;
    }
    if (key === "n" || key === "t") {
      event.preventDefault();
      createTape();
      return;
    }
    if (key === "w") {
      event.preventDefault();
      closeTape();
      return;
    }
    if (key === "tab") {
      event.preventDefault();
      cycleTape();
      return;
    }
  }

  const block = resultBlockAt(tapeElement.value, tapeElement.selectionStart);
  if ((event.key === "Backspace" || event.key === "Delete")
      && block && tapeElement.selectionStart === tapeElement.selectionEnd) {
    event.preventDefault();
    removeResultBlock(block);
    return;
  }

  if (event.key === "Enter") {
    event.preventDefault();
    applyEnterOutcome(enterInput());
    return;
  }

  const operators = new Set(["+", "-", "*", "/", "x", "×", "÷", "^"]);
  if (block && operators.has(event.key)) {
    event.preventDefault();
    const operator = state.settings.replaceOperators
      ? event.key.replace("*", "×").replace("/", "÷")
      : event.key;
    const hasFollowingNewline = tapeElement.value[block.end] === "\n";
    const insert = block.end + (hasFollowingNewline ? 1 : 0);
    const addition = `${hasFollowingNewline ? "" : "\n"}${operator} `;
    tapeElement.value = `${tapeElement.value.slice(0, insert)}${addition}${tapeElement.value.slice(insert)}`;
    tapeElement.setSelectionRange(insert + addition.length, insert + addition.length);
    recalculate();
    return;
  }

  if (state.settings.replaceOperators && !event.altKey && (event.key === "*" || event.key === "/")) {
    event.preventDefault();
    const symbol = event.key === "*" ? "×" : "÷";
    tapeElement.setRangeText(symbol, tapeElement.selectionStart, tapeElement.selectionEnd, "end");
    recalculate();
    return;
  }

  if (event.key === "Escape" && state.settings.escapeClears && tapeElement.value) {
    event.preventDefault();
    tapeElement.value = "";
    recalculate();
  }
});

document.querySelector("#new-button").addEventListener("click", createTape);
bindHistoryControl(document.querySelector("#undo-button"), "undo", restoreFromHistory);
bindHistoryControl(document.querySelector("#redo-button"), "redo", restoreFromHistory);
document.querySelector("#rename-button").addEventListener("click", () => renameTape());
document.querySelector("#browse-button").addEventListener("click", () => {
  renderBrowseList();
  document.querySelector("#browse-dialog").showModal();
});
document.querySelector("#about-button").addEventListener("click", () => {
  document.querySelector("#about-dialog").showModal();
});
document.querySelector("#settings-button").addEventListener("click", () => {
  document.querySelector("#locale-setting").value = state.settings.locale;
  document.querySelector("#digits-setting").value = state.settings.decimalDigits;
  document.querySelector("#padding-setting").value = state.settings.padding;
  document.querySelector("#operators-setting").checked = state.settings.replaceOperators;
  document.querySelector("#escape-setting").checked = state.settings.escapeClears;
  document.querySelector("#settings-dialog").showModal();
});

document.querySelector("#settings-form").addEventListener("submit", (event) => {
  if (event.submitter?.value === "cancel") return;
  state.settings = {
    locale: document.querySelector("#locale-setting").value,
    decimalDigits: Math.min(50, Math.max(0, Number(document.querySelector("#digits-setting").value))),
    padding: Math.min(80, Math.max(1, Number(document.querySelector("#padding-setting").value))),
    replaceOperators: document.querySelector("#operators-setting").checked,
    escapeClears: document.querySelector("#escape-setting").checked,
  };
  recalculate({ formatCurrentLine: true });
});

renderTabs();
activateTape(state.activeId);

globalThis.__qwiktape = {
  get state() { return state; },
  calculateActive: () => calculateTape({ text: tapeElement.value, ...state.settings }),
  historyForActive: () => historyFor(),
};
