import assert from "node:assert/strict";
import test from "node:test";
import { applyTapeEdits, calculateTape as calculateTapeCore } from "../app/src/main/assets/tape-engine.js";
import { TapeHistory } from "../app/src/main/assets/tape-history.js";

function reparse(text) {
  const result = calculateTapeCore({ text });
  assert.deepEqual(calculateTapeCore({ text, extension: null }), result);
  return applyTapeEdits(text, result.edits.filter((edit) => edit.kind === "replace-token"));
}

test("undo and redo both reparse and rewrite downstream totals", () => {
  const original = reparse("100\n+ 200\n═══\n300");
  const edited = reparse("100\n+ 250\n═══\n300");
  const history = new TapeHistory(original);
  history.commit(edited);

  const undone = reparse(history.undo());
  history.replaceCurrent(undone);
  assert.match(undone, /300\.00$/);

  const redone = reparse(history.redo());
  history.replaceCurrent(redone);
  assert.match(redone, /350\.00$/);
});
