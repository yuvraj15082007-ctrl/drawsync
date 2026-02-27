const socket = io();
const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");

canvas.width = window.innerWidth;
canvas.height = window.innerHeight;

let scale = 1;
let originX = 0;
let originY = 0;

let drawing = false;
let isPanning = false;

let color = "black";
let brushSize = 3;
let currentRoom = "public";

let userName = prompt("Enter your name:");
if (!userName) userName = "Guest";

socket.emit("joinRoom", { pin: "public", name: userName });

// ================= COLOR + BRUSH SIZE =================

document.getElementById("colorPicker").addEventListener("input", (e) => {
    color = e.target.value;
});

document.getElementById("brushSize").addEventListener("input", (e) => {
    brushSize = e.target.value;
});

// ================= PREVENT MOBILE REFRESH =================

canvas.addEventListener("touchstart", e => e.preventDefault(), { passive: false });
canvas.addEventListener("touchmove", e => e.preventDefault(), { passive: false });
canvas.addEventListener("touchend", e => e.preventDefault(), { passive: false });

// ================= DRAW FUNCTION =================

function drawLine(x0, y0, x1, y1, color, size) {
    ctx.strokeStyle = color;
    ctx.lineWidth = size;
    ctx.lineCap = "round";

    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
}

let lastX = 0;
let lastY = 0;

// ================= MOUSE DRAW =================

canvas.addEventListener("mousedown", (e) => {
    drawing = true;
    lastX = (e.offsetX - originX) / scale;
    lastY = (e.offsetY - originY) / scale;
});

canvas.addEventListener("mousemove", (e) => {
    if (!drawing) return;

    let x = (e.offsetX - originX) / scale;
    let y = (e.offsetY - originY) / scale;

    drawLine(lastX, lastY, x, y, color, brushSize);

    socket.emit("draw", {
        pin: currentRoom,
        stroke: { x0: lastX, y0: lastY, x1: x, y1: y, color, size: brushSize }
    });

    lastX = x;
    lastY = y;
});

canvas.addEventListener("mouseup", () => drawing = false);

// ================= TOUCH DRAW + ZOOM + PAN =================

let startDistance = 0;

canvas.addEventListener("touchstart", (e) => {

    if (e.touches.length === 1) {
        drawing = true;
        const rect = canvas.getBoundingClientRect();
        lastX = (e.touches[0].clientX - rect.left - originX) / scale;
        lastY = (e.touches[0].clientY - rect.top - originY) / scale;
    }

    if (e.touches.length === 2) {
        drawing = false;
        let dx = e.touches[0].clientX - e.touches[1].clientX;
        let dy = e.touches[0].clientY - e.touches[1].clientY;
        startDistance = Math.sqrt(dx * dx + dy * dy);
    }
});

canvas.addEventListener("touchmove", (e) => {

    const rect = canvas.getBoundingClientRect();

    // Draw
    if (e.touches.length === 1 && drawing) {
        let x = (e.touches[0].clientX - rect.left - originX) / scale;
        let y = (e.touches[0].clientY - rect.top - originY) / scale;

        drawLine(lastX, lastY, x, y, color, brushSize);

        socket.emit("draw", {
            pin: currentRoom,
            stroke: { x0: lastX, y0: lastY, x1: x, y1: y, color, size: brushSize }
        });

        lastX = x;
        lastY = y;
    }

    // Pinch Zoom
    if (e.touches.length === 2) {

        let dx = e.touches[0].clientX - e.touches[1].clientX;
        let dy = e.touches[0].clientY - e.touches[1].clientY;
        let distance = Math.sqrt(dx * dx + dy * dy);

        let zoomFactor = distance / startDistance;
        scale *= zoomFactor;

        if (scale < 0.5) scale = 0.5;
        if (scale > 3) scale = 3;

        ctx.setTransform(scale, 0, 0, scale, originX, originY);

        document.getElementById("zoomLevel").innerText =
            Math.round(scale * 100) + "%";

        startDistance = distance;
    }
});

canvas.addEventListener("touchend", () => {
    drawing = false;
});

// ================= SOCKET EVENTS =================

socket.on("draw", (stroke) => {
    drawLine(stroke.x0, stroke.y0, stroke.x1, stroke.y1, stroke.color, stroke.size);
});

socket.on("loadStrokes", (strokes) => {
    strokes.forEach(s =>
        drawLine(s.x0, s.y0, s.x1, s.y1, s.color, s.size)
    );
});

socket.on("clearBoard", () => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
});

socket.on("userList", (users) => {
    document.getElementById("userCount").innerText =
        "Online: " + users.length;

    const list = document.getElementById("userList");
    list.innerHTML = users.map(u => `<div>${u}</div>`).join("");
});

socket.on("notification", (msg) => {
    const box = document.getElementById("notifications");
    box.innerText = msg;
    setTimeout(() => box.innerText = "", 3000);
});

// ================= UI FUNCTIONS =================

function clearBoard() {
    socket.emit("clearBoard", currentRoom);
}

function createRoom() {
    let pin = prompt("Enter new room PIN:");
    if (!pin) return;

    currentRoom = pin;
    socket.emit("joinRoom", { pin, name: userName });
    document.getElementById("roomInfo").innerText = "Room: " + pin;
}

function joinRoom() {
    let pin = prompt("Enter room PIN:");
    if (!pin) return;

    currentRoom = pin;
    socket.emit("joinRoom", { pin, name: userName });
    document.getElementById("roomInfo").innerText = "Room: " + pin;
}

function toggleUsers() {
    document.getElementById("userList").classList.toggle("hidden");
}

function setBrush() {
    color = document.getElementById("colorPicker").value;
}

function setEraser() {
    color = "white";
}