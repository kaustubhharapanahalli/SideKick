/**
 * @file manifest.test.js
 * Validates the Chrome Extension manifest for correctness and Chrome Web Store compliance.
 */

const fs = require('fs');
const path = require('path');

const manifestPath = path.join(__dirname, '..', 'manifest.json');
let manifest;

beforeAll(() => {
  const raw = fs.readFileSync(manifestPath, 'utf8');
  manifest = JSON.parse(raw);
});

describe('Manifest V3 Compliance', () => {
  test('uses manifest_version 3', () => {
    expect(manifest.manifest_version).toBe(3);
  });

  test('has a name', () => {
    expect(manifest.name).toBeDefined();
    expect(manifest.name.length).toBeGreaterThan(0);
    expect(manifest.name.length).toBeLessThanOrEqual(45); // Chrome Web Store limit
  });

  test('has a description', () => {
    expect(manifest.description).toBeDefined();
    expect(manifest.description.length).toBeGreaterThan(0);
    expect(manifest.description.length).toBeLessThanOrEqual(132); // CWS limit
  });

  test('has a valid semver version', () => {
    expect(manifest.version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  test('has required permissions', () => {
    expect(manifest.permissions).toContain('storage');
    expect(manifest.permissions).toContain('activeTab');
    expect(manifest.permissions).toContain('sidePanel');
  });

  test('declares a background service worker', () => {
    expect(manifest.background).toBeDefined();
    expect(manifest.background.service_worker).toBeDefined();
  });

  test('declares a side panel', () => {
    expect(manifest.side_panel).toBeDefined();
    expect(manifest.side_panel.default_path).toBeDefined();
  });

  test('background service worker file exists', () => {
    const swPath = path.join(__dirname, '..', manifest.background.service_worker);
    expect(fs.existsSync(swPath)).toBe(true);
  });

  test('side panel HTML file exists', () => {
    const spPath = path.join(__dirname, '..', manifest.side_panel.default_path);
    expect(fs.existsSync(spPath)).toBe(true);
  });

  test('options page file exists', () => {
    if (manifest.options_ui) {
      const optPath = path.join(__dirname, '..', manifest.options_ui.page);
      expect(fs.existsSync(optPath)).toBe(true);
    }
  });

  test('does not request unnecessary permissions', () => {
    const dangerous = ['clipboardRead', 'clipboardWrite', 'debugger', 'downloads', 'history', 'bookmarks'];
    dangerous.forEach(p => {
      expect(manifest.permissions).not.toContain(p);
    });
  });
});
