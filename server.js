const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static("public"));

let rooms = {};

// Default public room
rooms["public"] = {
    users: {},
    strokes: []
};

io.on("connection", (socket) => {

    socket.on("joinRoom", ({ pin, name }) => {

        if (!rooms[pin]) {
            rooms[pin] = {
                users: {},
                strokes: []
            };
        }

        socket.join(pin);
        socket.room = pin;

        rooms[pin].users[socket.id] = name;

        socket.emit("loadStrokes", rooms[pin].strokes);

        io.to(pin).emit("notification", `${name} joined`);
        io.to(pin).emit("userList", Object.values(rooms[pin].users));
    });

    socket.on("draw", (data) => {
        const { pin, stroke } = data;
        if (!rooms[pin]) return;

        rooms[pin].strokes.push(stroke);
        socket.to(pin).emit("draw", stroke);
    });

    socket.on("clearBoard", (pin) => {
        if (!rooms[pin]) return;
        rooms[pin].strokes = [];
        io.to(pin).emit("clearBoard");
    });

    socket.on("disconnect", () => {
        const room = socket.room;
        if (room && rooms[room]) {
            delete rooms[room].users[socket.id];
            io.to(room).emit("userList", Object.values(rooms[room].users));
        }
    });
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => console.log("Server running on port", PORT));