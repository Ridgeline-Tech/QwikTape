import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { applyTapeEdits, calculateTape } from "../app/src/main/assets/tape-engine.js";

const golden = JSON.parse(readFileSync(
  new URL("./upstream-e781115a.golden.json", import.meta.url),
  "utf8",
));

function optional(target, key, value) {
  if (value !== undefined) target[key] = value;
}

function referenceToken(token) {
  const normalized = {
    type: token.type,
    image: token.image,
    startOffset: token.startOffset,
    endOffset: token.endOffset,
    startLine: token.startLine,
    startColumn: token.startColumn,
    endLine: token.endLine,
    endColumn: token.endColumn,
  };
  optional(normalized, "formatting", token.formatting);
  optional(normalized, "padding", token.padding);
  optional(normalized, "ws", token.whitespace);
  if (token.styles.length > 0) normalized.style = token.styles;
  optional(normalized, "tooltip", token.tooltip);
  optional(normalized, "value", token.value);
  return normalized;
}

function interestingTokens(result) {
  return result.tokens
    .filter((token) => token.formatting !== undefined
      || token.styles.length > 0
      || token.tooltip !== undefined)
    .map(referenceToken);
}

function insertEdits(result) {
  return result.edits
    .filter((edit) => edit.kind === "insert-result")
    .map((edit) => ({
      kind: edit.kind,
      start: edit.start,
      end: edit.end,
      value: edit.value,
      width: edit.width,
      replacement: edit.replacement,
      node: edit.node,
    }));
}

function diagnostics(result, kind) {
  return result.diagnostics
    .filter((diagnostic) => diagnostic.kind === kind)
    .map(({ name, message }) => ({ name, message }));
}

function referenceDiagnostics(errors) {
  return errors.map(({ name, message }) => ({ name, message }));
}

function assertFixture(name, fixture) {
  test(`matches upstream full output: ${name}`, () => {
    const actual = calculateTape({ text: fixture.text, ...fixture.settings });
    const withNullExtension = calculateTape({
      text: fixture.text,
      ...fixture.settings,
      extension: null,
    });
    assert.deepEqual(withNullExtension, actual);
    const formattingEdits = actual.edits.filter((edit) => edit.kind === "replace-token");

    assert.deepEqual(interestingTokens(actual), fixture.result.tokens);
    assert.deepEqual(insertEdits(actual), fixture.result.insertEdits);
    assert.deepEqual(actual.variables, fixture.result.variables);
    assert.deepEqual(diagnostics(actual, "lexer"), referenceDiagnostics(fixture.result.lexerErrors));
    assert.deepEqual(diagnostics(actual, "parser"), referenceDiagnostics(fixture.result.parserErrors));
    assert.equal(applyTapeEdits(fixture.text, formattingEdits), fixture.result.formattedText);
    assert.equal(applyTapeEdits(fixture.text, actual.edits), fixture.result.materializedText);
  });
}

for (const [name, fixture] of Object.entries(golden.cases)) {
  assertFixture(`case ${name}`, fixture);
}

for (const [locale, fixture] of Object.entries(golden.locales)) {
  assertFixture(`locale ${locale}`, fixture);
}

for (const [name, fixture] of Object.entries(golden.seeds)) {
  assertFixture(`seed ${name}`, fixture);
}

test("the unchanged upstream grammar oracle remained green", () => {
  assert.deepEqual(golden.upstreamGrammar, {
    groups: 14,
    cases: 196,
    assertions: 980,
    failures: [],
  });
});
