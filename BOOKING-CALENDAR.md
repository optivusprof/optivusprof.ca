# Booking calendar: how it works

## What was wrong
Google's "Book a Call" pop-up is drawn by Google's own script. It has a transparent
background, so on the dark Optivus pages the calendar text was dark on dark and could not
be read. It also had no visible way to close it. Neither can be fixed with CSS, because the
pop-up lives inside Google's code.

## What it does now
Every booking button and every link to `calendar.app.google` opens an Optivus pop-up:

- Solid white panel, so the calendar is always readable.
- Header bar with a close button (X, top right), plus an "Open in a new tab" link.
- Closes with the X, the Esc key, or a click on the dark area outside the panel.
- Focus returns to the button the visitor clicked. Page scroll is locked while open.
- Full-screen on phones.
- Ctrl/Cmd-click on a booking link still opens Google's page in a new tab.

Google still supplies the calendar itself (availability, time zones, confirmation emails).
The pop-up simply shows Google's official embeddable booking page inside a white frame.

## Where the code lives
All of it is in one file: `assets/site.js`, in the section titled
"OPTIVUS BOOKING CALENDAR (sitewide)". Every page already loads that file.

- Change the calendar: edit `BOOKING_URL` at the top of that section. One edit updates every page.
- Change the look (colors, size, title): edit the `css` string and the `ob-title` text in the same section.
- Open the pop-up from any new button: add a link to `https://calendar.app.google/5v6oNJ8jHkWMVzTTA`
  (it opens automatically), or call `optivusBook()` from a script.

## What changed in the pages
- Google's script and stylesheet (`scheduling-button-script.js` / `.css`) were removed from all 37 pages.
- The nav "Book a Call" and drawer "Book a Discovery Call" buttons are still created by the same
  inline code on each page. `site.js` now supplies `calendar.schedulingButton.load()`, which makes
  the button instead of Google. The buttons keep their existing styling (`#onav-cta`, `#onav-drw-cta`).
- `revenue-engine-audit.html`: the "Book a Strategy Review" button now sits in the results screen
  as a normal button. Before, Google's script ran before that screen existed and never showed it.

## If something goes wrong
- If `site.js` fails to load, the nav buttons still appear as normal links to your calendar.
- If a browser blocks the frame, the "Open in a new tab" link in the pop-up header still works.
- To roll back: restore the previous `assets/site.js` and re-add the two Google lines
  (`<link ... scheduling-button-script.css>` and `<script ... scheduling-button-script.js defer>`) to the pages.

## How to test after uploading
1. Open any page, click "Book a Call" in the nav: a white pop-up with the calendar appears.
2. Close it with X, then Esc, then by clicking outside. Each should return you to the page.
3. Click a "Book a call" link in the page body: same pop-up, no new tab.
4. On a phone: the pop-up fills the screen and the X is reachable.
