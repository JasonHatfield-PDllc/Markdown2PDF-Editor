/**
 * Embed the app icon into Markdown2PDF.exe after pack.
 *
 * We keep win.signAndEditExecutable=false so local/CI packs do not hit
 * winCodeSign symlink extraction failures. That also skips electron-builder's
 * rcedit pass — which is what Windows uses for the taskbar icon.
 */
const path = require('path');
const fs = require('fs');
const rcedit = require('rcedit');

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'win32') return;

  const exeName = `${context.packager.appInfo.productFilename}.exe`;
  const exePath = path.join(context.appOutDir, exeName);
  const iconPath = path.join(context.packager.projectDir, 'build', 'icon.ico');

  if (!fs.existsSync(exePath)) {
    throw new Error(`[afterPack] missing executable: ${exePath}`);
  }
  if (!fs.existsSync(iconPath)) {
    throw new Error(`[afterPack] missing icon: ${iconPath}`);
  }

  await rcedit(exePath, { icon: iconPath });
  console.log(`[afterPack] embedded icon into ${exePath}`);
};
