import * as std from "std";
import * as bignum from "../src/parser/bignum.js";
import * as tapeModule from "../src/parser/tape-embedded.js";
import { intro, tests as testSeed } from "../src/storage/seeds.js";

const stats = { groups: 0, cases: 0, assertions: 0, failures: [] };
let currentGroup = "";

function valueEqual(actual, expected) {
  if (actual === expected) return true;
  if (typeof actual === "number" || typeof actual === "bigdecimal") {
    return String(actual) === String(expected);
  }
  if (Array.isArray(actual) && Array.isArray(expected)) {
    return actual.length === expected.length
      && actual.every((value, index) => valueEqual(value, expected[index]));
  }
  if (actual && expected && typeof actual === "object" && typeof expected === "object") {
    const keys = Object.keys(expected);
    return keys.every((key) => valueEqual(actual[key], expected[key]));
  }
  return false;
}

function describe(value) {
  try {
    return JSON.stringify(value, (_key, item) =>
      typeof item === "bigdecimal" ? String(item) : item
    );
  } catch (_error) {
    return String(value);
  }
}

function check(condition, message) {
  stats.assertions += 1;
  if (!condition) throw new Error(message);
}

globalThis.sciter = {
  import(path) {
    if (path.endsWith("/bignum.js")) return bignum;
    if (path.endsWith("/tape-embedded.js")) return tapeModule;
    throw new Error(`Unsupported sciter.import in golden runner: ${path}`);
  },
};

globalThis.testGroup = (name, body, beforeEach) => {
  currentGroup = name;
  stats.groups += 1;
  if (beforeEach) beforeEach();
  body();
};

globalThis.test = (name, body) => {
  stats.cases += 1;
  try {
    body();
  } catch (error) {
    stats.failures.push(`${currentGroup} / ${name}: ${error.stack || error}`);
  }
};

globalThis.expect = (received) => ({
  equal(expected) {
    check(valueEqual(received, expected),
      `expected ${describe(received)} to equal ${describe(expected)}`);
  },
  defined() {
    check(received !== undefined, "expected value to be defined");
  },
  haveLength(expected) {
    check(received != null && received.length === expected,
      `expected length ${expected}, received ${received?.length}`);
  },
  instanceOf(expected) {
    check(received instanceof expected,
      `expected ${describe(received)} to be an instance of ${expected.name}`);
  },
  contain(expected) {
    const contains = Object.keys(expected).every((key) => {
      const matcher = expected[key];
      if (typeof matcher === "function") return matcher(received[key])[0];
      return valueEqual(received[key], matcher);
    });
    check(contains,
      `expected ${describe(received)} to contain ${describe(expected)}`);
  },
});

// Run this script from tests/ so QuickJS resolves the unchanged upstream
// module imports above. The globals provide only the Sciter test-runner
// surface; parser, evaluator, BigDecimal and fixtures remain pinned upstream
// code. Example:
//   qjs --bignum --std run-upstream-golden.qjs.js upstream-e781115a.golden.json
std.loadScript("sciter-tape-grammar.tests.js");

function normalizeValue(value) {
  if (value === undefined) return undefined;
  if (typeof value === "bigdecimal" || typeof value === "number") return String(value);
  return value;
}

function normalizeStyle(style) {
  if (style === undefined) return undefined;
  return Array.isArray(style) ? [...style] : [style];
}

function normalizeToken(token) {
  const normalized = {
    type: token.tokenType?.name,
    image: token.image,
    startOffset: token.startOffset,
    endOffset: token.endOffset,
    startLine: token.startLine,
    startColumn: token.startColumn,
    endLine: token.endLine,
    endColumn: token.endColumn,
  };
  if (token.formatting !== undefined) normalized.formatting = token.formatting;
  if (token.padding !== undefined) normalized.padding = token.padding;
  if (token.ws !== undefined) normalized.ws = token.ws;
  if (token.style !== undefined) normalized.style = normalizeStyle(token.style);
  if (token.tooltip !== undefined) normalized.tooltip = String(token.tooltip);
  if (token.value !== undefined) normalized.value = normalizeValue(token.value);
  return normalized;
}

function normalizeEdit(edit) {
  return {
    type: edit.type,
    value: normalizeValue(edit.value),
    padding: edit.padding,
    token: normalizeToken(edit),
    node: edit.node ? {
      image: edit.node.image,
      startOffset: edit.node.startOffset,
      endOffset: edit.node.endOffset,
      startLine: edit.node.startLine,
      startColumn: edit.node.startColumn,
      endLine: edit.node.endLine,
      endColumn: edit.node.endColumn,
    } : undefined,
  };
}

function formattingEdit(token) {
  const whitespace = token.ws ?? 0;
  const padding = token.padding ?? 0;
  const value = token.formatting ?? token.image;
  return {
    kind: "replace-token",
    line: token.startLine,
    start: Math.max(0, token.startOffset - whitespace),
    end: token.endOffset + 1,
    value,
    replacement: `${" ".repeat(Math.max(0, whitespace + padding))}${value}`,
  };
}

function resultEdit(edit, text) {
  const value = String(edit.value);
  const width = Math.max(edit.padding ?? 0, value.length);
  const start = edit.node.endOffset + 1;
  const following = text.slice(start);
  const trailingNewline = following && !following.startsWith("\n") ? "\n" : "";
  return {
    kind: "insert-result",
    start,
    end: start,
    value,
    width,
    replacement: `${"═".repeat(width)}\n${value.padStart(width, " ")}${trailingNewline}`,
    node: {
      startOffset: edit.node.startOffset,
      endOffset: edit.node.endOffset,
      startLine: edit.node.startLine,
      startColumn: edit.node.startColumn,
      endLine: edit.node.endLine,
      endColumn: edit.node.endColumn,
    },
  };
}

function applyEdits(text, edits) {
  return [...edits]
    .sort((left, right) => right.start - left.start || right.end - left.end)
    .reduce(
      (next, edit) => `${next.slice(0, edit.start)}${edit.replacement}${next.slice(edit.end)}`,
      text,
    );
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

function normalizeError(error) {
  return {
    name: error.name,
    message: error.message,
    token: error.token ? normalizeToken(error.token) : undefined,
  };
}

function parseReference(text, settings = {}) {
  const options = {
    decimalDigits: settings.decimalDigits ?? 2,
    padding: settings.padding ?? 10,
  };
  tapeModule.QwikTape.changeLocale(settings.locale ?? "1,234,567.89", options.decimalDigits);
  const lex = tapeModule.QwikTape.lexer.tokenize(text);
  tapeModule.QwikTape.parser.input = lex.tokens;
  const edits = tapeModule.QwikTape.parser.tape(options);
  const tokens = lex.tokens
    .filter((token) => token.formatting !== undefined
      || token.style !== undefined
      || token.tooltip !== undefined)
    .map(normalizeToken);
  const variables = Object.fromEntries(
    Object.entries(tapeModule.QwikTape.parser._vars)
      .map(([name, value]) => [name, normalizeValue(value)])
  );
  const formattingEdits = lex.tokens
    .filter((token) => token.formatting !== undefined || token.padding !== undefined)
    .map(formattingEdit);
  const insertEdits = edits
    .filter((edit) => edit?.type === tapeModule.QwikTape.tokenType.Insert)
    .map((edit) => resultEdit(edit, text));
  return {
    edits: edits.map(normalizeEdit),
    formattingEdits,
    insertEdits,
    tokens,
    variables,
    lexerErrors: lex.errors.map(normalizeError),
    parserErrors: tapeModule.QwikTape.parser.errors.map(normalizeError),
    formattedText: applyEdits(text, formattingEdits),
    materializedText: applyEdits(text, [...formattingEdits, ...insertEdits]),
  };
}

function fixture(text, settings = {}) {
  return { text, settings, result: parseReference(text, settings) };
}

function enterFixture(text, selectionStart, settings = {}) {
  const source = `${text.slice(0, selectionStart)}\n${text.slice(selectionStart)}`;
  const caret = selectionStart + 1;
  const result = parseReference(source, settings);
  const selectedInsert = result.insertEdits.find((edit) => edit.start === caret);
  const edits = [...result.formattingEdits, ...(selectedInsert ? [selectedInsert] : [])];
  return {
    text,
    selectionStart,
    settings,
    source,
    selectedInsert,
    resultText: applyEdits(source, edits),
    selectionAfter: selectionAfterEdits(caret, edits),
  };
}

function deleteFixture(text, selectionStart, blockStart, blockEnd, settings = {}) {
  const source = `${text.slice(0, blockStart)}${text.slice(blockEnd)}`;
  const result = parseReference(source, settings);
  return {
    text,
    selectionStart,
    block: { start: blockStart, end: blockEnd },
    settings,
    source,
    resultText: result.formattedText,
    selectionAfter: blockStart,
  };
}

const semanticCases = {
  leftToRight: fixture("100\n+ 200\n× 3\n"),
  assignmentPrecedence: fixture("answer = 100 + 200 × 3\n"),
  addPercent: fixture("100\n+ 5%\n"),
  subtractPercent: fixture("100\n- 5%\n"),
  multiplyPercent: fixture("100\n× 5%\n"),
  dividePercent: fixture("100\n÷ 5%\n"),
  dividePercentNonTerminating: fixture("100\n÷ 3%\n"),
  powerPercent: fixture("100\n^ 50%\n"),
  negativeExponent: fixture("2\n^ -1\n"),
  zeroExponent: fixture("2\n^ 0\n"),
  divideByZero: fixture("100\n÷ 0\n"),
  continuation: fixture("100\n+ 200\n═══\n300\n× 3\n"),
  resultCapture: fixture("100\n+ 200\n═══\n300 = total\n+ total\n"),
  exactDecimal: fixture("0.1\n+ 0.2\n"),
  roundingTieZeroPositive: fixture("2.5\n+ 0\n", { decimalDigits: 0 }),
  roundingTieTwoPositive: fixture("10.005\n+ 0\n", { decimalDigits: 2 }),
  roundingTieTwoNegative: fixture("-10.005\n+ 0\n", { decimalDigits: 2 }),
  roundingTieThreeNegative: fixture("-1.2345\n+ 0\n", { decimalDigits: 3 }),
  digitsFifty: fixture("0.1\n+ 0.2\n", { decimalDigits: 50 }),
  undefinedName: fixture("100\n+ missing\n"),
  redefinedName: fixture("a = 5\na = 7\n"),
  staleTotal: fixture("100\n+ 200\n════\n999"),
  staleTotalRewrite: fixture("      100.00\n+     250.00\n════════════\n      300.00"),
};

const localeFormats = [
  "1234567.89",
  "1234567,89",
  "1,234,567.89",
  "1.234.567,89",
  "1 234 567.89",
  "1 234 567,89",
  "12,34,567.89",
  "12 34 567.89",
  "1'234'567.89",
  "1'234'567,89",
  "1.234.567'89",
  "1˙234˙567.89",
  "1˙234˙567,89",
  "1,234,567·89",
];

const localeCases = Object.fromEntries(localeFormats.map((locale) => {
  const integer = locale.slice(0, -3);
  return [locale, fixture(`${integer}\n+ ${integer}\n`, { locale })];
}));

const scopedEnterText = "100\n+ 200\nnote line\n50\n+ 5";
const selectedEnterText = "100\n+ 200\nnote line";
const deletionText = "      100.00\n+     200.00\n════════════\n      300.00";
const deletionStart = deletionText.indexOf("═");

const golden = {
  source: {
    repository: "https://github.com/4silvertooth/QwikTape",
    commit: "e781115a9dd2168e4933f95ed7eb88c82a5c9318",
    tree: "f739c7e31c24cdfc36b7965e7502af35c3248e92",
    quickJs: "2024-01-13 --bignum",
  },
  upstreamGrammar: stats,
  cases: semanticCases,
  locales: localeCases,
  enterCases: {
    scopedPendingTotals: enterFixture(scopedEnterText, scopedEnterText.length),
    selectedChainBeforeText: enterFixture(selectedEnterText, selectedEnterText.indexOf("\nnote line")),
  },
  deletionCases: {
    resultBlock: deleteFixture(
      deletionText,
      deletionText.lastIndexOf("300") + 1,
      deletionStart,
      deletionText.length,
    ),
  },
  seeds: {
    intro: fixture(intro),
    tests: fixture(testSeed),
  },
};

if (stats.failures.length > 0) {
  for (const failure of stats.failures) console.log(`FAIL ${failure}`);
  throw new Error(`${stats.failures.length} upstream grammar cases failed`);
}

const outputPath = scriptArgs[1];
if (!outputPath) throw new Error("Usage: qjs --bignum --std tests/run-upstream-golden.qjs.js <output.json>");
const output = std.open(outputPath, "w");
output.puts(`${JSON.stringify(golden, null, 2)}\n`);
output.close();

console.log(`PASS upstream grammar: ${stats.groups} groups, ${stats.cases} cases, ${stats.assertions} assertions`);
console.log(`WROTE ${outputPath}`);
