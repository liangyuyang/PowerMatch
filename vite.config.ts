import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { execFileSync } from "node:child_process";
const git = (...args: string[]) =>
  execFileSync("git", args, { encoding: "utf8" }).trim();
const revision = git("rev-parse", "--short=7", "HEAD");
const version = `V0.1.${git("rev-list", "--first-parent", "--count", "HEAD")}`;
const today = new Date(Date.now() + 8 * 3600000);
const releaseDate = `${today.getUTCFullYear()}.${today.getUTCMonth() + 1}.${today.getUTCDate()}`;
export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(version),
    __APP_REVISION__: JSON.stringify(revision),
    __APP_DATE__: JSON.stringify(releaseDate),
  },
  plugins: [
    react(),
    {
      name: "release-version",
      generateBundle() {
        this.emitFile({
          type: "asset",
          fileName: "version.json",
          source: JSON.stringify({ version, revision, date: releaseDate }),
        });
      },
    },
  ],
  server: { port: 5173, proxy: { "/api": "http://127.0.0.1:8787" } },
  build: { outDir: "dist", sourcemap: false },
});
