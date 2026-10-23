/* Optivus sitewide script: analytics loader + Revenue Leak Brief signup.
   ---------------------------------------------------------------------
   ANALYTICS: paste your IDs below. Anything left "" is not loaded.
   Microsoft Clarity is already installed inline in each page's <head>.
   For company-level visitor identification (Snitcher, Dealfront, RB2B), paste the
   vendor's snippet at the very bottom of this file.
   After turning any of these on, the privacy policy already discloses them. */
(function () {
  var CONFIG = {
    ga4Id: "",              // Google Analytics 4 Measurement ID, e.g. "G-XXXXXXXXXX"
    linkedinPartnerId: "",  // LinkedIn Insight Tag partner ID, e.g. "1234567"
    // Newsletter signups are emailed to Dean through FormSubmit (same endpoint as the audit).
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
    try { if (window.gtag) window.gtag("event", name); } catch (e) {}
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

  // ---- Revenue Leak Brief signup (injected above the footer on every page)
  var css = ".rlb{background:#0B1220;border-top:1px solid rgba(52,211,153,.18);padding:44px 24px;}" +
    ".rlb-in{max-width:980px;margin:0 auto;display:grid;grid-template-columns:1.1fr 1fr;gap:32px;align-items:center;}" +
    ".rlb h2{font-size:24px;line-height:1.2;color:#fff;margin:0 0 8px;border:none;padding:0;font-weight:700;}" +
    ".rlb p{color:rgba(255,255,255,.72);font-size:15px;line-height:1.6;margin:0;}" +
    ".rlb form{display:grid;grid-template-columns:1fr 1fr;gap:10px;}" +
    ".rlb input{font:inherit;font-size:15px;padding:12px 14px;border-radius:6px;border:1px solid rgba(255,255,255,.22);background:rgba(255,255,255,.06);color:#fff;min-width:0;}" +
    ".rlb input::placeholder{color:rgba(255,255,255,.5);}" +
    ".rlb button{grid-column:1/-1;font:inherit;font-weight:700;font-size:13px;letter-spacing:.08em;text-transform:uppercase;padding:13px 18px;border:0;border-radius:6px;background:#10B981;color:#fff;cursor:pointer;}" +
    ".rlb button:hover{background:#065F46;}" +
    ".rlb small{grid-column:1/-1;display:block;color:rgba(255,255,255,.55);font-size:12px;line-height:1.5;}" +
    ".rlb .rlb-ok{grid-column:1/-1;color:#34D399;font-weight:600;font-size:15px;}" +
    "@media(max-width:760px){.rlb-in{grid-template-columns:1fr;gap:20px;}.rlb form{grid-template-columns:1fr;}}";

  function mountSignup() {
    var footer = document.querySelector("footer");
    if (!footer || document.querySelector(".rlb")) return;
    var st = document.createElement("style"); st.textContent = css; document.head.appendChild(st);
    var sec = document.createElement("section");
    sec.className = "rlb"; sec.setAttribute("aria-label", "Subscribe to The Revenue Leak Brief");
    sec.innerHTML =
      '<div class="rlb-in"><div><h2>The Revenue Leak Brief</h2>' +
      '<p>One revenue leak and one fix, every second Tuesday. Written for CEOs of $15M to $60M B2B companies. Three minutes to read.</p></div>' +
      '<form novalidate><input name="name" type="text" autocomplete="given-name" placeholder="First name" aria-label="First name">' +
      '<input name="email" type="email" autocomplete="email" placeholder="Work email" aria-label="Work email" required>' +
      '<button type="submit">Send me the Brief</button>' +
      '<small>By subscribing you agree to receive The Revenue Leak Brief by email from Dean Reid, Optivus (2836609 Alberta Ltd.), 240 Montclair Place, Cochrane, AB T4C 0A8, dean.reid@optivusprof.ca. Unsubscribe any time. <a href="privacy-policy.html" style="color:inherit;text-decoration:underline">Privacy</a></small></form></div>';
    footer.parentNode.insertBefore(sec, footer);
    var form = sec.querySelector("form");
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var email = form.email.value.trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { form.email.focus(); form.email.style.borderColor = "#F59E0B"; return; }
      var btn = form.querySelector("button"); btn.disabled = true; btn.textContent = "Sending...";
      var data = {
        _subject: "[Optivus lead] Newsletter: " + email,
        _template: "table", _captcha: "false", _replyto: email,
        name: form.name.value.trim(), email: email,
        source: "Revenue Leak Brief signup", page: location.href,
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
        form.innerHTML = '<p class="rlb-ok">Thanks. The next Brief will be in your inbox on the second Tuesday.</p>';
        track("newsletter_signup");
      }
      fetch(CONFIG.signupEndpoint, {
        method: "POST", headers: { "Content-Type": "application/json", "Accept": "application/json" },
        body: JSON.stringify(data)
      }).then(function (r) {
        if (r.ok) done(); else throw new Error("bad status");
      }).catch(function () {
        btn.disabled = false; btn.textContent = "Send me the Brief";
        var m = form.querySelector(".rlb-err") || document.createElement("small");
        m.className = "rlb-err"; m.style.color = "#F59E0B";
        m.innerHTML = 'That did not go through. Email <a href="mailto:dean.reid@optivusprof.ca?subject=Subscribe%20to%20the%20Revenue%20Leak%20Brief" style="color:inherit">dean.reid@optivusprof.ca</a> and I will add you.';
        form.appendChild(m);
      });
    });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mountSignup);
  else mountSignup();
})();
