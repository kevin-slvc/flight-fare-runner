// Bind a fare's conditions, price and action to one live DOM card.
export function fareDetails(text){
 if(typeof text!=='string'||!text.includes('往復')||!text.includes('エコノミークラス')||!text.includes('支払い方法指定なし')||/お支払い方法\s*[：:]/.test(text))throw Error('payment_condition_not_cleared');
 const match=text.match(/(?:^|\n)([\d,]+)円(?:\n|$)/);
 const price=match?Number(match[1].replaceAll(',','')):NaN;
 if(!Number.isSafeInteger(price)||price<=0)throw Error('fare_price_missing');
 return {price,text};
}

export async function firstFareCard(page){
 const buttons=await page.getByRole('button',{name:/^(選択|次へ)$/}).elementHandles();
 for(const button of buttons){
  if(!await button.isVisible())continue;
  const handle=await button.evaluateHandle(button=>{
   for(let node=button.parentElement,depth=0;node&&depth<12;node=node.parentElement,depth++){
    const text=node.innerText||'';
    const choices=[...node.querySelectorAll('button,[role="button"]')].filter(b=>/^(選択|次へ)$/.test(b.innerText.trim())&&b.getClientRects().length);
    if(choices.length!==1)continue;
    if(text.includes('往復')&&text.includes('エコノミークラス')&&/支払い方法指定なし|お支払い方法\s*[：:]/.test(text))return node;
   }
   return null;
  });
  const card=handle.asElement();
  if(card)return {card,button,text:await card.innerText()};
  await handle.dispose();
 }
 throw Error('fare_card_not_found');
}

export async function chooseUnrestrictedFare(page){
 let fare=await firstFareCard(page);
 try{fareDetails(fare.text);return fare;}catch{}
 const payment=await fare.card.$('text="お支払い方法：VISA"');
 if(!payment)throw Error('payment_filter_not_supported');
 await payment.click();
 const heading=page.getByText('お支払い方法の選択',{exact:true}).first();
 await heading.waitFor({timeout:10000});
 const menuHandle=await heading.evaluateHandle(heading=>{
  for(let node=heading.parentElement,depth=0;node&&depth<8;node=node.parentElement,depth++){
   if([...node.querySelectorAll('button,[role="button"]')].some(b=>/^(選択|次へ)$/.test(b.innerText.trim())))break;
   if(node.innerText.includes('VISA')&&node.innerText.includes('支払い方法指定なし'))return node;
  }
  return null;
 });
 const menu=menuHandle.asElement();
 if(!menu)throw Error('payment_menu_not_found');
 const option=await menu.$('text="支払い方法指定なし"');
 if(!option)throw Error('unrestricted_payment_option_missing');
 await option.click();
 await page.mouse.move(0,0);
 const deadline=Date.now()+20000;
 while(Date.now()<deadline){
  if(await page.locator('#verification-slider').isVisible())throw Error('human_verification_required');
  try{fare=await firstFareCard(page);fareDetails(fare.text);return fare;}catch{}
  await page.waitForTimeout(200);
 }
 throw Error('payment_condition_not_cleared');
}

export async function assertFareUnchanged(fare){
 if(!await fare.card.isVisible()||!await fare.button.isVisible()||await fare.card.innerText()!==fare.text)throw Error('fare_card_changed');
 return fareDetails(fare.text);
}
