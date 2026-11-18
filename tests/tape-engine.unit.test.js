import assert from "node:assert/strict";
import test from "node:test";
import {
  applyTapeEdits,
  calculateTape,
  resultBlockAt,
} from "../app/src/main/assets/tape-engine.js";
import { BigNum } from "../app/src/main/assets/bignum.js";

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

test("division fallback rounds an exact tie half-even at 113 fractional digits", () => {
  const divisor = BigNum(`2${"0".repeat(113)}`);
  assert.equal(BigNum.divide(BigNum(1), divisor).toFixed(113), `0.${"0".repeat(113)}`);
});

test("oversized powers fail quickly and leave the accumulator unchanged", () => {
  const started = performance.now();
  const result = calculateTape({ text: "10\n^99999999\n" });
  const elapsed = performance.now() - started;

  assert.ok(elapsed < 1000, `oversized power guard took ${elapsed.toFixed(1)} ms`);
  assert.equal(
    result.edits.find((edit) => edit.kind === "insert-result")?.value,
    "10.00",
  );
  const powerError = result.tokens.find((token) => token.image === "99999999");
  assert.ok(powerError?.styles.includes("Error"));
  assert.match(powerError?.tooltip ?? "", /power is too large/);

  const normal = calculateTape({ text: "2\n^ 10\n" });
  assert.equal(
    normal.edits.find((edit) => edit.kind === "insert-result")?.value,
    "1,024.00",
  );
});

test("invalid locale falls back to default without leaking prior call state", () => {
  const insertValue = (locale) => calculateTape({
    text: "1234567\n+ 1234567\n",
    locale,
  }).edits.find((edit) => edit.kind === "insert-result")?.value;

  assert.equal(insertValue("1.234.567,89"), "2.469.134,00");
  assert.equal(insertValue("de-DE"), "2,469,134.00");
  assert.equal(insertValue("1'234'567.89"), "2'469'134.00");
});
