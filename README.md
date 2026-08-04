# BI Job Search marketing website

Static five-page website for Netlify.

## Structure

- `index.html` — homepage
- `about/index.html`
- `contact/index.html`
- `privacy/index.html`
- `terms-of-use/index.html`
- `assets/css/styles.css` — shared styling
- `assets/js/main.js` — mobile navigation and footer year
- `assets/images/bi-job-search-logo.png` — shared logo

## Header and footer

The header and footer HTML is intentionally copied into each page. This keeps the site build-free and simple.
When changing navigation or footer links, make the same edit in all five HTML files.

## Contact form

The contact form uses Netlify Forms. After deployment, submit a test message and verify it appears in
the Netlify dashboard.

## Legal review

The Privacy Policy and Terms of Use are practical first drafts. They should be reviewed and completed
against the application's actual analytics, authentication, email, payment, cookie and data-retention
practices before relying on them as final legal documents.
