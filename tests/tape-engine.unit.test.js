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

test("result magnitude bound stops variable squaring without rejecting valid large values", () => {
  const valid = calculateTape({ text: "a = 10 ^ 4999\nb = a × a\n" });
  assert.deepEqual(valid.diagnostics, []);
  assert.equal(valid.variables.a, "1e+4999");
  assert.equal(valid.variables.b, "1e+9998");

  const names = "abcdefghijklm";
  const lines = ["a = 10 ^ 4999"];
  for (let index = 1; index < names.length; index += 1) {
    lines.push(`${names[index]} = ${names[index - 1]} × ${names[index - 1]}`);
  }

  const started = performance.now();
  const bounded = calculateTape({ text: `${lines.join("\n")}\n` });
  const elapsed = performance.now() - started;
  assert.ok(elapsed < 1500, `variable squaring guard took ${elapsed.toFixed(1)} ms`);
  assert.equal(bounded.variables.a, "1e+4999");
  for (const name of names.slice(1)) assert.equal(bounded.variables[name], "1e+9998");

  const errors = bounded.diagnostics.filter((item) => item.kind === "evaluation");
  assert.equal(errors.length, names.length - 2);
  assert.ok(errors.every((item) => /result is too large/.test(item.message)));
  assert.ok(errors.every((item) => item.token.styles.includes("Error")));
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

test("incomplete trailing operators produce diagnostics without throwing", () => {
  const result = calculateTape({ text: "1-" });

  assert.deepEqual(result.tokens.map((token) => token.image), ["1", "-"]);
  assert.equal(result.edits.some((edit) => edit.kind === "insert-result"), false);
  assert.ok(result.diagnostics.some((diagnostic) => diagnostic.kind === "parser"));
});

test("unexpected calculation failures return a contained engine diagnostic", () => {
  const result = calculateTape({
    text: { toString() { throw new Error("injected failure"); } },
  });

  assert.deepEqual(result.edits, []);
  assert.deepEqual(result.tokens, []);
  assert.deepEqual(result.variables, {});
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].kind, "engine");
  assert.equal(result.diagnostics[0].message, "The tape could not be recalculated. Your text was preserved.");
  assert.doesNotMatch(result.diagnostics[0].message, /injected failure/);
  assert.deepEqual(calculateTape(), {
    edits: [],
    tokens: [],
    diagnostics: [],
    variables: {},
  });
});

for (const incomplete of ["b=÷0", "x=×x", "b = ÷ 2"]) {
  test(`incomplete assignment keeps unrelated tape results: ${incomplete}`, () => {
    const text = `a = 5\n100\n+ 200\n${incomplete}\n250\n+ 0\n`;
    const result = calculateTape({ text });

    assert.deepEqual(
      result.edits.filter((edit) => edit.kind === "insert-result").map((edit) => edit.value),
      ["300.00", "250.00"],
    );
    assert.deepEqual(result.variables, { a: "5" });
    assert.equal(result.diagnostics.some((diagnostic) => diagnostic.kind === "engine"), false);
    assert.ok(result.diagnostics.some((diagnostic) => diagnostic.kind === "parser"));
  });
}

for (const incomplete of ["5-3\n═-u", "5-a\n═\n!"]) {
  test(`recovered result syntax keeps unrelated tape results: ${JSON.stringify(incomplete)}`, () => {
    const text = `a = 5\n100\n+ 200\n\n${incomplete}\n\n50\n× a\n`;
    const result = calculateTape({ text });

    assert.deepEqual(
      result.edits.filter((edit) => edit.kind === "insert-result").map((edit) => edit.value),
      ["300.00", "250.00"],
    );
    assert.deepEqual(result.variables, { a: "5" });
    assert.equal(result.diagnostics.some((diagnostic) => diagnostic.kind === "engine"), false);
    assert.ok(result.diagnostics.some((diagnostic) => diagnostic.kind === "parser"));
  });
}

for (const incomplete of [
  "3-5\n═÷5",
  "0-5\n═÷2",
  "0-t\n═÷0",
  "5+x\n═^0",
  "-a-5\n═×3",
  "0^u\n═\n\n-5",
  "0-a\n═\n\n-5",
  "5-5\n═\n=-a",
]) {
  test(`recovered aggregate keeps surrounding rows: ${JSON.stringify(incomplete)}`, () => {
    const text = `a = 5\n100\n+ 200\n\n${incomplete}\n\n50\n× 5\n`;
    const result = calculateTape({ text });
    const insertedResults = result.edits
      .filter((edit) => edit.kind === "insert-result")
      .map((edit) => edit.value);

    assert.equal(insertedResults[0], "300.00");
    assert.equal(insertedResults.at(-1), "250.00");
    assert.deepEqual(result.variables, { a: "5" });
    assert.equal(result.diagnostics.some((diagnostic) => diagnostic.kind === "engine"), false);
    assert.ok(result.diagnostics.length > 0);
  });
}

test("seeded incomplete-input fuzz never throws and stays bounded", () => {
  const corpusSize = 4_096;
  const fragments = [
    "0", "1", "5", ".", ",", " ", "(", ")",
    "+", "-", "×", "÷", "*", "/", "^", "%", "=",
    "a", "b", "u", "foo", "!", "═", "\n", "%⥱",
  ];
  const requiredFragments = [
    "═÷5", "═×3", "═^0", "═-5", "═+5",
    "═\n\n-5", "═\n=-a", "-5", "%⥱",
    "═", "+", "-", "×", "÷", "^", "%", "a", "b", "!", "\n",
  ];
  const inputs = [];

  for (const seed of [0x51a7c0de, 0x73d0cafe, 0xdeadbeef, 0xc001d00d]) {
    let state = seed;
    const next = () => {
      state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
      return state;
    };
    const seededInputs = [
      "1-", "5-3\n═-u", "5-a\n═\n!",
      "3-5\n═÷5", "0-5\n═÷2", "0-t\n═÷0", "5+x\n═^0",
      "-a-5\n═×3", "0^u\n═\n\n-5", "0-a\n═\n\n-5", "5-5\n═\n=-a",
    ];
    while (seededInputs.length < corpusSize) {
      const fragmentCount = next() % 17;
      let text = requiredFragments[seededInputs.length % requiredFragments.length];
      for (let index = 0; index < fragmentCount; index += 1) {
        text += fragments[next() % fragments.length];
      }
      seededInputs.push(text);
    }
    inputs.push(...seededInputs);
  }

  const started = performance.now();
  for (const text of inputs) {
    const result = calculateTape({ text });
    assert.ok(Array.isArray(result.tokens), JSON.stringify({ text }));
    assert.ok(Array.isArray(result.edits), JSON.stringify({ text }));
    assert.ok(Array.isArray(result.diagnostics), JSON.stringify({ text }));
    assert.equal(
      result.diagnostics.some((diagnostic) => diagnostic.kind === "engine"),
      false,
      JSON.stringify({ text, diagnostics: result.diagnostics }),
    );
  }
  const elapsed = performance.now() - started;
  assert.ok(elapsed < 5_000, `seeded fuzz took ${elapsed.toFixed(1)} ms`);
});
