import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { calculateTape } from "../app/src/main/assets/tape-engine.js";

const golden = JSON.parse(readFileSync(
  new URL("./upstream-e781115a.golden.json", import.meta.url),
  "utf8",
));

function insertValues(result) {
  return result.edits
    .filter((edit) => edit.kind === "insert-result")
    .map((edit) => edit.value);
}

function referenceInsertValues(result) {
  return result.edits.map((edit) => edit.value);
}

function evaluationErrors(result) {
  return result.diagnostics.filter((diagnostic) => diagnostic.kind === "evaluation");
}

for (const [name, fixture] of Object.entries(golden.cases)) {
  test(`matches upstream golden case: ${name}`, () => {
    const actual = calculateTape({ text: fixture.text });
    assert.deepEqual(insertValues(actual), referenceInsertValues(fixture.result));
    assert.deepEqual(actual.variables, fixture.result.variables);
    assert.equal(
      evaluationErrors(actual).length,
      fixture.result.tokens.filter((token) => token.style?.includes("Error")).length,
    );
    assert.equal(
      actual.diagnostics.filter((diagnostic) => diagnostic.kind === "lexer").length,
      fixture.result.lexerErrors.length,
    );
    assert.equal(
      actual.diagnostics.filter((diagnostic) => diagnostic.kind === "parser").length,
      fixture.result.parserErrors.length,
    );
  });
}

for (const [name, fixture] of Object.entries(golden.seeds)) {
  test(`matches upstream seed: ${name}`, () => {
    const actual = calculateTape({ text: fixture.text });
    assert.deepEqual(insertValues(actual), referenceInsertValues(fixture.result));
    assert.deepEqual(actual.variables, fixture.result.variables);
    assert.equal(
      evaluationErrors(actual).length,
      fixture.result.tokens.filter((token) => token.style?.includes("Error")).length,
    );
    assert.equal(
      actual.diagnostics.filter((diagnostic) => diagnostic.kind === "lexer").length,
      fixture.result.lexerErrors.length,
    );
    assert.equal(
      actual.diagnostics.filter((diagnostic) => diagnostic.kind === "parser").length,
      fixture.result.parserErrors.length,
    );
  });
}

test("fixture records the unchanged upstream grammar suite", () => {
  assert.deepEqual(golden.upstreamGrammar, {
    groups: 14,
    cases: 196,
    assertions: 980,
    failures: [],
  });
});
