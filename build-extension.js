#!/usr/bin/env node

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

console.log('🔨 Building Chrome Extension...');

try {
  // Clean and build
  console.log('📦 Running Vite build...');
  execSync('npm run build', { stdio: 'inherit' });

  // Verify build output
  const distPath = path.join(__dirname, 'dist');
  const expectedFiles = [
    'background.js',
    'content/index.js',
    'firebase.js',
    'manifest.json',
    'index.html'
  ];

  console.log('\n✅ Verifying build output...');
  for (const file of expectedFiles) {
    const filePath = path.join(distPath, file);
    if (fs.existsSync(filePath)) {
      const stats = fs.statSync(filePath);
      console.log(`✓ ${file} (${Math.round(stats.size / 1024)}KB)`);
    } else {
      console.error(`❌ Missing: ${file}`);
      process.exit(1);
    }
  }

  // Verify manifest content
  const manifestPath = path.join(distPath, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  
  console.log('\n📋 Manifest verification:');
  console.log(`✓ Background script: ${manifest.background?.service_worker}`);
  console.log(`✓ Content scripts: ${manifest.content_scripts?.[0]?.js?.join(', ')}`);
  console.log(`✓ Web accessible resources: ${manifest.web_accessible_resources?.[0]?.resources?.join(', ')}`);

  // Check if content script exists
  const contentScriptPath = path.join(distPath, manifest.content_scripts[0].js[0]);
  if (fs.existsSync(contentScriptPath)) {
    const contentSize = fs.statSync(contentScriptPath).size;
    console.log(`✓ Content script size: ${Math.round(contentSize / 1024)}KB`);
  } else {
    console.error(`❌ Content script not found: ${manifest.content_scripts[0].js[0]}`);
    process.exit(1);
  }

  console.log('\n🎉 Build completed successfully!');
  console.log('\n📝 Next steps:');
  console.log('1. Load the extension in Chrome from the dist/ folder');
  console.log('2. Check the console for any injection errors');
  console.log('3. Test on Facebook to verify content script communication');

} catch (error) {
  console.error('❌ Build failed:', error.message);
  process.exit(1);
}
