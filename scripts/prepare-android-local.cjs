const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const source = path.resolve(process.argv[2]);
const target = path.resolve(process.argv[3]);
const tools = path.resolve(process.env.PUBLIC, 'ExpoAndroid');
if (!target.startsWith(tools + path.sep) || target === source) {
  throw new Error('The Android staging folder must be inside the local build tools folder.');
}
fs.mkdirSync(target, { recursive: true });

// Refresh only these owned source copies, preserving native build caches.
for (const name of ['src', 'assets', 'scripts', 'plugins']) {
  const destination = path.resolve(target, name);
  if (!destination.startsWith(target + path.sep)) throw new Error('Invalid staging path');
  fs.rmSync(destination, { recursive: true, force: true });
  const original = path.join(source, name);
  if (fs.existsSync(original)) fs.cpSync(original, destination, { recursive: true });
}
for (const name of ['App.js', 'app.json', 'app.config.js', 'app.config.cjs', 'app.config.ts', 'package.json', 'package-lock.json', 'babel.config.js', 'metro.config.js', 'tsconfig.json']) {
  const original = path.join(source, name);
  const destination = path.join(target, name);
  if (fs.existsSync(original)) fs.copyFileSync(original, destination);
  else fs.rmSync(destination, { force: true });
}

const digest = (files) => {
  const hash = crypto.createHash('sha256');
  for (const file of files) {
    if (fs.existsSync(file)) hash.update(file.slice(target.length)).update(fs.readFileSync(file));
  }
  return hash.digest('hex');
};
const gather = (directory) => fs.existsSync(directory)
  ? fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)).flatMap((entry) => {
      const file = path.join(directory, entry.name);
      return entry.isDirectory() ? gather(file) : [file];
    })
  : [];
const dependencyHash = digest([path.join(target, 'package-lock.json')]);
const nativeHash = digest([
  ...['app.json', 'app.config.js', 'app.config.cjs', 'app.config.ts', 'package-lock.json'].map((name) => path.join(target, name)),
  ...gather(path.join(target, 'plugins')),
  ...gather(path.join(target, 'assets')),
]);
const statePath = path.join(target, '.local-build-state.json');
const previous = fs.existsSync(statePath) ? JSON.parse(fs.readFileSync(statePath, 'utf8')) : {};
console.log(JSON.stringify({
  statePath,
  dependencyHash,
  nativeHash,
  installNeeded: previous.dependencyHash !== dependencyHash || !fs.existsSync(path.join(target, 'node_modules', 'expo', 'package.json')),
  prebuildNeeded: previous.nativeHash !== nativeHash || !fs.existsSync(path.join(target, 'android', 'gradlew.bat')),
}));
