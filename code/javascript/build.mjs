import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const buildFile = fileURLToPath(import.meta.url);
const projectRoot = resolve(dirname(buildFile), "../..");
const output = resolve(projectRoot, "dist");

if (output !== resolve(projectRoot, "dist") || !output.startsWith(`${projectRoot}${sep}`)) {
    throw new Error("The build output must remain inside this project.");
}

rmSync(output, { recursive: true, force: true });
mkdirSync(output, { recursive: true });

const htmlDirectory = resolve(projectRoot, "code/html");
for (const entry of readdirSync(htmlDirectory, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".html")) {
        continue;
    }
    const html = readFileSync(resolve(htmlDirectory, entry.name), "utf8")
        .replaceAll('"../css/', '"./css/')
        .replaceAll('"../javascript/', '"./javascript/')
        .replaceAll('"../../assets/', '"./assets/');
    writeFileSync(resolve(output, entry.name), html);
}

cpSync(resolve(projectRoot, "code/css"), resolve(output, "css"), { recursive: true });
cpSync(resolve(projectRoot, "code/javascript"), resolve(output, "javascript"), {
    recursive: true,
    filter: source => resolve(source) !== buildFile
});
cpSync(resolve(projectRoot, "assets"), resolve(output, "assets"), {
    recursive: true,
    filter: source => !source.endsWith(`${sep}.gitkeep`)
});

console.log("Built public site files in dist/.");
