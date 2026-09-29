import { RoomApp } from "./app/RoomApp.js?v=80";

const app = new RoomApp();
window.roomApp = app;
app.start();
