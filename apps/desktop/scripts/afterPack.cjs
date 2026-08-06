/**
 * After pack on Windows:
 * - Embed app icon into Markdown2PDF.exe (taskbar / Explorer)
 * - Stamp VersionInfo so Properties shows PD, not Electron/GitHub
 *
 * We keep win.signAndEditExecutable=false so local/CI packs do not hit
 * winCodeSign symlink extraction failures. That also skips electron-builder's
 * own rcedit pass — so this hook owns icon + metadata.
 */
const path = require('path');
const fs = require('fs');
const rcedit = require('rcedit');

/** @param {string} semver e.g. 0.1.0 → 0.1.0.0 */
function toWindowsFileVersion(semver) {
  const parts = String(semver || '0.0.0')
    .split(/[.+-]/)
    .filter(Boolean)
    .map((p) => {
      const n = Number.parseInt(p, 10);
      return Number.isFinite(n) ? n : 0;
    });
  while (parts.length < 4) parts.push(0);
  return parts.slice(0, 4).join('.');
}

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'win32') return;

  const info = context.packager.appInfo;
  const productName = info.productName || 'Markdown2PDF';
  const exeName = `${info.productFilename}.exe`;
  const exePath = path.join(context.appOutDir, exeName);
  const iconPath = path.join(context.packager.projectDir, 'build', 'icon.ico');
  const version = info.version || '0.0.0';
  const winVersion = toWindowsFileVersion(version);
  const company = 'Pragmatic Disruptor, LLC.';
  const copyright =
    info.copyright || `Copyright © ${new Date().getUTCFullYear()} ${company}`;

  if (!fs.existsSync(exePath)) {
    throw new Error(`[afterPack] missing executable: ${exePath}`);
  }
  if (!fs.existsSync(iconPath)) {
    throw new Error(`[afterPack] missing icon: ${iconPath}`);
  }

  await rcedit(exePath, {
    icon: iconPath,
    'file-version': winVersion,
    'product-version': winVersion,
    'version-string': {
      CompanyName: company,
      FileDescription: productName,
      ProductName: productName,
      LegalCopyright: copyright,
      OriginalFilename: exeName,
      InternalName: productName,
    },
  });

  console.log(
    `[afterPack] branded ${exeName} · ${company} · ${productName} · ${winVersion}`,
  );
};
