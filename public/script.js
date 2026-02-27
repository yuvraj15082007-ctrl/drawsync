const socket = io();
const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");

canvas.width = window.innerWidth;
canvas.height = window.innerHeight;

let scale = 1;
let originX = 0;
let originY = 0;

let drawing = false;
let color = "black";
let brushSize = 3;
let currentRoom = "public";

let userName = prompt("Enter your name:");
if (!userName) userName = "Guest";

socket.emit("joinRoom", { pin: "public", name: userName });

// ================= DRAW =================

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

// ================= TOUCH SUPPORT =================

canvas.addEventListener("touchstart", (e) => {
    if (e.touches.length === 1) {
        drawing = true;
        const rect = canvas.getBoundingClientRect();
        lastX = (e.touches[0].clientX - rect.left - originX) / scale;
        lastY = (e.touches[0].clientY - rect.top - originY) / scale;
    }
});

canvas.addEventListener("touchmove", (e) => {
    if (e.touches.length === 1 && drawing) {
        const rect = canvas.getBoundingClientRect();
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

    // Pinch zoom
    if (e.touches.length === 2) {
        let dx = e.touches[0].clientX - e.touches[1].clientX;
        let dy = e.touches[0].clientY - e.touches[1].clientY;
        let distance = Math.sqrt(dx * dx + dy * dy);

        scale = distance / 200;
        if (scale < 0.5) scale = 0.5;
        if (scale > 3) scale = 3;

        ctx.setTransform(scale, 0, 0, scale, originX, originY);
    }
});

canvas.addEventListener("touchend", () => drawing = false);

// ================= SOCKET EVENTS =================

socket.on("draw", (stroke) => {
    drawLine(stroke.x0, stroke.y0, stroke.x1, stroke.y1, stroke.color, stroke.size);
});

socket.on("loadStrokes", (strokes) => {
    strokes.forEach(s => drawLine(s.x0, s.y0, s.x1, s.y1, s.color, s.size));
});

socket.on("clearBoard", () => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
});

socket.on("userList", (users) => {
    document.getElementById("onlineCount").innerText = "Online: " + users.length;
    window.currentUsers = users;
});

socket.on("notification", (msg) => {
    console.log(msg);
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
}

function joinRoom() {
    let pin = prompt("Enter room PIN:");
    if (!pin) return;

    currentRoom = pin;
    socket.emit("joinRoom", { pin, name: userName });
}

function showUsers() {
    alert("Users:\n" + window.currentUsers.join("\n"));
}

function setBrush() {
    color = "black";
}

function setEraser() {
    color = "white";
}