import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  applyTapeEdits,
  calculateTape,
} from "../app/src/main/assets/tape-engine.js";

function quantity(amount) {
  return { amount };
}

function amount(value) {
  return value.amount;
}

function calculate(left, operator, right) {
  switch (operator) {
    case "+": return quantity(amount(left) + amount(right));
    case "-": return quantity(amount(left) - amount(right));
    case "*":
    case "×": return quantity(amount(left) * amount(right));
    case "/":
    case "÷": return quantity(amount(left) / amount(right));
    case "^": return quantity(amount(left) ** amount(right));
    default: throw new RangeError(`unsupported fake operator ${operator}`);
  }
}

const fakeExtension = {
  matchLiteral(text, offset) {
    const match = /^u(-?\d+(?:\.\d+)?)/.exec(text.slice(offset));
    if (!match) return null;
    const value = quantity(Number(match[1]));
    return {
      length: match[0].length,
      value,
      formatting: value.amount === 10 ? "u10.0" : undefined,
    };
  },
  matchPrefix(text, offset) {
    return text[offset] === "~"
      ? { length: 1, value: "double", formatting: "pre" }
      : null;
  },
  matchPostfix(text, offset) {
    return text[offset] === "!"
      ? { length: 1, value: "increment", formatting: "post" }
      : null;
  },
  valueAdapter: {
    fromDecimal(value) { return quantity(Number(value.toString())); },
    formatLiteral(value) { return `u${amount(value).toFixed(1)}`; },
    formatValue(value) { return `u${amount(value).toFixed(2)}`; },
    fixedValue(value) { return String(amount(value)); },
    formatPercentageValue(value) { return `u${amount(value).toFixed(3)}`; },
    negate(value) { return quantity(-amount(value)); },
    isNegative(value) { return amount(value) < 0; },
    evaluate(left, operator, right) { return calculate(left, operator, right); },
    percentageOfOne(value) { return quantity(amount(value) / 100); },
    evaluatePercentage(left, operator, percentage) {
      switch (operator) {
        case "+": return quantity(amount(left) + amount(left) * amount(percentage));
        case "-": return quantity(amount(left) - amount(left) * amount(percentage));
        case "*":
        case "×": return quantity(amount(left) * amount(percentage));
        case "/":
        case "÷": return quantity(amount(left) / amount(percentage));
        case "^": return quantity(amount(left) ** amount(percentage));
        default: throw new RangeError(`unsupported fake percentage operator ${operator}`);
      }
    },
    applyPrefix(prefix, value) {
      if (prefix !== "double") throw new RangeError("unknown fake prefix");
      return quantity(amount(value) * 2);
    },
    applyPostfix(value, postfix) {
      if (postfix !== "increment") throw new RangeError("unknown fake postfix");
      return quantity(amount(value) + 1);
    },
  },
};

function insertedValues(result) {
  return result.edits
    .filter((edit) => edit.kind === "insert-result")
    .map((edit) => edit.value);
}

test("omitted and null extensions match main across full seeded outputs", () => {
  const expectedMainDigest = "2a0be2c4bff38f96c1cbb5089f1e7dedd0701fb8e2fb16b9f5f043c445bf6b8f";
  const corpusSize = 4_039;
  const alphabet = "0123456789+-*/×÷^%()= abcdef\n.,";
  let state = 0xc011ab1e;
  const next = () => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    return state;
  };
  const inputs = ["1-", "b=÷0", "x=×x", "b = ÷ 2", "100\n+\n"];
  while (inputs.length < corpusSize) {
    const length = next() % 33;
    let text = "";
    for (let index = 0; index < length; index += 1) {
      text += alphabet[next() % alphabet.length];
    }
    inputs.push(text);
  }

  for (const extension of [undefined, null]) {
    const digest = createHash("sha256");
    for (const text of inputs) {
      const result = extension === undefined
        ? calculateTape({ text })
        : calculateTape({ text, extension });
      const json = JSON.stringify(result);
      digest.update(`${json.length}:`);
      digest.update(json);
    }
    assert.equal(digest.digest("hex"), expectedMainDigest);
  }
});

test("generic extension covers literals, decorators, binary operations, and offsets", () => {
  const text = "~u10!\n+ u5\n";
  const result = calculateTape({ text, extension: fakeExtension });
  assert.deepEqual(insertedValues(result), ["u26.00"]);
  assert.deepEqual(result.diagnostics, []);

  const prefix = result.tokens.find((token) => token.type === "ExtensionPrefix");
  const literal = result.tokens.find((token) => token.image === "u10");
  const postfix = result.tokens.find((token) => token.type === "ExtensionPostfix");
  assert.deepEqual(
    [prefix.startOffset, prefix.endOffset, literal.startOffset, literal.endOffset,
      postfix.startOffset, postfix.endOffset],
    [0, 0, 1, 3, 4, 4],
  );
  assert.equal(prefix.formatting, "pre");
  assert.equal(literal.formatting, "u10.0");
  assert.equal(postfix.formatting, "post");
});

test("generic extension survives variables, negation, and mixed native percentages", () => {
  const variables = calculateTape({
    text: "a = u10\nb = a + u5\nnegative = -u5\nb\n+ u5\n",
    extension: fakeExtension,
  });
  assert.deepEqual(variables.variables, { a: "10", b: "15", negative: "-5" });
  assert.deepEqual(insertedValues(variables), ["u20.00"]);
  assert.deepEqual(variables.diagnostics, []);

  const percentage = calculateTape({
    text: "u100\n+ 10%\n",
    extension: fakeExtension,
  });
  assert.deepEqual(insertedValues(percentage), ["u110.00"]);
  const percentageToken = percentage.tokens.find((token) => token.type === "Percentage");
  assert.equal(percentageToken.formatting, "% ⥱ u0.100");
});

test("generic extension rewrites stale totals and preserves source edit offsets", () => {
  const text = "u10\n+ u5\n════\nu99 = total\n";
  const result = calculateTape({ text, extension: fakeExtension });
  const stale = result.edits.find((edit) => edit.kind === "replace-token"
    && edit.start === text.indexOf("u99"));
  assert.equal(stale.replacement.trim(), "u15.00");
  assert.equal(stale.end, text.indexOf("u99") + 3);
  assert.match(applyTapeEdits(text, result.edits), /u15\.00/);
  assert.equal(result.variables.total, "15");
});

test("unmatched syntax keeps native output and extension failures are diagnostics", () => {
  const unmatched = "plain ? syntax\n";
  assert.deepEqual(
    calculateTape({ text: unmatched, extension: fakeExtension }),
    calculateTape({ text: unmatched }),
  );

  const nativeText = "100\n+ 200\n";
  const native = calculateTape({ text: nativeText });
  for (const [name, matcher, message] of [
    ["throwing literal", { matchLiteral() { throw new Error("fake literal failed"); } }, /fake literal failed/],
    ["zero-length literal", { matchLiteral() { return { length: 0, value: quantity(1) }; } }, /invalid descriptor/],
    ["throwing prefix", { matchPrefix() { throw new Error("fake prefix failed"); } }, /fake prefix failed/],
  ]) {
    const failed = calculateTape({
      text: nativeText,
      extension: { ...fakeExtension, ...matcher },
    });
    const matcherDiagnostics = failed.diagnostics.filter((item) => item.kind === "extension");
    assert.equal(matcherDiagnostics.length, 1, name);
    assert.match(matcherDiagnostics[0].message, message, name);
    assert.deepEqual(failed.tokens, native.tokens, name);
    assert.deepEqual(failed.edits, native.edits, name);
    assert.deepEqual(failed.variables, native.variables, name);
    assert.deepEqual(insertedValues(failed), ["300.00"], name);
  }

  const adapterFailure = {
    ...fakeExtension,
    valueAdapter: {
      ...fakeExtension.valueAdapter,
      evaluate() { throw new Error("fake evaluate failed"); },
    },
  };
  const failedEvaluation = calculateTape({
    text: "u1\n+ u2\n",
    extension: adapterFailure,
  });
  const evaluationDiagnostic = failedEvaluation.diagnostics
    .find((item) => /fake evaluate failed/.test(item.message));
  assert.equal(evaluationDiagnostic.token.image, "u2");
  assert.deepEqual(insertedValues(failedEvaluation), ["u1.00"]);

  const serializationFailure = {
    ...fakeExtension,
    valueAdapter: {
      ...fakeExtension.valueAdapter,
      fixedValue(value) {
        if (amount(value) === 2) throw new Error("fake fixed value failed");
        return String(amount(value));
      },
    },
  };
  const failedSerialization = calculateTape({
    text: "u1\n+ u2\n",
    extension: serializationFailure,
  });
  const serializationDiagnostic = failedSerialization.diagnostics
    .find((item) => /fake fixed value failed/.test(item.message));
  assert.equal(serializationDiagnostic.token.image, "u2");
});

test("a later variable fixedValue failure becomes a diagnostic", () => {
  let fixedValueCalls = 0;
  const extension = {
    ...fakeExtension,
    valueAdapter: {
      ...fakeExtension.valueAdapter,
      fixedValue(value) {
        fixedValueCalls += 1;
        if (fixedValueCalls >= 3) throw new Error("late fixed value failure");
        return String(amount(value));
      },
    },
  };
  const result = calculateTape({ text: "a = u1\n", extension });

  assert.equal(result.diagnostics.some((item) => item.kind === "engine"), false);
  assert.ok(result.diagnostics.some((item) => /late fixed value failure/.test(item.message)));
  assert.ok(Object.hasOwn(result.variables, "a"));
});

test("opaque extension values cannot escalate serialization failures", () => {
  for (const [name, failOnCall] of [["token", 2], ["variable", 3]]) {
    let fixedValueCalls = 0;
    const opaqueValue = {
      amount: 9,
      toString() { throw new Error("opaque toString must not run"); },
    };
    const extension = {
      ...fakeExtension,
      matchLiteral(text, offset) {
        return text.startsWith("u9", offset)
          ? { length: 2, value: opaqueValue }
          : fakeExtension.matchLiteral(text, offset);
      },
      valueAdapter: {
        ...fakeExtension.valueAdapter,
        fixedValue(value) {
          fixedValueCalls += 1;
          if (fixedValueCalls === failOnCall) throw new Error(`hostile ${name} fixed value`);
          return String(amount(value));
        },
      },
    };
    const result = calculateTape({
      text: "a = 5\n100\n+ 200\n\nx = u9\n",
      extension,
    });

    assert.equal(result.diagnostics.some((item) => item.kind === "engine"), false, name);
    assert.ok(result.diagnostics.some((item) => new RegExp(`hostile ${name} fixed value`).test(item.message)), name);
    assert.equal(result.variables.a, "5", name);
    assert.deepEqual(insertedValues(result), ["300.00"], name);
    if (name === "token") {
      assert.equal(result.tokens.find((token) => token.image === "u9").value, "?", name);
    } else {
      assert.equal(result.variables.x, "?", name);
    }
  }
});
