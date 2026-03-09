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
let currentTool = "brush";
let userName = "";

// Shape preview
let shapeStart = null;
let previewSnapshot = null;

// Undo/Redo
let undoStack = [];
let redoStack = [];
const MAX_UNDO = 40;

// Smooth brush - point buffer
let points = [];
let lastEmitX = 0, lastEmitY = 0;
const EMIT_THRESHOLD = 1;
let currentStrokeId = 0;

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
    canvas.style.top = "0px";
    canvas.style.left = "0px";
    canvas.style.width = "100vw";
    canvas.style.height = "100vh";
    canvas.style.position = "fixed";
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

/* ===== Smooth Brush (full stroke redraw) ===== */
// Snapshot taken BEFORE stroke starts — we redraw full smooth path each move
let strokeSnapshot = null;

function drawFullStroke(pts, c, size) {
    if (pts.length < 2) return;
    ctx.strokeStyle = c;
    ctx.lineWidth = size;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);

    if (pts.length === 2) {
        ctx.lineTo(pts[1].x, pts[1].y);
    } else {
        // Mid-point smoothing over ALL collected points
        for (let i = 1; i < pts.length - 1; i++) {
            const midX = (pts[i].x + pts[i + 1].x) / 2;
            const midY = (pts[i].y + pts[i + 1].y) / 2;
            ctx.quadraticCurveTo(pts[i].x, pts[i].y, midX, midY);
        }
        ctx.lineTo(pts[pts.length - 1].x, pts[pts.length - 1].y);
    }
    ctx.stroke();
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
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
    ctx.stroke();
}

/* ===== Remote smooth rendering ===== */
// Buffer points per remote stroke (uid+sid), redraw full smooth path like local
const remoteStrokes = {};

/* ===== Render any stroke ===== */
function renderStroke(s) {
    if (s.type === "brush" || s.type === "line" || !s.type) {
        const key = (s.uid || "r") + "_" + (s.sid || "0");

        if (!remoteStrokes[key]) {
            // First segment of this stroke — snapshot current canvas as base
            remoteStrokes[key] = {
                points: [{ x: s.x0, y: s.y0 }],
                snapshot: ctx.getImageData(0, 0, canvas.width, canvas.height),
                color: s.color,
                size: s.size
            };
        }

        remoteStrokes[key].points.push({ x: s.x1, y: s.y1 });

        // Restore base snapshot + redraw full smooth stroke — identical to local rendering
        const rs = remoteStrokes[key];
        ctx.putImageData(rs.snapshot, 0, 0);
        drawFullStroke(rs.points, rs.color, rs.size);

    } else if (s.type === "rect") {
        drawRect(s.x0, s.y0, s.x1, s.y1, s.color, s.size);
        delete remoteStrokes[(s.uid||"r")+"_"+(s.sid||"0")];
    } else if (s.type === "circle") {
        drawCircle(s.x0, s.y0, s.x1, s.y1, s.color, s.size);
        delete remoteStrokes[(s.uid||"r")+"_"+(s.sid||"0")];
    } else if (s.type === "shape-line") {
        drawLine(s.x0, s.y0, s.x1, s.y1, s.color, s.size);
        delete remoteStrokes[(s.uid||"r")+"_"+(s.sid||"0")];
    }
}

// When remote user lifts pen — clear their buffer so next stroke starts fresh
socket.on("strokeEnd", ({ uid, sid }) => {
    delete remoteStrokes[(uid||"r")+"_"+(sid||"0")];
});

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

/* ===== START ===== */
function startDraw(clientX, clientY) {
    drawing = true;
    const pos = getPos(clientX, clientY);

    if (currentTool === "brush" || currentTool === "eraser") {
        saveSnapshot();
        strokeSnapshot = ctx.getImageData(0, 0, canvas.width, canvas.height);
        points = [pos];
        lastEmitX = pos.x;
        lastEmitY = pos.y;
        currentStrokeId++;
    } else {
        saveSnapshot();
        shapeStart = pos;
        previewSnapshot = ctx.getImageData(0, 0, canvas.width, canvas.height);
    }
}

/* ===== MOVE ===== */
function moveDraw(clientX, clientY) {
    if (!drawing) return;
    const pos = getPos(clientX, clientY);
    const drawColor = currentTool === "eraser" ? "#ffffff" : color;

    if (currentTool === "brush" || currentTool === "eraser") {
        points.push(pos);

        // Restore snapshot then redraw FULL smooth stroke from scratch
        if (strokeSnapshot) ctx.putImageData(strokeSnapshot, 0, 0);
        drawFullStroke(points, drawColor, brushSize);

        // Throttled emit
        const dx = pos.x - lastEmitX;
        const dy = pos.y - lastEmitY;
        if (Math.sqrt(dx * dx + dy * dy) >= EMIT_THRESHOLD) {
            const prev = points[points.length - 2];
            socket.emit("draw", {
                pin: currentRoom,
                stroke: {
                    type: "brush",
                    x0: prev.x, y0: prev.y,
                    x1: pos.x, y1: pos.y,
                    color: drawColor,
                    size: brushSize,
                    sid: currentStrokeId   // stroke session id for remote smooth tracking
                }
            });
            lastEmitX = pos.x;
            lastEmitY = pos.y;
        }

    } else if (shapeStart && previewSnapshot) {
        ctx.putImageData(previewSnapshot, 0, 0);
        if (currentTool === "rect") drawRect(shapeStart.x, shapeStart.y, pos.x, pos.y, color, brushSize);
        else if (currentTool === "circle") drawCircle(shapeStart.x, shapeStart.y, pos.x, pos.y, color, brushSize);
        else if (currentTool === "line") drawLine(shapeStart.x, shapeStart.y, pos.x, pos.y, color, brushSize);
    }
}

/* ===== END ===== */
function endDraw(clientX, clientY) {
    if (!drawing) return;
    drawing = false;

    if ((currentTool === "rect" || currentTool === "circle" || currentTool === "line") && shapeStart) {
        const pos = getPos(clientX, clientY);
        const typeMap = { rect: "rect", circle: "circle", line: "shape-line" };

        ctx.putImageData(previewSnapshot, 0, 0);
        if (currentTool === "rect") drawRect(shapeStart.x, shapeStart.y, pos.x, pos.y, color, brushSize);
        else if (currentTool === "circle") drawCircle(shapeStart.x, shapeStart.y, pos.x, pos.y, color, brushSize);
        else if (currentTool === "line") drawLine(shapeStart.x, shapeStart.y, pos.x, pos.y, color, brushSize);

        socket.emit("draw", {
            pin: currentRoom,
            stroke: {
                type: typeMap[currentTool],
                x0: shapeStart.x, y0: shapeStart.y,
                x1: pos.x, y1: pos.y,
                color, size: brushSize
            }
        });

        shapeStart = null;
        previewSnapshot = null;
    }

    points = [];
    strokeSnapshot = null;

    // Tell remote clients this stroke is done — so they clear their smooth buffer
    socket.emit("strokeEnd", { pin: currentRoom, sid: currentStrokeId });
}

/* ===== Mouse Events ===== */
canvas.addEventListener("mousedown",  (e) => startDraw(e.clientX, e.clientY));
canvas.addEventListener("mousemove",  (e) => moveDraw(e.clientX, e.clientY));
canvas.addEventListener("mouseup",    (e) => endDraw(e.clientX, e.clientY));
canvas.addEventListener("mouseleave", () => {
    if (drawing) socket.emit("strokeEnd", { pin: currentRoom, sid: currentStrokeId });
    drawing = false;
    points = [];
    strokeSnapshot = null;
});

/* ===== Touch Events ===== */
canvas.addEventListener("touchstart", (e) => {
    e.preventDefault();
    const t = e.touches[0];
    startDraw(t.clientX, t.clientY);
}, { passive: false });

canvas.addEventListener("touchmove", (e) => {
    e.preventDefault();
    const t = e.touches[0];
    moveDraw(t.clientX, t.clientY);
}, { passive: false });

canvas.addEventListener("touchend", (e) => {
    const t = e.changedTouches[0];
    endDraw(t.clientX, t.clientY);
});

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
    document.getElementById("chatChevron").style.transform =
        document.getElementById("chatBox").classList.contains("collapsed") ? "rotate(180deg)" : "";
}

/* ===== Color + Size ===== */
document.getElementById("colorPicker").addEventListener("input", e => {
    color = e.target.value;
});

document.getElementById("brushSize").addEventListener("input", e => {
    brushSize = parseInt(e.target.value);
    document.getElementById("sizeLabel").textContent = brushSize;
    document.getElementById("sizePopupVal").textContent = brushSize;
});

function openSizePopup() {
    document.getElementById("sizePopup").classList.remove("hidden");
}

function closeSizePopup() {
    document.getElementById("sizePopup").classList.add("hidden");
}

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
        document.getElementById("roomInfo").textContent = pin.slice(0,6);
        document.getElementById("roomInfo").title = "Room: " + pin;
    });
}

function joinRoom() {
    showRoomModal("Join Room", (pin) => {
        currentRoom = pin;
        socket.emit("joinRoom", { pin, name: userName });
        document.getElementById("roomInfo").textContent = pin.slice(0,6);
        document.getElementById("roomInfo").title = "Room: " + pin;
    });
}

function quitRoom() {
    currentRoom = "public";
    socket.emit("joinRoom", { pin: "public", name: userName });
    document.getElementById("roomInfo").textContent = "pub";
    document.getElementById("roomInfo").title = "Room: public";
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
    
