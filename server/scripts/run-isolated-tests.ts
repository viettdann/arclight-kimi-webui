import { Glob, spawnSync } from 'bun';

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
  for (const file of testFiles) {
    console.log(`\n>> ${file}`);
    const proc = spawnSync(['bun', 'test', file], {
      stdout: 'inherit',
      stderr: 'inherit',
      env: { ...process.env, NODE_ENV: 'test' },
    });

    if (proc.exitCode !== 0) failedFiles.push(file);
  }

  console.log(
    `\n=== Isolated test summary: ${testFiles.length - failedFiles.length}/${testFiles.length} files passed ===`,
  );
  if (failedFiles.length > 0) {
    console.log('Failed files:');
    for (const f of failedFiles) console.log(`  - ${f}`);
    process.exit(1);
  }
}

runTests();
