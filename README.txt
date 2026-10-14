OPTIVUS: INDEXING FIXES (Oct 14, 2026)

UPLOAD: drag all 35 files (everything except this README) into the repo root on
GitHub and commit. No folders, so nothing can land in the wrong place.

WHAT CHANGED
1. All 34 pages: links to "index.html" now point to "/" (178 links).
   Google treats index.html as a duplicate of your homepage ("Alternate page with
   proper canonical tag"). Linking it everywhere sent mixed signals.
2. what-is-a-fractional-cmo.html ("Crawled - currently not indexed"):
   - eyebrow said "Guide · 2025", now 2026
   - byline read as if you are currently VP Marketing at TEC Canada; now
     "Fractional CMO (Revenue Architect) · Optivus · 25+ years of VP marketing
     leadership at TELUS, Bell Canada, SMART Technologies and Veriforce"
   - last-updated date and schema dateModified set to Oct 14, 2026
3. The 7 new articles: share images now point to where GitHub put them (repo
   root), and each author box links to the 3 fractional CMO guides.
4. sitemap.xml: share-image paths fixed, guide lastmod updated.

THEN, IN GOOGLE SEARCH CONSOLE
- Sitemaps: resubmit https://www.optivusprof.ca/sitemap.xml and confirm
  Status = Success and Discovered pages = 32.
- URL Inspection -> Request indexing, starting with:
  what-is-a-fractional-cmo.html, resources.html, fractional-cmo-cost-canada.html,
  fractional-cmo-vs-full-time.html, philosophy.html, then the 4 new essays.
- "Page with redirect" and "Alternate page with proper canonical tag": these are
  correct behaviour. Don't click "Validate fix" on them; validation will always
  "fail" because the redirects are intentional.
