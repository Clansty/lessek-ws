import { createServer } from "https";
import WebSocket, { WebSocketServer } from "ws";
import { readFileSync } from "fs";
import sleep from "sleep-promise";

const IP = "11.11.1.40";

(async () => {
  const dohQuery = await fetch("https://cloudflare-dns.com/dns-query?name=kessel-ws.parsec.app&type=A", {
    headers: {
      accept: "application/dns-json",
    },
  });
  const dohResult = await dohQuery.json();
  const realIp = dohResult.Answer.find((it) => it.type === 1).data;

  console.log("Real IP:", realIp);

  const server = createServer({
    cert: readFileSync("./cert/kessel-ws.parsec.app.crt"),
    key: readFileSync("./cert/kessel-ws.parsec.app.key"),
  });
  const wss = new WebSocketServer({ server });

  wss.on("connection", function connection(ws, request) {
    let realConnOpen = false;
    console.log("Request:", request.url);
    const realConn = new WebSocket(
      `wss://kessel-ws.parsec.app${request.url}`,
      // request.headers["sec-websocket-protocol"],
      {
        lookup: (host, opts, cb) => cb(undefined, realIp, 4),
        headers: {
          "Sec-WebSocket-Key": request.headers["sec-websocket-key"],
        },
        protocolVersion: Number(request.headers["sec-websocket-version"]),
      }
    );
    realConn.on("error", (err) => console.log("Real connection error:", err));
    realConn.on("open", () => {
      console.log("Real connection open");
      realConnOpen = true;
    });
    realConn.on("message", (data) => {
      console.log("received from real connection: %s", data);
      const json = JSON.parse(data.toString());
      if (json.action === "answer_relay") {
        ws.send(JSON.stringify(json));
        ws.send(
          JSON.stringify({
            action: "candex_relay",
            payload: {
              to: json.payload.to,
              attempt_id: json.payload.attempt_id,
              data: {
                from_stun: false,
                ip: IP,
                lan: true,
                port: 21731,
                sync: false,
                ver_data: 1,
                versions: { audio: 1, bud: 1, control: 1, init: 1, p2p: 1, video: 1 },
              },
              from: json.payload.from,
            },
            version: 1,
          })
        );
      }
    });

    ws.on("error", console.error);

    ws.on("message", async function message(data) {
      console.log("received: %s", data);
      const json = JSON.parse(data.toString());
      if (json.action === "offer") {
        while (!realConnOpen) {
          await sleep(200);
        }
        realConn.send(JSON.stringify(json));
        console.log("Send offer");
      }
    });
  });

  server.listen(443);
  console.log("Server started");
})();
