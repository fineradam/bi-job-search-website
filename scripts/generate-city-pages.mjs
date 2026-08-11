import { createClient } from '@supabase/supabase-js';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
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
const OUTPUT_ROOT = path.resolve('jobs');
const TOP_CITY_LIMIT = 10;
const PAGE_JOB_LIMIT = 10;
const TOP_SKILL_LIMIT = 10;
const TOP_ROLE_LIMIT = 5;

function escapeHtml(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function slugify(value) {
  return String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function cityKey(job) {
  return [job.city, job.state_region || '', job.country_code || ''].join('|');
}

function cityLabel(group) {
  const { city, state_region, country_code } = group;
  if (country_code === 'US' && state_region) return `${city}, ${state_region}`;
  return city;
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
    'id',
    'job_uid',
    'title',
    'role_family',
    'seniority',
    'work_arrangement',
    'employment_type',
    'location_display',
    'city',
    'state_region',
    'country_code',
    'country_name',
    'posted_at',
    'has_salary',
    'salary_min',
    'salary_max',
    'salary_currency',
    'salary_period'
  ].join(',');

  const pageSize = 1000;
  let from = 0;
  const rows = [];

  while (true) {
    const { data, error } = await supabase
      .from('jobs')
      .select(fields)
      .eq('is_active', true)
      .not('city', 'is', null)
      .range(from, from + pageSize - 1);

    if (error) throw error;
    rows.push(...data);
    if (data.length < pageSize) break;
    from += pageSize;
  }

  return rows.filter(job => job.city && job.city.trim());
}

async function fetchSkillsForJobs(jobIds) {
  if (!jobIds.length) return new Map();

  const skillMap = new Map();
  const skillNameMap = new Map();

  const { data: skills, error: skillsError } = await supabase
    .from('skills')
    .select('id,name,category,is_active')
    .eq('is_active', true);

  if (skillsError) throw skillsError;
  for (const skill of skills) skillNameMap.set(skill.id, skill);

  const chunkSize = 250;
  for (let i = 0; i < jobIds.length; i += chunkSize) {
    const chunk = jobIds.slice(i, i + chunkSize);
    const { data, error } = await supabase
      .from('job_skills')
      .select('job_id,skill_id')
      .in('job_id', chunk);

    if (error) throw error;

    for (const row of data) {
      const skill = skillNameMap.get(row.skill_id);
      if (!skill) continue;
      if (!skillMap.has(row.job_id)) skillMap.set(row.job_id, []);
      skillMap.get(row.job_id).push(skill);
    }
  }

  return skillMap;
}

function buildCityGroups(jobs) {
  const groups = new Map();

  for (const job of jobs) {
    const key = cityKey(job);
    if (!groups.has(key)) {
      groups.set(key, {
        key,
        city: job.city,
        state_region: job.state_region,
        country_code: job.country_code,
        country_name: job.country_name,
        jobs: []
      });
    }
    groups.get(key).jobs.push(job);
  }

  return [...groups.values()]
    .sort((a, b) => b.jobs.length - a.jobs.length)
    .slice(0, TOP_CITY_LIMIT);
}

function assignSlugs(groups) {
  const baseCounts = new Map();
  for (const group of groups) {
    const base = slugify(group.city);
    baseCounts.set(base, (baseCounts.get(base) || 0) + 1);
  }

  for (const group of groups) {
    const base = slugify(group.city);
    const needsCountry = baseCounts.get(base) > 1;
    const specialWashington = base === 'washington' && group.country_code === 'US';
    group.slug = specialWashington
      ? 'washington-dc'
      : needsCountry
        ? `${base}-${slugify(group.country_code)}`
        : base;
  }
}

function getTopSkills(group, skillsByJob) {
  const counts = new Map();
  for (const job of group.jobs) {
    const seen = new Set();
    for (const skill of skillsByJob.get(job.id) || []) {
      if (seen.has(skill.id)) continue;
      seen.add(skill.id);
      const existing = counts.get(skill.id) || { name: skill.name, category: skill.category, count: 0 };
      existing.count += 1;
      counts.set(skill.id, existing);
    }
  }

  return [...counts.values()]
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    .slice(0, TOP_SKILL_LIMIT)
    .map(skill => ({
      ...skill,
      percentage: Math.round((skill.count / group.jobs.length) * 1000) / 10
    }));
}

function renderMarketRows(items, total, useBars = false) {
  if (!items.length) return '<p class="muted">Not enough data yet.</p>';
  return `<div class="market-list">${items.map(item => {
    const pct = total ? Math.round((item.count / total) * 1000) / 10 : 0;
    return `
      <div class="market-row">
        <div>
          <div class="market-row-name">${escapeHtml(item.name)}</div>
          ${useBars ? `<div class="skill-bar"><span style="width:${Math.min(pct, 100)}%"></span></div>` : ''}
        </div>
        <div class="market-row-value">${item.count}${useBars ? ` · ${pct}%` : ''}</div>
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

function renderJobs(group) {
  const latest = [...group.jobs]
    .sort((a, b) => new Date(b.posted_at || 0) - new Date(a.posted_at || 0))
    .slice(0, PAGE_JOB_LIMIT);

  return latest.map(job => {
    const salary = formatSalary(job);
    const meta = [
      job.role_family,
      job.seniority,
      job.work_arrangement,
      job.employment_type,
      salary
    ].filter(Boolean);

    return `
      <article class="public-job-card">
        <h3>${escapeHtml(job.title)}</h3>
        <div class="public-job-meta">
          <span>${escapeHtml(job.location_display || cityLabel(group))}</span>
          <span>Posted ${escapeHtml(formatDate(job.posted_at))}</span>
        </div>
        <div class="public-job-tags">
          ${meta.map(value => `<span>${escapeHtml(value)}</span>`).join('')}
        </div>
      </article>`;
  }).join('');
}

function renderPage(group, skillsByJob) {
  const label = cityLabel(group);
  const count = group.jobs.length;
  const roles = countBy(group.jobs, job => job.role_family).slice(0, TOP_ROLE_LIMIT);
  const seniority = countBy(group.jobs, job => job.seniority);
  const arrangements = countBy(group.jobs, job => job.work_arrangement);
  const skills = getTopSkills(group, skillsByJob);
  const topRole = roles[0];
  const topSkill = skills[0];
  const canonical = `${SITE_URL}/jobs/${group.slug}/`;
  const title = `Business Intelligence Jobs in ${label} | BI Job Search`;
  const description = `Explore ${count} current Business Intelligence jobs in ${label}. See the latest BI roles, in-demand skills, seniority levels and work arrangements.`;
  const marketSentence = topSkill && topRole
    ? `${topSkill.name} is currently the most frequently identified skill in ${label} BI vacancies, appearing in ${topSkill.percentage}% of active jobs. ${topRole.name} is the most common classified role in the current market.`
    : `Explore the current mix of BI roles, skills and working arrangements in ${label}.`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(title)}</title>
  <meta name="description" content="${escapeHtml(description)}" />
  <link rel="canonical" href="${canonical}" />
  <meta property="og:title" content="${escapeHtml(title)}" />
  <meta property="og:description" content="${escapeHtml(description)}" />
  <meta property="og:type" content="website" />
  <meta property="og:url" content="${canonical}" />
  <link rel="stylesheet" href="/assets/css/styles.css" />
  <link rel="stylesheet" href="/assets/css/jobs.css" />
  <link rel="icon" type="image/svg+xml" href="/favicon.svg?v=3" />
  <link rel="apple-touch-icon" href="/favicon.svg?v=3" />
</head>
<body>
  <header class="site-header">
    <div class="container header-inner">
      <a class="brand brand-logo" href="/" aria-label="BI Job Search homepage">
        <img src="/assets/images/bi-job-search-logo.png" alt="BI Job Search" />
      </a>
      <nav class="desktop-nav" aria-label="Main navigation">
        <a href="/jobs/">BI jobs</a>
        <a href="/about/">About</a>
        <a href="/contact/">Contact</a>
      </nav>
      <div class="header-actions">
        <a class="text-link desktop-only" href="${APP_URL}/login">Sign in</a>
        <a class="button button-primary button-small desktop-only" href="${APP_URL}">Search jobs</a>
        <button class="mobile-menu-button" type="button" aria-label="Open navigation" aria-expanded="false">☰</button>
      </div>
    </div>
    <nav class="mobile-nav" aria-label="Mobile navigation">
      <a href="/jobs/">BI jobs</a>
      <a href="/about/">About</a>
      <a href="/contact/">Contact</a>
      <a href="${APP_URL}/login">Sign in</a>
      <a class="button button-primary" href="${APP_URL}">Search jobs</a>
    </nav>
  </header>

  <main>
    <section class="jobs-hero">
      <div class="container">
        <span class="eyebrow">Live BI job market data</span>
        <h1>Business Intelligence Jobs in ${escapeHtml(label)}</h1>
        <p class="lead">Explore ${count} current Business Intelligence jobs in ${escapeHtml(label)}, together with the roles, skills, seniority levels and working arrangements appearing across the local BI market.</p>
        <div class="market-stats">
          <div class="market-stat"><strong>${count}</strong><span>active BI jobs</span></div>
          <div class="market-stat"><strong>${escapeHtml(topRole?.name || 'BI roles')}</strong><span>most common role</span></div>
          <div class="market-stat"><strong>${escapeHtml(topSkill?.name || 'BI skills')}</strong><span>most requested skill</span></div>
        </div>
        <div class="jobs-updated">Data is generated from active BI Job Search listings and refreshed when the website is rebuilt.</div>
      </div>
    </section>

    <section class="section">
      <div class="container jobs-layout">
        <div>
          <div class="section-heading">
            <span class="eyebrow">Latest opportunities</span>
            <h2>Latest BI jobs in ${escapeHtml(label)}</h2>
            <p class="lead">The newest active listings currently identified in ${escapeHtml(label)}. Employer names, full descriptions and direct application links are available inside BI Job Search.</p>
          </div>
          <div class="public-job-list">${renderJobs(group)}</div>
          <div class="jobs-cta">
            <h3>See all ${count} BI jobs in ${escapeHtml(label)}</h3>
            <p>Search the complete market, filter by skills and experience, and create a free profile to personalise your results.</p>
            <a class="button button-light" href="${APP_URL}">Search BI jobs</a>
          </div>
        </div>

        <aside>
          <div class="market-panel">
            <h3>Most in-demand BI skills</h3>
            ${renderSkillRows(skills)}
          </div>
          <div class="market-panel">
            <h3>Top BI roles</h3>
            ${renderMarketRows(roles, count)}
          </div>
          <div class="market-panel">
            <h3>Jobs by seniority</h3>
            ${renderMarketRows(seniority, count)}
          </div>
          <div class="market-panel">
            <h3>Work arrangements</h3>
            ${renderMarketRows(arrangements, count)}
          </div>
        </aside>
      </div>
    </section>

    <section class="section section-soft">
      <div class="container market-copy">
        <span class="eyebrow">${escapeHtml(label)} BI market snapshot</span>
        <h2>What employers are asking for in ${escapeHtml(label)}</h2>
        <p class="lead">${escapeHtml(marketSentence)}</p>
        <p>BI Job Search classifies genuine Business Intelligence vacancies and extracts structured skills data from each listing. This page uses that live dataset to give job seekers a clearer view of the current ${escapeHtml(label)} BI market.</p>
      </div>
    </section>

    <section class="final-cta">
      <div class="container">
        <div class="cta-panel">
          <h2>Find the BI roles that fit your skills.</h2>
          <p>Search genuine Business Intelligence jobs, build a free skills profile and explore the market in more detail.</p>
          <a class="button button-light" href="${APP_URL}">Search BI jobs</a>
        </div>
      </div>
    </section>
  </main>

  <footer class="site-footer">
    <div class="container">
      <div class="footer-grid">
        <div class="footer-brand">
          <a class="brand brand-logo" href="/" aria-label="BI Job Search homepage">
            <img src="/assets/images/bi-job-search-logo.png" alt="BI Job Search" />
          </a>
          <p>A specialist job-search and market-intelligence platform built for Business Intelligence professionals.</p>
        </div>
        <div class="footer-column">
          <h3>Product</h3>
          <a href="/jobs/">BI jobs by location</a>
          <a href="${APP_URL}">Search jobs</a>
          <a href="/#pricing">Pricing</a>
          <a href="${APP_URL}/login">Sign in</a>
        </div>
        <div class="footer-column">
          <h3>Company</h3>
          <a href="/about/">About</a>
          <a href="/contact/">Contact</a>
        </div>
        <div class="footer-column">
          <h3>Legal</h3>
          <a href="/privacy/">Privacy Policy</a>
          <a href="/terms-of-use/">Terms of Use</a>
          <a href="/terms-of-sale/">Terms of Sale</a>
          <button class="cookie-settings-link" type="button">Cookie settings</button>
        </div>
      </div>
      <div class="footer-bottom">
        <span>© <span id="current-year"></span> BI Job Search. All rights reserved.</span>
        <span>Operated by Vitamin Business Intelligence SASU.</span>
      </div>
    </div>
  </footer>

  <aside class="cookie-banner" id="cookie-banner" role="dialog" aria-labelledby="cookie-title" hidden>
    <h2 id="cookie-title">Analytics cookies</h2>
    <p>We use Google Analytics across the BI Job Search website and application to understand how visitors use the service. Analytics loads only after you accept. You can change your choice later through Cookie settings.</p>
    <div class="cookie-actions">
      <button class="button button-secondary" id="reject-analytics" type="button">Reject analytics</button>
      <button class="button button-primary" id="accept-analytics" type="button">Accept analytics</button>
    </div>
  </aside>

  <script src="/assets/js/main.js" defer></script>
</body>
</html>`;
}

function renderHub(groups) {
  const cards = groups.map(group => {
    const label = cityLabel(group);
    return `
      <article class="public-job-card">
        <h3><a href="/jobs/${group.slug}/">Business Intelligence Jobs in ${escapeHtml(label)}</a></h3>
        <div class="public-job-meta"><span>${group.jobs.length} active BI jobs</span></div>
        <a class="button button-text" href="/jobs/${group.slug}/">Explore ${escapeHtml(label)} →</a>
      </article>`;
  }).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Business Intelligence Jobs by City | BI Job Search</title>
  <meta name="description" content="Explore current Business Intelligence jobs in the cities with the most active BI opportunities across the US, UK and Canada." />
  <link rel="canonical" href="${SITE_URL}/jobs/" />
  <link rel="stylesheet" href="/assets/css/styles.css" />
  <link rel="stylesheet" href="/assets/css/jobs.css" />
  <link rel="icon" type="image/svg+xml" href="/favicon.svg?v=3" />
</head>
<body>
  <header class="site-header">
    <div class="container header-inner">
      <a class="brand brand-logo" href="/"><img src="/assets/images/bi-job-search-logo.png" alt="BI Job Search" /></a>
      <nav class="desktop-nav"><a href="/jobs/">BI jobs</a><a href="/about/">About</a><a href="/contact/">Contact</a></nav>
      <div class="header-actions"><a class="text-link desktop-only" href="${APP_URL}/login">Sign in</a><a class="button button-primary button-small desktop-only" href="${APP_URL}">Search jobs</a><button class="mobile-menu-button" type="button" aria-label="Open navigation" aria-expanded="false">☰</button></div>
    </div>
    <nav class="mobile-nav"><a href="/jobs/">BI jobs</a><a href="/about/">About</a><a href="/contact/">Contact</a><a href="${APP_URL}/login">Sign in</a><a class="button button-primary" href="${APP_URL}">Search jobs</a></nav>
  </header>
  <main>
    <section class="jobs-hero"><div class="container"><span class="eyebrow">BI jobs by location</span><h1>Business Intelligence Jobs by City</h1><p class="lead">Explore the cities with the most active Business Intelligence jobs currently available in BI Job Search.</p></div></section>
    <section class="section"><div class="container"><div class="section-heading"><h2>Top BI job markets right now</h2><p class="lead">These locations are selected automatically from the current active job database.</p></div><div class="public-job-list">${cards}</div></div></section>
    <section class="final-cta"><div class="container"><div class="cta-panel"><h2>Search the complete BI job market.</h2><p>Filter genuine BI jobs by location, skills, seniority and working arrangement.</p><a class="button button-light" href="${APP_URL}">Search BI jobs</a></div></div></section>
  </main>
  <footer class="site-footer"><div class="container"><div class="footer-bottom"><span>© <span id="current-year"></span> BI Job Search. All rights reserved.</span><span>Operated by Vitamin Business Intelligence SASU.</span></div></div></footer>
  <aside class="cookie-banner" id="cookie-banner" role="dialog" aria-labelledby="cookie-title" hidden><h2 id="cookie-title">Analytics cookies</h2><p>We use Google Analytics across the BI Job Search website and application to understand how visitors use the service. Analytics loads only after you accept.</p><div class="cookie-actions"><button class="button button-secondary" id="reject-analytics" type="button">Reject analytics</button><button class="button button-primary" id="accept-analytics" type="button">Accept analytics</button></div></aside>
  <script src="/assets/js/main.js" defer></script>
</body>
</html>`;
}

async function writeSitemap(groups) {
  const lastmod = new Date().toISOString().slice(0, 10);
  const urls = [
    ['/', '1.0'],
    ['/jobs/', '0.9'],
    ...groups.map(group => [`/jobs/${group.slug}/`, '0.8']),
    ['/about/', '0.7'],
    ['/contact/', '0.6'],
    ['/privacy/', '0.3'],
    ['/terms-of-use/', '0.3'],
    ['/terms-of-sale/', '0.3']
  ];

  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map(([url, priority]) => `  <url>\n    <loc>${SITE_URL}${url}</loc>\n    <lastmod>${lastmod}</lastmod>\n    <changefreq>${url.startsWith('/jobs') ? 'daily' : 'monthly'}</changefreq>\n    <priority>${priority}</priority>\n  </url>`).join('\n')}\n</urlset>\n`;

  await writeFile('sitemap.xml', xml, 'utf8');
}

async function main() {
  console.log('Fetching active BI jobs from Supabase...');
  const jobs = await fetchAllActiveJobs();
  const groups = buildCityGroups(jobs);
  assignSlugs(groups);

  const selectedJobIds = groups.flatMap(group => group.jobs.map(job => job.id));
  console.log(`Selected ${groups.length} cities covering ${selectedJobIds.length} active jobs.`);
  const skillsByJob = await fetchSkillsForJobs(selectedJobIds);

  await rm(OUTPUT_ROOT, { recursive: true, force: true });
  await mkdir(OUTPUT_ROOT, { recursive: true });

  for (const group of groups) {
    const folder = path.join(OUTPUT_ROOT, group.slug);
    await mkdir(folder, { recursive: true });
    await writeFile(path.join(folder, 'index.html'), renderPage(group, skillsByJob), 'utf8');
    console.log(`Generated /jobs/${group.slug}/ (${group.jobs.length} jobs)`);
  }

  await writeFile(path.join(OUTPUT_ROOT, 'index.html'), renderHub(groups), 'utf8');
  await writeSitemap(groups);
  console.log('Generated jobs hub and sitemap.xml.');
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
