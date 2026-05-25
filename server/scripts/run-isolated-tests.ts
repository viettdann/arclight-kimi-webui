import { Glob } from 'bun';

const FILE_TIMEOUT_MS = 30_000;
const PER_TEST_TIMEOUT_MS = 5_000;

async function runTests() {
  const glob = new Glob('test/**/*.test.{ts,tsx}');
  const testFiles = Array.from(glob.scanSync('.'))
    .filter((file) => !file.includes('node_modules') && !file.includes('dist'))
    .sort((a, b) => a.localeCompare(b));

  if (testFiles.length === 0) {
    console.log('No test files found in test/.');
    return;
  }

  console.log(`\nRunning ${testFiles.length} isolated tests in ${process.cwd()}...`);

  const failedFiles: string[] = [];
  const timedOutFiles: string[] = [];

  for (const file of testFiles) {
    console.log(`\n>> ${file}`);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FILE_TIMEOUT_MS);

    const proc = Bun.spawn(['bun', 'test', '--timeout', String(PER_TEST_TIMEOUT_MS), file], {
      stdout: 'inherit',
      stderr: 'inherit',
      env: { ...process.env, NODE_ENV: 'test' },
      signal: controller.signal,
    });

    const exitCode = await proc.exited;
    clearTimeout(timer);

    if (controller.signal.aborted) {
      console.error(`\n!! TIMEOUT after ${FILE_TIMEOUT_MS}ms: ${file}`);
      timedOutFiles.push(file);
    } else if (exitCode !== 0) {
      failedFiles.push(file);
    }
  }

  const passed = testFiles.length - failedFiles.length - timedOutFiles.length;
  console.log(
    `\n=== Isolated test summary: ${passed}/${testFiles.length} files passed` +
      `${failedFiles.length > 0 ? `, ${failedFiles.length} failed` : ''}` +
      `${timedOutFiles.length > 0 ? `, ${timedOutFiles.length} timed out` : ''} ===`,
  );

  if (failedFiles.length > 0) {
    console.log('Failed files:');
    for (const f of failedFiles) console.log(`  - ${f}`);
  }
  if (timedOutFiles.length > 0) {
    console.log(`Timed out files (> ${FILE_TIMEOUT_MS}ms wall):`);
    for (const f of timedOutFiles) console.log(`  - ${f}`);
  }

  if (failedFiles.length > 0 || timedOutFiles.length > 0) {
    process.exit(1);
  }
}

runTests();
