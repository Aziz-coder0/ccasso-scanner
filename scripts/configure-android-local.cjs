const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(process.argv[2] || '');
const localTest = process.argv.includes('--local-test');
const config = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8')).expo;
const gradlePath = path.join(root, 'android', 'app', 'build.gradle');
const stringsPath = path.join(root, 'android', 'app', 'src', 'main', 'res', 'values', 'strings.xml');
let gradle = fs.readFileSync(gradlePath, 'utf8');
// Only generated native files are patched. The public app ID stays in app.json.
gradle = gradle.replace(/\r?\n\s*\/\/ CCASSO_LOCAL_TEST_START[\s\S]*?\/\/ CCASSO_LOCAL_TEST_END\r?\n/g, '\n');
if (localTest) {
  if (!/buildTypes\s*\{[\s\S]*?release\s*\{/.test(gradle)) throw new Error('Missing Android release build type.');
  gradle = gradle.replace(/(buildTypes\s*\{[\s\S]*?release\s*\{)/, '$1\n            // CCASSO_LOCAL_TEST_START\n            applicationIdSuffix ".local"\n            // CCASSO_LOCAL_TEST_END\n');
}
fs.writeFileSync(gradlePath, gradle);
const xmlEscape = (value) => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, "\\'");
const name = config.name;
let strings = fs.readFileSync(stringsPath, 'utf8');
if (!/<string name="app_name">[\s\S]*?<\/string>/.test(strings)) throw new Error('Missing Android app name.');
strings = strings.replace(/(<string name="app_name">)[\s\S]*?(<\/string>)/, (_, start, end) => start + xmlEscape(name) + end);
fs.writeFileSync(stringsPath, strings);
console.log(`Configured ${name} (${config.android.package}${localTest ? '.local' : ''}).`);
