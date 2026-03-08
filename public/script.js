const socket = io();
const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");

const BOARD_WIDTH = 1600;
const BOARD_HEIGHT = 3200;

canvas.width = BOARD_WIDTH;
canvas.height = BOARD_HEIGHT;

let drawing = false;
let color = "#000000";
let brushSize = 3;
let currentRoom = "public";
let currentTool = "brush"; // brush | eraser | rect | circle | line
let userName = "";

// Shape preview
let shapeStart = null;
let previewSnapshot = null;

// Undo/Redo stacks (store canvas ImageData)
let undoStack = [];
let redoStack = [];
const MAX_UNDO = 40;

/* ===== Name Modal ===== */
window.addEventListener("load", () => {
    document.getElementById("nameInput").focus();
});

function submitName() {
    const input = document.getElementById("nameInput");
    userName = input.value.trim() || "Guest";
    document.getElementById("nameModal").classList.add("hidden");
    socket.emit("joinRoom", { pin: "public", name: userName });
}

document.getElementById("nameInput")?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") submitName();
});

/* ===== Resize ===== */
function resizeCanvas() {
    const toolbarH = document.getElementById("toolbar").offsetHeight;
    canvas.style.top = toolbarH + "px";
    canvas.style.left = "0px";
    canvas.style.width = "100vw";
    canvas.style.height = (window.innerHeight - toolbarH) + "px";
}

resizeCanvas();
window.addEventListener("resize", resizeCanvas);

/* ===== Position ===== */
function getPos(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    return {
        x: (clientX - rect.left) * (canvas.width / rect.width),
        y: (clientY - rect.top) * (canvas.height / rect.height)
    };
}

/* ===== Draw helpers ===== */
function drawLine(x0, y0, x1, y1, c, size) {
    ctx.strokeStyle = c;
    ctx.lineWidth = size;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
}

function drawRect(x0, y0, x1, y1, c, size) {
    ctx.strokeStyle = c;
    ctx.lineWidth = size;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
}

function drawCircle(x0, y0, x1, y1, c, size) {
    const cx = (x0 + x1) / 2;
    const cy = (y0 + y1) / 2;
    const rx = Math.abs(x1 - x0) / 2;
    const ry = Math.abs(y1 - y0) / 2;
    ctx.strokeStyle = c;
    ctx.lineWidth = size;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
    ctx.stroke();
}

/* ===== Undo/Redo ===== */
function saveSnapshot() {
    undoStack.push(ctx.getImageData(0, 0, canvas.width, canvas.height));
    if (undoStack.length > MAX_UNDO) undoStack.shift();
    redoStack = [];
}

function undoAction() {
    if (undoStack.length === 0) return;
    redoStack.push(ctx.getImageData(0, 0, canvas.width, canvas.height));
    ctx.putImageData(undoStack.pop(), 0, 0);
}

function redoAction() {
    if (redoStack.length === 0) return;
    undoStack.push(ctx.getImageData(0, 0, canvas.width, canvas.height));
    ctx.putImageData(redoStack.pop(), 0, 0);
}

/* ===== Tool selection ===== */
function setTool(tool) {
    currentTool = tool;
    document.querySelectorAll(".tool-btn").forEach(b => b.classList.remove("active"));
    const btn = document.getElementById("btn-" + tool);
    if (btn) btn.classList.add("active");
}

function setBrush() { setTool("brush"); }
function setEraser() { setTool("eraser"); }

/* ===== Mouse Events ===== */
let lastX, lastY;

canvas.addEventListener("mousedown", (e) => {
    drawing = true;
    const pos = getPos(e.clientX, e.clientY);
    lastX = pos.x;
    lastY = pos.y;

    if (currentTool === "rect" || currentTool === "circle" || currentTool === "line") {
        saveSnapshot();
        shapeStart = pos;
        previewSnapshot = ctx.getImageData(0, 0, canvas.width, canvas.height);
    } else {
        saveSnapshot();
    }
});

canvas.addEventListener("mousemove", (e) => {
    if (!drawing) return;
    const pos = getPos(e.clientX, e.clientY);
    const drawColor = currentTool === "eraser" ? "#ffffff" : color;

    if (currentTool === "brush" || currentTool === "eraser") {
        drawLine(lastX, lastY, pos.x, pos.y, drawColor, brushSize);
        socket.emit("draw", {
            pin: currentRoom,
            stroke: { type: "line", x0: lastX, y0: lastY, x1: pos.x, y1: pos.y, color: drawColor, size: brushSize }
        });
        lastX = pos.x;
        lastY = pos.y;
    } else if (shapeStart && previewSnapshot) {
        ctx.putImageData(previewSnapshot, 0, 0);
        if (currentTool === "rect") drawRect(shapeStart.x, shapeStart.y, pos.x, pos.y, color, brushSize);
        else if (currentTool === "circle") drawCircle(shapeStart.x, shapeStart.y, pos.x, pos.y, color, brushSize);
        else if (currentTool === "line") drawLine(shapeStart.x, shapeStart.y, pos.x, pos.y, color, brushSize);
    }
});

canvas.addEventListener("mouseup", (e) => {
    if (!drawing) return;
    drawing = false;
    const pos = getPos(e.clientX, e.clientY);

    if ((currentTool === "rect" || currentTool === "circle" || currentTool === "line") && shapeStart) {
        socket.emit("draw", {
            pin: currentRoom,
            stroke: { type: currentTool, x0: shapeStart.x, y0: shapeStart.y, x1: pos.x, y1: pos.y, color, size: brushSize }
        });
        shapeStart = null;
        previewSnapshot = null;
    }
});

canvas.addEventListener("mouseleave", () => { drawing = false; });

/* ===== Touch Events ===== */
canvas.addEventListener("touchstart", (e) => {
    e.preventDefault();
    drawing = true;
    const touch = e.touches[0];
    const pos = getPos(touch.clientX, touch.clientY);
    lastX = pos.x;
    lastY = pos.y;

    if (currentTool === "rect" || currentTool === "circle" || currentTool === "line") {
        saveSnapshot();
        shapeStart = pos;
        previewSnapshot = ctx.getImageData(0, 0, canvas.width, canvas.height);
    } else {
        saveSnapshot();
    }
}, { passive: false });

canvas.addEventListener("touchmove", (e) => {
    e.preventDefault();
    if (!drawing) return;
    const touch = e.touches[0];
    const pos = getPos(touch.clientX, touch.clientY);
    const drawColor = currentTool === "eraser" ? "#ffffff" : color;

    if (currentTool === "brush" || currentTool === "eraser") {
        drawLine(lastX, lastY, pos.x, pos.y, drawColor, brushSize);
        socket.emit("draw", {
            pin: currentRoom,
            stroke: { type: "line", x0: lastX, y0: lastY, x1: pos.x, y1: pos.y, color: drawColor, size: brushSize }
        });
        lastX = pos.x;
        lastY = pos.y;
    } else if (shapeStart && previewSnapshot) {
        ctx.putImageData(previewSnapshot, 0, 0);
        if (currentTool === "rect") drawRect(shapeStart.x, shapeStart.y, pos.x, pos.y, color, brushSize);
        else if (currentTool === "circle") drawCircle(shapeStart.x, shapeStart.y, pos.x, pos.y, color, brushSize);
        else if (currentTool === "line") drawLine(shapeStart.x, shapeStart.y, pos.x, pos.y, color, brushSize);
    }
}, { passive: false });

canvas.addEventListener("touchend", (e) => {
    if (!drawing) return;
    drawing = false;

    if ((currentTool === "rect" || currentTool === "circle" || currentTool === "line") && shapeStart) {
        const touch = e.changedTouches[0];
        const pos = getPos(touch.clientX, touch.clientY);
        socket.emit("draw", {
            pin: currentRoom,
            stroke: { type: currentTool, x0: shapeStart.x, y0: shapeStart.y, x1: pos.x, y1: pos.y, color, size: brushSize }
        });
        shapeStart = null;
        previewSnapshot = null;
    }
});

/* ===== Render incoming stroke ===== */
function renderStroke(s) {
    if (!s.type || s.type === "line") {
        drawLine(s.x0, s.y0, s.x1, s.y1, s.color, s.size);
    } else if (s.type === "rect") {
        drawRect(s.x0, s.y0, s.x1, s.y1, s.color, s.size);
    } else if (s.type === "circle") {
        drawCircle(s.x0, s.y0, s.x1, s.y1, s.color, s.size);
    }
}

/* ===== Clear ===== */
function clearBoard() {
    if (!confirm("Clear the entire board?")) return;
    socket.emit("clearBoard", currentRoom);
}

socket.on("clearBoard", () => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    undoStack = [];
    redoStack = [];
});

/* ===== Socket receive ===== */
socket.on("draw", (stroke) => {
    renderStroke(stroke);
});

socket.on("loadStrokes", (strokes) => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    strokes.forEach(s => renderStroke(s));
});

socket.on("updateUsers", (users) => {
    document.getElementById("userCount").innerText = "● " + users.length + " online";
});

/* ===== Chat ===== */
function sendMessage() {
    const input = document.getElementById("chatInput");
    const message = input.value.trim();
    if (!message) return;
    socket.emit("chatMessage", { pin: currentRoom, message });
    input.value = "";
}

socket.on("chatMessage", (data) => {
    const box = document.getElementById("messages");
    const div = document.createElement("div");
    div.innerHTML = `<b>${data.name}:</b> ${data.message}`;
    box.appendChild(div);
    box.scrollTop = box.scrollHeight;
    setTimeout(() => div.remove(), 30000);
});

function toggleChat() {
    document.getElementById("chatBox").classList.toggle("collapsed");
    const chevron = document.getElementById("chatChevron");
    chevron.style.transform = document.getElementById("chatBox").classList.contains("collapsed")
        ? "rotate(180deg)" : "";
}

/* ===== Color + Size ===== */
document.getElementById("colorPicker").addEventListener("input", e => {
    color = e.target.value;
});

document.getElementById("brushSize").addEventListener("input", e => {
    brushSize = parseInt(e.target.value);
    document.getElementById("sizeLabel").textContent = brushSize + "px";
});

/* ===== Rooms ===== */
function showRoomModal(title, callback) {
    const overlay = document.createElement("div");
    overlay.className = "room-modal";
    overlay.innerHTML = `
        <div class="room-modal-box">
            <h3>${title}</h3>
            <input type="text" id="roomPinInput" placeholder="Enter room PIN..." maxlength="20">
            <div class="room-modal-actions">
                <button class="btn-cancel" onclick="this.closest('.room-modal').remove()">Cancel</button>
                <button class="btn-confirm" id="roomConfirmBtn">Confirm</button>
            </div>
        </div>`;
    document.body.appendChild(overlay);
    overlay.querySelector("#roomPinInput").focus();
    overlay.querySelector("#roomConfirmBtn").onclick = () => {
        const pin = overlay.querySelector("#roomPinInput").value.trim();
        if (!pin) return;
        overlay.remove();
        callback(pin);
    };
    overlay.querySelector("#roomPinInput").addEventListener("keydown", (e) => {
        if (e.key === "Enter") overlay.querySelector("#roomConfirmBtn").click();
    });
}

function createRoom() {
    showRoomModal("Create New Room", (pin) => {
        currentRoom = pin;
        socket.emit("joinRoom", { pin, name: userName });
        document.getElementById("roomInfo").textContent = "📌 " + pin;
    });
}

function joinRoom() {
    showRoomModal("Join Room", (pin) => {
        currentRoom = pin;
        socket.emit("joinRoom", { pin, name: userName });
        document.getElementById("roomInfo").textContent = "📌 " + pin;
    });
}

function quitRoom() {
    currentRoom = "public";
    socket.emit("joinRoom", { pin: "public", name: userName });
    document.getElementById("roomInfo").textContent = "📌 public";
}

/* ===== Keyboard shortcuts ===== */
document.addEventListener("keydown", (e) => {
    if (e.target.tagName === "INPUT") return;
    if ((e.ctrlKey || e.metaKey) && e.key === "z") { e.preventDefault(); undoAction(); }
    if ((e.ctrlKey || e.metaKey) && (e.key === "y" || (e.shiftKey && e.key === "z"))) { e.preventDefault(); redoAction(); }
    if (e.key === "b") setTool("brush");
    if (e.key === "e") setTool("eraser");
    if (e.key === "r") setTool("rect");
    if (e.key === "c") setTool("circle");
    if (e.key === "l") setTool("line");
});
