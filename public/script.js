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
let currentTool = "brush"; // pen | marker | highlighter | calligraphy | eraser | rect | circle | line
let userName = "";

let shapeStart = null;
let previewSnapshot = null;
let strokeSnapshot = null;

let undoStack = [];
let redoStack = [];
const MAX_UNDO = 30;

let points = [];
let lastEmitX = 0, lastEmitY = 0;
const EMIT_THRESHOLD = 1;
let currentStrokeId = 0;

// Remote stroke tracking: uid_sid -> last point
const remoteStrokes = {};

/* ===== Canvas ===== */
function resizeCanvas() {
    canvas.style.cssText = "position:fixed;top:0;left:0;width:100vw;height:100vh;";
}
resizeCanvas();
window.addEventListener("resize", resizeCanvas);

/* ===== Name Modal ===== */
window.addEventListener("load", () => {
    const el = document.getElementById("nameInput");
    if (el) el.focus();
});

function submitName() {
    const input = document.getElementById("nameInput");
    userName = input.value.trim() || "Guest";
    document.getElementById("nameModal").classList.add("hidden");
    joinRoomSocket("public");
}

document.getElementById("nameInput")?.addEventListener("keydown", e => {
    if (e.key === "Enter") submitName();
});

function joinRoomSocket(pin) {
    currentRoom = pin;
    socket.emit("joinRoom", { pin, name: userName });
}

/* ===== Position ===== */
function getPos(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    return {
        x: (clientX - rect.left) * (canvas.width / rect.width),
        y: (clientY - rect.top) * (canvas.height / rect.height)
    };
}

/* ===== Brush type styles ===== */
function applyBrushStyle(tool, c, size) {
    ctx.strokeStyle = c;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    if (tool === "brush" || tool === "pen") {
        ctx.lineWidth = size;
        ctx.globalAlpha = 1;
        ctx.shadowBlur = 0;

    } else if (tool === "marker") {
        ctx.lineWidth = size * 3.5;
        ctx.globalAlpha = 0.85;
        ctx.lineCap = "square";
        ctx.shadowBlur = 0;

    } else if (tool === "highlighter") {
        ctx.lineWidth = size * 6;
        ctx.globalAlpha = 0.3;
        ctx.lineCap = "square";
        ctx.shadowBlur = 0;

    } else if (tool === "calligraphy") {
        ctx.lineWidth = size;
        ctx.globalAlpha = 1;
        ctx.lineCap = "butt";
        ctx.shadowBlur = 0;

    } else if (tool === "eraser") {
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = size * 4;
        ctx.globalAlpha = 1;
        ctx.lineCap = "round";
        ctx.shadowBlur = 0;
    }
}

function resetCtx() {
    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
}

/* ===== Draw helpers ===== */
function drawFullStroke(pts, tool, c, size) {
    if (pts.length < 2) return;
    applyBrushStyle(tool, c, size);
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);

    if (tool === "calligraphy") {
        // Calligraphy: varying width based on direction
        for (let i = 1; i < pts.length; i++) {
            const dx = pts[i].x - pts[i-1].x;
            const dy = pts[i].y - pts[i-1].y;
            const angle = Math.atan2(dy, dx);
            ctx.lineWidth = size * (1 + Math.abs(Math.sin(angle)) * 3);
            ctx.beginPath();
            ctx.moveTo(pts[i-1].x, pts[i-1].y);
            ctx.lineTo(pts[i].x, pts[i].y);
            ctx.stroke();
        }
    } else if (pts.length === 2) {
        ctx.lineTo(pts[1].x, pts[1].y);
        ctx.stroke();
    } else {
        for (let i = 1; i < pts.length - 1; i++) {
            const midX = (pts[i].x + pts[i+1].x) / 2;
            const midY = (pts[i].y + pts[i+1].y) / 2;
            ctx.quadraticCurveTo(pts[i].x, pts[i].y, midX, midY);
        }
        ctx.lineTo(pts[pts.length - 1].x, pts[pts.length - 1].y);
        ctx.stroke();
    }
    resetCtx();
}

function drawLine(x0, y0, x1, y1, c, size) {
    ctx.strokeStyle = c; ctx.lineWidth = size;
    ctx.lineCap = "round"; ctx.lineJoin = "round";
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
}

function drawRect(x0, y0, x1, y1, c, size) {
    ctx.strokeStyle = c; ctx.lineWidth = size; ctx.lineJoin = "round";
    ctx.beginPath(); ctx.strokeRect(x0, y0, x1-x0, y1-y0);
}

function drawCircle(x0, y0, x1, y1, c, size) {
    const cx = (x0+x1)/2, cy = (y0+y1)/2;
    const rx = Math.abs(x1-x0)/2, ry = Math.abs(y1-y0)/2;
    ctx.strokeStyle = c; ctx.lineWidth = size;
    ctx.beginPath(); ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI*2); ctx.stroke();
}

/* ===== Remote stroke render ===== */
function renderStroke(s) {
    const tool = s.brushType || "brush";

    if (tool === "brush" || tool === "pen" || tool === "marker" ||
        tool === "highlighter" || tool === "calligraphy" || tool === "eraser" || !s.type || s.type === "brush") {

        const key = (s.uid || "r") + "_" + (s.sid || "0");
        const prev = remoteStrokes[key];

        applyBrushStyle(tool, s.color, s.size);
        ctx.beginPath();

        if (prev) {
            ctx.moveTo(prev.x, prev.y);
            if (tool === "calligraphy") {
                const dx = s.x1 - s.x0, dy = s.y1 - s.y0;
                const angle = Math.atan2(dy, dx);
                ctx.lineWidth = s.size * (1 + Math.abs(Math.sin(angle)) * 3);
                ctx.lineTo(s.x1, s.y1);
            } else {
                const midX = (s.x0 + s.x1) / 2;
                const midY = (s.y0 + s.y1) / 2;
                ctx.quadraticCurveTo(s.x0, s.y0, midX, midY);
            }
        } else {
            ctx.moveTo(s.x0, s.y0);
            ctx.lineTo(s.x1, s.y1);
        }
        ctx.stroke();
        resetCtx();

        remoteStrokes[key] = { x: s.x1, y: s.y1 };

    } else if (s.type === "rect") {
        drawRect(s.x0, s.y0, s.x1, s.y1, s.color, s.size);
    } else if (s.type === "circle") {
        drawCircle(s.x0, s.y0, s.x1, s.y1, s.color, s.size);
    } else if (s.type === "shape-line") {
        drawLine(s.x0, s.y0, s.x1, s.y1, s.color, s.size);
    }
}

/* ===== Undo / Redo ===== */
function saveSnapshot() {
    undoStack.push(ctx.getImageData(0, 0, canvas.width, canvas.height));
    if (undoStack.length > MAX_UNDO) undoStack.shift();
    redoStack = [];
}

function undoAction() {
    if (!undoStack.length) return;
    redoStack.push(ctx.getImageData(0, 0, canvas.width, canvas.height));
    ctx.putImageData(undoStack.pop(), 0, 0);
    // Sync undo to all users in room
    socket.emit("syncUndo", { pin: currentRoom });
}

function redoAction() {
    if (!redoStack.length) return;
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

/* ===== Drawing ===== */
function isBrushTool(t) {
    return ["brush", "pen", "marker", "highlighter", "calligraphy", "eraser"].includes(t);
}

function startDraw(clientX, clientY) {
    drawing = true;
    const pos = getPos(clientX, clientY);
    if (isBrushTool(currentTool)) {
        saveSnapshot();
        strokeSnapshot = ctx.getImageData(0, 0, canvas.width, canvas.height);
        currentStrokeId++;
        points = [pos];
        lastEmitX = pos.x;
        lastEmitY = pos.y;
    } else {
        saveSnapshot();
        shapeStart = pos;
        previewSnapshot = ctx.getImageData(0, 0, canvas.width, canvas.height);
    }
}

function moveDraw(clientX, clientY) {
    if (!drawing) return;
    const pos = getPos(clientX, clientY);
    const drawColor = currentTool === "eraser" ? "#ffffff" : color;

    if (isBrushTool(currentTool)) {
        points.push(pos);
        if (strokeSnapshot) ctx.putImageData(strokeSnapshot, 0, 0);
        drawFullStroke(points, currentTool, drawColor, brushSize);

        const dx = pos.x - lastEmitX, dy = pos.y - lastEmitY;
        if (Math.sqrt(dx*dx + dy*dy) >= EMIT_THRESHOLD) {
            const prev = points[points.length - 2];
            socket.emit("draw", {
                pin: currentRoom,
                stroke: {
                    type: "brush",
                    brushType: currentTool,
                    x0: prev.x, y0: prev.y,
                    x1: pos.x, y1: pos.y,
                    color: drawColor,
                    size: brushSize,
                    sid: currentStrokeId
                }
            });
            lastEmitX = pos.x; lastEmitY = pos.y;
        }
    } else if (shapeStart && previewSnapshot) {
        ctx.putImageData(previewSnapshot, 0, 0);
        if (currentTool === "rect")   drawRect(shapeStart.x, shapeStart.y, pos.x, pos.y, color, brushSize);
        if (currentTool === "circle") drawCircle(shapeStart.x, shapeStart.y, pos.x, pos.y, color, brushSize);
        if (currentTool === "line")   drawLine(shapeStart.x, shapeStart.y, pos.x, pos.y, color, brushSize);
    }
}

function endDraw(clientX, clientY) {
    if (!drawing) return;
    drawing = false;
    if (!isBrushTool(currentTool) && shapeStart) {
        const pos = getPos(clientX, clientY);
        const typeMap = { rect: "rect", circle: "circle", line: "shape-line" };
        ctx.putImageData(previewSnapshot, 0, 0);
        if (currentTool === "rect")   drawRect(shapeStart.x, shapeStart.y, pos.x, pos.y, color, brushSize);
        if (currentTool === "circle") drawCircle(shapeStart.x, shapeStart.y, pos.x, pos.y, color, brushSize);
        if (currentTool === "line")   drawLine(shapeStart.x, shapeStart.y, pos.x, pos.y, color, brushSize);
        socket.emit("draw", { pin: currentRoom, stroke: { type: typeMap[currentTool], x0: shapeStart.x, y0: shapeStart.y, x1: pos.x, y1: pos.y, color, size: brushSize } });
        shapeStart = null; previewSnapshot = null;
    } else {
        socket.emit("strokeEnd", { pin: currentRoom, sid: currentStrokeId });
    }
    points = []; strokeSnapshot = null;
}

function cancelDraw() {
    if (drawing) socket.emit("strokeEnd", { pin: currentRoom, sid: currentStrokeId });
    drawing = false; points = []; strokeSnapshot = null;
}

/* ===== Canvas events ===== */
canvas.addEventListener("mousedown",   e => startDraw(e.clientX, e.clientY));
canvas.addEventListener("mousemove",   e => moveDraw(e.clientX, e.clientY));
canvas.addEventListener("mouseup",     e => endDraw(e.clientX, e.clientY));
canvas.addEventListener("mouseleave",  () => cancelDraw());
canvas.addEventListener("touchstart",  e => { e.preventDefault(); const t=e.touches[0]; startDraw(t.clientX, t.clientY); }, { passive: false });
canvas.addEventListener("touchmove",   e => { e.preventDefault(); const t=e.touches[0]; moveDraw(t.clientX, t.clientY); },  { passive: false });
canvas.addEventListener("touchend",    e => { const t=e.changedTouches[0]; endDraw(t.clientX, t.clientY); });
canvas.addEventListener("touchcancel", () => cancelDraw());

/* ===== Socket events ===== */
socket.on("draw", stroke => renderStroke(stroke));

socket.on("strokeEnd", ({ uid, sid }) => {
    delete remoteStrokes[(uid||"r")+"_"+(sid||"0")];
});

// Undo sync — server sends back the full strokes list, we re-render
socket.on("undoSync", (strokes) => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    Object.keys(remoteStrokes).forEach(k => delete remoteStrokes[k]);
    strokes.forEach(s => {
        if (s.type === "brush" || !s.type) drawLine(s.x0, s.y0, s.x1, s.y1, s.color, s.size);
        else if (s.type === "rect")       drawRect(s.x0, s.y0, s.x1, s.y1, s.color, s.size);
        else if (s.type === "circle")     drawCircle(s.x0, s.y0, s.x1, s.y1, s.color, s.size);
        else if (s.type === "shape-line") drawLine(s.x0, s.y0, s.x1, s.y1, s.color, s.size);
    });
});

socket.on("loadStrokes", strokes => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    Object.keys(remoteStrokes).forEach(k => delete remoteStrokes[k]);
    strokes.forEach(s => {
        if (s.type === "brush" || !s.type) drawLine(s.x0, s.y0, s.x1, s.y1, s.color, s.size);
        else if (s.type === "rect")       drawRect(s.x0, s.y0, s.x1, s.y1, s.color, s.size);
        else if (s.type === "circle")     drawCircle(s.x0, s.y0, s.x1, s.y1, s.color, s.size);
        else if (s.type === "shape-line") drawLine(s.x0, s.y0, s.x1, s.y1, s.color, s.size);
    });
});

socket.on("clearBoard", () => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    undoStack = []; redoStack = [];
    Object.keys(remoteStrokes).forEach(k => delete remoteStrokes[k]);
});

socket.on("updateUsers", users => {
    const el = document.getElementById("userCount");
    if (el) el.innerText = "● " + users.length;
});

socket.on("chatMessage", data => {
    const box = document.getElementById("messages");
    const div = document.createElement("div");
    div.innerHTML = `<b>${data.name}:</b> ${data.message}`;
    box.appendChild(div);
    box.scrollTop = box.scrollHeight;
    setTimeout(() => div.remove(), 30000);
});

/* ===== Clear ===== */
function clearBoard() {
    if (!confirm("Clear the entire board?")) return;
    socket.emit("clearBoard", currentRoom);
}

/* ===== Chat ===== */
function sendMessage() {
    const input = document.getElementById("chatInput");
    const message = input.value.trim();
    if (!message) return;
    socket.emit("chatMessage", { pin: currentRoom, message });
    input.value = "";
}

function toggleChat() {
    const box = document.getElementById("chatBox");
    const chevron = document.getElementById("chatChevron");
    box.classList.toggle("collapsed");
    if (chevron) chevron.style.transform = box.classList.contains("collapsed") ? "rotate(180deg)" : "";
}

/* ===== Color & Size ===== */
document.getElementById("colorPicker").addEventListener("input", e => { color = e.target.value; });

document.getElementById("brushSize").addEventListener("input", e => {
    brushSize = parseInt(e.target.value);
    const sl = document.getElementById("sizeLabel");
    const sp = document.getElementById("sizePopupVal");
    if (sl) sl.textContent = brushSize;
    if (sp) sp.textContent = brushSize;
});

function openSizePopup()  { document.getElementById("sizePopup").classList.remove("hidden"); }
function closeSizePopup() { document.getElementById("sizePopup").classList.add("hidden"); }

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
    const pinInput = overlay.querySelector("#roomPinInput");
    pinInput.focus();
    overlay.querySelector("#roomConfirmBtn").onclick = () => {
        const pin = pinInput.value.trim();
        if (!pin) return;
        overlay.remove();
        callback(pin);
    };
    pinInput.addEventListener("keydown", e => { if (e.key === "Enter") overlay.querySelector("#roomConfirmBtn").click(); });
}

function updateRoomLabel(pin) {
    const el = document.getElementById("roomInfo");
    if (el) { el.textContent = pin.slice(0, 6); el.title = "Room: " + pin; }
}

function createRoom() {
    showRoomModal("Create New Room", pin => { joinRoomSocket(pin); updateRoomLabel(pin); });
}

function joinRoom() {
    showRoomModal("Join Room", pin => { joinRoomSocket(pin); updateRoomLabel(pin); });
}

function quitRoom() {
    joinRoomSocket("public");
    updateRoomLabel("pub");
}

/* ===== Keyboard shortcuts ===== */
document.addEventListener("keydown", e => {
    if (e.target.tagName === "INPUT") return;
    if ((e.ctrlKey||e.metaKey) && e.key === "z") { e.preventDefault(); undoAction(); }
    if ((e.ctrlKey||e.metaKey) && (e.key === "y" || (e.shiftKey && e.key === "z"))) { e.preventDefault(); redoAction(); }
    if (e.key === "b") setTool("brush");
    if (e.key === "m") setTool("marker");
    if (e.key === "h") setTool("highlighter");
    if (e.key === "e") setTool("eraser");
    if (e.key === "r") setTool("rect");
    if (e.key === "c") setTool("circle");
    if (e.key === "l") setTool("line");
});
    
