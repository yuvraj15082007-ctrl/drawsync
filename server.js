const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static("public"));

let rooms = {};

function generateRoomPin() {
    return Math.floor(100000 + Math.random() * 900000).toString();
}

io.on("connection", socket => {

    socket.on("createRoom", name => {
        const pin = generateRoomPin();

        rooms[pin] = {
            users: {},
            strokes: []
        };

        socket.join(pin);
        rooms[pin].users[socket.id] = name;

        socket.emit("roomCreated", pin);
        io.to(pin).emit("notification", name + " created the room");
        io.to(pin).emit("userList", Object.values(rooms[pin].users));
    });

    socket.on("joinRoom", ({ pin, name }) => {

        if (!rooms[pin]) {
            socket.emit("roomError", "Room not found");
            return;
        }

        socket.join(pin);
        rooms[pin].users[socket.id] = name;

        socket.emit("loadStrokes", rooms[pin].strokes);

        io.to(pin).emit("notification", name + " joined the room");
        io.to(pin).emit("userList", Object.values(rooms[pin].users));
    });

    socket.on("draw", ({ pin, stroke }) => {
        if (!rooms[pin]) return;

        rooms[pin].strokes.push(stroke);
        socket.to(pin).emit("draw", stroke);
    });

    socket.on("clear", pin => {
        if (!rooms[pin]) return;

        rooms[pin].strokes = [];
        io.to(pin).emit("clear");
    });

    socket.on("disconnect", () => {
        for (let pin in rooms) {
            if (rooms[pin].users[socket.id]) {
                const name = rooms[pin].users[socket.id];
                delete rooms[pin].users[socket.id];

                io.to(pin).emit("notification", name + " left the room");
                io.to(pin).emit("userList", Object.values(rooms[pin].users));
            }
        }
    });

});

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => {
    console.log("Server running on port " + PORT);
});