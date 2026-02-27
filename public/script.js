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
let scale = 1;
let isEraser = false;

ctx.lineCap = "round";
ctx.lineJoin = "round";

// 🎨 Background
function drawBackgroundMessage() {
    ctx.save();
    ctx.globalAlpha = 0.08;
    ctx.textAlign = "center";
    ctx.fillStyle = "black";
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.rotate(-Math.PI / 8);
    ctx.font = "bold 60px Arial";
    ctx.fillText("This is for you Nancy 💖", 0, -40);
    ctx.font = "bold 40px Arial";
    ctx.fillText("From Yuvraj", 0, 40);
    ctx.restore();
}

drawBackgroundMessage();

function startDrawing(x, y) {
    drawing = true;
    lastX = x / scale;
    lastY = y / scale;
}

function stopDrawing() {
    drawing = false;
}

function drawLine(x, y, emit = true) {
    if (!drawing) return;

    const newX = x / scale;
    const newY = y / scale;

    ctx.beginPath();
    ctx.moveTo(lastX, lastY);
    ctx.lineTo(newX, newY);
    ctx.strokeStyle = isEraser ? "white" : color;
    ctx.lineWidth = brushSize;
    ctx.stroke();
    ctx.closePath();

    if (emit) {
        socket.emit("draw", {
            x: newX,
            y: newY,
            lastX,
            lastY,
            color,
            brushSize,
            isEraser
        });
    }

    lastX = newX;
    lastY = newY;
}

// 🖱 PC
canvas.addEventListener("mousedown", (e) => {
    startDrawing(e.clientX, e.clientY);
});

canvas.addEventListener("mouseup", stopDrawing);

canvas.addEventListener("mousemove", (e) => {
    drawLine(e.clientX, e.clientY);
});

// 📱 Mobile
canvas.addEventListener("touchstart", (e) => {
    e.preventDefault();
    const touch = e.touches[0];
    startDrawing(touch.clientX, touch.clientY);
});

canvas.addEventListener("touchend", stopDrawing);

canvas.addEventListener("touchmove", (e) => {
    e.preventDefault();
    const touch = e.touches[0];
    drawLine(touch.clientX, touch.clientY);
});

// 👥 Receive
socket.on("draw", (data) => {
    ctx.beginPath();
    ctx.moveTo(data.lastX, data.lastY);
    ctx.lineTo(data.x, data.y);
    ctx.strokeStyle = data.isEraser ? "white" : data.color;
    ctx.lineWidth = data.brushSize;
    ctx.stroke();
    ctx.closePath();
});

// 🎨 Color
document.getElementById("colorPicker")
    .addEventListener("input", (e) => {
        color = e.target.value;
        isEraser = false;
    });

// 🧽 Eraser
function setEraser() {
    isEraser = true;
}

function setBrush() {
    isEraser = false;
}

// 🔍 Zoom
function zoomIn() {
    scale += 0.1;
    canvas.style.transform = `scale(${scale})`;
}

function zoomOut() {
    scale -= 0.1;
    if (scale < 0.5) scale = 0.5;
    canvas.style.transform = `scale(${scale})`;
}

// 🧹 Clear
function clearBoard() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawBackgroundMessage();
    socket.emit("clear");
}

socket.on("clear", () => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawBackgroundMessage();
});