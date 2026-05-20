---
description: Open the ChainGPT marketplace dashboard (localhost web UI — Overview, Skills, Activity, Health, About)
argument-hint: "[port]"
---

Open the ChainGPT marketplace dashboard for the user.

**Steps:**

1. Call the MCP tool `chaingpt_dashboard_serve`. If the user passed a port as $1, pass it as `{ "port": <number> }`; otherwise call with no args (default port 8788).
2. The tool will print a URL (`http://127.0.0.1:<port>`), a freshly rotated admin token, and the token-file path. Surface all three to the user, formatted clearly, in your reply.
3. After the URL + token, offer to open the URL in their default browser using `open <url>` on macOS or `xdg-open <url>` on Linux. Wait for the user to confirm before running the command — do NOT auto-open.
4. Remind the user once that the dashboard binds `127.0.0.1` only, the admin token rotates each time `/chaingpt:dashboard` is invoked, and the dashboard is read-only (no signing flows are proxied through the browser).

**Do not:**

- Do not attempt to fetch or display dashboard content yourself — the user is the one with the browser.
- Do not store the admin token in any file other than the path the tool already wrote it to.
- Do not run the dashboard on a non-loopback bind (the tool will refuse anyway).
