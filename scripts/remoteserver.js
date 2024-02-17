const express = require("express");

const app = express({strict: false});
const fs = require("fs");
const path = require("path");



app.use((req, res, next) => { 
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Access-Control-Allow-Headers", "Authorization");
  next();
});


app.get("/api/data-sample-request", async (req, res) => {
  res.json({data: "This is a sample response from the remote server"});
});

app.listen("9001", () => {
  console.log(`Remote server listening on port 9001`);
});