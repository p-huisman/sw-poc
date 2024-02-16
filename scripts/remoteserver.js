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
  const response =  await fetch("https://demo.duendesoftware.com/connect/userinfo");
  if (response.status !== 200) {
    return res.status(response.status).json({message: "Error fetching data " + response.status});
  }

  const data = await response.json();
  return data;
});

app.listen("9001", () => {
  console.log(`Remote server listening on port 9001`);
});