// Keep repository .env files out of the agent's iOS builds and development runs.
import { copyFileSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const envDir = join(root, 'src-tauri', 'target', 'ios-empty-env');
mkdirSync(envDir, { recursive: true });

// Tauri 2.11.2 generates `node tauri ios xcode-script` when invoked directly
// through Node. Route the generated phase through a stable repository script.
function prepareXcodePhase() {
  const apple = join(root, 'src-tauri', 'gen', 'apple');
  const appIcons = join(apple, 'Assets.xcassets', 'AppIcon.appiconset');
  for (const name of readdirSync(join(root, 'src-tauri', 'icons', 'ios'))) {
    if (name.endsWith('.png')) copyFileSync(join(root, 'src-tauri', 'icons', 'ios', name), join(appIcons, name));
  }
  const buildCommand = 'bash "$SRCROOT/../../../scripts/ios-xcode-build.sh"';
  const yamlPath = join(apple, 'project.yml');
  let yaml = readFileSync(yamlPath, 'utf8');
  if (!yaml.includes('OTHER_LDFLAGS:')) {
    yaml = yaml.replace(/^(      PRODUCT_BUNDLE_IDENTIFIER: .+)$/m,
      '$1\n      OTHER_LDFLAGS: ["$(inherited)", "-lz"]');
  }
  yaml = yaml.replace(/OTHER_LDFLAGS: \[([^\]]*)\]/g, (line, flags) =>
    flags.includes('MediaPlayer') ? line : `OTHER_LDFLAGS: [${flags}, "-framework", "MediaPlayer"]`);
  writeFileSync(yamlPath, yaml.replace(
    /^(\s+- script: ).*? ios xcode-script /m,
    (_, prefix) => prefix + buildCommand + ' '));
  const projectPath = join(apple, 'lomifynext-tauri.xcodeproj', 'project.pbxproj');
  let project = readFileSync(projectPath, 'utf8');
  // Rust's staticlib includes FFmpeg objects; Xcode must link their system zlib.
  if (!project.includes('OTHER_LDFLAGS =')) {
    project = project.replace(/^(\s+ALWAYS_EMBED_SWIFT_STANDARD_LIBRARIES = YES;)$/gm,
      '$1\n\t\t\t\tOTHER_LDFLAGS = ("$(inherited)", "-lz");');
  }
  project = project.replace(/OTHER_LDFLAGS = \((.*)\);/g, (line, flags) =>
    flags.includes('MediaPlayer') ? line : `OTHER_LDFLAGS = (${flags}, "-framework", "MediaPlayer");`);
  writeFileSync(projectPath, project.replace(
    /shellScript = ("(?:[^"\\]|\\.)*");/g,
    (line, encoded) => {
      const script = JSON.parse(encoded);
      if (!script.includes(' ios xcode-script ')) return line;
      return 'shellScript = ' + JSON.stringify(
        script.replace(/^.*? ios xcode-script /, buildCommand + ' ')) + ';';
    }));
}

if (process.argv[2] === 'prepare-project') {
  prepareXcodePhase();
  process.exit(0);
}
const xcodePhase = process.argv[2] === 'xcode-script';
const childEnv = { ...process.env, LOMIFY_ENV_DIR: envDir };
if (xcodePhase) {
  // The CLI resolves src-tauri by going two levels up from gen/apple.
  delete childEnv.npm_lifecycle_event;
  delete childEnv.PNPM_PACKAGE_NAME;
  delete childEnv.npm_config_user_agent;
}
const command = spawn(process.execPath,
  [join(root, 'node_modules', '@tauri-apps', 'cli', 'tauri.js'), 'ios', ...process.argv.slice(2)],
  { cwd: xcodePhase ? join(root, 'src-tauri', 'gen', 'apple') : root,
    stdio: 'inherit', env: childEnv });
command.on('error', error => { console.error(error.message); process.exitCode = 1; });
command.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else {
    if (code === 0 && process.argv[2] === 'init') prepareXcodePhase();
    process.exitCode = code ?? 1;
  }
});
