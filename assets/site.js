/* Optivus sitewide script: analytics loader + Optivus Newsletter signup.
   ---------------------------------------------------------------------
   ANALYTICS: paste your IDs below. Anything left "" is not loaded.
   Microsoft Clarity is already installed inline in each page's <head>.
   For company-level visitor identification (Snitcher, Dealfront, RB2B), paste the
   vendor's snippet at the very bottom of this file.
   After turning any of these on, the privacy policy already discloses them. */
(function () {
  var CONFIG = {
    ga4Id: "",              // Leave empty: GA4 runs through Google Tag Manager (GTM-TMNCNPFD) in each page's <head>
    linkedinPartnerId: "",  // LinkedIn Insight Tag partner ID, e.g. "1234567"
    // PRIMARY: Google Apps Script web app (WebsiteLeads.gs in the "spark leads" sheet). Paste its /exec URL.
    leadsAppScriptUrl: "https://script.google.com/macros/s/AKfycbxtKEagOwZqv6qh88WH_kPB8gI7PMbtdR-yBliC4v1qmgCF_hWyqLcHF8oJci-Zlzohtw/exec",
    // FALLBACK while the URL above is empty: signups are emailed to Dean through FormSubmit.
    signupEndpoint: "https://formsubmit.co/ajax/dean.reid@optivusprof.ca"
  };

  function addScript(src, attrs) {
    var s = document.createElement("script");
    s.async = true; s.src = src;
    if (attrs) for (var k in attrs) s.setAttribute(k, attrs[k]);
    document.head.appendChild(s);
    return s;
  }

  // ---- Google Analytics 4
  if (CONFIG.ga4Id) {
    addScript("https://www.googletagmanager.com/gtag/js?id=" + encodeURIComponent(CONFIG.ga4Id));
    window.dataLayer = window.dataLayer || [];
    window.gtag = function () { window.dataLayer.push(arguments); };
    window.gtag("js", new Date());
    window.gtag("config", CONFIG.ga4Id);
  }

  // ---- LinkedIn Insight Tag (retargeting + company demographics)
  if (CONFIG.linkedinPartnerId) {
    window._linkedin_partner_id = CONFIG.linkedinPartnerId;
    window._linkedin_data_partner_ids = window._linkedin_data_partner_ids || [];
    window._linkedin_data_partner_ids.push(CONFIG.linkedinPartnerId);
    if (!window.lintrk) {
      window.lintrk = function (a, b) { window.lintrk.q.push([a, b]); };
      window.lintrk.q = [];
    }
    addScript("https://snap.licdn.com/li.lms-analytics/insight.min.js");
  }

  // ---- Conversion events for any tool that is on
  function track(name) {
    // Google Tag Manager (GTM-TMNCNPFD) picks these up as Custom Event triggers.
    try { (window.dataLayer = window.dataLayer || []).push({ event: name, page_path: location.pathname }); } catch (e) {}
    try { if (window.clarity) window.clarity("event", name); } catch (e) {}
    // LinkedIn conversions are set up in Campaign Manager as URL-based rules, not from here.
  }
  document.addEventListener("click", function (e) {
    var a = e.target.closest && e.target.closest("a[href]");
    if (!a) return;
    var h = a.getAttribute("href") || "";
    if (h.indexOf("calendar.app.google") > -1 || h.indexOf("calendar.google.com") > -1) track("book_call_click");
    else if (h.indexOf("revenue-leak-review") > -1) track("leak_review_click");
    else if (h.indexOf("revenue-engine-audit") > -1) track("audit_click");
  });

  // ---- Optivus Newsletter signup (injected above the footer on every page)
  var css = ".rlb{background:#0B1220;border-top:1px solid rgba(52,211,153,.18);padding:44px 24px;}" +
    ".rlb-in{max-width:980px;margin:0 auto;display:grid;grid-template-columns:1.1fr 1fr;gap:32px;align-items:center;}" +
    ".rlb .rlb-in h2.rlb-title{font-family:inherit !important;font-size:24px !important;line-height:1.2 !important;color:#fff !important;margin:0 0 8px !important;border:none !important;padding:0 !important;font-weight:700 !important;letter-spacing:-0.01em !important;text-transform:none !important;background:none !important;}" +
    ".rlb .rlb-in p{color:rgba(255,255,255,.78) !important;font-size:15px !important;line-height:1.6 !important;margin:0 !important;}" +
    ".rlb form{display:grid;grid-template-columns:1fr 1fr;gap:10px;}" +
    ".rlb input{font:inherit;font-size:15px;padding:12px 14px;border-radius:6px;border:1px solid rgba(255,255,255,.22);background:rgba(255,255,255,.06);color:#fff;min-width:0;}" +
    ".rlb input::placeholder{color:rgba(255,255,255,.5);}" +
    ".rlb button{grid-column:1/-1;font:inherit;font-weight:700;font-size:13px;letter-spacing:.08em;text-transform:uppercase;padding:13px 18px;border:0;border-radius:6px;background:#10B981;color:#fff;cursor:pointer;}" +
    ".rlb button:hover{background:#065F46;}" +
    ".rlb .rlb-in small{grid-column:1/-1;display:block;color:rgba(255,255,255,.68) !important;font-size:12px !important;line-height:1.5 !important;}" +
    ".rlb .rlb-in p.rlb-ok{grid-column:1/-1;color:#34D399 !important;font-weight:600 !important;font-size:15px !important;}" +
    "@media(max-width:760px){.rlb-in{grid-template-columns:1fr;gap:20px;}.rlb form{grid-template-columns:1fr;}}";

  function mountSignup() {
    var footer = document.querySelector("footer");
    if (!footer || document.querySelector(".rlb")) return;
    var st = document.createElement("style"); st.textContent = css; document.head.appendChild(st);
    var sec = document.createElement("section");
    sec.className = "rlb"; sec.setAttribute("aria-label", "Subscribe to the Optivus Newsletter");
    sec.innerHTML =
      '<div class="rlb-in"><div><h2 class="rlb-title">Subscribe to the Optivus Newsletter</h2>' +
      '<p>One practical idea a month on finding and fixing the revenue leaks in your go-to-market. Written for CEOs of $15M to $60M B2B companies. Three minutes to read.</p></div>' +
      '<form novalidate><input name="name" type="text" autocomplete="given-name" placeholder="First name" aria-label="First name">' +
      '<input name="email" type="email" autocomplete="email" placeholder="Work email" aria-label="Work email" required>' +
      '<input name="website" type="text" tabindex="-1" autocomplete="off" aria-hidden="true" style="position:absolute;left:-9999px;width:1px;height:1px;opacity:0">' +
      '<button type="submit">Subscribe</button>' +
      '<small>By subscribing you agree to receive the Optivus Newsletter by email once a month from Dean Reid, Optivus (2836609 Alberta Ltd.), 240 Montclair Place, Cochrane, AB T4C 0A8, dean.reid@optivusprof.ca. Unsubscribe any time. <a href="privacy-policy.html" style="color:inherit;text-decoration:underline">Privacy</a></small></form></div>';
    footer.parentNode.insertBefore(sec, footer);
    var form = sec.querySelector("form");
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var email = form.email.value.trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { form.email.focus(); form.email.style.borderColor = "#40E0D0"; return; }
      var btn = form.querySelector("button"); btn.disabled = true; btn.textContent = "Sending...";
      var data = {
        _subject: "[Optivus lead] Newsletter: " + email,
        _template: "table", _captcha: "false", _replyto: email,
        name: form.name.value.trim(), email: email,
        source: "Optivus Newsletter signup", page: location.href,
        consent: "Express consent via signup form, " + new Date().toISOString()
      };
      // Machine-readable copy for the n8n -> Optivus Local CRM workflow (base64 JSON between markers).
      try {
        data.crm_data = "CRM1:" + btoa(unescape(encodeURIComponent(JSON.stringify({
          type: "newsletter_signup", name: data.name, email: email, page: data.page,
          newsletter: true, consent: data.consent, submittedAt: new Date().toISOString()
        })))) + ":CRM1";
      } catch (err) {}
      function done() {
        form.innerHTML = '<p class="rlb-ok">Thanks for subscribing. Your first Optivus Newsletter arrives next month.</p>';
        track("newsletter_signup");
      }
      var useScript = /^https:\/\/script\.google\.com\//.test(CONFIG.leadsAppScriptUrl || "");
      var req = useScript
        ? fetch(CONFIG.leadsAppScriptUrl, {
            method: "POST", mode: "no-cors", headers: { "Content-Type": "text/plain;charset=utf-8" },
            body: JSON.stringify({ type: "newsletter_signup", name: data.name, email: email, consent: data.consent,
                                   page: data.page, submittedAt: new Date().toISOString(),
                                   website: form.website ? form.website.value : "" })
          }).then(function () { done(); })
        : fetch(CONFIG.signupEndpoint, {
            method: "POST", headers: { "Content-Type": "application/json", "Accept": "application/json" },
            body: JSON.stringify(data)
          }).then(function (r) { if (r.ok) done(); else throw new Error("bad status"); });
      req.catch(function () {
        btn.disabled = false; btn.textContent = "Subscribe";
        var m = form.querySelector(".rlb-err") || document.createElement("small");
        m.className = "rlb-err"; m.style.color = "#40E0D0";
        m.innerHTML = 'That did not go through. Email <a href="mailto:dean.reid@optivusprof.ca?subject=Subscribe%20to%20the%20Optivus%20Newsletter" style="color:inherit">dean.reid@optivusprof.ca</a> and I will add you.';
        form.appendChild(m);
      });
    });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mountSignup);
  else mountSignup();
})();


/* ==========================================================================
   OPTIVUS BOOKING CALENDAR (sitewide)
   --------------------------------------------------------------------------
   Replaces Google's own pop-up (which rendered transparent over the dark
   site and had no close button) with an Optivus pop-up:
     - solid WHITE panel, so the calendar is always readable
     - visible close (X) button, plus Esc key and click-outside to close
     - focus returns to the button the visitor clicked
   It also provides the `calendar.schedulingButton.load()` call that the
   pages already use, so the nav buttons keep working unchanged.
   Any link to calendar.app.google opens this pop-up instead of a new tab.
   To change the calendar, edit BOOKING_URL below (one place, whole site).
   See BOOKING-CALENDAR.md for the full write-up.
   ========================================================================== */
(function () {
  var BOOKING_URL = "https://calendar.google.com/calendar/appointments/schedules/AcZssZ0vwcmmCRjR0JZoEVRIWoZq0R1xyJqWu90X9AHkEg8M-2rTOXRbfgdyETWvncK4DjOvUsf9_0EJ?gv=true";
  var SHORT_URL_MATCH = "calendar.app.google";
  var overlay, frame, closeBtn, lastFocus;

  var css = ""
    + "#optivus-book{position:fixed;inset:0;z-index:2147483000;display:none;align-items:center;justify-content:center;padding:24px;background:rgba(15,23,42,.72);}"
    + "#optivus-book.open{display:flex;}"
    + "#optivus-book .ob-panel{position:relative;display:flex;flex-direction:column;width:100%;max-width:980px;height:min(90vh,800px);background:#fff;color:#0F172A;border-radius:14px;overflow:hidden;box-shadow:0 24px 80px rgba(0,0,0,.45);}"
    + "#optivus-book .ob-bar{display:flex;align-items:center;gap:12px;padding:10px 12px 10px 20px;background:#fff;border-bottom:1px solid #E2E8F0;flex-shrink:0;}"
    + "#optivus-book .ob-title{font:700 15px/1.2 Inter,system-ui,sans-serif;color:#0F172A;margin-right:auto;}"
    + "#optivus-book .ob-new{font:600 13px/1 Inter,system-ui,sans-serif;color:#0F766E;text-decoration:underline;white-space:nowrap;}"
    + "#optivus-book .ob-close{display:flex;align-items:center;justify-content:center;width:40px;height:40px;border:2px solid #40E0D0;border-radius:50%;background:#fff;color:#0F172A;font:700 18px/1 Inter,system-ui,sans-serif;cursor:pointer;flex-shrink:0;}"
    + "#optivus-book .ob-close:hover{background:#40E0D0;}"
    + "#optivus-book .ob-close:focus-visible,#optivus-book .ob-new:focus-visible{outline:3px solid #0F172A;outline-offset:2px;}"
    + "#optivus-book .ob-body{position:relative;flex:1;background:#fff;}"
    + "#optivus-book .ob-load{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font:500 14px Inter,system-ui,sans-serif;color:#475569;}"
    + "#optivus-book iframe{position:relative;width:100%;height:100%;border:0;background:#fff;display:block;}"
    + "body.ob-lock{overflow:hidden;}"
    + "@media (max-width:640px){#optivus-book{padding:0;}#optivus-book .ob-panel{max-width:none;height:100%;border-radius:0;}}";

  function build() {
    if (overlay) return;
    var st = document.createElement("style"); st.textContent = css; document.head.appendChild(st);
    overlay = document.createElement("div");
    overlay.id = "optivus-book";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-label", "Book a call with Dean Reid");
    overlay.innerHTML =
      '<div class="ob-panel">'
      + '<div class="ob-bar"><span class="ob-title">Book a call with Dean Reid</span>'
      + '<a class="ob-new" href="' + BOOKING_URL + '" target="_blank" rel="noopener">Open in a new tab</a>'
      + '<button type="button" class="ob-close" aria-label="Close booking calendar">&#x2715;</button></div>'
      + '<div class="ob-body"><div class="ob-load">Loading calendar&hellip;</div></div>'
      + '</div>';
    document.body.appendChild(overlay);
    closeBtn = overlay.querySelector(".ob-close");
    closeBtn.addEventListener("click", close);
    overlay.addEventListener("mousedown", function (e) { if (e.target === overlay) close(); });
    document.addEventListener("keydown", function (e) {
      if (!overlay.classList.contains("open")) return;
      if (e.key === "Escape") { e.preventDefault(); close(); }
      if (e.key === "Tab") {  // keep keyboard focus inside the pop-up
        var f = overlay.querySelectorAll("a[href],button,iframe");
        var first = f[0], last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    });
  }

  function open(trigger) {
    build();
    lastFocus = trigger || document.activeElement;
    if (!frame) {  // load Google's booking page once, on first open
      frame = document.createElement("iframe");
      frame.src = BOOKING_URL;
      frame.title = "Book a call with Dean Reid";
      frame.setAttribute("allow", "payment");
      frame.addEventListener("load", function () {
        var l = overlay.querySelector(".ob-load"); if (l) l.style.display = "none";
      });
      overlay.querySelector(".ob-body").appendChild(frame);
    }
    overlay.classList.add("open");
    document.body.classList.add("ob-lock");
    closeBtn.focus();
    try { if (window.dataLayer) window.dataLayer.push({ event: "booking_modal_open" }); } catch (e) {}
  }

  function close() {
    if (!overlay) return;
    overlay.classList.remove("open");
    document.body.classList.remove("ob-lock");
    if (lastFocus && lastFocus.focus) { try { lastFocus.focus(); } catch (e) {} }
  }

  /* Any link to the calendar opens the pop-up. Ctrl/Cmd/Shift-click still opens a new tab. */
  document.addEventListener("click", function (e) {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    var a = e.target.closest && e.target.closest("a[href]");
    if (!a || a.closest("#optivus-book")) return;
    var h = a.getAttribute("href") || "";
    if (h.indexOf(SHORT_URL_MATCH) === -1 && h.indexOf("calendar.google.com/calendar/appointments") === -1) return;
    e.preventDefault();
    open(a);
  });

  /* Drop-in replacement for Google's calendar.schedulingButton.load(), used by the page templates. */
  function loadButton(opts) {
    opts = opts || {};
    var t = opts.target, a = document.createElement("a");
    a.href = opts.url || BOOKING_URL;
    a.target = "_blank"; a.rel = "noopener";
    a.textContent = opts.label || "Book a Call";
    a.setAttribute("data-optivus-book", "1");
    if (a.textContent === "Book a Call" && t && t.tagName === "SCRIPT") a.id = "onav-cta";                 // nav button (styled by page CSS)
    else if (a.textContent === "Book a Discovery Call" && t && t.tagName === "SCRIPT") a.id = "onav-drw-cta"; // mobile drawer button
    else a.style.cssText = "display:inline-flex;align-items:center;padding:12px 22px;border-radius:999px;font:700 14px Inter,system-ui,sans-serif;text-decoration:none;color:#0F1A24;background:" + (opts.color || "#40E0D0") + ";";
    if (!t) return;
    if (t.tagName === "SCRIPT" && t.parentNode) t.parentNode.insertBefore(a, t); else t.appendChild(a);
  }
  window.calendar = window.calendar || {};
  window.calendar.schedulingButton = { load: loadButton };
  window.optivusBook = open;  // any custom button can call optivusBook()
})();
