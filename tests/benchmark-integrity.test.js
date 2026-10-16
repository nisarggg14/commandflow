const assert = require("assert");
const fs = require("fs");
const path = require("path");

async function main() {
  const module = await import("../scripts/run-commandflow-fixture-benchmark.mjs");
  assert.equal(module.csvEscape('a,"b\nc'), '"a,""b\nc"');
  assert.equal(module.nearestRank([1, 2, 3, 4], 0.5), 2);
  assert.equal(module.nearestRank([9], 0.95), 9);
  assert.equal(module.summarize([], 0).sample_count, 0);
  assert.equal(module.summarize([5], 5).p95_ms, 5);
  const failed = module.runFixtureCase({ case_id: "failed", expected_outcome: "expected", notes: "" }, () => { throw new Error("observed_failure"); });
  assert.equal(failed.success, 0);
  assert.equal(failed.observed_outcome, "observed_failure");
  const result = await module.runFixtureBenchmark({ warmupCount: 1, sampleCount: 3 });
  assert.equal(result.measurements["fixture-schema-validation"].sample_count, 3);
  assert.equal(result.fixtureCount, 8);
  assert.equal(result.rows.length, 20);
  assert.equal(result.rows.some(row => row.case_id === "unknown-tool" && row.success === 1), true);
  assert.equal(fs.existsSync(path.join(__dirname, "..", "mcp", "server.ts")), true);
  console.log("✔ fixture-only benchmark, CSV, percentile, failure, and isolation tests passed");
}

main().catch(error => { console.error(error); process.exitCode = 1; });
