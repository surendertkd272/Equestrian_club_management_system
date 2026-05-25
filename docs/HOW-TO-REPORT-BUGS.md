# How to report bugs in the Equiwings system

Hello! Thank you for testing Equiwings. When you find anything that doesn't work the way you expect, please log it in the attached **`equiwings-bug-report-template.csv`** sheet. The more detail you give, the faster we can fix it.

## How to use the sheet

1. Open `equiwings-bug-report-template.csv` in **Excel**, **Google Sheets**, or **Numbers**.
2. The first two rows (B-001, B-002) are **examples** — please leave them as a reference and start your entries from row B-003 onwards.
3. Fill in one row per bug. Use a fresh ID each time (B-003, B-004, B-005…).
4. Save the file (Excel will prompt to "Keep CSV format" — yes, keep it).
5. Share back via WhatsApp, email, or Google Drive — whichever is easiest.

## What goes in each column

| Column | What to write |
|---|---|
| **ID** | Sequential — B-003, B-004… |
| **Date** | When you saw the bug (YYYY-MM-DD) |
| **Reporter Name** | Your name |
| **Role** | Your role — Centre Manager, Coach, Parent, Vet, etc. |
| **Centre** | Which club — Ghaziabad, Gurgaon, Mumbai, Bangalore, or HQ |
| **Page / Feature** | Roughly which screen — "Submit Invoice", "Horse profile", "Vet visits", etc. |
| **URL** | Copy from your browser's address bar |
| **What did you expect?** | One line — what *should* have happened |
| **What actually happened?** | One line — the bug |
| **Steps to reproduce** | Numbered, terse — "1. Click X. 2. Type Y. 3. See Z." |
| **Screenshot file name** | If you took a screenshot, name it (e.g. `ravi-req-error.png`) and attach it to your email/share |
| **Severity** | One of: **Blocker** (can't use the system) / **High** (key feature broken) / **Medium** (annoying but workable) / **Low** (cosmetic) |
| **Device** | Desktop / Mobile / Tablet |
| **Browser** | Chrome / Safari / Edge / Firefox / WhatsApp in-app browser |
| **Status** | Leave blank — we'll fill this when we look at it |
| **Notes for dev team** | Anything else useful — error messages copied from console, time of day, what you were trying to achieve |

## Tips for good bug reports

- **One bug per row.** If you see two different problems, that's two rows.
- **Take a screenshot if possible.** Cmd+Shift+4 on Mac, Win+Shift+S on Windows, or the screenshot button on your phone. Attach images separately to the email/WhatsApp message.
- **Tell us what the URL was.** Many bugs depend on which page you were on.
- **Tell us the time** in the Notes column if it might matter (e.g. "I tapped Sign in at 11:43 AM"). Helps us check server logs.
- **Don't worry about being technical** — plain-English descriptions are perfect. "It froze" or "the picture wouldn't load" tells us enough to start.

## Where to send the filled sheet

- **WhatsApp**: send to the dev team contact you've been talking to
- **Email**: send to the address you got the system invite from
- **Google Drive**: share the file (make sure permission is set to "Anyone with link can view")

We'll respond within 24 hours with a status update for each bug.

Thank you for taking the time to test thoroughly — every report makes the system better for your whole team.
