# Bonk Football Division

A Bonk.io football platform for player assessments, tier rankings, playstyle classes, and championship partnerships.

Live site: [bonk-football-division.com](https://bonk-football-division.com/).

## Project structure

```text
assets/                       Images, icons, fonts, and other media
code/
    html/index.html           Page structure
    css/main.css              Shared theme and navigation
    css/pages.css             Page layouts
    css/account.css           Account form and navigation dropdown
    css/admin.css             Assessment management interface
    css/division-view.css     Event pages, timelines and brackets
    css/divisions.css         Division list and editor
    javascript/main.js        Navigation and routing
    javascript/assessments.js  Assessment browsing and profiles
    javascript/classes.js     Seven playstyle class guides
    javascript/divisions.js   Division directory and live event editor
    javascript/division-view.js Event preview and bracket calculation
    javascript/account.js     Bonk sign-in and account state
    javascript/admin.js       Administrator assessment tools
    javascript/build.mjs      Public-site build
worker/index.js               Same-origin account and assessment API
worker/assessments.js         Assessment validation and queries
worker/divisions.js           Division drafts, publication and scoped roles
worker/migrations/            D1 database migrations
worker/tests/                 Worker API tests
tests/                        Browser behavior tests
wrangler.jsonc                Cloudflare Worker configuration
```

## Current content

Assessments and Divisions start empty. Administrators can now add assessments; the seven defined playstyle classes are retained. Class videos are not available yet.

Each class opens a playstyle panel with offence, defence, and teamwork notes, followed by potential matchups and teammate pairings with explanations. The panel stays at 90% of the viewport height, with the video fixed at the top and only the text beneath it scrolling. Selecting a related class updates the same panel. These describe possible interactions; positioning, teamwork, and individual skill still affect the outcome.

The Divisions page invites tournament hosts to work with the division. A host request form and review process are planned; no contact form is live yet. The site administrator can create event drafts and delegate management to signed-in Bonk accounts.

Bonk.io account sign-in is available through **Account**. Assessments are stored in this site's D1 database and appear publicly when created. No player records or competitions are fabricated, and the existing Bonk Critic database is not connected or imported.

## Sharing pages

Public pages have shareable paths such as `/assessments`, `/classes`, and `/divisions`. Individual assessment records use `/assessments/ID`, published events use `/divisions/ID`, and class panels use `/classes/weaver` (or another class name). Existing hash links still open normally; the address bar and copy-link buttons now include the server-readable page path. Assessment view links retain their filters.

The Worker supplies Open Graph and Twitter preview metadata in the initial HTML, with page-specific images from `assets/social/`. Assessment previews show public name, tier, points, class and date. Division previews use only the published snapshot, including when a manager shares the link. Draft-only divisions return a generic unavailable preview, and account, profile and management pages never include account details. Editable preview image sources are in `assets/social/source/`.

## Local development

Open `code/html/index.html` directly, or install the deployment tools and run the Cloudflare preview:

```powershell
npm install
npm run db:migrate:local
npm run dev
```

Wrangler runs the build automatically. `npm run build` can also be run separately; it writes only public HTML, CSS, JavaScript, and media to `dist/`. The build rebases HTML asset references for hosting at the site root or a GitHub Pages project path. Configuration, credentials, source-control metadata, and the build script are excluded from the public output.

Use the Wrangler preview to test accounts. Opening the HTML file directly can preview static content but cannot sign in.

## Deployment

The GitHub repository stores the source. Wrangler publishes the site and its API as the dedicated `bonk-football-division` Worker. A separate D1 database with the same name stores this site's accounts, sessions, and assessments. Apply migrations before deploying code that reads the new tables.

```powershell
npx wrangler whoami
npm run db:migrate:remote
npm run deploy -- --dry-run
npm run deploy
```

If Cloudflare authentication has expired, run `npx wrangler login` before deploying. GitHub pushes and Cloudflare deployments are separate actions; no automatic deployment workflow is configured.

The `bonk-football-division.com` custom domain is attached through `wrangler.jsonc`. Cloudflare manages its DNS binding and TLS certificate. Enable **Always Use HTTPS** under the domain's **SSL/TLS > Edge Certificates** settings to redirect HTTP traffic to HTTPS.

## Bonk accounts

Sign-in follows the old site's working Bonk flow: the Worker sends the username and password exactly as entered over HTTPS to the fixed `https://bonk2.io/scripts/login_legacy.php` endpoint with `remember=false`. It requires a successful response containing a valid Bonk player ID, username, and provider token. This uses Bonk's legacy login endpoint, rather than OAuth. Spaces can be part of older Bonk usernames, so they are preserved.

Passwords and Bonk tokens are not saved to the database, returned to the browser, or logged by the application. The Worker saves the verified Bonk ID, username, selected avatar code when available, and a hash of a new random site session token. The interface currently uses the username initial as its avatar. Your browser's password manager may separately offer to remember your password.

Site sessions last 24 hours and use an HttpOnly, Secure, SameSite=Lax cookie. The browser does not keep a session token in localStorage or sessionStorage. Logging out revokes the current session on the server and clears its cookie. The verified Bonk player ID `3177088` is the initial administrator; the Worker checks the session and this ID on every management request. Other Bonk accounts cannot create or edit assessments. This initial admin access does not yet use a separate personal code.

The API requires same-origin JSON requests for sign-in and sign-out. Credentials are sent only to the fixed Bonk endpoint, with redirects disabled and bounded request/response sizes and timeouts. Sign-in is limited by IP and username. Expired sessions and stale attempt counters are cleaned daily.

Run the account and UI checks with Node.js 24 or later:

```powershell
npm test
```

Tests use mocked provider responses and synthetic credentials. They do not sign into a real Bonk account.

## Known Bonk account suggestions

The admin search suggests names from Bonk accounts verified by sign-in on this site and names already used in assessments. Results identify their source; only verified sign-ins supply a trusted Bonk player ID. The admin-only `/api/admin/bonk-accounts` endpoint returns a small ranked list for a partial name. This is a directory of accounts known to this site, not a complete Bonk account index.

The [documented Bonkverse API](https://docs.bonkverse.io/api) provides exact username and bulk lookups of names already known, but no documented partial-name search. Its replay-based records may not include every player or their Bonk player ID. A future exact lookup would require a Bonkverse API key stored only on the Worker, and must follow [Bonkverse's attribution and privacy terms](https://bonkverse.io/developers/terms/). This site does not call an undocumented search endpoint.

## Assessment browsing

Circular tier buttons and square initials filter the assessment grid. Multiple choices can be selected; each index has its own **All** button. Names starting with numbers or symbols appear under `#`. The API sends up to 12 assessments per page, and the grid replaces cards when pages change.

Search, filters, sorting, and page are remembered in this browser. **Copy view link** includes the current settings, which take priority over the recipient's saved preferences. A selectable link field appears if automatic copying is unavailable. Press `/` to focus search when you are not already typing. Entire player cards are keyboard-accessible profile links.

Assessments use normal page scrolling with matching top and bottom padding. On desktop, the left indexes remain visible and scroll separately when needed; on smaller screens, they become horizontal rows. Returning from a profile restores the page and index positions for the same view.

The **Admin center** link appears only for the initial administrator. Its connected tabs provide a paged assessment list with search and sorting, a read-only detail view, an explicit edit action, and a form to create an assessment. Each of the six scores is validated as a whole number from 0 to 300; the Worker calculates total points and tier and rejects stale edits. Player comparison and badge management are not implemented yet.

## Divisions and events

Open **Divisions** to create a division as the site administrator or find events assigned to your account. Each event has its own `/divisions/ID` page inside the normal site navigation. New divisions start as private drafts; published events appear in the public list.

The showcase leads with published events in cover cards. **All**, **Live**, **Upcoming** and **Completed** filter the server-paged list, with up to 12 cards loaded at a time. Upcoming includes events accepting registrations. Live events appear first in the combined list, followed by upcoming dates and completed events. Cards show published dates, match size and entrant counts. Private drafts and unpublished changes appear as compact management-only rows underneath, with six rows per page; the host invitation sits last.

Cards use the event banner's image or colour, with a CSS football pitch as the default cover. The banner and page background can be set independently. Older events keep their existing cover until those settings are changed. The event overview puts dates, match format and registration details before the longer description. Saved section layouts retain their exact order; older live or completed events without a saved layout lead with their bracket.

The event editor uses the same renderer as the public page. People with management permissions get a left tools dock beside the event, opposite the section rail on the right. The event keeps the same content width as the public page. On wide screens the tools remain visible in the gutter; on smaller screens the **Tools** tab opens the panel over the page without shifting its content. Closing tools keeps unfinished edits intact. Both side controls move up with the page, then stay below the site navigation while the event scrolls. Hover over a permitted section or focus its controls to reveal **Edit**; touch screens keep the controls visible. There is no View/Edit mode switch. The left dock keeps publication, appearance, access and history controls; content and formatting are edited inside the section. Selecting another section's Edit button keeps unfinished changes locally. **Save section** stores the private draft and returns to the rendered section; **Cancel** restores only the content from before the current editor opened. Changes kept from another section remain intact, and failed saves keep the current fields open.

Management permissions make **+ Add section** available between sections and at the end of the page. Use it to add participation information, a timeline, teams, a bracket, campaigns, referendums, polls, or a custom text section at that position. The picker always shows the permitted built-in types: choosing one already on the page opens it for editing. Each built-in type can appear once; text sections can repeat, with up to 20 saved. Each section has move-up, move-down and remove controls. The event header stays first. Cancelling an editor for a newly added section also cancels that addition. New drafts start with the event header, while older events retain their existing visible sections.

Removing a completed section keeps a private archived copy and removes it from the page. Save the draft to retain that change. Choosing the same template later offers **Create new** for a blank replacement or **Restore** for a selected archived version. These are separate choices, so creating a replacement does not silently reuse old content. **Delete archive** permanently removes that archived copy when the draft is saved. Cancelling a new or restored section returns to the layout and archives from before it was opened. Incomplete sections are removed without being archived; the private archive holds up to 30 completed sections.

**Save draft** stores all local content, formatting, appearance and section-order changes privately, including changes kept while switching editors. **Publish** promotes the saved draft and requires local changes to be saved first. **Unpublish** withdraws the public copy while retaining the draft. Version checks prevent a stale editor from overwriting a newer save. Editors can arrange their text, campaign and referendum sections without removing or changing the order of sections they do not manage.

Open **Background** to change the page backdrop, or **Banner** to change the event cover and division card. Hovering over the banner also reveals a translucent overlay with a pen button for people with permission to change it. Each settings panel accepts a colour or direct HTTPS image URL and previews changes immediately. Use **Close panel**, Escape, a click outside the panel, or another section to close it while keeping changes locally. **Cancel** reverts that panel's changes; **Save settings** or **Save draft** stores them privately. Each reset button restores only its own default appearance. Changes reach the public event and card after publishing.

While editing supported text fields, select a phrase in the input or use **Select whole field**. The section's **Text style** toolbar applies bold, italic, underline, font, size or colour to that selection; **Clear formatting** removes its styles. A formatted preview appears below the field. Formatting follows text edits and is saved with the draft as validated text ranges rather than HTML. The same section permissions apply to text styling as to its content.

The management tools include **Undo** and **Redo** for the last 30 section edits, formatting and layout/appearance changes in this open event. Undoing a saved change creates an unsaved reversal; it does not write to the server or change the published page. Reloading the saved draft clears this local history. **Copy event link** copies its page URL with a selectable fallback when clipboard access is unavailable. Sharing a private draft's URL does not grant access to it.

A vertical section rail sits in the right gutter for readers and managers. Each dot marks a visible section's starting position as a percentage of the event content's total height, so taller sections produce larger gaps. Hover or focus a dot to see its name; click it to scroll to that section. The current section is highlighted as you scroll. Positions recalculate when sections change size or order, and navigating the rail keeps unfinished inline edits intact.

| Role | Event content | Publication | Management roles |
| --- | --- | --- | --- |
| Site administrator | All divisions and sections | Publish and unpublish | Assign or remove any division role |
| Director | All sections of assigned divisions | Publish and unpublish | Assign or remove organizers and editors |
| Organizer | Event information, timeline, participation, teams, bracket, campaigns, referendums and polls | Draft only | None |
| Editor | Background, banner, description, text sections, campaigns, referendums and polls | Draft only | None |

Roles are scoped to one division and checked by the Worker on every management request. Assign a role using the person's **Bonk player ID** after they have signed in to this site. A division role grants no assessment or site administrator privileges.

The template includes a branched date timeline, participation settings from 1v1 to 4v4, rosters, and a single elimination bracket for up to 16 entrants. Byes advance automatically; entered scores advance the winner, while a tie waits for a result. Scores are tied to their participants so an earlier result change cannot silently reuse a later match's old score. Campaign and referendum sections display event information and proposals; signup submissions are not implemented. Use a **Polls** section for live voting.

Each poll has a question, optional description, two to eight choices, and a planned, open or closed status. Save and publish it before collecting votes. Signed-in Bonk accounts can vote in an open published poll and change their choice; the server keeps one vote per account for that poll. Readers see vote counts without voter identities. Changing the question or choices starts a new ballot, while description edits and closing or reopening preserve the existing votes. Draft changes do not affect the public ballot until publication.

## Code conventions

Use four-space indentation, including the `head` and `body` elements inside `html`. Keep code in its language folder and media in `assets/`.

Page text is unselectable except inside text inputs and textareas. Images are undraggable.
