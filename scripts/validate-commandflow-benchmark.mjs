import fs from "node:fs";
import path from "node:path";

const defaultInput = path.resolve("metrics-report", "benchmark-results.csv");
const defaultOutput = path.resolve("metrics-report", "benchmark-results.csv");
const flatOutput = path.resolve("reportmetrics", "benchmark-results.csv");
const expectedColumns = ["kind", "case_id", "command", "expected_tool", "expected_arguments", "expected_authorization", "expected_outcome", "observed_outcome", "success", "duration_ms", "sample_index", "notes"];

function parseCsv(text, legacyBackslashQuotes = false) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    const next = text[i + 1];
    if (quoted) {
      if (legacyBackslashQuotes && c === "\\" && next === '"') {
        field += '"';
        i += 1;
      } else if (c === '"') {
        if (next === '"') {
          field += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"' && field.length === 0) {
      quoted = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (c !== "\r") {
      field += c;
    }
  }
  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }
  if (quoted) throw new Error("unterminated quoted CSV field");
  return rows;
}

function csvEscape(value) {
  return `"${String(value ?? "").replaceAll('"', '""')}"`;
}

function encode(rows) {
  return rows.map(row => row.map(csvEscape).join(",")).join("\n") + "\n";
}

function percentile(sorted, p) {
  return sorted[Math.max(0, Math.ceil(sorted.length * p) - 1)];
}

function summarize(samples, batchElapsedMs = samples.reduce((sum, value) => sum + value, 0)) {
  const sorted = [...samples].sort((a, b) => a - b);
  const mean = samples.reduce((sum, value) => sum + value, 0) / samples.length;
  const variance = samples.reduce((sum, value) => sum + ((value - mean) ** 2), 0) / samples.length;
  return {
    sample_count: samples.length,
    min_ms: sorted[0],
    mean_ms: mean,
    p50_ms: percentile(sorted, 0.5),
    p95_ms: percentile(sorted, 0.95),
    p99_ms: percentile(sorted, 0.99),
    max_ms: sorted[sorted.length - 1],
    stddev_ms: Math.sqrt(variance),
    throughput_per_second: samples.length / (batchElapsedMs / 1000),
  };
}

function inspect(file) {
  const text = fs.readFileSync(file, "utf8");
  let rows;
  let parser = "rfc4180";
  try {
    rows = parseCsv(text, false);
    if (rows.some(row => row.length !== expectedColumns.length)) throw new Error("column count mismatch");
  } catch {
    parser = "legacy-backslash-quote-recovery";
    rows = parseCsv(text, true);
  }
  const header = rows.shift();
  const errors = [];
  if (JSON.stringify(header) !== JSON.stringify(expectedColumns)) errors.push("header does not match declared columns");
  const typed = rows.map((row, index) => {
    if (row.length !== expectedColumns.length) errors.push(`row ${index + 2}: expected ${expectedColumns.length} columns, got ${row.length}`);
    const duration = Number(row[9]);
    const sampleIndex = Number(row[10]);
    if (!Number.isFinite(duration) || duration < 0) errors.push(`row ${index + 2}: invalid duration_ms`);
    if (!Number.isInteger(sampleIndex) || sampleIndex < 1) errors.push(`row ${index + 2}: invalid sample_index`);
    if (!/^[01]$/.test(row[8])) errors.push(`row ${index + 2}: success must be 0 or 1`);
    try { JSON.parse(row[4] || "{}"); } catch { errors.push(`row ${index + 2}: expected_arguments is not JSON`); }
    return { row, duration, sampleIndex };
  });
  const latency = typed.filter(item => item.row[0] === "latency");
  const fixtures = typed.filter(item => item.row[0] === "fixture");
  const byCase = new Map();
  for (const item of latency) {
    if (!byCase.has(item.row[1])) byCase.set(item.row[1], []);
    byCase.get(item.row[1]).push(item.duration);
  }
  if (latency.length !== 40000) errors.push(`expected 40000 latency rows, got ${latency.length}`);
  if (fixtures.length !== 8) errors.push(`expected 8 fixture rows, got ${fixtures.length}`);
  for (const [name, samples] of byCase) if (samples.length !== 10000) errors.push(`${name}: expected 10000 samples, got ${samples.length}`);
  for (const fixture of fixtures) {
    if (fixture.row[8] !== "1" || fixture.row[6] !== fixture.row[7]) errors.push(`${fixture.row[1]}: fixture outcome mismatch`);
  }
  const summaries = Object.fromEntries([...byCase].map(([name, samples]) => {
    const batchTimes = typed.filter(item => item.row[0] === "latency" && item.row[1] === name).map(item => Number(item.row[11].match(/batchElapsedMs=([0-9.]+)/)?.[1]));
    const validBatchTimes = batchTimes.filter(Number.isFinite);
    if (validBatchTimes.length && new Set(validBatchTimes).size !== 1) errors.push(`${name}: inconsistent batchElapsedMs metadata`);
    return [name, summarize(samples, validBatchTimes[0] || samples.reduce((sum, value) => sum + value, 0))];
  }));
  return { file, parser, rows: rows.length, columns: expectedColumns.length, latencyRows: latency.length, fixtureRows: fixtures.length, summaries, errors, rowsData: [header, ...rows] };
}

const inputArgument = process.argv.slice(2).find(argument => !argument.startsWith("--"));
const input = inputArgument ? path.resolve(inputArgument) : defaultInput;
const repair = process.argv.includes("--canonicalize");
const result = inspect(input);
if (repair) {
  if (result.errors.length) throw new Error(`Cannot canonicalize invalid benchmark data: ${result.errors.join("; ")}`);
  fs.writeFileSync(defaultOutput, encode(result.rowsData));
  if (flatOutput !== defaultOutput && fs.existsSync(path.dirname(flatOutput))) fs.writeFileSync(flatOutput, encode(result.rowsData));
  result.canonicalized = [defaultOutput, flatOutput];
  result.parserAfterRepair = inspect(defaultOutput).parser;
}
console.log(JSON.stringify({ ...result, rowsData: undefined }, null, 2));
if (result.errors.length) process.exitCode = 1;

export { parseCsv, expectedColumns, summarize };
