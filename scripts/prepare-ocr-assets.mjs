import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";

const root = process.cwd(),
  languages = ["eng", "chi_sim", "jpn", "kor", "spa", "fra", "deu"];
const json = async (relative) =>
  JSON.parse(
    await fs.readFile(
      path.join(root, "node_modules", relative, "package.json"),
      "utf8",
    ),
  );
const tesseract = await json("tesseract.js"),
  core = await json("tesseract.js-core");
const dataVersions = await Promise.all(
  languages.map(async (lang) => [
    lang,
    (await json("@tesseract.js-data/" + lang)).version,
  ]),
);
if (
  dataVersions.some(([, version]) => version !== "1.0.0") ||
  tesseract.version !== "7.0.0" ||
  core.version !== "7.0.0"
)
  throw Error(
    "OCR dependency versions changed; review asset version paths before preparing assets",
  );
const version = "tesseract-7.0.0-core-7.0.0-data-1.0.0-best-int";
const directory = path.join(root, "public", "ocr-assets", version),
  files = [];
async function copy(relative, target) {
  const source = path.join(root, "node_modules", relative),
    destination = path.join(directory, target);
  await fs.mkdir(path.dirname(destination), { recursive: true });
  const bytes = await fs.readFile(source);
  await fs.writeFile(destination, bytes);
  files.push({
    file: target,
    bytes: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  });
}
await copy("tesseract.js/dist/worker.min.js", "worker.min.js");
await copy(
  "tesseract.js/dist/worker.min.js.LICENSE.txt",
  "worker.min.js.LICENSE.txt",
);
await copy("tesseract.js/LICENSE.md", "licenses/tesseract-LICENSE.md");
await copy("tesseract.js-core/LICENSE", "licenses/core-LICENSE");
for (const name of (
  await fs.readdir(path.join(root, "node_modules/tesseract.js-core"))
).filter((name) =>
  /^tesseract-core(?:-(?:simd|relaxedsimd))?(?:-lstm)?\.wasm(?:\.js)?$/.test(
    name,
  ),
))
  await copy("tesseract.js-core/" + name, "core/" + name);
for (const lang of languages) {
  await copy(
    "@tesseract.js-data/" +
      lang +
      "/4.0.0_best_int/" +
      lang +
      ".traineddata.gz",
    "lang/" + lang + ".traineddata.gz",
  );
  await copy(
    "@tesseract.js-data/" + lang + "/package.json",
    "licenses/" + lang + "-package.json",
  );
}
await fs.copyFile(path.join(root,'docs/third-party/tessdata-LICENSE.txt'),path.join(directory,'licenses/tessdata-LICENSE.txt'));
await fs.writeFile(
  path.join(directory, "manifest.json"),
  JSON.stringify(
    {
      version,
      tesseract: tesseract.version,
      core: core.version,
      languageData: Object.fromEntries(dataVersions),
      languageSource: "4.0.0_best_int",
      files,
    },
    null,
    2,
  ) + "\n",
);
console.log(
  `Prepared ${files.length} local OCR assets at /ocr-assets/${version}/`,
);
