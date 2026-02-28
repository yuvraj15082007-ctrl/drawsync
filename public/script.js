const socket = io();
const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");

const BOARD_WIDTH = 900;
const BOARD_HEIGHT = 1600;

canvas.width = BOARD_WIDTH;
canvas.height = BOARD_HEIGHT;

let drawing = false;
let color = "#000000";
let brushSize = 3;
let currentRoom = "public";

let userName = prompt("Enter your name:");
if (!userName) userName = "Guest";

socket.emit("joinRoom", { pin: "public", name: userName });

/* ===== Layout Fix (Chat on Top) ===== */

function resizeCanvasArea() {
    const toolbarHeight = document.querySelector(".toolbar").offsetHeight;
    const chatHeight = document.querySelector(".chatBox").offsetHeight;

    canvas.style.top = (toolbarHeight + chatHeight) + "px";
    canvas.style.height =
        (window.innerHeight - toolbarHeight - chatHeight) + "px";
    canvas.style.width = "100vw";
}

resizeCanvasArea();
window.addEventListener("resize", resizeCanvasArea);

/* ===== Position Helper ===== */

function getPos(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    return {
        x: (clientX - rect.left) * (canvas.width / rect.width),
        y: (clientY - rect.top) * (canvas.height / rect.height)
    };
}

function drawLine(x0, y0, x1, y1, color, size) {
    ctx.strokeStyle = color;
    ctx.lineWidth = size;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
}

let lastX, lastY;

/* ===== MOUSE EVENTS ===== */

canvas.addEventListener("mousedown", (e) => {
    drawing = true;
    const pos = getPos(e.clientX, e.clientY);
    lastX = pos.x;
    lastY = pos.y;
});

canvas.addEventListener("mousemove", (e) => {
    if (!drawing) return;
    const pos = getPos(e.clientX, e.clientY);

    drawLine(lastX, lastY, pos.x, pos.y, color, brushSize);

    socket.emit("draw", {
        pin: currentRoom,
        stroke: { x0: lastX, y0: lastY, x1: pos.x, y1: pos.y, color, size: brushSize }
    });

    lastX = pos.x;
    lastY = pos.y;
});

canvas.addEventListener("mouseup", () => drawing = false);
canvas.addEventListener("mouseleave", () => drawing = false);

/* ===== TOUCH EVENTS ===== */

canvas.addEventListener("touchstart", (e) => {
    e.preventDefault();
    drawing = true;

    const touch = e.touches[0];
    const pos = getPos(touch.clientX, touch.clientY);
    lastX = pos.x;
    lastY = pos.y;
}, { passive: false });

canvas.addEventListener("touchmove", (e) => {
    e.preventDefault();
    if (!drawing) return;

    const touch = e.touches[0];
    const pos = getPos(touch.clientX, touch.clientY);

    drawLine(lastX, lastY, pos.x, pos.y, color, brushSize);

    socket.emit("draw", {
        pin: currentRoom,
        stroke: { x0: lastX, y0: lastY, x1: pos.x, y1: pos.y, color, size: brushSize }
    });

    lastX = pos.x;
    lastY = pos.y;
}, { passive: false });

canvas.addEventListener("touchend", () => drawing = false);

/* ===== CLEAR ===== */

function clearBoard() {
    socket.emit("clearBoard", currentRoom);
}

socket.on("clearBoard", () => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
});

/* ===== SOCKET RECEIVE ===== */

socket.on("draw", (stroke) => {
    drawLine(stroke.x0, stroke.y0, stroke.x1, stroke.y1, stroke.color, stroke.size);
});

socket.on("loadStrokes", (strokes) => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    strokes.forEach(s =>
        drawLine(s.x0, s.y0, s.x1, s.y1, s.color, s.size)
    );
});

socket.on("updateUsers", (users) => {
    document.getElementById("userCount").innerText =
        "Online: " + users.length;
});

/* ===== CHAT ===== */

function sendMessage() {
    const input = document.getElementById("chatInput");
    const message = input.value.trim();
    if (!message) return;

    socket.emit("chatMessage", { pin: currentRoom, message });
    input.value = "";
}

socket.on("chatMessage", (data) => {
    const box = document.getElementById("messages");
    const div = document.createElement("div");
    div.innerHTML = `<b>${data.name}:</b> ${data.message}`;
    box.appendChild(div);

    setTimeout(() => div.remove(), 30000);
});

/* ===== COLOR + SIZE ===== */

document.getElementById("colorPicker").addEventListener("input", e => {
    color = e.target.value;
});

document.getElementById("brushSize").addEventListener("input", e => {
    brushSize = parseInt(e.target.value);
});

function setBrush() {
    color = document.getElementById("colorPicker").value;
}

function setEraser() {
    color = "#ffffff";
}

function createRoom() {
    let pin = prompt("Enter new room PIN:");
    if (!pin) return;
    currentRoom = pin;
    socket.emit("joinRoom", { pin, name: userName });
}

function joinRoom() {
    let pin = prompt("Enter room PIN:");
    if (!pin) return;
    currentRoom = pin;
    socket.emit("joinRoom", { pin, name: userName });
}

function quitRoom() {
    currentRoom = "public";
    socket.emit("joinRoom", { pin: "public", name: userName });
}