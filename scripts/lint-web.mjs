import { spawnSync } from "node:child_process";

const files = [
  "app/src/main/assets/bignum.js",
  "app/src/main/assets/tape-parser.js",
  "app/src/main/assets/tape-engine.js",
  "app/src/main/assets/tape-history.js",
  "app/src/main/assets/tape-input.js",
  "app/src/main/assets/seeds.js",
  "app/src/main/assets/app.js",
  "tests/golden-parity.test.js",
  "tests/tape-engine.unit.test.js",
  "tests/tape-input.unit.test.js",
];

for (const file of files) {
  const result = spawnSync(process.execPath, ["--check", file], { stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

console.log(`Syntax checked ${files.length} web/test modules.`);
