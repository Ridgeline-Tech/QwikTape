import { performance } from "node:perf_hooks";

import { calculateTape } from "../app/src/main/assets/tape-engine.js";
import { assertTapeEditInvariants } from "../tests/tape-edit-invariants.js";

const seeds = [0x51a7c0de, 0x73d0cafe, 0xdeadbeef, 0xc001d00d];
const inputsPerSeed = 6_250;
const requiredInputs = [
  "1-",
  "5-3\n═-u",
  "5-a\n═\n!",
  "3-5\n═÷5",
  "0-5\n═÷2",
  "0-t\n═÷0",
  "5+x\n═^0",
  "-a-5\n═×3",
  "0^u\n═\n\n-5",
  "0-a\n═\n\n-5",
  "5-5\n═\n=-a",
  "1000000\n+     200.00\n════════════\n      1,000,200.00",
  "0-5\n═\n)3",
];
const biasedFragments = [
  "═÷5", "═×3", "═^0", "═-5", "═+5",
  "═\n\n-5", "═\n=-a", "-5", "%⥱",
  "0", "1", "5", ".", ",", " ", "(", ")",
  "+", "-", "×", "÷", "*", "/", "^", "%", "=",
  "a", "b", "u", "foo", "!", "═", "\n",
];

let inputCount = 0;
let diagnosticCount = 0;
let engineFailureCount = 0;
let editInvariantFailureCount = 0;
const engineFailures = [];
const editInvariantFailures = [];
const started = performance.now();

for (const seed of seeds) {
  let state = seed;
  const next = () => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    return state;
  };
  const inputs = [...requiredInputs];

  while (inputs.length < inputsPerSeed) {
    const fragmentCount = 1 + (next() % 20);
    let text = biasedFragments[inputs.length % 9];
    for (let index = 0; index < fragmentCount; index += 1) {
      text += biasedFragments[next() % biasedFragments.length];
    }
    if ((inputs.length & 3) === 0) text = `a = 5\n${text}\n50\n× 5\n`;
    inputs.push(text);
  }

  for (const text of inputs) {
    const result = calculateTape({ text });
    inputCount += 1;
    diagnosticCount += result.diagnostics.length;
    if (result.diagnostics.some((diagnostic) => diagnostic.kind === "engine")) {
      engineFailureCount += 1;
      if (engineFailures.length < 10) engineFailures.push({ seed, text, diagnostics: result.diagnostics });
    }
    try {
      assertTapeEditInvariants(text, result, `biased fuzz seed ${seed}`);
    } catch (error) {
      editInvariantFailureCount += 1;
      if (editInvariantFailures.length < 10) {
        editInvariantFailures.push({ seed, text, message: error.message });
      }
    }
  }
}

const elapsedMs = performance.now() - started;
console.log(JSON.stringify({
  inputCount,
  diagnosticCount,
  engineFailureCount,
  editInvariantFailureCount,
  elapsedMs: Number(elapsedMs.toFixed(1)),
}));

if (engineFailureCount > 0 || editInvariantFailureCount > 0) {
  console.error(JSON.stringify({ engineFailures, editInvariantFailures }, null, 2));
  process.exitCode = 1;
}
