<div align="center">

# 🕳️ SyncPit

### One editor. Your whole team.

Real-time shared coding room. Share one QR code, edit the same code live, in any language.

[![Live](https://img.shields.io/badge/LIVE-syncpit.onrender.com-46E3B7?style=for-the-badge&logo=render&logoColor=white)](https://syncpit.onrender.com)
[![License: MIT](https://img.shields.io/badge/License-MIT-F7C948?style=for-the-badge)](LICENSE)
[![Hosted on Render](https://img.shields.io/badge/Hosted%20on-Render-7C5CFF?style=for-the-badge&logo=render&logoColor=white)](https://render.com)
[![Encryption](https://img.shields.io/badge/Encrypted-AES--256--GCM-2EA44F?style=for-the-badge&logo=letsencrypt&logoColor=white)](#-privacy--security)

![Realtime](https://img.shields.io/badge/Realtime-Live%20Sync-FF5C8A?style=flat-square)
![Languages](https://img.shields.io/badge/Languages-25%2B-3B82F6?style=flat-square)
![Run](https://img.shields.io/badge/Run-JavaScript%20%26%20Python-F97316?style=flat-square)
![Preview](https://img.shields.io/badge/Preview-HTML%20%26%20CSS-06B6D4?style=flat-square)
![Made by](https://img.shields.io/badge/A%20project%20of-Crown%20Lab-111827?style=flat-square)

</div>

```js
const team = sync();
team.edit("together"); // every keystroke, live
```

---

## ✨ Features

| | | |
|:--|:--|:--|
| 🟣 **Live collaboration**<br>Every keystroke syncs instantly | 🟢 **QR and link sharing**<br>Invite teammates in one scan | 🟡 **Owner controls**<br>Lock editing or delete the workspace |
| 🔴 **Owner key**<br>Regain control on any device | 🔵 **Persistent workspaces**<br>Links survive server restarts | 🟠 **Any language**<br>Auto-detect or choose manually |
| 🟦 **Run in browser**<br>JavaScript and Python sandbox, `Ctrl+Enter` | 🟩 **Live preview**<br>HTML and CSS render instantly | 🟪 **Presence and chat**<br>See who's here, messages vanish when all leave |

**Also included:** accounts with unique names and numbers, System/Light/Dark themes, site notices, role tags, maintenance mode, feedback form and an Audius music player.

---

## 🚀 How it works

| Step | What you do |
|:--:|:--|
| ![1](https://img.shields.io/badge/1-Create-7C5CFF?style=flat-square) | Click **Create workspace & QR** |
| ![2](https://img.shields.io/badge/2-Share-46E3B7?style=flat-square) | Send the QR code or link to your team |
| ![3](https://img.shields.io/badge/3-Edit-FF5C8A?style=flat-square) | Code together in real time |
| ![4](https://img.shields.io/badge/4-Lock-F7C948?style=flat-square) | Press **Lock editing** for read-only mode |
| ![5](https://img.shields.io/badge/5-Manage-3B82F6?style=flat-square) | Open your **owner link** anytime to manage the workspace |

---

## 🔒 Privacy & Security

> [!IMPORTANT]
> Workspace content is encrypted at rest with **AES-256-GCM**, and access requires the workspace link.

- Only what's needed to run the service is stored: latest workspace content, display names and numbers, basic technical data.
- Sign-in stores only your name and a private sign-in ID. Never your password, email or photo.

> [!WARNING]
> Don't put passwords or private keys in shared code. Use a secrets manager.

---

## 🛠️ Run locally

> [!NOTE]
> Add your setup steps here once you know your stack, for example:

```bash
git clone https://github.com/<realsynapse>/syncpit.git
cd syncpit
cp .env.example .env   # fill in your own values
# install dependencies and start the server
```


---

## 🤝 Contributing

Bug reports and ideas are welcome. Open an issue, or use the **Feedback** button in the app.

## 📄 License

Released under the [MIT License](LICENSE).

---

<div align="center">

Made with 💜 by **Crown Lab** · [syncpit.onrender.com](https://syncpit.onrender.com)

</div>
