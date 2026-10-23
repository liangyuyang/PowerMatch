import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { execFileSync } from "node:child_process";
import {readFileSync} from "node:fs";
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
      name:'local-ocr-binary-assets',
      configureServer(server){
        // Vite otherwise labels .gz as Content-Encoding:gzip without a MIME.
        // Serve the pinned language files exactly like production static assets.
        server.middlewares.use((request,response,next)=>{
          const pathname=request.url?.split('?')[0]??'';
          if(!/^\/ocr-assets\/tesseract-7\.0\.0-core-7\.0\.0-data-1\.0\.0-best-int\/lang\/(eng|chi_sim|jpn|kor|spa|fra|deu)\.traineddata\.gz$/.test(pathname))return next();
          try{
            const bytes=readFileSync(new URL('./public'+pathname,import.meta.url));
            response.setHeader('Content-Type','application/gzip');
            response.setHeader('Content-Length',bytes.length);
            response.setHeader('Cache-Control','public, max-age=31536000, immutable');
            response.setHeader('X-Content-Type-Options','nosniff');
            response.end(request.method==='HEAD'?undefined:bytes);
          }catch{next();}
        });
      },
    },
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
  build: { outDir: "dist", assetsDir: "bundles", sourcemap: false },
});
