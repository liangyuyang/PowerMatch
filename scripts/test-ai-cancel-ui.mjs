import { chromium, expect } from '@playwright/test';
import fs from 'node:fs';
import assert from 'node:assert/strict';
const origin='http://127.0.0.1:5173';
const {token}=JSON.parse(fs.readFileSync('tmp/test-admin-browser.json','utf8'));
const browser=await chromium.launch({headless:true,channel:'msedge'});
try {
 const ctx=await browser.newContext({locale:'zh-CN'});
 await ctx.addCookies([{name:'pm_session',value:token,url:origin}]);
 const page=await ctx.newPage(); const errors=[]; const requests=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/api/ai/models',r=>r.fulfill({json:{models:[{id:'fixture',name:'QA mocked model',provider:'deepseek',isDefault:true}]}}));
 await page.route('**/api/ai/assist',async r=>{
   requests.push(r.request().postDataJSON());
   await new Promise(resolve=>setTimeout(resolve,1500));
   try {await r.fulfill({status:503,json:{error:'fixture-no-provider-called'}});} catch {}
 });
 await page.goto(origin);
 await expect(page.getByRole('button',{name:'保存版本',exact:true})).toBeEnabled();
 const title=await page.locator('.design-bar input').inputValue();
 const launch=page.getByRole('button',{name:'AI 设计助手',exact:true});
 await launch.click();
 await page.getByLabel('设计需求').fill('QA canceled request');
 await page.getByRole('button',{name:'发送',exact:true}).dblclick();
 await expect(page.getByRole('button',{name:'取消等待',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'取消等待',exact:true}).click();
 await expect(page.getByRole('alert')).toContainText('再次提交可能再次计费');
 await expect(page.getByLabel('设计需求')).toHaveValue('QA canceled request');
 assert.equal(requests.length,1);
 assert.match(requests[0].requestId,/^[a-f0-9-]{36}$/);
 await page.keyboard.press('Escape');
 await expect(launch).toBeFocused();
 assert.equal(await page.locator('.design-bar input').inputValue(),title);
 await launch.click();
 await expect(page.getByLabel('设计需求')).toHaveValue('QA canceled request');
 await page.getByRole('button',{name:'发送',exact:true}).click();
 await expect(page.getByRole('button',{name:'取消等待',exact:true})).toBeVisible();
 await page.keyboard.press('Escape');
 await expect(launch).toBeFocused();
 await page.waitForTimeout(1800);
 assert.equal(requests.length,2);
 assert.notEqual(requests[0].requestId,requests[1].requestId);
 assert.deepEqual(errors,[]);
 console.log(JSON.stringify({passed:true,checks:['double submit yields one request with UUID','cancel preserves design and prompt, warns about possible provider billing','close aborts pending request and returns focus','manual new request has distinct ID'],realProvider:false}));
}finally{await browser.close();}
