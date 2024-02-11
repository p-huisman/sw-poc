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
const jwt = require('jsonwebtoken')
const bodyParser = require("body-parser");

const privateKey = fs.readFileSync(path.join(__dirname, 'keys', 'rsa.key'), 'utf8')

const signToken = (payload) => {
  try {
      return jwt.sign(payload, privateKey, { algorithm: 'RS256'});
  } catch (err) {
      /*
          TODO throw http 500 here 
          ! Dont send JWT error messages to the client
          ! Let exception handler handles this error
      */
      throw err
  }
};

app.use(bodyParser.json());

app.get("/token", (req, res) => {
  const data = fs.readFileSync('./scripts/api/token.json', 'utf8');
   res.json({token: signToken(data)});
});

app.listen("9000", () => {
  console.log(`Server listening on port 9000`);
});