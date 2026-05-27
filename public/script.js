const socket = io();
const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");

// ===== WORLD / VIEWPORT =====
const WORLD_SIZE = 10000;
let vpX = 0, vpY = 0; // viewport top-left in world coords
let zoom = 1;
const MIN_ZOOM = 0.1, MAX_ZOOM = 8;

// Convert screen px → world coords
function screenToWorld(sx, sy) {
    return {
        x: vpX + sx / zoom,
        y: vpY + sy / zoom
    };
}

// Convert world coords → screen px
function worldToScreen(wx, wy) {
    return {
        x: (wx - vpX) * zoom,
        y: (wy - vpY) * zoom
    };
}

function resizeCanvas() {
    // Simple resize - no DPR scaling to avoid box issue
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    canvas.style.cssText = "position:fixed;top:0;left:0;width:100vw;height:100vh;touch-action:none;z-index:0;background:#fff;";
    redrawAll();
}
window.addEventListener("resize", resizeCanvas);

// ===== STATE =====
let drawing = false;
let color = "#000000";
let brushSize = 3;
let currentRoom = "public";
let currentTool = "pen";
let userName = "";
let myColor = "#4d96ff";

let shapeStart = null;
let previewSnapshot = null;

let undoStack = [];
let redoStack = [];
const MAX_UNDO = 30;

let points = []; // world coords
let currentStrokeId = 0;
let allStrokes = []; // full stroke store for redraw
let activeLocalStrokes = {}; // uid_sid -> pts, for incremental local drawing

const remoteCursors = {}; // uid → { name, color, x, y (world) }
let cursorThrottle = 0;

// ===== PAN state =====
let isPanning = false;
let panStart = { x: 0, y: 0 };
let vpStart = { x: 0, y: 0 };

// ===== PINCH state =====
let lastPinchDist = 0;
let lastPinchMid = { x: 0, y: 0 };
let isPinching = false;

// ===== Name Modal =====
window.addEventListener("load", () => {
    document.getElementById("nameInput")?.focus();
    resizeCanvas();
});

function submitName() {
    userName = document.getElementById("nameInput").value.trim() || "Guest";
    document.getElementById("nameModal").style.display = "none";
    joinRoomSocket("public");
    initTutorial();
}
document.getElementById("nameInput")?.addEventListener("keydown", e => { if (e.key === "Enter") submitName(); });

function joinRoomSocket(pin) {
    currentRoom = pin;
    allStrokes = [];
    socket.emit("joinRoom", { pin, name: userName });
}

// ===== ZOOM helpers =====
function zoomAt(screenX, screenY, factor) {
    const before = screenToWorld(screenX, screenY);
    zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom * factor));
    const after = screenToWorld(screenX, screenY);
    vpX += before.x - after.x;
    vpY += before.y - after.y;
    redrawAll();
    updateMinimap();
}

// Mouse wheel zoom
canvas.addEventListener("wheel", e => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.1 : 0.9;
    zoomAt(e.clientX, e.clientY, factor);
}, { passive: false });

// ===== BRUSH STYLE =====
function applyBrushStyle(tool, c, size) {
    ctx.strokeStyle = tool === "eraser" ? "#ffffff" : c;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;
    ctx.lineWidth = tool === "eraser" ? size * 4 * zoom : size * zoom;
}

function resetCtx() {
    ctx.globalAlpha = 1; ctx.shadowBlur = 0;
    ctx.lineCap = "round"; ctx.lineJoin = "round";
}

// ===== DRAW HELPERS (world coords → screen) =====
function drawFullStrokeWorld(pts, tool, c, size) {
    if (pts.length < 2) return;
    const sp = pts.map(p => worldToScreen(p.x, p.y));
    applyBrushStyle(tool, c, size);
    ctx.beginPath();
    ctx.moveTo(sp[0].x, sp[0].y);
    if (sp.length === 2) {
        ctx.lineTo(sp[1].x, sp[1].y);
    } else {
        for (let i = 1; i < sp.length - 1; i++) {
            const midX = (sp[i].x + sp[i+1].x) / 2;
            const midY = (sp[i].y + sp[i+1].y) / 2;
            ctx.quadraticCurveTo(sp[i].x, sp[i].y, midX, midY);
        }
        ctx.lineTo(sp[sp.length-1].x, sp[sp.length-1].y);
    }
    ctx.stroke();
    resetCtx();
}

function drawShapeWorld(tool, wx0, wy0, wx1, wy1, c, size) {
    const p0 = worldToScreen(wx0, wy0);
    const p1 = worldToScreen(wx1, wy1);
    ctx.strokeStyle = c; ctx.lineWidth = size * zoom;
    ctx.lineCap = "round"; ctx.lineJoin = "round";

    if (tool === "rect") {
        ctx.beginPath(); ctx.strokeRect(p0.x, p0.y, p1.x-p0.x, p1.y-p0.y);
    } else if (tool === "circle") {
        const cx=(p0.x+p1.x)/2, cy=(p0.y+p1.y)/2;
        const rx=Math.abs(p1.x-p0.x)/2, ry=Math.abs(p1.y-p0.y)/2;
        ctx.beginPath(); ctx.ellipse(cx,cy,rx,ry,0,0,Math.PI*2); ctx.stroke();
    } else if (tool === "line") {
        ctx.beginPath(); ctx.moveTo(p0.x,p0.y); ctx.lineTo(p1.x,p1.y); ctx.stroke();
    } else if (tool === "triangle") {
        const mx=(p0.x+p1.x)/2;
        ctx.beginPath(); ctx.moveTo(mx,p0.y); ctx.lineTo(p1.x,p1.y); ctx.lineTo(p0.x,p1.y); ctx.closePath(); ctx.stroke();
    } else if (tool === "arrow") {
        const angle = Math.atan2(p1.y-p0.y, p1.x-p0.x);
        const headLen = Math.max(16, size*zoom*4);
        ctx.beginPath(); ctx.moveTo(p0.x,p0.y); ctx.lineTo(p1.x,p1.y); ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(p1.x,p1.y);
        ctx.lineTo(p1.x - headLen*Math.cos(angle-Math.PI/6), p1.y - headLen*Math.sin(angle-Math.PI/6));
        ctx.moveTo(p1.x,p1.y);
        ctx.lineTo(p1.x - headLen*Math.cos(angle+Math.PI/6), p1.y - headLen*Math.sin(angle+Math.PI/6));
        ctx.stroke();
    } else if (tool === "star") {
        const cx=(p0.x+p1.x)/2, cy=(p0.y+p1.y)/2;
        const outerR=Math.min(Math.abs(p1.x-p0.x),Math.abs(p1.y-p0.y))/2;
        const innerR=outerR*0.4;
        ctx.beginPath();
        for (let i=0; i<10; i++) {
            const angle=(i*Math.PI)/5 - Math.PI/2;
            const r = i%2===0 ? outerR : innerR;
            const x=cx+r*Math.cos(angle), y=cy+r*Math.sin(angle);
            i===0 ? ctx.moveTo(x,y) : ctx.lineTo(x,y);
        }
        ctx.closePath(); ctx.stroke();
    }
    resetCtx();
}

// ===== REDRAW ALL =====
function redrawAll() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawGrid();

    // Draw committed strokes
    const strokeMap = {};
    for (const s of allStrokes) {
        const isShape = ["rect","circle","line","triangle","arrow","star"].includes(s.type);
        if (isShape) {
            drawShapeWorld(s.type, s.x0, s.y0, s.x1, s.y1, s.color, s.size);
        } else {
            const key = (s.uid||"l") + "_" + (s.sid||"0");
            if (!strokeMap[key]) strokeMap[key] = { tool: s.brushType||"pen", color: s.color, size: s.size, pts: [] };
            if (strokeMap[key].pts.length === 0) strokeMap[key].pts.push({ x: s.x0, y: s.y0 });
            strokeMap[key].pts.push({ x: s.x1, y: s.y1 });
        }
    }
    for (const k in strokeMap) {
        const s = strokeMap[k];
        drawFullStrokeWorld(s.pts, s.tool, s.color, s.size);
    }

    // Draw active (in-progress) strokes from ALL users
    for (const key in activeLocalStrokes) {
        const s = activeLocalStrokes[key];
        if (s.pts && s.pts.length >= 2) {
            drawFullStrokeWorld(s.pts, s.tool || "pen", s.color || color, s.size || brushSize);
        }
    }

    drawCursors();
}

function drawGrid() {
    const gridSize = 50 * zoom;
    if (gridSize < 10) return;
    const offsetX = (-vpX * zoom) % gridSize;
    const offsetY = (-vpY * zoom) % gridSize;
    ctx.strokeStyle = "rgba(0,0,0,0.04)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = offsetX; x < canvas.width; x += gridSize) {
        ctx.moveTo(x, 0); ctx.lineTo(x, canvas.height);
    }
    for (let y = offsetY; y < canvas.height; y += gridSize) {
        ctx.moveTo(0, y); ctx.lineTo(canvas.width, y);
    }
    ctx.stroke();
}

// ===== CURSORS =====
function drawCursors() {
    for (const uid in remoteCursors) {
        const c = remoteCursors[uid];
        const sp = worldToScreen(c.x, c.y);
        // Only draw if on screen
        if (sp.x < -20 || sp.x > canvas.width+20 || sp.y < -20 || sp.y > canvas.height+20) continue;
        // Cursor dot
        ctx.beginPath();
        ctx.arc(sp.x, sp.y, 6, 0, Math.PI*2);
        ctx.fillStyle = c.color;
        ctx.fill();
        ctx.strokeStyle = "#fff";
        ctx.lineWidth = 1.5;
        ctx.stroke();
        // Name label
        ctx.font = "bold 11px Syne, sans-serif";
        ctx.fillStyle = c.color;
        const tw = ctx.measureText(c.name).width;
        ctx.fillStyle = "rgba(0,0,0,0.6)";
        ctx.beginPath();
        ctx.roundRect(sp.x + 10, sp.y - 8, tw + 10, 18, 4);
        ctx.fill();
        ctx.fillStyle = "#fff";
        ctx.fillText(c.name, sp.x + 15, sp.y + 5);
    }
}

// ===== MINIMAP =====
const minimap = document.getElementById("minimap");
const mmCtx = minimap.getContext("2d");
const MM_W = 120, MM_H = 90;
minimap.width = MM_W; minimap.height = MM_H;

function updateMinimap() {
    const mm = document.getElementById("minimap");
    const mw = mm.width;
    const mh = mm.height;

    mmCtx.clearRect(0, 0, mw, mh);
    mmCtx.fillStyle = "#1a1a1a";
    mmCtx.fillRect(0, 0, mw, mh);

    // Find bounding box of all content + current viewport
    let minX = vpX, minY = vpY;
    let maxX = vpX + canvas.width / zoom;
    let maxY = vpY + canvas.height / zoom;

    for (const s of allStrokes) {
        minX = Math.min(minX, s.x0, s.x1);
        minY = Math.min(minY, s.y0, s.y1);
        maxX = Math.max(maxX, s.x0, s.x1);
        maxY = Math.max(maxY, s.y0, s.y1);
    }

    // Add padding
    const pad = Math.max((maxX - minX), (maxY - minY)) * 0.1;
    minX -= pad; minY -= pad; maxX += pad; maxY += pad;

    const rangeX = maxX - minX || 1;
    const rangeY = maxY - minY || 1;

    // Keep aspect ratio
    const aspect = rangeX / rangeY;
    let scaleX, scaleY, offX = 0, offY = 0;
    if (aspect > mw / mh) {
        scaleX = mw / rangeX;
        scaleY = scaleX;
        offY = (mh - rangeY * scaleY) / 2;
    } else {
        scaleY = mh / rangeY;
        scaleX = scaleY;
        offX = (mw - rangeX * scaleX) / 2;
    }

    function wx(x) { return (x - minX) * scaleX + offX; }
    function wy(y) { return (y - minY) * scaleY + offY; }

    // Draw strokes
    const strokeMap = {};
    for (const s of allStrokes) {
        const isShape = ["rect","circle","line","triangle","arrow","star"].includes(s.type);
        if (isShape) {
            mmCtx.strokeStyle = s.color;
            mmCtx.lineWidth = 0.8;
            mmCtx.beginPath();
            if (s.type === "rect") {
                mmCtx.strokeRect(wx(s.x0), wy(s.y0), (s.x1-s.x0)*scaleX, (s.y1-s.y0)*scaleY);
            } else {
                mmCtx.moveTo(wx(s.x0), wy(s.y0));
                mmCtx.lineTo(wx(s.x1), wy(s.y1));
                mmCtx.stroke();
            }
        } else {
            const key = (s.uid||"l") + "_" + (s.sid||"0");
            if (!strokeMap[key]) strokeMap[key] = { color: s.color, pts: [] };
            if (strokeMap[key].pts.length === 0) strokeMap[key].pts.push({ x: s.x0, y: s.y0 });
            strokeMap[key].pts.push({ x: s.x1, y: s.y1 });
        }
    }
    for (const k in strokeMap) {
        const s = strokeMap[k];
        if (s.pts.length < 2) continue;
        mmCtx.strokeStyle = s.color;
        mmCtx.lineWidth = 0.8;
        mmCtx.beginPath();
        mmCtx.moveTo(wx(s.pts[0].x), wy(s.pts[0].y));
        for (let i = 1; i < s.pts.length; i++) {
            mmCtx.lineTo(wx(s.pts[i].x), wy(s.pts[i].y));
        }
        mmCtx.stroke();
    }

    // Viewport rect
    mmCtx.strokeStyle = "#e8ff47";
    mmCtx.lineWidth = 1.5;
    mmCtx.strokeRect(
        wx(vpX), wy(vpY),
        (canvas.width / zoom) * scaleX,
        (canvas.height / zoom) * scaleY
    );

    // Remote cursors
    for (const uid in remoteCursors) {
        const c = remoteCursors[uid];
        mmCtx.beginPath();
        mmCtx.arc(wx(c.x), wy(c.y), 3, 0, Math.PI * 2);
        mmCtx.fillStyle = c.color;
        mmCtx.fill();
    }

    // Store for click-to-jump
    mm._minX = minX; mm._minY = minY;
    mm._scaleX = scaleX; mm._scaleY = scaleY;
    mm._offX = offX; mm._offY = offY;
}

// Click minimap to jump
minimap.addEventListener("click", e => {
    if (!minimap._scaleX) return;
    const rect = minimap.getBoundingClientRect();
    const px = (e.clientX - rect.left) * (minimap.width / rect.width);
    const py = (e.clientY - rect.top) * (minimap.height / rect.height);
    const wx = (px - minimap._offX) / minimap._scaleX + minimap._minX;
    const wy = (py - minimap._offY) / minimap._scaleY + minimap._minY;
    vpX = wx - (canvas.width / zoom) / 2;
    vpY = wy - (canvas.height / zoom) / 2;
    redrawAll();
    updateMinimap();
});

// ===== DRAWING =====
const BRUSH_TOOLS = ["pen", "eraser"];
const SHAPE_TOOLS = ["rect", "circle", "line", "triangle", "arrow", "star"];

function getWorldPos(clientX, clientY) {
    return screenToWorld(clientX, clientY);
}

let previewStrokeSnapshot = null;

function startDraw(clientX, clientY) {
    const wp = getWorldPos(clientX, clientY);

    if (BRUSH_TOOLS.includes(currentTool)) {
        saveSnapshot();
        currentStrokeId++;
        points = [wp];
        // Track this stroke locally for smooth drawing
        const key = "local_" + currentStrokeId;
        activeLocalStrokes[key] = {
            tool: currentTool,
            color: currentTool === "eraser" ? "#ffffff" : color,
            size: brushSize,
            pts: [wp]
        };
    } else if (SHAPE_TOOLS.includes(currentTool)) {
        saveSnapshot();
        shapeStart = wp;
        previewStrokeSnapshot = [...allStrokes];
    }
    drawing = true;
}

function moveDraw(clientX, clientY) {
    if (!drawing) return;
    const wp = getWorldPos(clientX, clientY);
    const drawColor = currentTool === "eraser" ? "#ffffff" : color;

    // Emit cursor
    const now = Date.now();
    if (now - cursorThrottle > 40) {
        socket.emit("cursor", { pin: currentRoom, x: wp.x, y: wp.y });
        cursorThrottle = now;
    }

    if (BRUSH_TOOLS.includes(currentTool)) {
        const prev = points[points.length - 1];
        points.push(wp);

        // Update local active stroke points
        const key = "local_" + currentStrokeId;
        if (activeLocalStrokes[key]) {
            activeLocalStrokes[key].pts.push(wp);
        }

        // Draw just the new segment incrementally — no canvas wipe
        drawFullStrokeWorld([prev, wp], currentTool, drawColor, brushSize);

        // Emit
        socket.emit("draw", { pin: currentRoom, stroke: {
            type: "brush", brushType: currentTool,
            x0: prev.x, y0: prev.y, x1: wp.x, y1: wp.y,
            color: drawColor, size: brushSize, sid: currentStrokeId
        }});

    } else if (SHAPE_TOOLS.includes(currentTool) && shapeStart) {
        // Shape preview — restore snapshot strokes then redraw all active + shape on top
        allStrokes = [...previewStrokeSnapshot];
        redrawAll(); // this now includes activeLocalStrokes too
        drawShapeWorld(currentTool, shapeStart.x, shapeStart.y, wp.x, wp.y, color, brushSize);
    }
}

function endDraw(clientX, clientY) {
    if (!drawing) return;
    drawing = false;
    const wp = getWorldPos(clientX, clientY);

    if (SHAPE_TOOLS.includes(currentTool) && shapeStart) {
        const stroke = {
            type: currentTool,
            x0: shapeStart.x, y0: shapeStart.y,
            x1: wp.x, y1: wp.y,
            color, size: brushSize,
            uid: "local", sid: currentStrokeId
        };
        allStrokes.push(stroke);
        socket.emit("draw", { pin: currentRoom, stroke: {
            type: currentTool,
            x0: shapeStart.x, y0: shapeStart.y,
            x1: wp.x, y1: wp.y,
            color, size: brushSize
        }});
        shapeStart = null; previewStrokeSnapshot = null;
        redrawAll();
    } else {
        // Save brush stroke to allStrokes
        if (points.length > 1) {
            for (let i = 1; i < points.length; i++) {
                allStrokes.push({
                    type: "brush", brushType: currentTool,
                    x0: points[i-1].x, y0: points[i-1].y,
                    x1: points[i].x, y1: points[i].y,
                    color: currentTool === "eraser" ? "#ffffff" : color,
                    size: brushSize, sid: currentStrokeId, uid: "local"
                });
            }
        }
        // Cleanup active local stroke
        delete activeLocalStrokes["local_" + currentStrokeId];
        socket.emit("strokeEnd", { pin: currentRoom, sid: currentStrokeId });
    }
    points = [];
    updateMinimap();
}

function cancelDraw() {
    if (drawing) socket.emit("strokeEnd", { pin: currentRoom, sid: currentStrokeId });
    delete activeLocalStrokes["local_" + currentStrokeId];
    drawing = false; points = [];
}

// ===== PAN (two finger or middle mouse or space+drag) =====
let spaceDown = false;
document.addEventListener("keydown", e => {
    if (e.target.tagName === "INPUT") return;
    if (e.code === "Space") { spaceDown = true; canvas.style.cursor = "grab"; }
    if ((e.ctrlKey||e.metaKey) && e.key === "z") { e.preventDefault(); undoAction(); }
    if ((e.ctrlKey||e.metaKey) && (e.key === "y" || (e.shiftKey && e.key === "z"))) { e.preventDefault(); redoAction(); }
    if (e.key === "b") selectBrush("pen","Pen",null);
    if (e.key === "e") setTool("eraser");
    if (e.key === "+" || e.key === "=") zoomAt(canvas.width/2, canvas.height/2, 1.2);
    if (e.key === "-") zoomAt(canvas.width/2, canvas.height/2, 0.8);
});
document.addEventListener("keyup", e => {
    if (e.code === "Space") { spaceDown = false; canvas.style.cursor = "crosshair"; }
});

// ===== MOUSE EVENTS =====
canvas.addEventListener("mousedown", e => {
    if (e.button === 1 || spaceDown) {
        isPanning = true;
        panStart = { x: e.clientX, y: e.clientY };
        vpStart = { x: vpX, y: vpY };
        canvas.style.cursor = "grabbing";
        return;
    }
    startDraw(e.clientX, e.clientY);
});

canvas.addEventListener("mousemove", e => {
    // Emit cursor even when not drawing
    const wp = screenToWorld(e.clientX, e.clientY);
    const now = Date.now();
    if (now - cursorThrottle > 50) {
        socket.emit("cursor", { pin: currentRoom, x: wp.x, y: wp.y });
        cursorThrottle = now;
    }

    if (isPanning) {
        vpX = vpStart.x - (e.clientX - panStart.x) / zoom;
        vpY = vpStart.y - (e.clientY - panStart.y) / zoom;
        redrawAll();
        updateMinimap();
        return;
    }
    moveDraw(e.clientX, e.clientY);
});

canvas.addEventListener("mouseup", e => {
    if (isPanning) { isPanning = false; canvas.style.cursor = spaceDown ? "grab" : "crosshair"; return; }
    endDraw(e.clientX, e.clientY);
});
canvas.addEventListener("mouseleave", () => { if (!isPanning) cancelDraw(); });

// ===== TOUCH EVENTS =====
canvas.addEventListener("touchstart", e => {
    e.preventDefault();

    if (e.touches.length === 2) {
        // Two fingers — cancel any drawing, start pinch/pan
        if (drawing) cancelDraw();
        isPinching = true;

        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        lastPinchDist = Math.sqrt(dx*dx + dy*dy);
        lastPinchMid = {
            x: (e.touches[0].clientX + e.touches[1].clientX) / 2,
            y: (e.touches[0].clientY + e.touches[1].clientY) / 2
        };
        panStart = { ...lastPinchMid };
        vpStart = { x: vpX, y: vpY };
        return;
    }

    // Only start drawing if single touch and not pinching
    if (e.touches.length === 1 && !isPinching) {
        startDraw(e.touches[0].clientX, e.touches[0].clientY);
    }
}, { passive: false });

canvas.addEventListener("touchmove", e => {
    e.preventDefault();

    if (e.touches.length === 2) {
        // Cancel drawing if second finger joins mid-stroke
        if (drawing) cancelDraw();
        isPinching = true;

        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        const dist = Math.sqrt(dx*dx + dy*dy);
        const mid = {
            x: (e.touches[0].clientX + e.touches[1].clientX) / 2,
            y: (e.touches[0].clientY + e.touches[1].clientY) / 2
        };

        // Zoom
        if (lastPinchDist > 0) {
            const factor = dist / lastPinchDist;
            zoomAt(mid.x, mid.y, factor);
        }
        lastPinchDist = dist;

        // Pan
        vpX -= (mid.x - lastPinchMid.x) / zoom;
        vpY -= (mid.y - lastPinchMid.y) / zoom;
        lastPinchMid = mid;

        redrawAll();
        updateMinimap();
        return;
    }

    // Single touch drawing — only if not pinching
    if (e.touches.length === 1 && !isPinching) {
        moveDraw(e.touches[0].clientX, e.touches[0].clientY);
    }
}, { passive: false });

canvas.addEventListener("touchend", e => {
    e.preventDefault();

    if (e.touches.length === 0) {
        // All fingers lifted
        if (isPinching) {
            isPinching = false;
            lastPinchDist = 0;
            return;
        }
        if (drawing && e.changedTouches.length) {
            endDraw(e.changedTouches[0].clientX, e.changedTouches[0].clientY);
        }
        return;
    }

    if (e.touches.length === 1 && isPinching) {
        // One finger lifted from pinch — stop pinching, don't draw
        isPinching = false;
        lastPinchDist = 0;
        return;
    }
}, { passive: false });

canvas.addEventListener("touchcancel", e => {
    isPinching = false;
    lastPinchDist = 0;
    cancelDraw();
});

// ===== SOCKET EVENTS =====
socket.on("draw", stroke => {
    allStrokes.push(stroke);

    const isShape = ["rect","circle","line","triangle","arrow","star"].includes(stroke.type);
    if (isShape) {
        // Shape — just draw it on top, no full redraw needed
        drawShapeWorld(stroke.type, stroke.x0, stroke.y0, stroke.x1, stroke.y1, stroke.color, stroke.size);
    } else {
        // Brush — track in activeLocalStrokes and draw incrementally
        const key = (stroke.uid||"r") + "_" + (stroke.sid||"0");
        if (!activeLocalStrokes[key]) {
            activeLocalStrokes[key] = {
                tool: stroke.brushType||"pen",
                color: stroke.color,
                size: stroke.size,
                pts: [{ x: stroke.x0, y: stroke.y0 }]
            };
        }
        activeLocalStrokes[key].pts.push({ x: stroke.x1, y: stroke.y1 });

        // Draw only last few points for smooth incremental rendering
        const pts = activeLocalStrokes[key].pts;
        const len = pts.length;
        const segPts = pts.slice(Math.max(0, len - 3));
        drawFullStrokeWorld(segPts, stroke.brushType||"pen", stroke.color, stroke.size);
    }
    updateMinimap();
});

socket.on("strokeEnd", ({ uid, sid }) => {
    const key = (uid||"r") + "_" + (sid||"0");
    delete activeLocalStrokes[key];
    updateMinimap();
});


socket.on("cursor", ({ uid, name, color: c, x, y }) => {
    remoteCursors[uid] = { name, color: c, x, y };
    redrawAll();
    updateMinimap();
});

socket.on("removeCursor", ({ uid }) => {
    delete remoteCursors[uid];
    redrawAll();
    updateMinimap();
});

socket.on("undoSync", strokes => {
    allStrokes = strokes;
    redrawAll();
    updateMinimap();
});

socket.on("redoSync", strokes => {
    allStrokes = strokes;
    redrawAll();
    updateMinimap();
});

socket.on("loadStrokes", strokes => {
    allStrokes = strokes;
    redrawAll();
    updateMinimap();
});

socket.on("clearBoard", () => {
    allStrokes = [];
    undoStack = []; redoStack = [];
    redrawAll();
    updateMinimap();
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

// ===== UNDO/REDO =====
function saveSnapshot() {
    undoStack.push(JSON.stringify(allStrokes));
    if (undoStack.length > MAX_UNDO) undoStack.shift();
    redoStack = [];
}

function undoAction() {
    if (!undoStack.length) return;
    redoStack.push(JSON.stringify(allStrokes));
    allStrokes = JSON.parse(undoStack.pop());
    redrawAll();
    updateMinimap();
    socket.emit("syncUndo", { pin: currentRoom });
}

function redoAction() {
    if (!redoStack.length) return;
    undoStack.push(JSON.stringify(allStrokes));
    allStrokes = JSON.parse(redoStack.pop());
    redrawAll();
    updateMinimap();
    socket.emit("syncRedo", { pin: currentRoom, strokes: allStrokes });
}

// ===== SAVE — crop to drawn area =====
function downloadImage() {
    if (allStrokes.length === 0) { alert("Nothing to save!"); return; }

    // Find bounding box of all strokes
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const s of allStrokes) {
        minX = Math.min(minX, s.x0, s.x1);
        minY = Math.min(minY, s.y0, s.y1);
        maxX = Math.max(maxX, s.x0, s.x1);
        maxY = Math.max(maxY, s.y0, s.y1);
    }
    const pad = 40;
    minX -= pad; minY -= pad; maxX += pad; maxY += pad;

    // Render to offscreen canvas at 1:1 zoom
    const w = maxX - minX, h = maxY - minY;
    const offscreen = document.createElement("canvas");
    offscreen.width = w; offscreen.height = h;
    const octx = offscreen.getContext("2d");
    octx.fillStyle = "#ffffff";
    octx.fillRect(0, 0, w, h);

    // Temporarily swap ctx, vpX/Y, zoom to render clean
    const savedCtx = ctx;
    const savedVpX = vpX, savedVpY = vpY, savedZoom = zoom;

    // Override worldToScreen for offscreen
    const renderStrokes = allStrokes.filter(s => s.color !== "#ffffff"); // skip eraser for export
    vpX = minX; vpY = minY; zoom = 1;

    // Draw to offscreen
    const strokeMap = {};
    for (const s of renderStrokes) {
        const isShape = ["rect","circle","line","triangle","arrow","star"].includes(s.type);
        const p0 = { x: (s.x0 - minX), y: (s.y0 - minY) };
        const p1 = { x: (s.x1 - minX), y: (s.y1 - minY) };
        if (isShape) {
            octx.strokeStyle = s.color; octx.lineWidth = s.size;
            octx.lineCap = "round"; octx.lineJoin = "round";
            if (s.type === "rect") { octx.beginPath(); octx.strokeRect(p0.x, p0.y, p1.x-p0.x, p1.y-p0.y); }
            else if (s.type === "line") { octx.beginPath(); octx.moveTo(p0.x,p0.y); octx.lineTo(p1.x,p1.y); octx.stroke(); }
            else if (s.type === "circle") {
                const cx=(p0.x+p1.x)/2, cy=(p0.y+p1.y)/2;
                octx.beginPath(); octx.ellipse(cx,cy,Math.abs(p1.x-p0.x)/2,Math.abs(p1.y-p0.y)/2,0,0,Math.PI*2); octx.stroke();
            }
        } else {
            const key = (s.uid||"l")+"_"+(s.sid||"0");
            if (!strokeMap[key]) strokeMap[key] = { color: s.color, size: s.size, pts: [] };
            if (strokeMap[key].pts.length === 0) strokeMap[key].pts.push(p0);
            strokeMap[key].pts.push(p1);
        }
    }
    for (const k in strokeMap) {
        const s = strokeMap[k];
        if (s.pts.length < 2) continue;
        octx.strokeStyle = s.color; octx.lineWidth = s.size;
        octx.lineCap = "round"; octx.lineJoin = "round";
        octx.beginPath(); octx.moveTo(s.pts[0].x, s.pts[0].y);
        for (let i = 1; i < s.pts.length - 1; i++) {
            const mx = (s.pts[i].x+s.pts[i+1].x)/2, my = (s.pts[i].y+s.pts[i+1].y)/2;
            octx.quadraticCurveTo(s.pts[i].x, s.pts[i].y, mx, my);
        }
        octx.lineTo(s.pts[s.pts.length-1].x, s.pts[s.pts.length-1].y);
        octx.stroke();
    }

    // Restore
    vpX = savedVpX; vpY = savedVpY; zoom = savedZoom;

    const dataUrl = offscreen.toDataURL("image/png");
    const fileName = "drawsync-" + Date.now() + ".png";

    // Android native bridge
    if (window.AndroidSave) {
        window.AndroidSave.saveImage(dataUrl);
        return;
    }

    // Android WebView — Web Share API
    if (navigator.share && navigator.canShare) {
        offscreen.toBlob(blob => {
            const file = new File([blob], fileName, { type: "image/png" });
            if (navigator.canShare({ files: [file] })) {
                navigator.share({ files: [file], title: "DrawSync" })
                    .catch(err => console.log("Share cancelled", err));
            } else {
                const link = document.createElement("a");
                link.download = fileName;
                link.href = dataUrl;
                link.click();
            }
        });
    } else {
        // Desktop browser
        const link = document.createElement("a");
        link.download = fileName;
        link.href = dataUrl;
        link.click();
    }
}

// replayAllStrokes — alias (loadStrokes uses redrawAll directly)
function replayAllStrokes(strokes) {
    allStrokes = strokes;
    Object.keys(activeLocalStrokes).forEach(k => delete activeLocalStrokes[k]);
    redrawAll();
    updateMinimap();
}

// ===== TOOLBAR =====
function toggleSubmenu(id, event) {
    if (event) event.stopPropagation();
    const menu = document.getElementById(id);
    const isOpen = !menu.classList.contains("hidden");
    document.querySelectorAll(".submenu").forEach(m => m.classList.add("hidden"));
    if (!isOpen) {
        menu.classList.remove("hidden");
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
    document.getElementById("btn-brush-group")?.classList.add("active");
    document.getElementById("btn-shapes-group")?.classList.remove("active");
    document.getElementById("btn-eraser")?.classList.remove("active");
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

function setTool(tool) {
    currentTool = tool;
    if (tool === "eraser") {
        document.getElementById("btn-eraser")?.classList.add("active");
        document.getElementById("btn-brush-group")?.classList.remove("active");
        document.getElementById("btn-shapes-group")?.classList.remove("active");
        document.querySelectorAll(".submenu").forEach(m => m.classList.add("hidden"));
    }
}

// ===== COLOR & SIZE =====
document.getElementById("colorPicker").addEventListener("input", e => { color = e.target.value; });
document.getElementById("brushSize").addEventListener("input", e => {
    brushSize = parseInt(e.target.value);
    document.getElementById("sizeLabel").textContent = brushSize;
    document.getElementById("sizePopupVal").textContent = brushSize;
});
function openSizePopup()  { document.getElementById("sizePopup").classList.remove("hidden"); }
function closeSizePopup() { document.getElementById("sizePopup").classList.add("hidden"); }

// ===== ROOMS =====
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

// ===== CLEAR =====
function clearBoard() {
    if (!confirm("Clear the entire board?")) return;
    socket.emit("clearBoard", currentRoom);
}

// ===== CHAT =====
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

// ===== RESET VIEW =====
function resetView() {
    zoom = 1;
    vpX = 0;
    vpY = 0;
    redrawAll();
    updateMinimap();
}

// ===== MINIMAP TOGGLE =====
let minimapExpanded = false;
function toggleMinimap() {
    const wrap = document.getElementById("minimapWrap");
    const mm = document.getElementById("minimap");

    if (wrap.classList.contains("collapsed")) {
        // collapsed → normal
        wrap.classList.remove("collapsed");
        mm.width = 120; mm.height = 90;
        minimapExpanded = false;
    } else if (!minimapExpanded) {
        // normal → expanded
        minimapExpanded = true;
        wrap.classList.remove("collapsed");
        wrap.classList.add("expanded");
        mm.width = 240; mm.height = 180;
    } else {
        // expanded → collapsed (just header visible)
        minimapExpanded = false;
        wrap.classList.remove("expanded");
        wrap.classList.add("collapsed");
    }
    updateMinimap();
}

// ===== TOOLBAR HIDE/SHOW =====
function hideToolbar() {
    document.getElementById("toolbar").classList.add("hidden");
    document.getElementById("tbShowBtn").classList.remove("hidden");
}

function showToolbar() {
    document.getElementById("toolbar").classList.remove("hidden");
    document.getElementById("tbShowBtn").classList.add("hidden");
}

// ===== RESET VIEW =====
function resetView() {
    zoom = 1;
    vpX = 0;
    vpY = 0;
    redrawAll();
    updateMinimap();
}



// ===== INTERACTIVE TUTORIAL =====
const TUTORIAL_STEPS = [
    {
        title: "Welcome to DrawSync! ✏️",
        description: "Real-time collaborative whiteboard. Let's show you everything — step by step!",
        target: null, // center screen, no highlight
        position: "center"
    },
    {
        title: "Pen Tool 🖊️",
        description: "Tap here to draw freely on the canvas. This is your main drawing tool!",
        target: "#btn-brush-group",
        position: "left"
    },
    {
        title: "Eraser 🧹",
        description: "Made a mistake? Tap the Eraser to rub it out. Increase size for bigger erasing.",
        target: "#btn-eraser",
        position: "left"
    },
    {
        title: "Shapes 🔷",
        description: "Tap Shapes to draw rectangles, circles, arrows, triangles, stars and lines!",
        target: "#btn-shapes-group",
        position: "left"
    },
    {
        title: "Pick a Color 🎨",
        description: "Tap the color circle to pick any color for your pen or shapes.",
        target: "#colorPicker",
        position: "left"
    },
    {
        title: "Brush Size 📏",
        description: "Tap SIZE to open the slider. Set brush size from 1 to 200px.",
        target: ".size-btn",
        position: "left"
    },
    {
        title: "Undo & Redo ↩️",
        description: "Made a mistake? UNDO removes your last stroke. REDO brings it back. Synced with everyone!",
        target: "[onclick='undoAction()']",
        position: "left"
    },
    {
        title: "Save Your Drawing 💾",
        description: "Tap SAVE to download the canvas as a PNG image — only the drawn area is saved!",
        target: "[onclick='downloadImage()']",
        position: "left"
    },
    {
        title: "Rooms 🚪",
        description: "NEW creates a private room with a PIN. Share the PIN with friends — only they can join!",
        target: "[onclick='createRoom()']",
        position: "left"
    },
    {
        title: "Zoom & Pan 🔍",
        description: "Use + and − to zoom. Tap ⊙ to reset view. On mobile: pinch to zoom, 2 fingers to pan!",
        target: ".zoom-controls",
        position: "top"
    },
    {
        title: "Minimap 🗺️",
        description: "The MAP shows the full canvas. Yellow box = your view. Tap map to jump anywhere. Colored dots = other users!",
        target: "#minimapWrap",
        position: "top"
    },
    {
        title: "Live Chat 💬",
        description: "Tap the Chat box to send messages to everyone in your room in real time!",
        target: "#chatBox",
        position: "bottom"
    },
    {
        title: "You're ready! 🚀",
        description: "Start drawing, invite friends, and create together. Have fun!",
        target: null,
        position: "center"
    }
];

let tutorialStep = 0;
let tutorialActive = false;

function initTutorial() {
    if (localStorage.getItem("ds_tutorial_done")) return;
    setTimeout(() => startTutorial(), 900);
}

function startTutorial() {
    tutorialActive = true;
    tutorialStep = 0;
    showTutorialStep(0);
}

function showTutorialStep(index) {
    // Remove existing tutorial elements
    removeTutorialUI();

    if (index >= TUTORIAL_STEPS.length) {
        endTutorial();
        return;
    }

    const step = TUTORIAL_STEPS[index];
    const total = TUTORIAL_STEPS.length;

    // Create overlay with hole
    const overlay = document.createElement("div");
    overlay.id = "tut-overlay";
    overlay.style.cssText = `
        position:fixed;inset:0;z-index:3000;
        pointer-events:none;
    `;
    document.body.appendChild(overlay);

    // Target element highlight
    let targetRect = null;
    if (step.target) {
        const el = document.querySelector(step.target);
        if (el) {
            targetRect = el.getBoundingClientRect();
            // Highlight ring
            const ring = document.createElement("div");
            ring.id = "tut-ring";
            ring.style.cssText = `
                position:fixed;
                left:${targetRect.left - 6}px;
                top:${targetRect.top - 6}px;
                width:${targetRect.width + 12}px;
                height:${targetRect.height + 12}px;
                border:2.5px solid #e8ff47;
                border-radius:12px;
                z-index:3001;
                pointer-events:none;
                box-shadow:0 0 0 2000px rgba(0,0,0,0.55);
                animation: tutPulse 1.2s ease-in-out infinite;
            `;
            document.body.appendChild(ring);
        }
    } else {
        // Full dim overlay for center steps
        const dim = document.createElement("div");
        dim.style.cssText = `
            position:fixed;inset:0;
            background:rgba(0,0,0,0.7);
            z-index:3000;
            pointer-events:none;
        `;
        overlay.appendChild(dim);
    }

    // Tooltip box
    const box = document.createElement("div");
    box.id = "tut-box";

    // Position tooltip
    let boxStyle = "";
    if (!targetRect || step.position === "center") {
        boxStyle = `
            position:fixed;
            left:50%;top:50%;
            transform:translate(-50%,-50%);
        `;
    } else if (step.position === "left") {
        const rightEdge = targetRect.left - 14;
        const topPos = Math.min(
            Math.max(targetRect.top - 20, 10),
            window.innerHeight - 220
        );
        boxStyle = `
            position:fixed;
            right:${window.innerWidth - rightEdge}px;
            top:${topPos}px;
        `;
    } else if (step.position === "top") {
        boxStyle = `
            position:fixed;
            left:50%;
            bottom:${window.innerHeight - targetRect.top + 14}px;
            transform:translateX(-50%);
        `;
    } else if (step.position === "bottom") {
        boxStyle = `
            position:fixed;
            left:12px;
            top:${targetRect.bottom + 14}px;
        `;
    }

    // Arrow direction
    let arrowHtml = "";
    if (targetRect && step.position === "left") {
        arrowHtml = `<div class="tut-arrow tut-arrow-right"></div>`;
    } else if (targetRect && step.position === "top") {
        arrowHtml = `<div class="tut-arrow tut-arrow-down"></div>`;
    } else if (targetRect && step.position === "bottom") {
        arrowHtml = `<div class="tut-arrow tut-arrow-up"></div>`;
    }

    box.style.cssText = boxStyle + `
        z-index:3002;
        background:#161616;
        border:1px solid rgba(232,255,71,0.3);
        border-radius:14px;
        padding:16px;
        width:220px;
        box-shadow:0 8px 32px rgba(0,0,0,0.6);
        animation:tutSlide 0.25s cubic-bezier(0.34,1.4,0.64,1);
        pointer-events:all;
    `;

    // Progress dots
    const dots = Array.from({length: total}, (_, i) =>
        `<span style="
            display:inline-block;
            width:${i===index?'16px':'7px'};height:7px;
            border-radius:4px;
            background:${i===index?'#e8ff47':'rgba(255,255,255,0.2)'};
            margin:0 2px;
            transition:all 0.2s;
        "></span>`
    ).join("");

    const isLast = index === total - 1;

    box.innerHTML = `
        ${arrowHtml}
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
            <span style="font-family:'Space Mono',monospace;font-size:0.55rem;color:#666;">${index+1} / ${total}</span>
            <button onclick="skipTutorial()" style="
                background:rgba(255,255,255,0.08);
                border:1px solid rgba(255,255,255,0.12);
                color:#888;padding:3px 10px;
                border-radius:6px;font-size:0.7rem;
                font-family:'Syne',sans-serif;
                cursor:pointer;font-weight:700;
            ">Skip ✕</button>
        </div>
        <div style="display:flex;gap:3px;margin-bottom:12px;">${dots}</div>
        <h3 style="font-family:'Syne',sans-serif;font-size:0.95rem;font-weight:800;color:#f0f0f0;margin-bottom:6px;">${step.title}</h3>
        <p style="font-family:'Space Mono',monospace;font-size:0.68rem;color:#888;line-height:1.6;margin-bottom:14px;">${step.description}</p>
        <button onclick="nextTutorialStep()" style="
            width:100%;padding:10px;
            background:#e8ff47;border:none;
            border-radius:9px;color:#000;
            font-size:0.88rem;font-weight:800;
            font-family:'Syne',sans-serif;
            cursor:pointer;
        ">${isLast ? "Let's Draw! 🚀" : "Next →"}</button>
    `;

    document.body.appendChild(box);
}

function removeTutorialUI() {
    ["tut-overlay","tut-ring","tut-box"].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.remove();
    });
    // Remove any arrow-less rings
    document.querySelectorAll("[id^='tut-']").forEach(el => el.remove());
}

function nextTutorialStep() {
    tutorialStep++;
    showTutorialStep(tutorialStep);
}

function skipTutorial() {
    removeTutorialUI();
    tutorialActive = false;
    localStorage.setItem("ds_tutorial_done", "1");
}

function endTutorial() {
    removeTutorialUI();
    tutorialActive = false;
    localStorage.setItem("ds_tutorial_done", "1");
}
