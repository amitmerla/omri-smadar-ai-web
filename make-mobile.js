// mobile.html is generated from index.html so the two never drift: node make-mobile.js
const fs = require('fs'), path = require('path');
let h = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
const a = h.indexOf('<script>\n// Phones'), b = h.indexOf('</script>', a) + '</script>'.length;
if (a < 0) throw new Error('redirect script not found in index.html');
h = h.slice(0, a) + `<script>
// Desktop browsers go back to the full page. ?view=mobile forces this one.
(function () {
  var forced = /[?&]view=mobile/.test(location.search);
  var phone = /Android.+Mobile|iPhone|iPod|Windows Phone|webOS|BlackBerry|Opera Mini/i.test(navigator.userAgent) ||
    (matchMedia('(pointer: coarse)').matches && Math.min(screen.width, screen.height) < 600);
  if (!phone && !forced) location.replace('index.html' + location.hash);
})();
</script>` + h.slice(b);
h = h.replace('<html lang="en">', '<html lang="en" class="m">')
  .replace('<p class="gate-hint">Press and hold</p>', '<p class="gate-hint">Touch and hold</p>')
  .replace('Drag to spin. Click the front one to land.', 'Swipe to spin. Tap the front one to land.');
fs.writeFileSync(path.join(__dirname, 'mobile.html'), h);
console.log('mobile.html written');
