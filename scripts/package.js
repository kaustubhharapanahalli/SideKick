/**
 * package.js
 * Creates a production-ready ZIP file for the Chrome Web Store.
 * Usage: npm run package
 * 
 * © 2026 Kaustubh Harapanahalli. All rights reserved.
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const PACKAGE_NAME = 'sidekick.zip';
const DIST_DIR = path.join(__dirname, '..', 'dist');

// Files and directories to include
const INCLUDES = [
  'manifest.json',
  'scripts/',
  'src/',
  'assets/',
  'README.md',
  'LICENSE'
];

// Files to exclude from those directories
const EXCLUDES = [
  '*.DS_Store',
  '*.map',
  'scripts/*.test.js',
  'tests/'
];

function package() {
  console.log('📦 Packaging Sidekick for production...');

  // Create dist directory if it doesn't exist
  if (!fs.existsSync(DIST_DIR)) {
    fs.mkdirSync(DIST_DIR);
  }

  const zipPath = path.join(DIST_DIR, PACKAGE_NAME);
  
  // Remove existing zip if it exists
  if (fs.existsSync(zipPath)) {
    fs.unlinkSync(zipPath);
  }

  try {
    // Construct the zip command
    const includesStr = INCLUDES.join(' ');
    const excludesStr = EXCLUDES.map(x => `-x "${x}"`).join(' ');
    
    // Run from the project root
    process.chdir(path.join(__dirname, '..'));
    
    console.log(`Creating ${PACKAGE_NAME}...`);
    execSync(`zip -r dist/${PACKAGE_NAME} ${includesStr} ${excludesStr}`);
    
    const stats = fs.statSync(zipPath);
    const sizeInMB = (stats.size / (1024 * 1024)).toFixed(2);
    
    console.log(`\n✅ Successfully packaged: dist/${PACKAGE_NAME} (${sizeInMB} MB)`);
    console.log('You can now upload this file to the Chrome Web Store Developer Dashboard.');
  } catch (error) {
    console.error('❌ Packaging failed:', error.message);
    process.exit(1);
  }
}

package();
