<div align="center">

# ✏️ DrawSync

**A free, real-time collaborative whiteboard for classrooms, teams, and remote collaboration — no login, no installs, just a PIN.**

[![Live Demo](https://img.shields.io/badge/Live%20Demo-drawsync--vdz0.onrender.com-e8ff47?style=for-the-badge)](https://drawsync-vdz0.onrender.com/)
[![Node.js](https://img.shields.io/badge/Node.js-Backend-339933?style=flat-square&logo=node.js&logoColor=white)](https://nodejs.org/)
[![Socket.IO](https://img.shields.io/badge/Socket.IO-Real--Time-010101?style=flat-square&logo=socket.io&logoColor=white)](https://socket.io/)
[![WebRTC](https://img.shields.io/badge/WebRTC-Voice-333?style=flat-square&logo=webrtc&logoColor=white)](https://webrtc.org/)
[![Android](https://img.shields.io/badge/Android-Capacitor-3DDC84?style=flat-square&logo=android&logoColor=white)](https://capacitorjs.com/)

🔗 **[Try it live →](https://drawsync-vdz0.onrender.com/)**

</div>

---

## 📖 About

Most collaborative whiteboards make you sign up, pay for real-time multi-user boards, or give you zero control once a session starts. **DrawSync** fixes that: open a room by PIN and start drawing together in seconds — and with **Teaching Room** mode, a teacher can run an entire live class with controlled drawing permissions, voice broadcast, and built-in geometry tools, all in one tab.

Built for **Smart India Hackathon** — Team **Survivors**.

---

## 📸 Screenshots

<table>
  <tr>
---
<img width="1600" height="817" alt="drawsyncss3" src="https://github.com/user-attachments/assets/8b10741c-c074-4fec-8748-20c1cdc668d1" />
<img width="575" height="523" alt="Screenshot 2026-03-18 145242" src="https://github.com/user-attachments/assets/08f2ef27-0e56-47e5-aafc-2b7a0e87e36a" />
<img width="1600" height="826" alt="drawsyncss" src="https://github.com/user-attachments/assets/d7e25f9a-d12a-45fb-ae81-f5b3d316e9ae" />
<img width="1600" height="825" alt="drawsyncss2" src="https://github.com/user-attachments/assets/fc77247b-506e-48f8-b26d-18c5c3ee564b" />

</tr>
</table>

## ✨ Features

### Core Whiteboard
- 🖊️ **Infinite canvas** — smooth pan & zoom, plus a minimap for quick navigation
- 🎨 **Full drawing toolkit** — pen, eraser, glow, shapes (rectangle, circle, line, triangle, arrow, star), fill, eyedropper, text, scale, and cut/copy/paste
- ✨ **Autocorrect drawing** — freehand strokes auto-straighten into clean lines and round into perfect circles
- ↩️ **Synced undo/redo** across every participant in the room
- 👥 **Real-time cursors & live chat**
- 💾 **PNG export** — saves just the drawn area, cropped automatically
- 🔒 **Private rooms by PIN** — no accounts; rooms auto-delete once empty, so no stale boards ever linger
- 📱 Works on **web browsers and Android** (Capacitor-wrapped APK)

### 🎓 Teaching Room Mode
A dedicated live-classroom mode:
- The **room creator becomes the teacher** automatically
- ✋ **Hand-raise system** — students request drawing permission; the teacher grants or revokes it live
- 🔐 **Server-enforced permissions** — access is checked on the backend, not just hidden in the UI
- 🧹 Only the teacher can **clear the board**
- 🎙️ **Live voice broadcast** — the teacher's mic streams directly to the class over WebRTC, peer-to-peer, no media server needed
- 📐 **Teacher Toolkit** for live math & geometry teaching:
  | Tool | What it does |
  |---|---|
  | Graph | Toggleable grid with bold origin axes |
  | Ruler | Measures length in real-world centimeters |
  | Protractor | Two-step angle tool with live degree readout |
  | Compass | Center-drag circle with radius label |
- 🗂️ **Minimizable Teacher Panel** — manage raised hands without it taking over the screen

---

## 🛠️ Tech Stack

| Layer | Technology |
|---|---|
| Frontend | HTML5 Canvas, JavaScript, CSS |
| Real-Time Sync | Socket.IO (WebSockets) |
| Voice | WebRTC (peer-to-peer, signaled via Socket.IO) |
| Backend | Node.js, Express |
| Mobile | Capacitor (Android APK) |
| Hosting | Render |

---

## 🧠 How It Works

```
User draws → Local canvas renders instantly (optimistic)
           → [Teaching Room] server-side permission check
           → Socket.IO broadcasts the stroke
           → Server stores it & relays it to the room
           → Every connected client stays in sync within milliseconds
```

Room state (participants, strokes, teacher role, permissions) lives entirely **in-memory** on the server, keyed by PIN — no database, no persistence to worry about, and rooms clean themselves up once empty.

Voice works the same way: the teacher's browser opens a direct `RTCPeerConnection` to each student, with Socket.IO used only to relay the initial offer/answer/ICE handshake. Audio itself never touches the server.

---

## 🚀 Getting Started

### Prerequisites
- [Node.js](https://nodejs.org/) v18+

### Installation

```bash
git clone https://github.com/yuvraj15082007-ctrl/drawsync.git
cd drawsync
npm install
npm start
```

The app runs at `http://localhost:10000` (or the port set by `process.env.PORT`).

### Trying Teaching Room mode
1. In one browser tab, click **Teach** to create a Teaching Room — you're now the teacher.
2. In a second tab or device, click **Join** with the same PIN — you're a student.
3. As the student, tap **✋ Raise Hand**. As the teacher, tap **Allow** in the Teacher Panel to grant drawing access.
4. Try **🎙️ Start Voice Broadcast** as the teacher — use headphones while testing to avoid feedback echo.

---

## 🗺️ Roadmap

- [ ] Redis-backed room state for horizontal scaling
- [ ] SFU media-server architecture for larger Teaching Room broadcasts (15–20+ listeners)
- [ ] Room passwords & session persistence
- [ ] Export board as PDF

---

## 👥 Team

**Survivors** — Smart India Hackathon

---

## 📄 License

Add a license of your choice (e.g., MIT) here.

---

<p align="center">Built by <a href="https://github.com/yuvraj15082007-ctrl">Yuvraj</a></p>
