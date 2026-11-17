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

// Execute the upstream test file unchanged. The globals above provide only the
// Sciter test-runner surface; parser, evaluator, BigDecimal and fixtures remain
// the pinned upstream code.
std.loadScript("tests/sciter-tape-grammar.tests.js");

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
      startLine: edit.node.startLine,
      startColumn: edit.node.startColumn,
      endLine: edit.node.endLine,
      endColumn: edit.node.endColumn,
    } : undefined,
  };
}

function normalizeError(error) {
  return {
    name: error.name,
    message: error.message,
    token: error.token ? normalizeToken(error.token) : undefined,
  };
}

function parseReference(text, options = { decimalDigits: 2, padding: 10 }) {
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
  return {
    edits: edits.map(normalizeEdit),
    tokens,
    variables,
    lexerErrors: lex.errors.map(normalizeError),
    parserErrors: tapeModule.QwikTape.parser.errors.map(normalizeError),
  };
}

tapeModule.QwikTape.changeLocale("1,234,567.89", 2);

const semanticCases = {
  leftToRight: "100\n+ 200\n× 3\n",
  assignmentPrecedence: "answer = 100 + 200 × 3\n",
  addPercent: "100\n+ 5%\n",
  subtractPercent: "100\n- 5%\n",
  multiplyPercent: "100\n× 5%\n",
  dividePercent: "100\n÷ 5%\n",
  powerPercent: "100\n^ 50%\n",
  divideByZero: "100\n÷ 0\n",
  continuation: "100\n+ 200\n═══\n300\n× 3\n",
  resultCapture: "100\n+ 200\n═══\n300 = total\n+ total\n",
};

const golden = {
  source: {
    repository: "https://github.com/4silvertooth/QwikTape",
    commit: "e781115a9dd2168e4933f95ed7eb88c82a5c9318",
    tree: "f739c7e31c24cdfc36b7965e7502af35c3248e92",
    quickJs: "2024-01-13 --bignum",
  },
  upstreamGrammar: stats,
  cases: Object.fromEntries(
    Object.entries(semanticCases).map(([name, text]) => [
      name,
      { text, result: parseReference(text) },
    ])
  ),
  seeds: {
    intro: { text: intro, result: parseReference(intro) },
    tests: { text: testSeed, result: parseReference(testSeed) },
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
