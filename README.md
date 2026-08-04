# Optivus — www.optivusprof.ca

Fractional CMO marketing leadership website for Dean Reid.

## Files

| File | URL |
|------|-----|
| `index.html` | www.optivusprof.ca |
| `philosophy.html` | www.optivusprof.ca/philosophy.html |
| `growth-playbook.html` | www.optivusprof.ca/growth-playbook.html |
| `board-advisor.html` | www.optivusprof.ca/board-advisor.html |
| `cx-audit.html` | www.optivusprof.ca/cx-audit.html |
| `ai-for-marketing.html` | www.optivusprof.ca/ai-for-marketing.html |
| `thought-leadership.html` | www.optivusprof.ca/thought-leadership.html |
| `what-is-a-fractional-cmo.html` | www.optivusprof.ca/what-is-a-fractional-cmo.html |
| `fractional-cmo-vs-full-time.html` | www.optivusprof.ca/fractional-cmo-vs-full-time.html |
| `fractional-cmo-cost-canada.html` | www.optivusprof.ca/fractional-cmo-cost-canada.html |
| `seo-playbook.html` | www.optivusprof.ca/seo-playbook.html |
| `resources.html` | www.optivusprof.ca/resources.html |
| `alignment-scorecard.html` | www.optivusprof.ca/alignment-scorecard.html |
| `roadmap-generator.html` | www.optivusprof.ca/roadmap-generator.html |
| `marketing-channel-diagnostic.html` | www.optivusprof.ca/marketing-channel-diagnostic.html |
| `privacy-policy.html` | www.optivusprof.ca/privacy-policy.html |
| `404.html` | (GitHub Pages custom 404) |

Supporting files: `marketing-channel-diagnostic-data.js` (tactic-pair data for the diagnostic tool), `privacy-policy.pdf` (downloadable version linked from the privacy policy page), `sitemap.xml`, `robots.txt`, `CNAME`, `.nojekyll`.

## Assets needed in `/assets/` folder

Place these files in an `assets/` subfolder on your server:

- `dean-reid.png` — headshot photo (referenced in the Person schema/structured data on several pages)
- `og-image.png` — social share image, ideally 1200×630px
- `favicon.png` — 32×32px favicon, referenced on all 17 pages

## GitHub Pages deployment

1. Create a new GitHub repository (e.g. `optivusprof`)
2. Upload all HTML files and the `assets/` folder
3. Go to Settings → Pages → Branch: main → Save
4. In your domain registrar (wherever optivusprof.ca is registered), add a CNAME record:
   - Type: CNAME
   - Name: www
   - Value: yourusername.github.io
5. In GitHub Pages settings, set custom domain to: www.optivusprof.ca

## Notes
- All internal links use relative paths — they work locally and on any server
- The Optivus logo is embedded as a base64 data URI — no external image dependency
- Booking is linked to https://calendar.app.google/S2bDFXCFoZA3eGJC6 (Google Calendar appointment scheduling)
