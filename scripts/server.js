const express = require("express");
const serveIndex = require("serve-index");

const app = express({strict: false});

app.use((req, res, next) => { 
  res.set("Service-Worker-Allowed", "/");
  res.set("Access-Control-Allow-Origin", "*");
  next();
});


app.use(express.static("./"), serveIndex("./", {icons: true}));

const fs = require("fs");
const path = require("path");
const bodyParser = require("body-parser");


app.use(bodyParser.json());

// app.get("/token", (req, res) => {
//   const data = fs.readFileSync('./scripts/api/token.json', 'utf8');
//    res.json({token: signToken(data)});
// });

app.listen("8000", () => {
  console.log(`Server listening on port 8000`);
});