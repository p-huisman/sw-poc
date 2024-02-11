const express = require("express");

const app = express({strict: false});
const fs = require("fs");
const path = require("path");
const jwt = require('jsonwebtoken')

const publicKey = fs.readFileSync(path.join(__dirname, 'keys', 'rsa.key.pub'), 'utf8')

const verifyToken = (token) => {
  try {
      return jwt.verify(token, publicKey, { algorithm: 'RS256'});
  } catch (err) {
      /*
          TODO throw http 500 here 
          ! Dont send JWT error messages to the client
          ! Let exception handler handles this error
      */
      throw err
  }
}

app.use((req, res, next) => { 
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Access-Control-Allow-Headers", "Authorization");
  next();
});


app.get("/api/data-sample-request", (req, res) => {
  const data = verifyToken(req.headers["authorization"].split(" ")[1]);
  res.json({message: "Hello " + data.bsn});
});

app.listen("9001", () => {
  console.log(`Remote server listening on port 9001`);
});