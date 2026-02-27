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

ctx.lineCap = "round";
ctx.lineJoin = "round";

// 🎨 Background Message
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
    lastX = x;
    lastY = y;
}

function stopDrawing() {
    drawing = false;
}

function drawLine(x, y, emit = true) {
    if (!drawing) return;

    ctx.beginPath();
    ctx.moveTo(lastX, lastY);
    ctx.lineTo(x, y);
    ctx.strokeStyle = color;
    ctx.lineWidth = brushSize;
    ctx.stroke();
    ctx.closePath();

    if (emit) {
        socket.emit("draw", {
            x,
            y,
            lastX,
            lastY,
            color,
            brushSize
        });
    }

    lastX = x;
    lastY = y;
}

// 🖱 PC Events
canvas.addEventListener("mousedown", (e) => {
    startDrawing(e.clientX, e.clientY);
});

canvas.addEventListener("mouseup", stopDrawing);

canvas.addEventListener("mousemove", (e) => {
    drawLine(e.clientX, e.clientY);
});

// 📱 Mobile Events
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

// 👥 Receive Drawing
socket.on("draw", (data) => {
    ctx.beginPath();
    ctx.moveTo(data.lastX, data.lastY);
    ctx.lineTo(data.x, data.y);
    ctx.strokeStyle = data.color;
    ctx.lineWidth = data.brushSize;
    ctx.stroke();
    ctx.closePath();
});

// 🎨 Color Picker
document.getElementById("colorPicker")
    .addEventListener("input", (e) => {
        color = e.target.value;
    });

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