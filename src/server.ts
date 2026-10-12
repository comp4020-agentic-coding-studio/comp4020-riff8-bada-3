import { createApp } from "./app.ts";

const PORT = Number(process.env.PORT ?? 8080);

// One SQLite file on the mounted volume: /data survives a restart or a
// redeploy, nothing else does (see fly.toml). DATA_DIR overrides it for a
// local run, where there's no volume.
const app = createApp({ dataDir: process.env.DATA_DIR ?? "/data" });

app.server.listen(PORT, "0.0.0.0", () => {
  console.log(JSON.stringify({ ts: new Date().toISOString(), action: "server.start", port: PORT }));
});
