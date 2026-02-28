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

function resizeCanvasArea() {
    const toolbarHeight = document.querySelector(".toolbar").offsetHeight;
    const chatHeight = document.querySelector(".chatBox").offsetHeight;

    document.querySelector(".chatBox").style.top = toolbarHeight + "px";

    canvas.style.top = (toolbarHeight + chatHeight) + "px";
    canvas.style.height =
        (window.innerHeight - toolbarHeight - chatHeight) + "px";
    canvas.style.width = "100vw";

    const bgLayer = document.getElementById("bgLayer");
    bgLayer.style.top = canvas.style.top;
    bgLayer.style.height = canvas.style.height;
    bgLayer.style.width = "100vw";
}

resizeCanvasArea();
window.addEventListener("resize", resizeCanvasArea);

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

socket.on("updateBackground", (imageData) => {
    document.getElementById("bgLayer").style.backgroundImage =
        `url(${imageData})`;
});

socket.on("backgroundChanged", (data) => {
    const box = document.getElementById("messages");
    const div = document.createElement("div");
    div.innerHTML = `<i>${data.name} changed the public background</i>`;
    box.appendChild(div);
    setTimeout(() => div.remove(), 30000);
});

document.getElementById("bgUpload").addEventListener("change", function () {

    if (currentRoom !== "public") return;

    const file = this.files[0];
    if (!file) return;

    const reader = new FileReader();

    reader.onload = function (e) {
        const img = new Image();
        img.onload = function () {
            const tempCanvas = document.createElement("canvas");
            const tctx = tempCanvas.getContext("2d");

            tempCanvas.width = 900;
            tempCanvas.height = 1600;

            tctx.drawImage(img, 0, 0, 900, 1600);

            const compressed = tempCanvas.toDataURL("image/jpeg", 0.7);

            socket.emit("setBackground", {
                pin: "public",
                imageData: compressed
            });
        };
        img.src = e.target.result;
    };

    reader.readAsDataURL(file);
});

function clearBoard() {
    socket.emit("clearBoard", currentRoom);
}

function sendMessage() {
    const input = document.getElementById("chatInput");
    const message = input.value.trim();
    if (!message) return;
    socket.emit("chatMessage", { pin: currentRoom, message });
    input.value = "";
}