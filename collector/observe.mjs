import {chromium} from 'playwright-core';
import {readFileSync,writeFileSync} from 'node:fs';
import probe from './probe.mjs';

// Called only with a locally validated synthetic route. No account credentials.
const task=JSON.parse(readFileSync(process.argv[2],'utf8'));
const browser=await chromium.launch({channel:'chrome',headless:false,chromiumSandbox:true});
try {
 const context=await browser.newContext({locale:'ja-JP',timezoneId:'Asia/Tokyo'});
 const page=await context.newPage();
 page.setDefaultTimeout(20000);page.setDefaultNavigationTimeout(40000);
 const raw=await probe(page,task);
 writeFileSync(process.argv[3],JSON.stringify(raw),{mode:0o600});
} finally {await browser.close();}
