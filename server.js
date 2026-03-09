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
    public: { users: {}, strokes: [] }
};

io.on("connection", (socket) => {

    socket.on("joinRoom", ({ pin, name }) => {
        // Leave previous room
        if (socket.room && rooms[socket.room]) {
            socket.leave(socket.room);
            delete rooms[socket.room].users[socket.id];
            io.to(socket.room).emit("updateUsers", Object.values(rooms[socket.room].users));
        }

        if (!rooms[pin]) rooms[pin] = { users: {}, strokes: [] };

        socket.join(pin);
        socket.room = pin;
        rooms[pin].users[socket.id] = name;

        socket.emit("loadStrokes", rooms[pin].strokes);
        io.to(pin).emit("updateUsers", Object.values(rooms[pin].users));
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

    // Undo sync: remove last N strokes from this socket, broadcast updated canvas
    socket.on("syncUndo", ({ pin }) => {
        if (!rooms[pin]) return;
        const strokes = rooms[pin].strokes;

        // Remove last stroke(s) belonging to this user
        let removed = 0;
        for (let i = strokes.length - 1; i >= 0 && removed < 1; i--) {
            if (strokes[i].uid === socket.id) {
                // Remove all segments of this stroke (same sid)
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

        // Tell everyone in room to re-render with new strokes list
        io.to(pin).emit("undoSync", strokes);
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
            name: rooms[pin].users[socket.id],
            message
        });
    });

    socket.on("disconnect", () => {
        const room = socket.room;
        if (room && rooms[room]) {
            delete rooms[room].users[socket.id];
            io.to(room).emit("updateUsers", Object.values(rooms[room].users));
        }
    });
});

server.listen(process.env.PORT || 10000, () => {
    console.log("DrawSync running on port", process.env.PORT || 10000);
});
