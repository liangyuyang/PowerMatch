import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';
const browser=await chromium.launch({headless:true,channel:'msedge'});
try {
const page=await browser.newPage({viewport:{width:1440,height:1000}});
await page.addInitScript(()=>localStorage.setItem('pm-language','zh'));
await page.goto('http://127.0.0.1:5173');
const angle=page.getByRole('combobox',{name:'光线照向板面的角度'});
await angle.selectOption('45');
const measured=page.getByRole('checkbox',{name:/这个 lux/});
await measured.check();assert.equal(await angle.isDisabled(),true);
await measured.uncheck();assert.equal(await angle.inputValue(),'45');
await angle.selectOption('0');
const launch=page.getByRole('button',{name:'AI 设计助手',exact:true});
assert.match(await launch.evaluate(e=>getComputedStyle(e).backgroundImage),/linear-gradient/);
await launch.click();
assert.equal(await page.getByText('哪些参数不让 AI 改',{exact:true}).evaluate(e=>e.closest('details').open),true);
await page.keyboard.press('Escape');assert.equal(await page.getByRole('dialog').count(),0);
assert.equal(await launch.evaluate(e=>e===document.activeElement),true);
for(const size of [{width:1440,height:1000},{width:390,height:844}]) {
 await page.setViewportSize(size);
 for(const img of await page.locator('img[src*="MOT-U125"]').all()) {
  assert.equal(await img.evaluate(e=>getComputedStyle(e).objectFit),'contain');
  assert.ok(await img.evaluate(e=>e.naturalWidth>0 && e.naturalHeight>0));
 }
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth+1));
 await page.screenshot({path:`tmp/zero-input-${size.width}.png`,fullPage:true});
}
console.log(JSON.stringify({result:'passed',checks:['gradient AI button','locks expanded','angle disabled/restored','Escape/focus','desktop/mobile aspect containment','no horizontal overflow']}));
} finally {await browser.close()}
