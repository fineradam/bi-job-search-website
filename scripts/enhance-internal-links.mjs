import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const STATIC_PAGES = [
  'index.html',
  'about/index.html',
  'contact/index.html',
  'privacy/index.html',
  'terms-of-use/index.html',
  'terms-of-sale/index.html',
  'thank-you/index.html'
];

const JOBS_ROOT = path.resolve('jobs');

function enhanceNav(html, className) {
  const pattern = new RegExp(`(<nav class=\\"${className}\\"[^>]*>)([\\s\\S]*?)(</nav>)`);
  return html.replace(pattern, (match, open, body, close) => {
    let updated = body.replaceAll('<a href="/jobs/">BI jobs</a>', '<a href="/jobs/">Job Market</a>');
    if (!updated.includes('href="/jobs/"')) {
      updated = `\n    <a href="/jobs/">Job Market</a>${updated}`;
    }
    return `${open}${updated}${close}`;
  });
}

function enhanceFooter(html) {
  html = html.replaceAll('<a href="/jobs/">BI jobs by location</a>', '<a href="/jobs/">Job Market</a>');
  const pattern = /(<div class="footer-column">\s*<h3>Product<\/h3>)([\s\S]*?)(<\/div>)/;
  return html.replace(pattern, (match, open, body, close) => {
    if (body.includes('href="/jobs/"')) return match;
    return `${open}\n        <a href="/jobs/">Job Market</a>${body}${close}`;
  });
}

function addJobsStylesheet(html) {
  if (html.includes('/assets/css/jobs.css')) return html;
  return html.replace(
    '<link rel="stylesheet" href="/assets/css/styles.css" />',
    '<link rel="stylesheet" href="/assets/css/styles.css" />\n  <link rel="stylesheet" href="/assets/css/jobs.css" />'
  );
}

function cityCards(cities) {
  return cities.map(city => `
        <a class="city-link-card" href="/jobs/${city.slug}/">
          <strong>${city.label}</strong>
          <span>Explore current BI jobs →</span>
        </a>`).join('');
}

function addHomepageMarketSection(html, cities) {
  if (html.includes('id="job-market-links"')) return html;
  html = addJobsStylesheet(html);
  const featured = cities.slice(0, 6);
  const section = `
    <section class="section section-soft" id="job-market-links">
      <div class="container">
        <div class="section-heading centered">
          <span class="eyebrow">Live BI job market</span>
          <h2>Explore Business Intelligence jobs by city.</h2>
          <p class="lead">See current BI opportunities and live market data for some of the strongest locations in the BI Job Search database.</p>
        </div>
        <div class="city-link-grid">${cityCards(featured)}
        </div>
        <div class="city-links-action">
          <a class="button button-secondary" href="/jobs/">Explore the full Job Market</a>
        </div>
      </div>
    </section>
`;
  return html.includes('<section class="final-cta">')
    ? html.replace('<section class="final-cta">', `${section}\n    <section class="final-cta">`)
    : html.replace('</main>', `${section}\n  </main>`);
}

function addCityCrossLinks(html, currentSlug, cities) {
  if (html.includes('id="other-job-markets"')) return html;
  const others = cities.filter(city => city.slug !== currentSlug);
  const section = `
    <section class="section" id="other-job-markets">
      <div class="container">
        <div class="section-heading">
          <span class="eyebrow">Explore more locations</span>
          <h2>Other BI job markets</h2>
          <p class="lead">Compare current Business Intelligence opportunities across other major BI job markets.</p>
        </div>
        <div class="city-link-grid">${cityCards(others)}
        </div>
        <div class="city-links-action">
          <a class="button button-secondary" href="/jobs/">View all Job Market locations</a>
        </div>
      </div>
    </section>
`;
  return html.includes('<section class="final-cta">')
    ? html.replace('<section class="final-cta">', `${section}\n    <section class="final-cta">`)
    : html;
}

async function getCities() {
  const entries = await readdir(JOBS_ROOT, { withFileTypes: true });
  const cities = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const file = path.join(JOBS_ROOT, entry.name, 'index.html');
    const html = await readFile(file, 'utf8');
    const labelMatch = html.match(/<h1>Business Intelligence Jobs in ([\s\S]*?)<\/h1>/);
    if (!labelMatch) continue;
    const countMatch = html.match(/<div class="market-stat"><strong>(\d+)<\/strong><span>active BI jobs<\/span><\/div>/);
    cities.push({
      slug: entry.name,
      label: labelMatch[1],
      count: countMatch ? Number(countMatch[1]) : 0
    });
  }
  return cities.sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

async function enhanceFile(filePath, cities, citySlug = null) {
  let html = await readFile(filePath, 'utf8');
  html = enhanceNav(html, 'desktop-nav');
  html = enhanceNav(html, 'mobile-nav');
  html = enhanceFooter(html);
  if (filePath === 'index.html') html = addHomepageMarketSection(html, cities);
  if (citySlug) html = addCityCrossLinks(html, citySlug, cities);
  await writeFile(filePath, html, 'utf8');
}

const cities = await getCities();

for (const file of STATIC_PAGES) {
  await enhanceFile(file, cities);
}

await enhanceFile(path.join('jobs', 'index.html'), cities);
for (const city of cities) {
  await enhanceFile(path.join('jobs', city.slug, 'index.html'), cities, city.slug);
}

console.log(`Enhanced internal linking across static pages and ${cities.length} city pages.`);
