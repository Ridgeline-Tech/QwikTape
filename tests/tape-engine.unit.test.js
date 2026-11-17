import assert from "node:assert/strict";
import test from "node:test";
import {
  applyTapeEdits,
  calculateTape,
  resultBlockAt,
} from "../app/src/main/assets/tape-engine.js";

test("returns the pure engine contract and materializes a result block", () => {
  const text = "100\n+ 200\n× 3\n";
  const result = calculateTape({ text, locale: "1,234,567.89", decimalDigits: 2, padding: 10 });
  assert.ok(Array.isArray(result.edits));
  assert.ok(Array.isArray(result.tokens));
  assert.ok(Array.isArray(result.diagnostics));
  assert.equal(applyTapeEdits(text, result.edits), "      100.00\n+     200.00\n×       3.00\n════════════\n      900.00");
});

test("locale, decimal digits, and padding are input configuration", () => {
  const text = "1000\n+ 0,5\n";
  const result = calculateTape({
    text,
    locale: "1.234.567,89",
    decimalDigits: 3,
    padding: 8,
  });
  assert.deepEqual(
    result.edits.filter((edit) => edit.kind === "insert-result").map((edit) => edit.value),
    ["1.000,500"],
  );
});

test("undefined and redefined names remain diagnostics while evaluating as upstream", () => {
  const text = "a = 5\na = 7\n100\n+ missing\n";
  const result = calculateTape({ text });
  assert.deepEqual(result.variables, { a: "5" });
  assert.equal(result.diagnostics.filter((item) => item.kind === "evaluation").length, 2);
  assert.deepEqual(
    result.edits.filter((edit) => edit.kind === "insert-result").map((edit) => edit.value),
    ["100.00"],
  );
});

test("result blocks are located atomically for delete/backspace behavior", () => {
  const text = "100\n+ 200\n════\n 300\n+ 5";
  const separatorOffset = text.indexOf("═") + 1;
  const resultOffset = text.indexOf("300") + 1;
  assert.deepEqual(resultBlockAt(text, separatorOffset), resultBlockAt(text, resultOffset));
  assert.deepEqual(resultBlockAt(text, resultOffset), {
    start: text.indexOf("════"),
    end: text.indexOf("300") + 3,
    separatorIndex: 2,
    resultIndex: 3,
  });
});

test("division is half-even at the upstream maximum fractional precision", () => {
  const result = calculateTape({ text: "third = 100 ÷ 300\n" });
  assert.equal(result.variables.third, `0.${"3".repeat(113)}`);
});
