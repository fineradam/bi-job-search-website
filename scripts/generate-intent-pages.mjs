import { createClient } from '@supabase/supabase-js';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false }
});

const SITE_URL = 'https://bijobsearch.com';
const APP_URL = 'https://app.bijobsearch.com';
const JOBS_ROOT = path.resolve('jobs');
const PAGE_JOB_LIMIT = 10;
const TOP_SKILL_LIMIT = 10;

function escapeHtml(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function formatDate(dateValue) {
  if (!dateValue) return 'Recently posted';
  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) return 'Recently posted';
  return new Intl.DateTimeFormat('en', {
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  }).format(date);
}

function formatSalary(job) {
  if (!job.has_salary) return null;
  const min = Number(job.salary_min);
  const max = Number(job.salary_max);
  if (!Number.isFinite(min) && !Number.isFinite(max)) return null;

  const currency = job.salary_currency || '';
  const formatter = new Intl.NumberFormat('en', { maximumFractionDigits: 0 });
  const amount = Number.isFinite(min) && Number.isFinite(max)
    ? `${formatter.format(min)}–${formatter.format(max)}`
    : formatter.format(Number.isFinite(min) ? min : max);

  return `${currency} ${amount}${job.salary_period ? ` / ${job.salary_period}` : ''}`.trim();
}

function countBy(items, getter) {
  const counts = new Map();
  for (const item of items) {
    const value = getter(item);
    if (!value) continue;
    counts.set(value, (counts.get(value) || 0) + 1);
  }
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

async function fetchAllActiveJobs() {
  const fields = [
    'id', 'job_uid', 'title', 'role_family', 'seniority', 'work_arrangement',
    'employment_type', 'location_display', 'city', 'state_region', 'country_code',
    'country_name', 'posted_at', 'has_salary', 'salary_min', 'salary_max',
    'salary_currency', 'salary_period'
  ].join(',');

  const pageSize = 1000;
  let from = 0;
  const rows = [];

  while (true) {
    const { data, error } = await supabase
      .from('jobs')
      .select(fields)
      .eq('is_active', true)
      .range(from, from + pageSize - 1);

    if (error) throw error;
    rows.push(...data);
    if (data.length < pageSize) break;
    from += pageSize;
  }

  return rows;
}

async function fetchSkillsForJobs(jobIds) {
  if (!jobIds.length) return new Map();

  const { data: skills, error: skillsError } = await supabase
    .from('skills')
    .select('id,name,category,is_active')
    .eq('is_active', true);

  if (skillsError) throw skillsError;
  const skillNameMap = new Map(skills.map(skill => [skill.id, skill]));
  const result = new Map();
  const chunkSize = 50;
  const pageSize = 1000;

  for (let i = 0; i < jobIds.length; i += chunkSize) {
    const chunk = jobIds.slice(i, i + chunkSize);
    let from = 0;

    while (true) {
      const { data, error } = await supabase
        .from('job_skills')
        .select('job_id,skill_id')
        .in('job_id', chunk)
        .range(from, from + pageSize - 1);

      if (error) throw error;

      for (const row of data) {
        const skill = skillNameMap.get(row.skill_id);
        if (!skill) continue;
        if (!result.has(row.job_id)) result.set(row.job_id, []);
        result.get(row.job_id).push(skill);
      }

      if (data.length < pageSize) break;
      from += pageSize;
    }
  }

  return result;
}

function hasSkill(skillsByJob, jobId, skillName) {
  const target = skillName.toLowerCase();
  return (skillsByJob.get(jobId) || []).some(skill => skill.name.toLowerCase() === target);
}

function getTopSkills(jobs, skillsByJob) {
  const counts = new Map();
  for (const job of jobs) {
    const seen = new Set();
    for (const skill of skillsByJob.get(job.id) || []) {
      if (seen.has(skill.id)) continue;
      seen.add(skill.id);
      const existing = counts.get(skill.id) || { name: skill.name, count: 0 };
      existing.count += 1;
      counts.set(skill.id, existing);
    }
  }

  return [...counts.values()]
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    .slice(0, TOP_SKILL_LIMIT)
    .map(skill => ({
      ...skill,
      percentage: jobs.length ? Math.round((skill.count / jobs.length) * 1000) / 10 : 0
    }));
}

function renderMarketRows(items, total) {
  if (!items.length) return '<p class="muted">Not enough data yet.</p>';
  return `<div class="market-list">${items.map(item => {
    const pct = total ? Math.round((item.count / total) * 1000) / 10 : 0;
    return `
      <div class="market-row">
        <div><div class="market-row-name">${escapeHtml(item.name)}</div></div>
        <div class="market-row-value">${item.count} · ${pct}%</div>
      </div>`;
  }).join('')}</div>`;
}

function renderSkillRows(skills) {
  if (!skills.length) return '<p class="muted">Not enough data yet.</p>';
  return `<div class="market-list">${skills.map(skill => `
    <div class="market-row">
      <div>
        <div class="market-row-name">${escapeHtml(skill.name)}</div>
        <div class="skill-bar"><span style="width:${Math.min(skill.percentage, 100)}%"></span></div>
      </div>
      <div class="market-row-value">${skill.percentage}%</div>
    </div>`).join('')}</div>`;
}

function renderJobs(jobs) {
  const latest = [...jobs]
    .sort((a, b) => new Date(b.posted_at || 0) - new Date(a.posted_at || 0))
    .slice(0, PAGE_JOB_LIMIT);

  return latest.map(job => {
    const salary = formatSalary(job);
    const meta = [job.role_family, job.seniority, job.work_arrangement, job.employment_type, salary]
      .filter(Boolean)
      .map(value => value === 'Not specified / API not remote' ? 'Not specified' : value);

    return `
      <article class="public-job-card">
        <h3>${escapeHtml(job.title)}</h3>
        <div class="public-job-meta">
          <span>${escapeHtml(job.location_display || job.city || job.country_name || 'Location not specified')}</span>
          <span>Posted ${escapeHtml(formatDate(job.posted_at))}</span>
        </div>
        <div class="public-job-tags">
          ${meta.map(value => `<span>${escapeHtml(value)}</span>`).join('')}
        </div>
      </article>`;
  }).join('');
}

const INTENT_PAGES = [
  {
    slug: 'bi-analyst',
    h1: 'BI Analyst Jobs',
    title: 'BI Analyst Jobs | BI Job Search',
    description: count => `Explore ${count} current BI Analyst jobs across the US, UK and Canada. See in-demand skills, seniority levels, work arrangements and the latest opportunities.`,
    intro: count => `Explore ${count} current BI Analyst jobs, together with the skills, locations, seniority levels and working arrangements appearing across the market.`,
    match: job => job.role_family === 'BI Analyst'
  },
  {
    slug: 'bi-developer',
    h1: 'BI Developer Jobs',
    title: 'BI Developer Jobs | BI Job Search',
    description: count => `Explore ${count} current BI Developer jobs across the US, UK and Canada. See in-demand skills, locations, seniority levels and the latest opportunities.`,
    intro: count => `Explore ${count} current BI Developer jobs and see which skills, locations and working arrangements are most common across the market.`,
    match: job => job.role_family === 'BI Developer'
  },
  {
    slug: 'power-bi',
    h1: 'Power BI Jobs',
    title: 'Power BI Jobs | BI Job Search',
    description: count => `Explore ${count} current jobs requiring Power BI across the US, UK and Canada. See the latest roles, related skills, seniority levels and work arrangements.`,
    intro: count => `Explore ${count} current BI jobs where Power BI is identified as a required or relevant skill, together with the roles and skills appearing alongside it.`,
    match: (job, skillsByJob) => hasSkill(skillsByJob, job.id, 'Power BI') || /\bpower\s*bi\b/i.test(job.title || '')
  },
  {
    slug: 'power-bi-developer',
    h1: 'Power BI Developer Jobs',
    title: 'Power BI Developer Jobs | BI Job Search',
    description: count => `Explore ${count} current Power BI Developer jobs across the US, UK and Canada. See in-demand skills, seniority levels, locations and latest opportunities.`,
    intro: count => `Explore ${count} current BI Developer jobs where Power BI is identified as a relevant skill, with live market data on skills, locations and seniority.`,
    match: (job, skillsByJob) => job.role_family === 'BI Developer' && (hasSkill(skillsByJob, job.id, 'Power BI') || /\bpower\s*bi\b/i.test(job.title || ''))
  },
  {
    slug: 'entry-level-bi-analyst',
    h1: 'Entry Level BI Analyst Jobs',
    title: 'Entry Level BI Analyst Jobs | BI Job Search',
    description: count => `Explore ${count} current entry-level and junior BI Analyst jobs across the US, UK and Canada, with live skills, location and work-arrangement data.`,
    intro: count => `Explore ${count} current entry-level and junior BI Analyst opportunities and see the skills and locations appearing most often in the market.`,
    match: job => job.role_family === 'BI Analyst' && (/entry|junior/i.test(job.seniority || '') || /\b(entry[- ]?level|junior)\b/i.test(job.title || ''))
  }
];

function renderIntentLinks(currentSlug = null) {
  return INTENT_PAGES
    .filter(page => page.slug !== currentSlug)
    .map(page => `
      <a class="city-link-card" href="/jobs/${page.slug}/">
        <strong>${escapeHtml(page.h1)}</strong>
        <span>Explore current opportunities →</span>
      </a>`).join('');
}

function renderPage(page, jobs, skillsByJob) {
  const count = jobs.length;
  const skills = getTopSkills(jobs, skillsByJob);
  const seniority = countBy(jobs, job => job.seniority);
  const arrangements = countBy(jobs, job => job.work_arrangement === 'Not specified / API not remote' ? 'Not specified' : job.work_arrangement);
  const locations = countBy(jobs, job => job.city || job.country_name).slice(0, 8);
  const roles = countBy(jobs, job => job.role_family).slice(0, 5);
  const topSkill = skills[0]?.name || 'BI skills';
  const topLocation = locations[0]?.name || 'Multiple markets';
  const canonical = `${SITE_URL}/jobs/${page.slug}/`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(page.title)}</title>
  <meta name="description" content="${escapeHtml(page.description(count))}" />
  <link rel="canonical" href="${canonical}" />
  <meta property="og:title" content="${escapeHtml(page.title)}" />
  <meta property="og:description" content="${escapeHtml(page.description(count))}" />
  <meta property="og:type" content="website" />
  <meta property="og:url" content="${canonical}" />
  <link rel="stylesheet" href="/assets/css/styles.css" />
  <link rel="stylesheet" href="/assets/css/jobs.css" />
  <link rel="icon" type="image/svg+xml" href="/favicon.svg?v=3" />
</head>
<body>
  <header class="site-header">
    <div class="container header-inner">
      <a class="brand brand-logo" href="/" aria-label="BI Job Search homepage"><img src="/assets/images/bi-job-search-logo.png" alt="BI Job Search" /></a>
      <nav class="desktop-nav" aria-label="Main navigation"><a href="/jobs/">BI jobs</a><a href="/about/">About</a><a href="/contact/">Contact</a></nav>
      <div class="header-actions"><a class="text-link desktop-only" href="${APP_URL}/login">Sign in</a><a class="button button-primary button-small desktop-only" href="${APP_URL}">Search jobs</a><button class="mobile-menu-button" type="button" aria-label="Open navigation" aria-expanded="false">☰</button></div>
    </div>
    <nav class="mobile-nav" aria-label="Mobile navigation"><a href="/jobs/">BI jobs</a><a href="/about/">About</a><a href="/contact/">Contact</a><a href="${APP_URL}/login">Sign in</a><a class="button button-primary" href="${APP_URL}">Search jobs</a></nav>
  </header>

  <main>
    <section class="jobs-hero">
      <div class="container">
        <span class="eyebrow">Live BI job market data</span>
        <h1>${escapeHtml(page.h1)}</h1>
        <p class="lead">${escapeHtml(page.intro(count))}</p>
        <div class="market-stats">
          <div class="market-stat"><strong>${count}</strong><span>active jobs</span></div>
          <div class="market-stat"><strong>${escapeHtml(topSkill)}</strong><span>most requested skill</span></div>
          <div class="market-stat"><strong>${escapeHtml(topLocation)}</strong><span>leading location</span></div>
        </div>
      </div>
    </section>

    <section class="section">
      <div class="container jobs-layout">
        <div>
          <div class="section-heading">
            <span class="eyebrow">Latest opportunities</span>
            <h2>Latest ${escapeHtml(page.h1)}</h2>
            <p class="lead">The newest active listings currently identified by BI Job Search. Employer names, full descriptions and direct application links are available inside the platform.</p>
          </div>
          <div class="public-job-list">${renderJobs(jobs)}</div>
          <div class="jobs-cta">
            <h3>Search all ${count} matching jobs</h3>
            <p>Search the complete BI job market, filter by skills and experience, and create a free profile to personalise your results.</p>
            <a class="button button-light" href="${APP_URL}">Search BI jobs</a>
          </div>
        </div>

        <aside>
          <div class="market-panel"><h3>Most in-demand skills</h3>${renderSkillRows(skills)}</div>
          ${roles.length > 1 ? `<div class="market-panel"><h3>Top BI roles</h3>${renderMarketRows(roles, count)}</div>` : ''}
          <div class="market-panel"><h3>Top locations</h3>${renderMarketRows(locations, count)}</div>
          <div class="market-panel"><h3>Jobs by seniority</h3>${renderMarketRows(seniority, count)}</div>
          <div class="market-panel"><h3>Work arrangements</h3>${renderMarketRows(arrangements, count)}</div>
        </aside>
      </div>
    </section>

    <section class="section section-soft">
      <div class="container market-copy">
        <span class="eyebrow">Explore more BI job searches</span>
        <h2>More Business Intelligence job opportunities</h2>
        <div class="city-link-grid">${renderIntentLinks(page.slug)}</div>
        <div class="city-links-action"><a class="button button-secondary" href="/jobs/">Explore jobs by location</a></div>
      </div>
    </section>

    <section class="final-cta">
      <div class="container"><div class="cta-panel"><h2>Find the BI roles that fit your skills.</h2><p>Search genuine Business Intelligence jobs, build a free skills profile and explore the market in more detail.</p><a class="button button-light" href="${APP_URL}">Search BI jobs</a></div></div>
    </section>
  </main>

  <footer class="site-footer">
    <div class="container">
      <div class="footer-grid">
        <div class="footer-brand"><a class="brand brand-logo" href="/" aria-label="BI Job Search homepage"><img src="/assets/images/bi-job-search-logo.png" alt="BI Job Search" /></a><p>A specialist job-search and market-intelligence platform built for Business Intelligence professionals.</p></div>
        <div class="footer-column"><h3>Product</h3><a href="/jobs/">BI jobs by location</a><a href="${APP_URL}">Search jobs</a><a href="/#pricing">Pricing</a><a href="${APP_URL}/login">Sign in</a></div>
        <div class="footer-column"><h3>Company</h3><a href="/about/">About</a><a href="/contact/">Contact</a></div>
        <div class="footer-column"><h3>Legal</h3><a href="/privacy/">Privacy Policy</a><a href="/terms-of-use/">Terms of Use</a><a href="/terms-of-sale/">Terms of Sale</a><button class="cookie-settings-link" type="button">Cookie settings</button></div>
      </div>
      <div class="footer-bottom"><span>© <span id="current-year"></span> BI Job Search. All rights reserved.</span><span>Operated by Vitamin Business Intelligence SASU.</span></div>
    </div>
  </footer>

  <aside class="cookie-banner" id="cookie-banner" role="dialog" aria-labelledby="cookie-title" hidden>
    <h2 id="cookie-title">Analytics cookies</h2>
    <p>We use Google Analytics across the BI Job Search website and application to understand how visitors use the service. Analytics loads only after you accept. You can change your choice later through Cookie settings.</p>
    <div class="cookie-actions"><button class="button button-secondary" id="reject-analytics" type="button">Reject analytics</button><button class="button button-primary" id="accept-analytics" type="button">Accept analytics</button></div>
  </aside>
  <script src="/assets/js/main.js" defer></script>
</body>
</html>`;
}

async function addHubLinks(pagesWithCounts) {
  const hubPath = path.join(JOBS_ROOT, 'index.html');
  let html = await readFile(hubPath, 'utf8');
  if (html.includes('id="popular-job-searches"')) return;

  const cards = pagesWithCounts.map(({ page, count }) => `
      <a class="city-link-card" href="/jobs/${page.slug}/">
        <strong>${escapeHtml(page.h1)}</strong>
        <span>${count} active matching jobs →</span>
      </a>`).join('');

  const section = `
    <section class="section section-soft" id="popular-job-searches">
      <div class="container">
        <div class="section-heading"><span class="eyebrow">Popular BI job searches</span><h2>Explore jobs by role, tool and career stage</h2><p class="lead">Browse live BI Job Search data for some of the most searched Business Intelligence job categories.</p></div>
        <div class="city-link-grid">${cards}</div>
      </div>
    </section>
`;

  html = html.includes('<section class="final-cta">')
    ? html.replace('<section class="final-cta">', `${section}\n    <section class="final-cta">`)
    : html.replace('</main>', `${section}\n  </main>`);

  await writeFile(hubPath, html, 'utf8');
}

async function addToSitemap() {
  const sitemapPath = 'sitemap.xml';
  let xml = await readFile(sitemapPath, 'utf8');
  const lastmod = new Date().toISOString().slice(0, 10);

  const additions = INTENT_PAGES
    .filter(page => !xml.includes(`${SITE_URL}/jobs/${page.slug}/`))
    .map(page => `  <url>\n    <loc>${SITE_URL}/jobs/${page.slug}/</loc>\n    <lastmod>${lastmod}</lastmod>\n    <changefreq>daily</changefreq>\n    <priority>0.8</priority>\n  </url>`)
    .join('\n');

  if (!additions) return;
  xml = xml.replace('</urlset>', `${additions}\n</urlset>`);
  await writeFile(sitemapPath, xml, 'utf8');
}

async function main() {
  console.log('Generating SEO intent pages...');
  const jobs = await fetchAllActiveJobs();
  const skillsByJob = await fetchSkillsForJobs(jobs.map(job => job.id));
  const pagesWithCounts = [];

  for (const page of INTENT_PAGES) {
    const matchingJobs = jobs.filter(job => page.match(job, skillsByJob));
    const folder = path.join(JOBS_ROOT, page.slug);
    await mkdir(folder, { recursive: true });
    await writeFile(path.join(folder, 'index.html'), renderPage(page, matchingJobs, skillsByJob), 'utf8');
    pagesWithCounts.push({ page, count: matchingJobs.length });
    console.log(`Generated /jobs/${page.slug}/ (${matchingJobs.length} jobs)`);
  }

  await addHubLinks(pagesWithCounts);
  await addToSitemap();
  console.log('Generated five SEO intent pages, hub links and sitemap entries.');
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
