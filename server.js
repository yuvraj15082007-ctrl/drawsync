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
    public: { users: {}, strokes: [], cursors: {} }
};

io.on("connection", (socket) => {

    socket.on("joinRoom", ({ pin, name }) => {
        if (socket.room && rooms[socket.room]) {
            socket.leave(socket.room);
            delete rooms[socket.room].users[socket.id];
            delete rooms[socket.room].cursors[socket.id];
            io.to(socket.room).emit("updateUsers", Object.values(rooms[socket.room].users));
            io.to(socket.room).emit("removeCursor", { uid: socket.id });
        }

        if (!rooms[pin]) rooms[pin] = { users: {}, strokes: [], cursors: {} };

        socket.join(pin);
        socket.room = pin;
        rooms[pin].users[socket.id] = { name, color: randomColor() };

        socket.emit("loadStrokes", rooms[pin].strokes);
        io.to(pin).emit("updateUsers", Object.values(rooms[pin].users).map(u => u.name));
    });

    socket.on("draw", ({ pin, stroke }) => {
        if (!rooms[pin]) return;
        if (rooms[pin].strokes.length > 5000) rooms[pin].strokes.shift();
        stroke.uid = socket.id;
        rooms[pin].strokes.push(stroke);
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
        if (!rooms[pin]) return;
        rooms[pin].strokes = [];
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

    socket.on("disconnect", () => {
        const room = socket.room;
        if (room && rooms[room]) {
            delete rooms[room].users[socket.id];
            delete rooms[room].cursors[socket.id];
            io.to(room).emit("updateUsers", Object.values(rooms[room].users).map(u => u.name));
            io.to(room).emit("removeCursor", { uid: socket.id });
        }
    });
});

function randomColor() {
    const colors = ["#ff6b6b","#ffd93d","#6bcb77","#4d96ff","#ff922b","#cc5de8","#20c997","#f06595"];
    return colors[Math.floor(Math.random() * colors.length)];
}

server.listen(process.env.PORT || 10000, () => {
    console.log("DrawSync running on port", process.env.PORT || 10000);
});
