const express = require("express");
const serveIndex = require("serve-index");

const app = express({ strict: false });

app.use((req, res, next) => {
  res.set("Service-Worker-Allowed", "/");
  res.set("Access-Control-Allow-Origin", "*");
  next();
});

app.use(express.static("./"), serveIndex("./", { icons: true }));

const fs = require("fs");
const bodyParser = require("body-parser");
const port = "9090";

app.use(bodyParser.json());

app.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});
