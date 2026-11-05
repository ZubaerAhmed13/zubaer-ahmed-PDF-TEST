import {test,expect,type Page} from '@playwright/test';
import {PDFDocument,StandardFonts} from 'pdf-lib';
import {createHash} from 'node:crypto';
test.use({serviceWorkers:'block'});
const prefix='/zubaer-ahmed-PDF-TEST/',project='https://ruefkvkavvycposzahit.supabase.co',owner='10000000-0000-4000-8000-000000000001',id='20000000-0000-4000-8000-000000000001';
async function pdfBytes(){const pdf=await PDFDocument.create(),font=await pdf.embedFont(StandardFonts.Helvetica);pdf.addPage([500,300]).drawText('Verified server output',{font,x:25,y:220,size:20});return Buffer.from(await pdf.save());}
async function setup(page:Page,options:{running?:boolean;failDownload?:boolean;failCreate?:boolean;failCancel?:boolean;disabled?:boolean}={}){
  const bytes=await pdfBytes(),meta={name:'result.pdf',type:'application/pdf',size:bytes.length,pages:1,sha256:createHash('sha256').update(bytes).digest('hex')};
  const calls:{path:string;method:string;body:Record<string,unknown>|null}[]=[];
  let state='queued',creates=0,downloads=0,failCancel=options.failCancel??false;
  let cancelGate:Promise<void>|null=null,releaseCancel:()=>void=()=>{};
  const headers={'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'GET, POST, PUT, OPTIONS'};
  await page.route(project+'/**',async route=>{
    const request=route.request(),url=new URL(request.url()),path=url.pathname,method=request.method();
    const json=async(body:unknown,status=200)=>route.fulfill({status,headers,contentType:'application/json',body:JSON.stringify(body)});
    if(method==='OPTIONS'){await route.fulfill({status:204,headers});return;}
    calls.push({path,method,body:method==='POST'?request.postDataJSON():null});
    if(path==='/auth/v1/token'){await json({access_token:'browser-test-access',refresh_token:'browser-test-refresh',expires_in:3600,user:{id:owner,email:'reader@example.invalid'}});return;}
    if(path.endsWith('/jobs')){if(options.disabled){await json({error:{code:'processing_not_ready',message:'Server document processing is not enabled yet.'}},503);return;}if(options.failCreate&&creates++<2){await route.abort('failed');return;}await json({job:{id,state,phase:'awaiting_upload'},upload:{url:project+'/storage/v1/object/upload/sign/docflow-processing/'+owner+'/'+id+'/input/0.pdf?token=test'}});return;}
    if(path.includes('/object/upload/')){await json({Key:'input'});return;}
    if(path.endsWith('/start')){state=options.running?'running':'completed';await json({job:{id,state,phase:'processing'}},202);return;}
    if(path.endsWith('/cancel')){if(cancelGate)await cancelGate;if(failCancel){await json({error:{code:'unavailable',message:'Unavailable'}},503);return;}state='cancelled';await json({job:{id,state,phase:'cancelled'},cleanupPending:false});return;}
    if(path.endsWith('/downloads')){await json({output:meta,url:project+'/storage/v1/object/sign/docflow-processing/'+owner+'/'+id+'/output/result.pdf?token=test'});return;}
    if(path.includes('/object/sign/')){if(options.failDownload&&downloads++===0){await route.fulfill({status:503,headers,body:'unavailable'});return;}await route.fulfill({headers,contentType:'application/pdf',body:bytes});return;}
    if(path.endsWith('/jobs/'+id)){await json({job:{id,state,phase:state}});return;}
    throw Error('Unexpected test service route '+path);
  });
  await page.goto(prefix+'#/tools/ocr');await page.locator('[data-file-input]').setInputFiles({name:'scan.pdf',mimeType:'application/pdf',buffer:bytes});
  return {calls,allowCancel:()=>{failCancel=false;},holdCancel:()=>{cancelGate=new Promise<void>(r=>{releaseCancel=r;});},releaseCancel:()=>releaseCancel()};
}
async function signIn(page:Page){await page.getByLabel('Processing location').selectOption('server');await page.getByLabel('DocFlow account email').fill('reader@example.invalid');await page.getByLabel('DocFlow account password').fill('browser-test-password');await page.getByRole('button',{name:'Sign in to DocFlow',exact:true}).click();await expect(page.getByRole('button',{name:'Sign out of DocFlow'})).toBeVisible();}
async function consentAndRun(page:Page){await page.getByLabel('I agree to upload this document').check();await page.locator('[data-run]').click();}

test('requires separate sign-in and fresh upload consent, then reviews actual server PDF',async({page})=>{
  const s=await setup(page);expect(s.calls).toHaveLength(0);await signIn(page);expect(s.calls.every(c=>c.path==='/auth/v1/token')).toBe(true);
  await page.locator('[data-run]').click();await expect(page.locator('[data-run-status]')).toContainText('accept the upload');expect(s.calls.some(c=>c.path.endsWith('/jobs'))).toBe(false);
  await consentAndRun(page);await expect(page.getByRole('heading',{name:'Review server OCR PDF'})).toBeVisible();expect(s.calls.filter(c=>c.path.endsWith('/start'))).toHaveLength(1);
  const created=s.calls.find(c=>c.path.endsWith('/jobs'))!.body!;expect(created.consent).toMatchObject({accepted:true});
  await page.getByRole('button',{name:'Return to editing'}).click();await expect(page.getByLabel('Processing location')).toHaveValue('server');await expect(page.getByLabel('I agree to upload this document')).not.toBeChecked();
  expect(await page.evaluate(()=>JSON.stringify(sessionStorage))).not.toContain('browser-test-password');
});
test('retains the original and account controls after unconfirmed cancellation, then allows a real retry',async({page})=>{
  const s=await setup(page,{running:true,failCancel:true});await signIn(page);await consentAndRun(page);await expect.poll(()=>s.calls.filter(c=>c.path.endsWith('/start')).length).toBe(1);
  await page.locator('[data-cancel-processing]').click();await expect(page.locator('[data-server-job]')).toContainText('not confirmed');await expect(page.locator('[data-run]')).toBeDisabled();await expect(page.getByRole('button',{name:'Sign out of DocFlow'})).toBeEnabled();
  page.on('dialog',dialog=>void dialog.accept());await page.locator('.df2-brand').click();await expect(page).toHaveURL(/#\/tools\/ocr\/work$/);await expect(page.locator('.df2-file')).toContainText('scan.pdf');
  s.allowCancel();await page.getByRole('button',{name:'Retry server cancellation'}).click();await expect(page.locator('[data-server-job]')).toContainText('cancelled');await expect(page.getByRole('button',{name:'Finish this attempt'})).toBeEnabled();
  await page.getByRole('button',{name:'Finish this attempt'}).click();await expect(page.locator('[data-run]')).toBeEnabled();await expect(page.getByLabel('I agree to upload this document')).not.toBeChecked();expect(s.calls.filter(c=>c.path.endsWith('/start'))).toHaveLength(1);
});
test('retries only the completed download after a transfer failure',async({page})=>{
  const s=await setup(page,{failDownload:true});await signIn(page);await consentAndRun(page);await expect(page.locator('[data-server-job]')).toContainText('could not be downloaded');
  await page.getByRole('button',{name:'Check server status'}).click();await expect(page.getByRole('button',{name:'Retrieve completed PDF'})).toBeEnabled();await page.getByRole('button',{name:'Retrieve completed PDF'}).click();await expect(page.getByRole('heading',{name:'Review server OCR PDF'})).toBeVisible();
  expect(s.calls.filter(c=>c.path.endsWith('/start'))).toHaveLength(1);expect(s.calls.filter(c=>c.path.endsWith('/jobs'))).toHaveLength(1);
});
test('recovers lost creation responses using the same key without uploading or starting again',async({page})=>{
  const s=await setup(page,{failCreate:true});await signIn(page);await consentAndRun(page);await expect(page.locator('[data-server-job]')).toContainText('could not be reached');await page.getByRole('button',{name:'Check server status'}).click();await expect(page.locator('[data-server-job]')).toContainText('queued');
  await page.getByRole('button',{name:'Retry server cancellation'}).click();await expect(page.locator('[data-server-job]')).toContainText('cancelled');
  const creates=s.calls.filter(c=>c.path.endsWith('/jobs'));expect(creates).toHaveLength(3);expect(new Set(creates.map(c=>c.body?.idempotencyKey)).size).toBe(1);expect(s.calls.some(c=>c.method==='PUT'||c.path.endsWith('/start'))).toBe(false);
});
test('waits for cancellation before navigating and honors the latest requested route',async({page})=>{
  const s=await setup(page,{running:true});await signIn(page);await consentAndRun(page);await expect.poll(()=>s.calls.filter(c=>c.path.endsWith('/start')).length).toBe(1);s.holdCancel();page.on('dialog',dialog=>void dialog.accept());
  await page.locator('.df2-nav a[href="#/tools/merge"]').click();await expect.poll(()=>s.calls.filter(c=>c.path.endsWith('/cancel')).length).toBe(1);await expect(page).toHaveURL(/#\/tools\/ocr\/work$/);await expect(page.locator('.df2-file')).toContainText('scan.pdf');
  await page.locator('.df2-nav a[href="#/tools/split"]').click();s.releaseCancel();await expect(page).toHaveURL(/#\/tools\/split$/);await expect(page.getByRole('heading',{name:'Split PDF',exact:true})).toBeVisible();
});

test('can finish a definite staging rejection without creating another job',async({page})=>{
  const s=await setup(page,{disabled:true});await signIn(page);await consentAndRun(page);await expect(page.locator('[data-server-job]')).toContainText('not enabled');
  await page.getByRole('button',{name:'Check server status'}).click();await expect(page.locator('[data-server-job]')).toContainText('No server job');await page.getByRole('button',{name:'Finish this attempt'}).click();await expect(page.locator('[data-run]')).toBeEnabled();expect(s.calls.filter(c=>c.path.endsWith('/jobs'))).toHaveLength(1);
});
