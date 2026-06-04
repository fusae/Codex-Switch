import { BrowserWindow, Menu, Tray, app, nativeImage } from 'electron';
import { join } from 'path';

let tray: Tray | null = null;
let panel: BrowserWindow | null = null;

const iconSvg = `
<svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 36 36">
  <defs>
    <linearGradient id="bg" x1="4" y1="4" x2="32" y2="32" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#111827"/>
      <stop offset="0.55" stop-color="#18181b"/>
      <stop offset="1" stop-color="#0f766e"/>
    </linearGradient>
    <linearGradient id="a" x1="8" y1="8" x2="29" y2="29" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#ffffff"/>
      <stop offset="1" stop-color="#8ff8ff"/>
    </linearGradient>
  </defs>
  <rect x="3" y="3" width="30" height="30" rx="8" fill="url(#bg)"/>
  <path d="M25 14a8.5 8.5 0 0 0-14.2-.8" fill="none" stroke="url(#a)" stroke-width="3.2" stroke-linecap="round"/>
  <path d="M11 13H6.9l3.9 4.1 4.1-4.1H11Z" fill="url(#a)"/>
  <path d="M11 22a8.5 8.5 0 0 0 14.2.8" fill="none" stroke="url(#a)" stroke-width="3.2" stroke-linecap="round"/>
  <path d="M25 23h4.1l-3.9-4.1-4.1 4.1H25Z" fill="url(#a)"/>
</svg>`;

function createIcon() {
  const icon = nativeImage.createFromDataURL(`data:image/svg+xml;base64,${Buffer.from(iconSvg).toString('base64')}`);
  return icon.resize({ width: 20, height: 20 });
}

export function createTray(): void {
  tray = new Tray(createIcon());
  tray.setToolTip('Codex Switch');
  if (process.platform === 'darwin') {
    tray.setTitle(' CS');
  }
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Codex Switch', enabled: false },
    { type: 'separator' },
    { label: '打开面板', click: () => togglePanel() },
    { label: '退出', click: () => app.quit() }
  ]));
  tray.on('click', () => togglePanel());
}

function createPanel(): BrowserWindow {
  const win = new BrowserWindow({
    width: 360,
    height: 460,
    resizable: false,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: true,
    vibrancy: 'popover',
    visualEffectState: 'active',
    alwaysOnTop: true,
    skipTaskbar: true,
    title: 'Codex Switch',
    webPreferences: {
      preload: join(__dirname, '..', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  win.loadFile(join(__dirname, '..', 'renderer', 'index.html'));
  win.on('blur', () => win.hide());
  win.on('closed', () => { panel = null; });
  return win;
}

function togglePanel(): void {
  if (!panel) panel = createPanel();
  if (panel.isVisible()) {
    panel.hide();
    return;
  }

  const bounds = tray?.getBounds();
  if (bounds) {
    const winBounds = panel.getBounds();
    panel.setPosition(
      Math.round(bounds.x + bounds.width / 2 - winBounds.width / 2),
      Math.round(bounds.y + bounds.height + 8),
      false
    );
  }
  panel.show();
  panel.focus();
}
