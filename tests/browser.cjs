const assert=require('node:assert/strict');
const fs=require('node:fs');
let playwright;playwright = require('playwright');
(async()=>{
 const browser=await playwright.chromium.launch({channel:'msedge',headless:true});
 try{
 const page=await browser.newPage({viewport:{width:1440,height:1000}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:4173');const view=page.locator('#preview');const source=page.frameLocator('#demo');
 await view.getByRole('heading',{name:'Community workshops',exact:true}).waitFor();
 await view.getByLabel('Full name (required)',{exact:true}).fill('Alex Example');await view.getByLabel('Full name (required)',{exact:true}).press('Tab');
 assert.equal(await source.locator('#name').inputValue(),'Alex Example');
 await view.getByLabel('Email address (required)',{exact:true}).fill('invalid');await view.getByLabel('Email address (required)',{exact:true}).press('Tab');
 assert.equal(await view.getByLabel('Email address (required)',{exact:true}).getAttribute('aria-invalid'),'true');
 await view.getByLabel('Email address (required)',{exact:true}).fill('alex@example.com');await view.getByLabel('Email address (required)',{exact:true}).press('Tab');
 await view.getByLabel('Workshop',{exact:true}).selectOption('web');assert.equal(await source.locator('#workshop').inputValue(),'web');
 await view.getByLabel('Send me workshop updates (optional)',{exact:true}).check();assert.equal(await source.locator('#updates').isChecked(),true);
 await view.getByRole('button',{name:'Register for workshop',exact:true}).click();assert.equal(await source.locator('#feedback').textContent(),'');
 await view.getByRole('button',{name:'Cancel',exact:true}).click();assert.equal(await source.locator('#feedback').textContent(),'');
 await view.getByRole('button',{name:'Register for workshop',exact:true}).click();await view.getByRole('button',{name:'Confirm action',exact:true}).click();
 await view.getByText('Registration complete, Alex Example.',{exact:false}).waitFor();
 await view.getByLabel('Search workshops',{exact:true}).fill('website');await view.getByLabel('Search workshops',{exact:true}).press('Tab');await view.getByRole('button',{name:'Search',exact:true}).click();await view.getByRole('button',{name:'Confirm action',exact:true}).click();
 await page.waitForFunction(()=>document.querySelector('#demo').contentDocument.querySelectorAll('#results article').length===1);
 await view.getByRole('button',{name:'Larger text',exact:true}).click();await page.reload();await view.locator('.access.large').waitFor();
 await page.screenshot({path:'test-results/desktop.png',fullPage:true});await page.setViewportSize({width:390,height:844});await page.screenshot({path:'test-results/mobile.png',fullPage:true});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 const fixture=await browser.newPage();await fixture.goto('http://127.0.0.1:4173/app/demo.html');await fixture.addScriptTag({path:'extension/engine.js'});
 const edgeCases=await fixture.evaluate(()=>{const engine=AccessEngine.create(document);const pass=document.createElement('input');pass.type='password';pass.value='secret';document.body.append(pass);const snapshot=engine.scan();const key=snapshot.items.find(x=>x.label==='Search'&&x.kind==='action').id;document.querySelector('#search-form button').remove();let stale=false;try{engine.activate(key);}catch{stale=true;}return {stale,secret:JSON.stringify(snapshot).includes('secret')};});assert.deepEqual(edgeCases,{stale:true,secret:false});
 // Theme and focus-mode behaviour of the shared UI.
 const panel=page.locator('#preview .access');
 await page.setViewportSize({width:1440,height:1000});
 await page.getByRole('button',{name:'Dark theme',exact:true}).first().click();
 assert.equal(await panel.getAttribute('data-resolved'),'dark');assert.equal(await page.evaluate(()=>document.documentElement.dataset.theme),'dark');
 await view.getByRole('button',{name:'Light theme',exact:true}).click();assert.equal(await panel.getAttribute('data-resolved'),'light');assert.equal(await page.evaluate(()=>document.documentElement.dataset.theme),'light');
 await view.getByRole('button',{name:'Focus mode',exact:true}).click();await view.locator('.count',{hasText:/Slide 1 of \d/}).waitFor();
 // Slide 1 is the whole redesigned page, with its form and search box.
 await view.getByLabel('Full name (required)',{exact:true}).waitFor();await view.getByLabel('Search workshops',{exact:true}).waitFor();
 await view.getByRole('button',{name:'Next slide',exact:true}).click();await view.locator('.count',{hasText:/Slide 2 of \d/}).waitFor();
 // Later slides hold only main content: no search box, no menu links.
 assert.equal(await view.getByLabel('Search workshops',{exact:true}).count(),0);assert.equal(await view.getByRole('button',{name:'Workshops',exact:true}).count(),0);
 await view.getByRole('button',{name:'Previous slide',exact:true}).click();await view.locator('.count',{hasText:/Slide 1 of \d/}).waitFor();
 // The registration form is one slide with every field together.
 await view.getByRole('button',{name:'Sections',exact:true}).click();await view.locator('.slidemenu').getByRole('button',{name:/Save your place/}).click();
 await view.getByRole('button',{name:'Next slide',exact:true}).click();
 const nameBox=view.getByLabel('Full name (required)',{exact:true});await nameBox.waitFor();await view.getByLabel('Email address (required)',{exact:true}).waitFor();
 await nameBox.fill('Sam Step');await nameBox.press('Tab');assert.equal(await source.locator('#name').inputValue(),'Sam Step');
 await page.keyboard.press('ArrowLeft');
 await view.getByRole('button',{name:'Sections',exact:true}).click();await view.locator('.slidemenu').getByRole('button',{name:/The whole page/}).click();await view.locator('.count',{hasText:/Slide 1 of \d/}).waitFor();
 await view.getByRole('button',{name:'Focus mode',exact:true}).click();
 assert.equal(await panel.getAttribute('data-focus'),'false','focus off after slides');
 // AI focus plan: the request carries structure only, and Claude may only name ids for the five allowed operations.
 let sent;await page.route('**/api/redesign',async route=>{sent=JSON.parse(route.request().postData());const keep=sent.items.filter(i=>i.kind==='field'||(i.kind==='action'&&!i.link)).map(i=>i.id);const heading=sent.items.find(i=>i.kind==='heading'&&i.level===2);await route.fulfill({json:{summary:'A workshop signup page.',main:[{from:keep[0],to:keep[keep.length-1]}],hide:[],collapse:[],chunks:heading?[{startId:heading.id,title:'Pick a workshop'}]:[],gists:[]}});});
 await view.getByRole('button',{name:'AI redesign with Claude',exact:true}).click();await view.getByRole('button',{name:'Send and redesign',exact:true}).click();
 await view.locator('[aria-label="AI redesign with Claude"][aria-pressed="true"]').waitFor();assert.equal(await view.getByText('A workshop signup page.').count(),0,'the AI summary is not shown as a Claude title box');assert.equal(await view.getByText('Claude ·').count(),0);assert.equal(sent.purpose,'focus');assert.equal(sent.items.some(i=>'value' in i||i.kind==='field'&&i.type==='password'),false);
 await view.getByLabel('Full name (required)',{exact:true}).waitFor();
 await view.getByRole('button',{name:'AI redesign with Claude',exact:true}).click();await view.locator('[aria-label="AI redesign with Claude"][aria-pressed="false"]').waitFor();
 assert.equal(await panel.getAttribute('data-focus'),'false','focus off after AI');
 // Reading line follows the pointer and can be switched off.
 await view.getByRole('button',{name:'Reading line',exact:true}).click();const band=view.locator('.ruler');await band.waitFor({state:'attached'});assert.equal(await band.isVisible(),true);
 await page.mouse.move(1000,300);await page.mouse.move(1000,420);await page.waitForTimeout(100);assert.equal(await band.evaluate(el=>el.style.getPropertyValue('--y')),'420px');
 await view.getByRole('button',{name:'Thicker reading line',exact:true}).click();assert.equal(await band.evaluate(el=>parseInt(el.style.getPropertyValue('--h'))>96),true);
 await view.getByRole('button',{name:'Reading line',exact:true}).click();assert.equal(await band.isHidden(),true); const noKey=await fixture.request.post('http://127.0.0.1:4173/api/redesign',{data:{items:[]},headers:{'x-access':'1'}});assert.ok([503,400].includes(noKey.status()));
 const blocked=await fixture.request.post('http://127.0.0.1:4173/api/redesign',{data:{items:[]},headers:{'origin':'https://evil.example','x-access':'1'}});assert.equal(blocked.status(),403);
 const noHeader=await fixture.request.post('http://127.0.0.1:4173/api/redesign',{data:{items:[]}});assert.equal(noHeader.status(),403); await view.getByRole('button',{name:'Close view',exact:true}).click();assert.equal(await page.locator('#preview').isHidden(),true);
 await page.getByRole('button',{name:'Reopen Access view'}).click();await view.getByRole('heading',{name:'Community workshops',exact:true}).waitFor();
 const missing=await fixture.request.get('http://127.0.0.1:4173/app/nope.html');assert.equal(missing.status(),404);
 await page.screenshot({path:'test-results/desktop-light.png',fullPage:true});
 assert.deepEqual(errors,[]);console.log('PASS: app rendering, field mapping, invalid input, select, checkbox, cancel/confirm, source success, search, saved preferences, mobile width, stale targets, password omission, theme switching, focus mode, close/reopen, 404 handling.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});

