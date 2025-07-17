import path from "path";
import {dirname} from "path";
import {fileURLToPath} from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));


const api = (app) => {
  app.use((req, res, next) => {
    res.set("Service-Worker-Allowed", "/");
    res.set("Access-Control-Allow-Origin", "*");
    
    next();
  });

  app.get("/demo/callback.html", (req, res) => {
    res.sendFile(path.join(__dirname, "callback.html"));
  });

  app.get("/particulieren/mijnpfzw/callback.html", (req, res) => {
    res.sendFile(path.join(__dirname, "callback.html"));
  });
};

export default api;
