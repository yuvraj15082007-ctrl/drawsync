const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    pingInterval: 5000,
    pingTimeout: 10000
});

app.use(express.static("public"));

let rooms = {
    public: { users: {}, strokes: [], cursors: {}, mode: "normal", teacherId: null, raisedHands: {}, permitted: {} }
};

// Emits the current hand-raise queue + permitted-drawer list to the teacher only.
function sendTeacherPanel(pin) {
    const room = rooms[pin];
    if (!room || room.mode !== "teaching" || !room.teacherId) return;
    const raised = Object.keys(room.raisedHands).map(uid => ({ uid, name: room.users[uid]?.name || "Unknown" }));
    const permitted = Object.keys(room.permitted).map(uid => ({ uid, name: room.users[uid]?.name || "Unknown" }));
    io.to(room.teacherId).emit("teacherPanelUpdate", { raised, permitted });
}

// Sends the teacher a full roster (excluding themself) — used to know who to voice-call.
function sendRoster(pin) {
    const room = rooms[pin];
    if (!room || room.mode !== "teaching" || !room.teacherId) return;
    const roster = Object.keys(room.users)
        .filter(uid => uid !== room.teacherId)
        .map(uid => ({ uid, name: room.users[uid]?.name || "Unknown" }));
    io.to(room.teacherId).emit("roster", roster);
}

// Cleans up a user's presence from a room (used on room-switch and disconnect).
function leaveRoom(socket, pin) {
    const room = rooms[pin];
    if (!room) return;
    delete room.users[socket.id];
    delete room.cursors[socket.id];
    delete room.raisedHands[socket.id];
    delete room.permitted[socket.id];
    if (room.teacherId === socket.id) room.teacherId = null;
    io.to(pin).emit("updateUsers", Object.values(room.users).map(u => u.name));
    io.to(pin).emit("removeCursor", { uid: socket.id });
    sendTeacherPanel(pin);
    sendRoster(pin);
    // Tell the room a student left so the teacher's voice call can drop that peer.
    if (room.mode === "teaching") io.to(pin).emit("voicePeerLeft", { uid: socket.id });
}

io.on("connection", (socket) => {

    // mode: "teaching" when creating/entering a Teaching Room, omitted/"normal" otherwise.
    socket.on("joinRoom", ({ pin, name, mode }) => {
        if (socket.room && rooms[socket.room]) {
            socket.leave(socket.room);
            leaveRoom(socket, socket.room);
        }

        const isNewRoom = !rooms[pin];
        if (isNewRoom) {
            rooms[pin] = {
                users: {}, strokes: [], cursors: {},
                mode: mode === "teaching" ? "teaching" : "normal",
                teacherId: null, raisedHands: {}, permitted: {}
            };
        }

        const room = rooms[pin];
        socket.join(pin);
        socket.room = pin;
        room.users[socket.id] = { name, color: randomColor() };

        let isTeacher = false;
        if (room.mode === "teaching") {
            // Creator of a fresh teaching room becomes teacher. If the room is
            // teacherless (e.g. teacher left), the next joiner takes over.
            if ((isNewRoom && mode === "teaching") || !room.teacherId) {
                room.teacherId = socket.id;
            }
            isTeacher = room.teacherId === socket.id;
        }

        socket.emit("loadStrokes", room.strokes);
        socket.emit("roomInfo", {
            pin,
            mode: room.mode,
            isTeacher,
            canDraw: room.mode !== "teaching" || isTeacher || !!room.permitted[socket.id]
        });
        io.to(pin).emit("updateUsers", Object.values(room.users).map(u => u.name));
        sendTeacherPanel(pin);
        sendRoster(pin);
    });

    socket.on("draw", ({ pin, stroke }) => {
        const room = rooms[pin];
        if (!room) return;
        if (room.mode === "teaching" && socket.id !== room.teacherId && !room.permitted[socket.id]) return;
        if (room.strokes.length > 5000) room.strokes.shift();
        stroke.uid = socket.id;
        room.strokes.push(stroke);
        socket.to(pin).emit("draw", stroke);
    });

    socket.on("strokeEnd", ({ pin, sid }) => {
        socket.to(pin).emit("strokeEnd", { uid: socket.id, sid });
    });

    // Cursor position broadcast
    socket.on("cursor", ({ pin, x, y }) => {
        if (!rooms[pin]) return;
        const user = rooms[pin].users[socket.id];
        if (!user) return;
        rooms[pin].cursors[socket.id] = { x, y };
        socket.to(pin).emit("cursor", {
            uid: socket.id,
            name: user.name,
            color: user.color,
            x, y
        });
    });

    socket.on("syncUndo", ({ pin }) => {
        if (!rooms[pin]) return;
        const strokes = rooms[pin].strokes;
        let removed = 0;
        for (let i = strokes.length - 1; i >= 0 && removed < 1; i--) {
            if (strokes[i].uid === socket.id) {
                const sid = strokes[i].sid;
                let j = strokes.length - 1;
                while (j >= 0) {
                    if (strokes[j].uid === socket.id && strokes[j].sid === sid) {
                        strokes.splice(j, 1);
                    }
                    j--;
                }
                removed++;
            }
        }
        io.to(pin).emit("undoSync", strokes);
    });

    socket.on("syncRedo", ({ pin, strokes }) => {
        if (!rooms[pin]) return;
        rooms[pin].strokes = strokes;
        socket.to(pin).emit("redoSync", strokes);
    });

    socket.on("clearBoard", (pin) => {
        const room = rooms[pin];
        if (!room) return;
        // In a Teaching Room, only the teacher can wipe the board.
        if (room.mode === "teaching" && socket.id !== room.teacherId) return;
        room.strokes = [];
        io.to(pin).emit("clearBoard");
    });

    socket.on("chatMessage", ({ pin, message }) => {
        if (!rooms[pin]) return;
        if (message.length > 200) return;
        io.to(pin).emit("chatMessage", {
            name: rooms[pin].users[socket.id]?.name,
            message
        });
    });

    // ===== TEACHING ROOM: hand-raise & permission flow =====
    socket.on("raiseHand", ({ pin }) => {
        const room = rooms[pin];
        if (!room || room.mode !== "teaching" || socket.id === room.teacherId) return;
        room.raisedHands[socket.id] = true;
        sendTeacherPanel(pin);
    });

    socket.on("lowerHand", ({ pin }) => {
        const room = rooms[pin];
        if (!room) return;
        delete room.raisedHands[socket.id];
        sendTeacherPanel(pin);
    });

    socket.on("grantDraw", ({ pin, uid }) => {
        const room = rooms[pin];
        if (!room || room.mode !== "teaching" || socket.id !== room.teacherId) return;
        room.permitted[uid] = true;
        delete room.raisedHands[uid];
        io.to(uid).emit("drawGranted");
        sendTeacherPanel(pin);
    });

    socket.on("revokeDraw", ({ pin, uid }) => {
        const room = rooms[pin];
        if (!room || room.mode !== "teaching" || socket.id !== room.teacherId) return;
        delete room.permitted[uid];
        io.to(uid).emit("drawRevoked");
        sendTeacherPanel(pin);
    });

    socket.on("disconnect", () => {
        const room = socket.room;
        if (room && rooms[room]) leaveRoom(socket, room);
    });

    // ===== TEACHING ROOM: WebRTC voice signaling relay =====
    // The server never touches audio itself — it just relays SDP/ICE messages
    // between the teacher and each student so they can set up a direct call.
    socket.on("voiceOffer", ({ pin, to, sdp }) => {
        const room = rooms[pin];
        if (!room || socket.id !== room.teacherId) return; // only teacher initiates
        io.to(to).emit("voiceOffer", { from: socket.id, sdp });
    });

    socket.on("voiceAnswer", ({ pin, to, sdp }) => {
        const room = rooms[pin];
        if (!room) return;
        io.to(to).emit("voiceAnswer", { from: socket.id, sdp });
    });

    socket.on("voiceIceCandidate", ({ pin, to, candidate }) => {
        if (!rooms[pin]) return;
        io.to(to).emit("voiceIceCandidate", { from: socket.id, candidate });
    });

    socket.on("voiceStart", ({ pin }) => {
        const room = rooms[pin];
        if (!room || socket.id !== room.teacherId) return;
        socket.to(pin).emit("voiceStart");
    });

    socket.on("voiceStop", ({ pin }) => {
        const room = rooms[pin];
        if (!room || socket.id !== room.teacherId) return;
        socket.to(pin).emit("voiceStop");
    });
});

function randomColor() {
    const colors = ["#ff6b6b","#ffd93d","#6bcb77","#4d96ff","#ff922b","#cc5de8","#20c997","#f06595"];
    return colors[Math.floor(Math.random() * colors.length)];
}

server.listen(process.env.PORT || 10000, () => {
    console.log("DrawSync running on port", process.env.PORT || 10000);
});
        
