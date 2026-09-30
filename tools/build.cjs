/* รวม src/* เป็น index.html ไฟล์เดียว: node tools/build.cjs */
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..'), rd = f => fs.readFileSync(path.join(root, 'src', f), 'utf8');
let html = rd('index.template.html');
const put = (k, v) => { html = html.split(k).join('\u0000' + k); html = html.replace('\u0000' + k, () => v).split('\u0000').join(''); };
put('/*CSS*/', rd('style.css')); put('/*CORE*/', rd('core.js')); put('/*APP*/', rd('app.js'));
fs.writeFileSync(path.join(root, 'index.html'), html);
console.log('index.html', (html.length / 1024).toFixed(0) + ' KB');
