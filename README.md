# SyncPit

**One editor. Your whole team.**

SyncPit is a real-time shared coding room. Create a workspace, share one QR code or link, and everyone edits the same code live, in any language. A project of **Crown Lab**.

🔗 **Live:** https://syncpit.onrender.com

```js
const team = sync();
team.edit("together"); // every keystroke, live
```

## Features

- **Live collaboration:** every keystroke syncs between everyone in the workspace.
- **QR code and link sharing:** invite teammates by scanning a QR code or sharing the workspace link.
- **Owner controls:** the owner can lock editing (the code stays viewable and copyable) or delete the workspace.
- **Owner key:** a private owner link restores lock/delete control on any device. Keep it secret, like a password.
- **Persistent workspaces:** content is saved, so links keep working after a server restart.
- **Any language:** auto-detect or pick from JavaScript, TypeScript, Python, HTML, CSS, Java, C, C++, C#, Go, Rust, PHP, Ruby, Lua, Swift, Kotlin, SQL, Shell, JSON, YAML, Markdown and more.
- **Run code in the browser:** JavaScript and Python run in a restricted sandbox with a built-in console (`Ctrl+Enter` to run).
- **Live preview:** HTML and CSS render in a preview tab.
- **Presence and chat:** see who's in the workspace and chat with them. Messages vanish when everyone leaves.
- **Accounts and settings:** unique display names with a permanent number, optional sign-in to keep workspaces across devices, and System/Light/Dark themes.
- **Site tools:** notices, role tags, maintenance mode, a feedback form and an Audius-powered music player.

## How it works

1. Click **Create workspace & QR**.
2. Share the QR code or link with your team.
3. Edit together. Press **Lock editing** when you want read-only mode.
4. Open your **owner link** later to manage the workspace from any device.

## Privacy and security

- Workspace content is encrypted at rest using **AES-256-GCM**, and access requires the workspace link.
- Only what's needed to run the service is stored: latest workspace content, display names and numbers, and basic technical data.
- Sign-in stores only your name and a private sign-in ID, never your password, email or photo.
- Don't put secrets such as passwords or private keys in shared code. Use a secrets manager.

See the in-app **Terms & Privacy** for full details.

## Contributing

Bug reports and ideas are welcome. Open an issue, or use the **Feedback** button in the app.

## License

This project is licensed under the [MIT License](LICENSE).

---

© Crown Lab. SyncPit is provided "as is". Keep a copy of important code in your own repository.
