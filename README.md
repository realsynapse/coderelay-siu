# CodeRelay
*A Crown Lab Team project*

Real-time team code editor. Share a QR code or link and edit the same code live. Workspaces are saved in Supabase, so they survive server restarts and redeploys, and edits made by anyone with the link are kept.

## What's new in this version
- **Console:** press Run (or Ctrl+Enter) to run JavaScript or Python. Code runs in a sandboxed page in your own browser, with no access to this site's data, no network, and a 5 second limit (Python: 30 s, first run downloads the runtime).
- **Merge-safe live editing:** two people typing at once no longer overwrite each other.
- **Encrypted at rest:** the server now requires `ENCRYPTION_KEY` (see `.env.example`) and refuses to start without it. Back the key up.
- Strict security headers, rate limits, and a sandbox for running code. Check everything with `node test/ot.test.js` and `node test/server.test.js`.

## 1. Set up Supabase (once)
1. Create a project at https://supabase.com.
2. Open **SQL Editor**, paste the contents of `supabase/schema.sql`, and run it.
3. Open **Project Settings -> API** and copy the **Project URL** and the **service_role** key.

## 2. Configure
Copy `.env.example` to `.env` and fill in:
```
SUPABASE_URL=...
SUPABASE_SERVICE_ROLE_KEY=...
```
The service_role key stays on the server only. Never put it in `public/`, commit it, or share it. When you deploy (Render, Railway, etc.), add the same two values as environment variables instead of uploading `.env`.

## 3. Run
```
npm install
node server.js
```
Open http://localhost:3000. (To share with people outside your network, deploy to a Node host that supports WebSockets.)

## Favicon
Put your icon (png, ico, svg, jpg, webp or gif, any file name) into the `favicon/` folder. It shows in the browser tab automatically, with no code change. Refresh the page (Ctrl+F5 if the tab still shows the old icon). With no file there, a default red `</>` mark is used.

## Syntax colours
The editor colours code live as you type (VS Code Dark+ style). Language is set to Auto detect by default; pick a language manually to override. Colours are the `.t-*` classes in `public/index.html`.

## Notes
- Only the latest version of each workspace is stored; there is no edit history.
- Anyone with a workspace link can edit while it is unlocked. The owner's Lock editing switch makes it read-only for everyone else. It is a permission lock. Stored workspace content is separately encrypted at rest.
- Do not paste passwords, API keys, or other secrets into a shared workspace.
- Edits are saved about half a second after typing stops, and pending edits are flushed when the server stops.
