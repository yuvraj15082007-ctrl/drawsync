const socket = io();
const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");

canvas.width = window.innerWidth;
canvas.height = window.innerHeight;

let drawing = false;
let color = "#000000";
let brushSize = 3;
let currentRoom = "public";

let userName = prompt("Enter your name:");
if (!userName) userName = "Guest";

socket.emit("joinRoom", { pin: "public", name: userName });

/* ================= DRAW ================= */

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

canvas.addEventListener("mousedown", (e) => {
    drawing = true;
    lastX = e.offsetX;
    lastY = e.offsetY;
});

canvas.addEventListener("mousemove", (e) => {
    if (!drawing) return;

    let x = e.offsetX;
    let y = e.offsetY;

    drawLine(lastX, lastY, x, y, color, brushSize);

    socket.emit("draw", {
        pin: currentRoom,
        stroke: { x0: lastX, y0: lastY, x1: x, y1: y, color, size: brushSize }
    });

    lastX = x;
    lastY = y;
});

canvas.addEventListener("mouseup", () => drawing = false);

/* ================= TOUCH ================= */

canvas.addEventListener("touchstart", (e) => {
    e.preventDefault();
    if (e.touches.length === 1) {
        drawing = true;
        const rect = canvas.getBoundingClientRect();
        lastX = e.touches[0].clientX - rect.left;
        lastY = e.touches[0].clientY - rect.top;
    }
}, { passive: false });

canvas.addEventListener("touchmove", (e) => {
    e.preventDefault();
    if (e.touches.length === 1 && drawing) {
        const rect = canvas.getBoundingClientRect();
        let x = e.touches[0].clientX - rect.left;
        let y = e.touches[0].clientY - rect.top;

        drawLine(lastX, lastY, x, y, color, brushSize);

        socket.emit("draw", {
            pin: currentRoom,
            stroke: { x0: lastX, y0: lastY, x1: x, y1: y, color, size: brushSize }
        });

        lastX = x;
        lastY = y;
    }
}, { passive: false });

canvas.addEventListener("touchend", () => drawing = false);

/* ================= COLOR + SIZE ================= */

document.getElementById("colorPicker").addEventListener("input", (e) => {
    color = e.target.value;
});

document.getElementById("brushSize").addEventListener("input", (e) => {
    brushSize = parseInt(e.target.value);
});

function setBrush() {
    color = document.getElementById("colorPicker").value;
}

function setEraser() {
    color = "#ffffff";
}

/* ================= CLEAR ================= */

function clearBoard() {
    socket.emit("clearBoard", currentRoom);
}

socket.on("clearBoard", () => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
});

/* ================= SOCKET RECEIVE ================= */

socket.on("draw", (stroke) => {
    drawLine(stroke.x0, stroke.y0, stroke.x1, stroke.y1, stroke.color, stroke.size);
});

socket.on("loadStrokes", (strokes) => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    strokes.forEach(s =>
        drawLine(s.x0, s.y0, s.x1, s.y1, s.color, s.size)
    );
});

socket.on("userList", (users) => {
    document.getElementById("userCount").innerText = "Online: " + users.length;
});