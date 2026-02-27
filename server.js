const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static("public"));

let users = {};

io.on("connection", socket => {

    socket.on("join", name => {
        users[socket.id] = name;
        io.emit("userCount", Object.keys(users).length);
        io.emit("userList", Object.values(users));
    });

    socket.on("draw", data => {
        socket.broadcast.emit("draw", data);
    });

    socket.on("clear", () => {
        socket.broadcast.emit("clear");
    });

    socket.on("disconnect", () => {
        delete users[socket.id];
        io.emit("userCount", Object.keys(users).length);
        io.emit("userList", Object.values(users));
    });
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => {
    console.log("Server running on port " + PORT);
});