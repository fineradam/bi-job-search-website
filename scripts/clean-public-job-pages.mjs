import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const JOBS_ROOT = path.resolve('jobs');

async function findHtmlFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await findHtmlFiles(fullPath));
    } else if (entry.isFile() && entry.name.endsWith('.html')) {
      files.push(fullPath);
    }
  }

  return files;
}

async function main() {
  const files = await findHtmlFiles(JOBS_ROOT);
  let changed = 0;

  for (const file of files) {
    const original = await readFile(file, 'utf8');
    const updated = original
      .replace(/\s*<div class="jobs-updated">Data is generated from active BI Job Search listings and refreshed when the website is rebuilt\.<\/div>/g, '')
      .replaceAll('Not specified / API not remote', 'Not specified');

    if (updated !== original) {
      await writeFile(file, updated, 'utf8');
      changed += 1;
    }
  }

  console.log(`Cleaned public-facing copy in ${changed} generated job page(s).`);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
