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
let initialDistance = null;

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
    ctx.fillText("This is for you Someone 💖", 0, -40);

    ctx.font = "bold 40px Arial";
    ctx.fillText("From Someone", 0, 40);

    ctx.restore();
}

drawBackgroundMessage();

// 🔄 Apply Zoom
function applyZoom() {
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    document.getElementById("zoomLevel").innerText =
        Math.round(scale * 100) + "%";
}

// ✏️ Drawing
function getMousePos(x, y) {
    const rect = canvas.getBoundingClientRect();
    return {
        x: (x - rect.left) / scale,
        y: (y - rect.top) / scale
    };
}

function startDrawing(x, y) {
    drawing = true;
    const pos = getMousePos(x, y);
    lastX = pos.x;
    lastY = pos.y;
}

function stopDrawing() {
    drawing = false;
}

function drawLine(x, y, emit = true) {
    if (!drawing) return;

    const pos = getMousePos(x, y);

    ctx.beginPath();
    ctx.moveTo(lastX, lastY);
    ctx.lineTo(pos.x, pos.y);
    ctx.strokeStyle = isEraser ? "white" : color;
    ctx.lineWidth = brushSize;
    ctx.stroke();
    ctx.closePath();

    if (emit) {
        socket.emit("draw", {
            x: pos.x,
            y: pos.y,
            lastX,
            lastY,
            color,
            brushSize,
            isEraser
        });
    }

    lastX = pos.x;
    lastY = pos.y;
}

// 🖱 PC Events
canvas.addEventListener("mousedown", e => {
    startDrawing(e.clientX, e.clientY);
});
canvas.addEventListener("mouseup", stopDrawing);
canvas.addEventListener("mousemove", e => {
    drawLine(e.clientX, e.clientY);
});

// 📱 Touch Events
canvas.addEventListener("touchstart", e => {
    if (e.touches.length === 1) {
        const touch = e.touches[0];
        startDrawing(touch.clientX, touch.clientY);
    }

    if (e.touches.length === 2) {
        initialDistance = getDistance(e.touches);
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

        if (initialDistance) {
            let zoomFactor = newDistance / initialDistance;
            scale *= zoomFactor;
            scale = Math.max(0.5, Math.min(scale, 3));
            applyZoom();
        }

        initialDistance = newDistance;
    }
});

canvas.addEventListener("touchend", stopDrawing);

function getDistance(touches) {
    const dx = touches[0].clientX - touches[1].clientX;
    const dy = touches[0].clientY - touches[1].clientY;
    return Math.sqrt(dx * dx + dy * dy);
}

// 👥 Receive drawing
socket.on("draw", data => {
    ctx.beginPath();
    ctx.moveTo(data.lastX, data.lastY);
    ctx.lineTo(data.x, data.y);
    ctx.strokeStyle = data.isEraser ? "white" : data.color;
    ctx.lineWidth = data.brushSize;
    ctx.stroke();
    ctx.closePath();
});

// 👥 User counter
socket.on("userCount", count => {
    document.getElementById("userCount").innerText =
        "Users: " + count;
});

// 🎨 Color
document.getElementById("colorPicker")
    .addEventListener("input", e => {
        color = e.target.value;
        isEraser = false;
    });

// 🖌 Brush Size
document.getElementById("brushSize")
    .addEventListener("input", e => {
        brushSize = e.target.value;
    });

// 🧽 Tools
function setEraser() {
    isEraser = true;
}
function setBrush() {
    isEraser = false;
}

// 🧹 Clear
function clearBoard() {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    scale = 1;
    applyZoom();
    drawBackgroundMessage();
    socket.emit("clear");
}

socket.on("clear", () => {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    scale = 1;
    applyZoom();
    drawBackgroundMessage();
});