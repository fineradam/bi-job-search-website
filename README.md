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


## Navigation

The shared header now contains only About and Contact, alongside the Sign in and Search jobs actions.
The same header markup is copied into all five HTML files.


## Analytics and consent

The site includes a custom consent banner for GA4 measurement ID `G-VMDF171NN4`.

- Analytics is denied by default.
- GA4 loads only after acceptance.
- Visitors can reject analytics with equal prominence.
- The choice is stored in localStorage.
- Cookie settings can be reopened from the footer.
- Advertising consent remains denied.
