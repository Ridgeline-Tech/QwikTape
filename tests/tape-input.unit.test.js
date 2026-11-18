import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  applyBeforeInput,
  bindHistoryControl,
  removeResultBlockAt,
  runInputRecalculation,
} from "../app/src/main/assets/tape-input.js";

const golden = JSON.parse(readFileSync(
  new URL("./upstream-e781115a.golden.json", import.meta.url),
  "utf8",
));

for (const [name, fixture] of Object.entries(golden.enterCases)) {
  test(`beforeinput Enter matches upstream caret-scoped insertion: ${name}`, () => {
    const actual = applyBeforeInput({
      inputType: "insertParagraph",
      text: fixture.text,
      selectionStart: fixture.selectionStart,
      selectionEnd: fixture.selectionStart,
      settings: fixture.settings,
    });
    const withNullExtension = applyBeforeInput({
      inputType: "insertParagraph",
      text: fixture.text,
      selectionStart: fixture.selectionStart,
      selectionEnd: fixture.selectionStart,
      settings: { ...fixture.settings, extension: null },
    });
    assert.deepEqual(withNullExtension, actual);
    assert.equal(actual.handled, true);
    assert.equal(actual.text, fixture.resultText);
    assert.equal(actual.selectionStart, fixture.selectionAfter);
    assert.equal(actual.selectionEnd, fixture.selectionAfter);
  });
}

test("beforeinput ignores ordinary inserted text", () => {
  assert.equal(applyBeforeInput({ inputType: "insertText", text: "1", selectionStart: 1 }), null);
});

test("history controls retain editor focus before restoring history", () => {
  const listeners = {};
  const button = {
    addEventListener(type, listener) { listeners[type] = listener; },
  };
  const restored = [];
  bindHistoryControl(button, "redo", (direction) => restored.push(direction));

  for (const type of ["pointerdown", "mousedown"]) {
    let prevented = false;
    listeners[type]({ preventDefault() { prevented = true; } });
    assert.equal(prevented, true, `${type} must prevent focus-changing default behavior`);
  }
  listeners.click();
  assert.deepEqual(restored, ["redo"]);
});

test("input recalculation failures preserve the editor and log one diagnostic", () => {
  const failure = new Error("unexpected engine failure");
  const diagnostics = [];
  const outcome = runInputRecalculation(
    () => { throw failure; },
    (...message) => diagnostics.push(message),
  );

  assert.equal(outcome, null);
  assert.deepEqual(diagnostics, [[
    "QwikTape input recalculation failed; editor text was preserved.",
    failure,
  ]]);
});

for (const [name, fixture] of Object.entries(golden.deletionCases)) {
  test(`result-block deletion matches upstream rendered output: ${name}`, () => {
    const actual = removeResultBlockAt({
      text: fixture.text,
      selectionStart: fixture.selectionStart,
      settings: fixture.settings,
    });
    const withNullExtension = removeResultBlockAt({
      text: fixture.text,
      selectionStart: fixture.selectionStart,
      settings: { ...fixture.settings, extension: null },
    });
    assert.deepEqual(withNullExtension, actual);
    assert.equal(actual.text, fixture.resultText);
    assert.equal(actual.selectionStart, fixture.selectionAfter);
    assert.equal(actual.selectionEnd, fixture.selectionAfter);
  });
}
