const socket = io();
const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");

canvas.width = window.innerWidth;
canvas.height = window.innerHeight;

let drawing = false;
let color = "black";
let brushSize = 3;
let lastX = 0;
let lastY = 0;
let isEraser = false;

let scale = 1;
let offsetX = 0;
let offsetY = 0;

let initialDistance = null;
let lastPanX = 0;
let lastPanY = 0;

let strokes = [];

ctx.lineCap = "round";
ctx.lineJoin = "round";


// 👤 Ask Name
let userName = prompt("Enter your name:");
if (!userName) userName = "Guest";

socket.emit("join", userName);


// 🔄 Redraw
function redrawCanvas() {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    ctx.setTransform(scale, 0, 0, scale, offsetX, offsetY);

    strokes.forEach(stroke => {
        ctx.beginPath();
        ctx.moveTo(stroke.lastX, stroke.lastY);
        ctx.lineTo(stroke.x, stroke.y);
        ctx.strokeStyle = stroke.isEraser ? "white" : stroke.color;
        ctx.lineWidth = stroke.brushSize;
        ctx.stroke();
        ctx.closePath();
    });

    document.getElementById("zoomLevel").innerText =
        Math.round(scale * 100) + "%";
}


// ✏ Get Position
function getPos(x, y) {
    const rect = canvas.getBoundingClientRect();
    return {
        x: (x - rect.left - offsetX) / scale,
        y: (y - rect.top - offsetY) / scale
    };
}


// ✏ Drawing
function startDrawing(x, y) {
    drawing = true;
    const pos = getPos(x, y);
    lastX = pos.x;
    lastY = pos.y;
}

function stopDrawing() {
    drawing = false;
}

function drawLine(x, y, emit = true) {
    if (!drawing) return;

    const pos = getPos(x, y);

    strokes.push({
        lastX,
        lastY,
        x: pos.x,
        y: pos.y,
        color,
        brushSize,
        isEraser
    });

    redrawCanvas();

    if (emit) {
        socket.emit("draw", strokes[strokes.length - 1]);
    }

    lastX = pos.x;
    lastY = pos.y;
}


// 🖱 Mouse
canvas.addEventListener("mousedown", e => {
    startDrawing(e.clientX, e.clientY);
});
canvas.addEventListener("mouseup", stopDrawing);
canvas.addEventListener("mousemove", e => {
    drawLine(e.clientX, e.clientY);
});


// 📱 Touch
canvas.addEventListener("touchstart", e => {

    if (e.touches.length === 1) {
        const touch = e.touches[0];
        startDrawing(touch.clientX, touch.clientY);
    }

    if (e.touches.length === 2) {
        initialDistance = getDistance(e.touches);
        lastPanX = e.touches[0].clientX;
        lastPanY = e.touches[0].clientY;
    }
});

canvas.addEventListener("touchmove", e => {
    e.preventDefault();

    if (e.touches.length === 1) {
        const touch = e.touches[0];
        drawLine(touch.clientX, touch.clientY);
    }

    if (e.touches.length === 2) {
        const newDistance = getDistance(e.touches);

        // Zoom
        if (initialDistance) {
            let zoomFactor = newDistance / initialDistance;
            scale *= zoomFactor;
            scale = Math.max(0.5, Math.min(scale, 4));
        }

        // Pan
        const currentX = e.touches[0].clientX;
        const currentY = e.touches[0].clientY;

        offsetX += (currentX - lastPanX);
        offsetY += (currentY - lastPanY);

        lastPanX = currentX;
        lastPanY = currentY;

        initialDistance = newDistance;
        redrawCanvas();
    }
});

canvas.addEventListener("touchend", stopDrawing);

function getDistance(touches) {
    const dx = touches[0].clientX - touches[1].clientX;
    const dy = touches[0].clientY - touches[1].clientY;
    return Math.sqrt(dx * dx + dy * dy);
}


// 👥 Socket Receive
socket.on("draw", data => {
    strokes.push(data);
    redrawCanvas();
});

socket.on("userCount", count => {
    document.getElementById("userCount").innerText =
        "Online: " + count;
});

socket.on("userList", list => {
    const userListDiv = document.getElementById("userList");
    userListDiv.innerHTML = "";

    list.forEach(name => {
        const div = document.createElement("div");
        div.innerText = name;
        userListDiv.appendChild(div);
    });
});
function toggleUsers() {
    const userList = document.getElementById("userList");
    userList.classList.toggle("hidden");
}


// 🎨 Tools
document.getElementById("colorPicker").addEventListener("input", e => {
    color = e.target.value;
    isEraser = false;
});

document.getElementById("brushSize").addEventListener("input", e => {
    brushSize = e.target.value;
});

function setEraser() { isEraser = true; }
function setBrush() { isEraser = false; }

function clearBoard() {
    strokes = [];
    redrawCanvas();
    socket.emit("clear");
}

socket.on("clear", () => {
    strokes = [];
    redrawCanvas();
});

redrawCanvas();