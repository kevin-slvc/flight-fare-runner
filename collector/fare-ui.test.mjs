import test from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from 'playwright-core';
import {firstFareCard,fareDetails,chooseUnrestrictedFare,assertFareUnchanged} from './fare-ui.mjs';

const card=(id,price,payment,button='次へ')=>`<article id="${id}"><p>${price}円</p><p>往復</p><p>エコノミークラス</p><span>${payment}</span><button>${button}</button></article>`;
let browser;
test.before(async()=>{browser=await chromium.launch({channel:'chrome',headless:false,chromiumSandbox:true});});
test.after(async()=>{await browser?.close();});

test('fare action excludes an unrelated next button and a VISA recommendation',async()=>{
 const page=await browser.newPage();
 try{
  await page.setContent('<button id="unrelated">次へ</button><h2>運賃の選択</h2>'+card('base','30,000','支払い方法指定なし')+card('recommend','29,000','お支払い方法：VISA'));
  const fare=await chooseUnrestrictedFare(page);
  assert.equal(await fare.card.getAttribute('id'),'base');
  assert.equal(fareDetails(fare.text).price,30000);
  await fare.button.click();
  assert.equal(await page.evaluate(()=>document.activeElement.closest('article')?.id),'base');
 }finally{await page.close();}
});

test('filter label outside a VISA fare cannot authorize that fare',async()=>{
 const page=await browser.newPage();
 try{
  await page.setContent('<div>支払い方法指定なし</div>'+card('restricted','40,000','お支払い方法：VISA'));
  const fare=await firstFareCard(page);
  assert.throws(()=>fareDetails(fare.text),/payment_condition_not_cleared/);
 }finally{await page.close();}
});

test('payment option belongs to the opened payment menu',async()=>{
 const page=await browser.newPage();
 try{
  await page.setContent('<div>支払い方法指定なし</div>'+card('base','40,000','お支払い方法：VISA')+'<section id="menu" hidden><h3>お支払い方法の選択</h3><span>VISA</span><button id="option">支払い方法指定なし</button></section>');
  await page.evaluate(()=>{
   document.querySelector('#base span').onclick=()=>document.querySelector('#menu').hidden=false;
   document.querySelector('#option').onclick=()=>{document.querySelector('#base p').textContent='41,000円';document.querySelector('#base span').textContent='支払い方法指定なし';document.querySelector('#menu').hidden=true;};
  });
  const fare=await chooseUnrestrictedFare(page);
  assert.equal(fareDetails(fare.text).price,41000);
  assert.equal(await fare.card.getAttribute('id'),'base');
 }finally{await page.close();}
});

test('replaced fare card cannot silently click a newly restricted fare',async()=>{
 const page=await browser.newPage();
 try{
  await page.setContent(card('base','30,000','支払い方法指定なし','選択'));
  const fare=await chooseUnrestrictedFare(page);
  await page.evaluate(()=>document.querySelector('#base').remove());
  await page.setContent(card('replacement','29,000','お支払い方法：VISA','選択'));
  await assert.rejects(()=>fare.button.click({timeout:1000}));
 }finally{await page.close();}
});


test('in-place payment restriction changes fail before click',async()=>{
 const page=await browser.newPage();
 try{
  await page.setContent(card('base','30,000','支払い方法指定なし'));
  const fare=await chooseUnrestrictedFare(page);
  await page.evaluate(()=>document.querySelector('#base span').textContent='お支払い方法：VISA');
  await assert.rejects(()=>assertFareUnchanged(fare),/fare_card_changed/);
 }finally{await page.close();}
});

test('missing menu options cannot escape into unrelated page labels',async()=>{
 const page=await browser.newPage();
 try{
  await page.setContent(card('base','30,000','お支払い方法：VISA')+'<h3>お支払い方法の選択</h3><div>支払い方法指定なし</div>');
  await assert.rejects(()=>chooseUnrestrictedFare(page),/payment_menu_not_found/);
 }finally{await page.close();}
});


test('ARIA button fare actions keep the same card binding',async()=>{
 const page=await browser.newPage();
 try{
  await page.setContent('<article id="base"><p>30,000円</p><p>往復</p><p>エコノミークラス</p><span>支払い方法指定なし</span><div role="button" tabindex="0">次へ</div></article>');
  const fare=await chooseUnrestrictedFare(page);
  assert.equal(await fare.card.getAttribute('id'),'base');
  assert.equal(fareDetails(fare.text).price,30000);
  await assertFareUnchanged(fare);
 }finally{await page.close();}
});
