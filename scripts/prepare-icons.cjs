// Expo's own asset pipeline creates square build variants without changing
// the source logos. The centered seals fit inside the square crop.
const { generateImageAsync } = require("@expo/image-utils");
const fs = require("node:fs/promises");
const path = require("node:path");

async function main() {
  const projectRoot = path.resolve(__dirname, "..");
  for (const [input, output, backgroundColor] of [
    ["icon.png", "icon-square.png", "#ffffff"],
    ["adaptive-icon.png", "adaptive-icon-square.png", "#00000000"],
  ]) {
    const { source } = await generateImageAsync({ projectRoot, cacheType: "scanner-icons" }, {
      src: path.join(projectRoot, "assets", input), name: output,
      width: 1024, height: 1024, resizeMode: "cover", backgroundColor,
    });
    await fs.writeFile(path.join(projectRoot, "assets", output), source);
    console.log(output + ": 1024 x 1024");
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
