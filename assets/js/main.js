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
const CONSENT_COOKIE_NAME = "bi_analytics_consent";
const LEGACY_STORAGE_KEY = "bi_job_search_analytics_consent";
const CONSENT_MAX_AGE = 15552000;

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

function readAnalyticsConsent() {
  const prefix = `${CONSENT_COOKIE_NAME}=`;
  const cookie = document.cookie
    .split(";")
    .map((item) => item.trim())
    .find((item) => item.startsWith(prefix));

  if (!cookie) return null;

  const value = decodeURIComponent(cookie.slice(prefix.length));
  return value === "granted" || value === "denied" ? value : null;
}

function writeAnalyticsConsent(choice) {
  document.cookie = [
    `${CONSENT_COOKIE_NAME}=${encodeURIComponent(choice)}`,
    "Domain=.bijobsearch.com",
    "Path=/",
    "Secure",
    "SameSite=Lax",
    `Max-Age=${CONSENT_MAX_AGE}`
  ].join("; ");
}

function removeLegacyConsent() {
  try {
    localStorage.removeItem(LEGACY_STORAGE_KEY);
  } catch (_) {}
}

function loadGoogleAnalytics() {
  if (document.querySelector('script[data-ga4-loader="true"]')) return;

  const script = document.createElement("script");
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${GA_MEASUREMENT_ID}`;
  script.dataset.ga4Loader = "true";

  script.addEventListener("load", () => {
    window.gtag("consent", "update", {
      analytics_storage: "granted",
      ad_storage: "denied",
      ad_user_data: "denied",
      ad_personalization: "denied"
    });

    window.gtag("js", new Date());

    window.gtag("config", GA_MEASUREMENT_ID, {
      send_page_view: false
    });

    window.gtag("event", "page_view", {
      page_title: document.title,
      page_location: window.location.href,
      page_path: window.location.pathname
    });
  });

  document.head.appendChild(script);
}

function deleteCookie(name, domain) {
  const domainPart = domain ? `; Domain=${domain}` : "";
  document.cookie = `${name}=; Max-Age=0; Path=/${domainPart}; Secure; SameSite=Lax`;
}

function clearGoogleAnalyticsCookies() {
  document.cookie.split(";").forEach((item) => {
    const cookieName = item.split("=")[0].trim();

    if (
      cookieName === "_ga" ||
      cookieName.startsWith("_ga_") ||
      cookieName === "_gid" ||
      cookieName.startsWith("_gat") ||
      cookieName.startsWith("_gcl_")
    ) {
      deleteCookie(cookieName);
      deleteCookie(cookieName, "bijobsearch.com");
      deleteCookie(cookieName, ".bijobsearch.com");
    }
  });
}

function setAnalyticsConsent(choice) {
  const granted = choice === "granted";

  window.gtag("consent", "update", {
    analytics_storage: granted ? "granted" : "denied",
    ad_storage: "denied",
    ad_user_data: "denied",
    ad_personalization: "denied"
  });

  writeAnalyticsConsent(choice);

  if (granted) {
    loadGoogleAnalytics();
  } else {
    clearGoogleAnalyticsCookies();
  }

  const banner = document.getElementById("cookie-banner");
  if (banner) banner.hidden = true;
}

function openCookieSettings() {
  const banner = document.getElementById("cookie-banner");
  if (banner) banner.hidden = false;
}

document.addEventListener("DOMContentLoaded", () => {
  removeLegacyConsent();

  const savedConsent = readAnalyticsConsent();
  const banner = document.getElementById("cookie-banner");
  const acceptButton = document.getElementById("accept-analytics");
  const rejectButton = document.getElementById("reject-analytics");

  if (savedConsent === "granted") {
    window.gtag("consent", "update", {
      analytics_storage: "granted",
      ad_storage: "denied",
      ad_user_data: "denied",
      ad_personalization: "denied"
    });
    loadGoogleAnalytics();
    if (banner) banner.hidden = true;
  } else if (savedConsent === "denied") {
    if (banner) banner.hidden = true;
  } else if (banner) {
    banner.hidden = false;
  }

  if (acceptButton) {
    acceptButton.addEventListener("click", () => setAnalyticsConsent("granted"));
  }

  if (rejectButton) {
    rejectButton.addEventListener("click", () => setAnalyticsConsent("denied"));
  }

  document.querySelectorAll(".cookie-settings-link").forEach((button) => {
    button.addEventListener("click", openCookieSettings);
  });
});
