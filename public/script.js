const socket = io();
const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");

canvas.width = window.innerWidth;
canvas.height = window.innerHeight;

let scale = 1;
let originX = 0;
let originY = 0;

let drawing = false;
let color = "#000000";
let brushSize = 3;
let currentRoom = "public";

let userName = prompt("Enter your name:");
if (!userName) userName = "Guest";

socket.emit("joinRoom", { pin: "public", name: userName });

function resetView() {
    scale = 1;
    originX = 0;
    originY = 0;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    document.getElementById("zoomLevel").innerText = "100%";
}

/* ========= DRAW ========= */

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

/* ========= TOUCH SUPPORT ========= */

canvas.addEventListener("touchstart", (e) => {
    e.preventDefault();
    if (e.touches.length === 1) {
        drawing = true;
        const rect = canvas.getBoundingClientRect();
        lastX = (e.touches[0].clientX - rect.left - originX) / scale;
        lastY = (e.touches[0].clientY - rect.top - originY) / scale;
    }
}, { passive: false });

canvas.addEventListener("touchmove", (e) => {
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();

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

}, { passive: false });

canvas.addEventListener("touchend", () => drawing = false);

/* ========= UI ========= */

function toggleToolbar() {
    document.querySelector(".toolbar").classList.toggle("hiddenToolbar");
}

function createRoom() {
    let pin = prompt("Enter new room PIN:");
    if (!pin) return;

    currentRoom = pin;
    resetView();
    socket.emit("joinRoom", { pin, name: userName });

    document.getElementById("roomInfo").innerText = "Room: " + pin;
    toggleRoomButtons(true);
}

function joinRoom() {
    let pin = prompt("Enter room PIN:");
    if (!pin) return;

    currentRoom = pin;
    resetView();
    socket.emit("joinRoom", { pin, name: userName });

    document.getElementById("roomInfo").innerText = "Room: " + pin;
    toggleRoomButtons(true);
}

function quitRoom() {
    currentRoom = "public";
    resetView();
    socket.emit("joinRoom", { pin: "public", name: userName });

    document.getElementById("roomInfo").innerText = "Room: public";
    toggleRoomButtons(false);
}

function toggleRoomButtons(inRoom) {
    document.getElementById("createBtn").style.display = inRoom ? "none" : "block";
    document.getElementById("joinBtn").style.display = inRoom ? "none" : "block";
    document.getElementById("quitBtn").style.display = inRoom ? "block" : "none";
}

function clearBoard() {
    socket.emit("clearBoard", currentRoom);
}

function setBrush() {
    color = document.getElementById("colorPicker").value;
}

function setEraser() {
    color = "#ffffff";
}

function toggleUsers() {
    document.getElementById("userList").classList.toggle("hidden");
}

/* ========= SOCKET ========= */

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
    document.getElementById("userList").innerHTML =
        users.map(u => `<div>${u}</div>`).join("");
});

socket.on("notification", (msg) => {
    const box = document.getElementById("notifications");
    box.innerText = msg;
    setTimeout(() => box.innerText = "", 3000);
});