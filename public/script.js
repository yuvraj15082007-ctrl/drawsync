const socket = io();
const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");

canvas.width = window.innerWidth;
canvas.height = window.innerHeight;

let drawing = false;
let color = "black";
let brushSize = 3;

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

function startPosition(x, y) {
    drawing = true;
    ctx.beginPath();
    ctx.moveTo(x, y);
}

function endPosition() {
    drawing = false;
}

function draw(x, y) {
    if (!drawing) return;

    ctx.lineTo(x, y);
    ctx.strokeStyle = color;
    ctx.lineWidth = brushSize;
    ctx.stroke();

    socket.emit("draw", { x, y, color, brushSize });
}

// 🖱 Mouse Events (PC)
canvas.addEventListener("mousedown", (e) => {
    startPosition(e.clientX, e.clientY);
});

canvas.addEventListener("mouseup", endPosition);

canvas.addEventListener("mousemove", (e) => {
    draw(e.clientX, e.clientY);
});

// 📱 Touch Events (Mobile)
canvas.addEventListener("touchstart", (e) => {
    e.preventDefault();
    const touch = e.touches[0];
    startPosition(touch.clientX, touch.clientY);
});

canvas.addEventListener("touchend", endPosition);

canvas.addEventListener("touchmove", (e) => {
    e.preventDefault();
    const touch = e.touches[0];
    draw(touch.clientX, touch.clientY);
});

// Receive drawing
socket.on("draw", (data) => {
    ctx.strokeStyle = data.color;
    ctx.lineWidth = data.brushSize;
    ctx.lineTo(data.x, data.y);
    ctx.stroke();
});

// Color picker
document.getElementById("colorPicker")
    .addEventListener("input", (e) => {
        color = e.target.value;
    });

// Clear
function clearBoard() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawBackgroundMessage();
    socket.emit("clear");
}

socket.on("clear", () => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawBackgroundMessage();
});