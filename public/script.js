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
let currentTool = "pen";
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

const remoteStrokes = {};

// Track last selected brush for submenu re-highlight
let lastBrushTool = "pen";
let lastBrushLabel = "Pen";

/* ===== Canvas ===== */
function resizeCanvas() {
    canvas.style.cssText = "position:fixed;top:0;left:0;width:100vw;height:100vh;touch-action:none;z-index:0;background:#fff;";
}
resizeCanvas();
window.addEventListener("resize", resizeCanvas);

/* ===== Name Modal ===== */
window.addEventListener("load", () => { document.getElementById("nameInput")?.focus(); });

function submitName() {
    userName = document.getElementById("nameInput").value.trim() || "Guest";
    document.getElementById("nameModal").style.display = "none"; // FIXED: direct style instead of classList
    joinRoomSocket("public");
}
document.getElementById("nameInput")?.addEventListener("keydown", e => { if (e.key === "Enter") submitName(); });

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

/* ===== Submenu toggle ===== */
function toggleSubmenu(id, event) {
    if (event) event.stopPropagation();
    const menu = document.getElementById(id);
    const isOpen = !menu.classList.contains("hidden");
    document.querySelectorAll(".submenu").forEach(m => m.classList.add("hidden"));
    if (!isOpen) {
        menu.classList.remove("hidden");
        if (id === "brush-menu") {
            document.getElementById("btn-eraser")?.classList.remove("active");
            document.getElementById("btn-shapes-group")?.classList.remove("active");
            document.getElementById("btn-brush-group")?.classList.add("active");
            document.querySelectorAll(".sub-btn").forEach(b => b.classList.remove("active"));
            document.getElementById("btn-" + lastBrushTool)?.classList.add("active");
        }
        if (id === "shapes-menu") {
            document.getElementById("btn-eraser")?.classList.remove("active");
            document.getElementById("btn-brush-group")?.classList.remove("active");
            document.getElementById("btn-shapes-group")?.classList.add("active");
        }
    }
}

document.addEventListener("click", e => {
    if (!e.target.closest(".toolbar")) {
        document.querySelectorAll(".submenu").forEach(m => m.classList.add("hidden"));
    }
});

function selectBrush(tool, label, event) {
    if (event) event.stopPropagation();
    currentTool = tool;
    lastBrushTool = tool;
    lastBrushLabel = label;
    document.querySelectorAll(".sub-btn").forEach(b => b.classList.remove("active"));
    document.getElementById("btn-" + tool)?.classList.add("active");
    document.getElementById("btn-brush-group").classList.add("active");
    document.getElementById("btn-shapes-group")?.classList.remove("active");
    document.getElementById("btn-eraser")?.classList.remove("active");
    document.getElementById("label-brush-group").textContent = label;
    document.getElementById("brush-menu").classList.add("hidden");
}

function selectShape(tool, label, event) {
    if (event) event.stopPropagation();
    currentTool = tool;
    document.querySelectorAll(".sub-btn").forEach(b => b.classList.remove("active"));
    document.getElementById("btn-" + tool)?.classList.add("active");
    document.getElementById("label-shapes-group").textContent = label;
    document.getElementById("btn-shapes-group").classList.add("active");
    document.getElementById("btn-brush-group")?.classList.remove("active");
    document.getElementById("btn-eraser")?.classList.remove("active");
    document.getElementById("shapes-menu").classList.add("hidden");
}

/* ===== Tool selection ===== */
function setTool(tool) {
    currentTool = tool;
    if (tool === "eraser") {
        document.getElementById("btn-eraser")?.classList.add("active");
        document.getElementById("btn-brush-group")?.classList.remove("active");
        document.getElementById("btn-shapes-group")?.classList.remove("active");
        document.querySelectorAll(".submenu").forEach(m => m.classList.add("hidden"));
    }
}

/* ===== Brush styles ===== */
function applyBrushStyle(tool, c, size) {
    ctx.strokeStyle = tool === "eraser" ? "#ffffff" : c;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;

    if (tool === "pen" || tool === "brush") {
        ctx.lineWidth = size;
    } else if (tool === "marker") {
        ctx.lineWidth = size * 3.5;
        ctx.globalAlpha = 0.82;
        ctx.lineCap = "square";
    } else if (tool === "highlighter") {
        ctx.lineWidth = size * 7;
        ctx.globalAlpha = 0.28;
        ctx.lineCap = "square";
    } else if (tool === "calligraphy") {
        ctx.lineWidth = size;
        ctx.lineCap = "butt";
    } else if (tool === "eraser") {
        ctx.lineWidth = size * 4;
    }
}

function resetCtx() { ctx.globalAlpha = 1; ctx.shadowBlur = 0; ctx.lineCap = "round"; ctx.lineJoin = "round"; }

/* ===== Draw helpers ===== */
function drawFullStroke(pts, tool, c, size) {
    if (pts.length < 2) return;

    if (tool === "calligraphy") {
        for (let i = 1; i < pts.length; i++) {
            const dx = pts[i].x - pts[i-1].x, dy = pts[i].y - pts[i-1].y;
            applyBrushStyle(tool, c, size);
            ctx.lineWidth = size * (1 + Math.abs(Math.sin(Math.atan2(dy, dx))) * 3);
            ctx.beginPath(); ctx.moveTo(pts[i-1].x, pts[i-1].y); ctx.lineTo(pts[i].x, pts[i].y); ctx.stroke();
        }
        resetCtx(); return;
    }

    applyBrushStyle(tool, c, size);
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    if (pts.length === 2) {
        ctx.lineTo(pts[1].x, pts[1].y);
    } else {
        for (let i = 1; i < pts.length - 1; i++) {
            const midX = (pts[i].x + pts[i+1].x) / 2;
            const midY = (pts[i].y + pts[i+1].y) / 2;
            ctx.quadraticCurveTo(pts[i].x, pts[i].y, midX, midY);
        }
        ctx.lineTo(pts[pts.length-1].x, pts[pts.length-1].y);
    }
    ctx.stroke();
    resetCtx();
}

function drawLine(x0, y0, x1, y1, c, size) {
    ctx.strokeStyle = c; ctx.lineWidth = size; ctx.lineCap = "round"; ctx.lineJoin = "round";
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

function drawTriangle(x0, y0, x1, y1, c, size) {
    const mx = (x0 + x1) / 2;
    ctx.strokeStyle = c; ctx.lineWidth = size; ctx.lineJoin = "round";
    ctx.beginPath(); ctx.moveTo(mx, y0); ctx.lineTo(x1, y1); ctx.lineTo(x0, y1); ctx.closePath(); ctx.stroke();
}

function drawArrow(x0, y0, x1, y1, c, size) {
    ctx.strokeStyle = c; ctx.lineWidth = size; ctx.lineCap = "round"; ctx.lineJoin = "round";
    const angle = Math.atan2(y1 - y0, x1 - x0);
    const headLen = Math.max(16, size * 4);
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x1 - headLen * Math.cos(angle - Math.PI/6), y1 - headLen * Math.sin(angle - Math.PI/6));
    ctx.moveTo(x1, y1);
    ctx.lineTo(x1 - headLen * Math.cos(angle + Math.PI/6), y1 - headLen * Math.sin(angle + Math.PI/6));
    ctx.stroke();
}

function drawStar(x0, y0, x1, y1, c, size) {
    const cx = (x0+x1)/2, cy = (y0+y1)/2;
    const outerR = Math.min(Math.abs(x1-x0), Math.abs(y1-y0)) / 2;
    const innerR = outerR * 0.4;
    const spikes = 5;
    ctx.strokeStyle = c; ctx.lineWidth = size; ctx.lineJoin = "round";
    ctx.beginPath();
    for (let i = 0; i < spikes * 2; i++) {
        const angle = (i * Math.PI) / spikes - Math.PI / 2;
        const r = i % 2 === 0 ? outerR : innerR;
        const x = cx + r * Math.cos(angle), y = cy + r * Math.sin(angle);
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.closePath(); ctx.stroke();
}

function drawShape(tool, x0, y0, x1, y1, c, size) {
    if (tool === "rect")     drawRect(x0, y0, x1, y1, c, size);
    if (tool === "circle")   drawCircle(x0, y0, x1, y1, c, size);
    if (tool === "line")     drawLine(x0, y0, x1, y1, c, size);
    if (tool === "triangle") drawTriangle(x0, y0, x1, y1, c, size);
    if (tool === "arrow")    drawArrow(x0, y0, x1, y1, c, size);
    if (tool === "star")     drawStar(x0, y0, x1, y1, c, size);
}

/* ===== Remote render ===== */
function renderStroke(s) {
    const tool = s.brushType || "pen";
    const isShape = ["rect","circle","line","triangle","arrow","star","shape-line"].includes(s.type);

    if (!isShape) {
        const key = (s.uid||"r") + "_" + (s.sid||"0");
        const prev = remoteStrokes[key];
        applyBrushStyle(tool, s.color, s.size);
        ctx.beginPath();
        if (prev) {
            ctx.moveTo(prev.x, prev.y);
            if (tool === "calligraphy") {
                const dx = s.x1-s.x0, dy = s.y1-s.y0;
                ctx.lineWidth = s.size * (1 + Math.abs(Math.sin(Math.atan2(dy,dx))) * 3);
                ctx.lineTo(s.x1, s.y1);
            } else {
                const midX = (s.x0+s.x1)/2, midY = (s.y0+s.y1)/2;
                ctx.quadraticCurveTo(s.x0, s.y0, midX, midY);
            }
        } else {
            ctx.moveTo(s.x0, s.y0); ctx.lineTo(s.x1, s.y1);
        }
        ctx.stroke();
        resetCtx();
        remoteStrokes[key] = { x: s.x1, y: s.y1 };
    } else {
        const type = s.type === "shape-line" ? "line" : s.type;
        drawShape(type, s.x0, s.y0, s.x1, s.y1, s.color, s.size);
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
    socket.emit("syncUndo", { pin: currentRoom });
}

function redoAction() {
    if (!redoStack.length) return;
    undoStack.push(ctx.getImageData(0, 0, canvas.width, canvas.height));
    ctx.putImageData(redoStack.pop(), 0, 0);
}

/* ===== Download ===== */
function downloadImage() {
    const link = document.createElement("a");
    link.download = "drawsync-" + Date.now() + ".png";
    link.href = canvas.toDataURL("image/png");
    link.click();
}

/* ===== Drawing ===== */
const BRUSH_TOOLS = ["pen", "brush", "marker", "highlighter", "calligraphy", "eraser"];
const SHAPE_TOOLS = ["rect", "circle", "line", "triangle", "arrow", "star"];

function startDraw(clientX, clientY) {
    drawing = true;
    const pos = getPos(clientX, clientY);
    if (BRUSH_TOOLS.includes(currentTool)) {
        saveSnapshot();
        strokeSnapshot = ctx.getImageData(0, 0, canvas.width, canvas.height);
        currentStrokeId++;
        points = [pos]; lastEmitX = pos.x; lastEmitY = pos.y;
    } else if (SHAPE_TOOLS.includes(currentTool)) {
        saveSnapshot();
        shapeStart = pos;
        previewSnapshot = ctx.getImageData(0, 0, canvas.width, canvas.height);
    }
}

function moveDraw(clientX, clientY) {
    if (!drawing) return;
    const pos = getPos(clientX, clientY);
    const drawColor = currentTool === "eraser" ? "#ffffff" : color;

    if (BRUSH_TOOLS.includes(currentTool)) {
        points.push(pos);
        if (strokeSnapshot) ctx.putImageData(strokeSnapshot, 0, 0);
        drawFullStroke(points, currentTool, drawColor, brushSize);

        const dx = pos.x - lastEmitX, dy = pos.y - lastEmitY;
        if (Math.sqrt(dx*dx + dy*dy) >= EMIT_THRESHOLD) {
            const prev = points[points.length - 2];
            socket.emit("draw", { pin: currentRoom, stroke: {
                type: "brush", brushType: currentTool,
                x0: prev.x, y0: prev.y, x1: pos.x, y1: pos.y,
                color: drawColor, size: brushSize, sid: currentStrokeId
            }});
            lastEmitX = pos.x; lastEmitY = pos.y;
        }
    } else if (SHAPE_TOOLS.includes(currentTool) && shapeStart && previewSnapshot) {
        ctx.putImageData(previewSnapshot, 0, 0);
        drawShape(currentTool, shapeStart.x, shapeStart.y, pos.x, pos.y, color, brushSize);
    }
}

function endDraw(clientX, clientY) {
    if (!drawing) return;
    drawing = false;

    if (SHAPE_TOOLS.includes(currentTool) && shapeStart) {
        const pos = getPos(clientX, clientY);
        ctx.putImageData(previewSnapshot, 0, 0);
        drawShape(currentTool, shapeStart.x, shapeStart.y, pos.x, pos.y, color, brushSize);
        socket.emit("draw", { pin: currentRoom, stroke: {
            type: currentTool, x0: shapeStart.x, y0: shapeStart.y,
            x1: pos.x, y1: pos.y, color, size: brushSize
        }});
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

socket.on("undoSync", strokes => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    Object.keys(remoteStrokes).forEach(k => delete remoteStrokes[k]);
    strokes.forEach(s => replayStroke(s));
});

socket.on("loadStrokes", strokes => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    Object.keys(remoteStrokes).forEach(k => delete remoteStrokes[k]);
    strokes.forEach(s => replayStroke(s));
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

function replayStroke(s) {
    const brushTool = s.brushType || "pen";
    const isShape = ["rect","circle","line","triangle","arrow","star","shape-line"].includes(s.type);
    if (isShape) {
        const type = s.type === "shape-line" ? "line" : s.type;
        drawShape(type, s.x0, s.y0, s.x1, s.y1, s.color, s.size);
        return;
    }
    // Apply correct brush style
    applyBrushStyle(brushTool, s.color, s.size);
    ctx.beginPath();
    ctx.moveTo(s.x0, s.y0);
    ctx.lineTo(s.x1, s.y1);
    ctx.stroke();
    resetCtx();
}

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
    document.getElementById("sizeLabel").textContent = brushSize;
    document.getElementById("sizePopupVal").textContent = brushSize;
});

function openSizePopup()  { document.getElementById("sizePopup").classList.remove("hidden"); }
function closeSizePopup() { document.getElementById("sizePopup").classList.add("hidden"); }

/* ===== Rooms ===== */
function showRoomModal(title, callback) {
    const overlay = document.createElement("div");
    overlay.className = "room-modal";
    overlay.innerHTML = `<div class="room-modal-box"><h3>${title}</h3>
        <input type="text" id="roomPinInput" placeholder="Enter room PIN..." maxlength="20">
        <div class="room-modal-actions">
            <button class="btn-cancel" onclick="this.closest('.room-modal').remove()">Cancel</button>
            <button class="btn-confirm" id="roomConfirmBtn">Confirm</button>
        </div></div>`;
    document.body.appendChild(overlay);
    const pinInput = overlay.querySelector("#roomPinInput");
    pinInput.focus();
    overlay.querySelector("#roomConfirmBtn").onclick = () => {
        const pin = pinInput.value.trim(); if (!pin) return;
        overlay.remove(); callback(pin);
    };
    pinInput.addEventListener("keydown", e => { if (e.key === "Enter") overlay.querySelector("#roomConfirmBtn").click(); });
}

function updateRoomLabel(pin) {
    const el = document.getElementById("roomInfo");
    if (el) { el.textContent = pin.slice(0, 6); el.title = "Room: " + pin; }
}

function createRoom() { showRoomModal("Create New Room", pin => { joinRoomSocket(pin); updateRoomLabel(pin); }); }
function joinRoom()   { showRoomModal("Join Room",       pin => { joinRoomSocket(pin); updateRoomLabel(pin); }); }
function quitRoom()   { joinRoomSocket("public"); updateRoomLabel("pub"); }

/* ===== Keyboard shortcuts ===== */
document.addEventListener("keydown", e => {
    if (e.target.tagName === "INPUT") return;
    if ((e.ctrlKey||e.metaKey) && e.key === "z") { e.preventDefault(); undoAction(); }
    if ((e.ctrlKey||e.metaKey) && (e.key === "y" || (e.shiftKey && e.key === "z"))) { e.preventDefault(); redoAction(); }
    if (e.key === "b") selectBrush("pen", "Pen", null);
    if (e.key === "e") setTool("eraser");
});

