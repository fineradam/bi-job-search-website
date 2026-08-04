const menuButton = document.querySelector(".mobile-menu-button");
const mobileNav = document.querySelector(".mobile-nav");

if (menuButton && mobileNav) {
  menuButton.addEventListener("click", () => {
    const isOpen = mobileNav.classList.toggle("open");
    menuButton.setAttribute("aria-expanded", String(isOpen));
    menuButton.textContent = isOpen ? "×" : "☰";
  });

  mobileNav.querySelectorAll("a").forEach((link) => {
    link.addEventListener("click", () => {
      mobileNav.classList.remove("open");
      menuButton.setAttribute("aria-expanded", "false");
      menuButton.textContent = "☰";
    });
  });
}

const currentYear = document.getElementById("current-year");
if (currentYear) {
  currentYear.textContent = new Date().getFullYear();
}


const GA_MEASUREMENT_ID = "G-VMDF171NN4";
const CONSENT_STORAGE_KEY = "bi_job_search_analytics_consent";

window.dataLayer = window.dataLayer || [];
window.gtag = window.gtag || function() {
  window.dataLayer.push(arguments);
};

window.gtag("consent", "default", {
  analytics_storage: "denied",
  ad_storage: "denied",
  ad_user_data: "denied",
  ad_personalization: "denied",
  wait_for_update: 500
});

function loadGoogleAnalytics() {
  if (document.querySelector('script[data-ga4-loader="true"]')) return;

  const script = document.createElement("script");
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${GA_MEASUREMENT_ID}`;
  script.dataset.ga4Loader = "true";
  document.head.appendChild(script);

  window.gtag("js", new Date());
  window.gtag("config", GA_MEASUREMENT_ID);
}

function setAnalyticsConsent(choice) {
  const granted = choice === "granted";

  window.gtag("consent", "update", {
    analytics_storage: granted ? "granted" : "denied",
    ad_storage: "denied",
    ad_user_data: "denied",
    ad_personalization: "denied"
  });

  localStorage.setItem(CONSENT_STORAGE_KEY, choice);

  if (granted) loadGoogleAnalytics();

  const banner = document.getElementById("cookie-banner");
  if (banner) banner.hidden = true;
}

function openCookieSettings() {
  const banner = document.getElementById("cookie-banner");
  if (banner) banner.hidden = false;
}

document.addEventListener("DOMContentLoaded", () => {
  const savedConsent = localStorage.getItem(CONSENT_STORAGE_KEY);
  const banner = document.getElementById("cookie-banner");
  const acceptButton = document.getElementById("accept-analytics");
  const rejectButton = document.getElementById("reject-analytics");

  if (savedConsent === "granted") {
    window.gtag("consent", "update", { analytics_storage: "granted" });
    loadGoogleAnalytics();
    if (banner) banner.hidden = true;
  } else if (savedConsent === "denied") {
    if (banner) banner.hidden = true;
  } else if (banner) {
    banner.hidden = false;
  }

  if (acceptButton) acceptButton.addEventListener("click", () => setAnalyticsConsent("granted"));
  if (rejectButton) rejectButton.addEventListener("click", () => setAnalyticsConsent("denied"));

  document.querySelectorAll(".cookie-settings-link").forEach((button) => {
    button.addEventListener("click", openCookieSettings);
  });
});
