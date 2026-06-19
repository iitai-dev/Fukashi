import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import * as esbuild from "esbuild";

const outdir = join(process.cwd(), "test/browser/.tmp");
mkdirSync(outdir, { recursive: true });

await esbuild.build({
  entryPoints: ["test/browser/stress-app.tsx"],
  bundle: true,
  format: "iife",
  sourcemap: true,
  outfile: join(outdir, "stress-app.js"),
  jsx: "automatic",
  define: {
    "process.env.NODE_ENV": '"production"'
  }
});

writeFileSync(
  join(outdir, "index.html"),
  `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Fukashi browser stress</title>
    <style>
      html, body { margin: 0; min-height: 100%; font-family: system-ui, sans-serif; }
      body { background: #f6f7f9; }
      #root { width: 960px; margin: 0 auto; }
      .tile { box-sizing: border-box; border: 1px solid #c6ced8; background: white; overflow: hidden; }
      .tile > span { display: block; height: 100%; background: linear-gradient(135deg, #d8eee2, #dee4f8); }
    </style>
  </head>
  <body>
    <div id="root"></div>
    <script src="./stress-app.js"></script>
  </body>
</html>
`,
  "utf8"
);
