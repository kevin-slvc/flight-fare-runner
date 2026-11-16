import {chooseUnrestrictedFare,fareDetails,assertFareUnchanged} from './fare-ui.mjs';
export function baseFareText(text){return text.split('運賃の選択').at(-1).split(/\n(?:選択|次へ)(?:\n|$)/)[0];}
export default async (page, options={}) => {
  // Read-only fare selection. Stops before passenger entry, consent or booking.
  // Tokyo origins, configured Asian airports; one adult, economy, JPY.
  const out=options.out||'2026-12-09',back=options.back||'2026-12-11';
  const from=options.from||'NRT',to=options.to||'ICN';
  const cities={ICN:'sel',TPE:'tpe',TSA:'tpe',HKG:'hkg',BKK:'bkk',DMK:'bkk',SGN:'sgn'};
  if(!['NRT','HND'].includes(from)||!cities[to])throw Error('invalid_route');
  const valid=s=>/^\d{4}-\d{2}-\d{2}$/.test(s)&&new Date(s+'T00:00:00Z').toISOString().slice(0,10)===s;
  if(!valid(out)||!valid(back)||back<=out)throw Error('invalid_dates');
  const jp=s=>Number(s.slice(5,7))+'月'+Number(s.slice(8,10))+'日';
  const url=new URL('https://jp.trip.com/flights/showfarefirst?triptype=rt&class=y&quantity=1&locale=ja-JP&curr=JPY');
  for(const [k,v] of Object.entries({dcity:'tyo',acity:cities[to],dairport:from.toLowerCase(),aairport:to.toLowerCase()}))url.searchParams.set(k,v);
  url.searchParams.set('ddate',out);url.searchParams.set('rdate',back);const queryUrl=url.href;
  const startedAt=new Date().toISOString();
  let step="search",activePage=page,selectedFare=null;
  try {
  await page.goto(queryUrl,{waitUntil:'domcontentloaded'});
  const outboundChoice=page.getByRole('button',{name:/^この(運賃|便)を選択$/}).first();
  await outboundChoice.waitFor({timeout:45000});
  if(await page.locator('#verification-slider').isVisible())throw Error('human_verification_required');
  await page.getByRole('tab',{name:'安い順',exact:true}).click();
  const outboundList=await page.locator('main').innerText();
  if(!outboundList.includes('大人1名') || !outboundList.includes(from) || !outboundList.includes(to)) throw Error('search_conditions_mismatch');
  step='outbound_selection';
  const eligibleOutbound=outboundChoice;
  await eligibleOutbound.click();
  await page.getByText(/^2\.\s*復路（/).first().waitFor({timeout:45000});
  const returnChoice=page.getByText('詳細を表示',{exact:true}).or(page.getByRole('button',{name:'この便を選択',exact:true})).first();
  await returnChoice.waitFor({timeout:45000});
  const returnList=await page.locator('main').innerText();
  step='return_selection';
  await returnChoice.click();
  step='payment_filter';
  await page.getByText('運賃の選択',{exact:true}).first().waitFor({timeout:25000});
  const fare=await chooseUnrestrictedFare(page);
  selectedFare=fareDetails(fare.text);
  if(!page.url().includes('/flights/'))throw Error('fare_results_page_changed');
  // Trip sometimes navigates this tab instead of opening a new one.
  // Both observers must be attached before clicking; handle rejected loser.
  step='passenger_quote';
  const destination=Promise.any([
    page.waitForEvent('popup',{timeout:15000}),
    page.waitForURL(u=>u.pathname.includes('/flights/passenger'),{timeout:15000}).then(()=>page)
  ]);
  destination.catch(()=>{});
  if(await page.locator('#verification-slider').isVisible())throw Error('human_verification_required');
  await assertFareUnchanged(fare);
  await fare.button.click();
  const p=await destination;activePage=p;
  await p.waitForLoadState('domcontentloaded');
  await p.waitForFunction(()=>/合計金額\s*[\d,]+円/.test(document.body.innerText),{},{timeout:25000});
  const text=await p.locator('body').innerText();
  if(!text.includes(jp(out))||!text.includes(jp(back))||!text.includes('航空券（大人1名）'))throw Error('passenger_conditions_mismatch');
  const match=text.match(/合計金額\s*([\d,]+)円/);
  const total=Number(match[1].replaceAll(',',''));
  if(total!==selectedFare.price||/お支払い方法\s*[：:]/.test(text))throw Error('selected_fare_quote_mismatch');
  const flights=[...text.matchAll(/^([A-Z0-9]{2}\d{1,4})$/gm)].map(m=>m[1]);
  if((flights.length<2||flights.length>4)||!Number.isFinite(total)||total<=0)throw Error('incomplete_roundtrip');
  return {probeVersion:2,selectedFarePrice:selectedFare.price,selectedFareText:selectedFare.text,startedAt,observedAt:new Date().toISOString(),provider:'Trip.com',stage:'passenger_form_quote',queryUrl,from,to,out,back,total,currency:'JPY',adults:1,paymentCondition:'unspecified',flights,bookingCompleted:false,text,outboundList,returnList};
  } catch(error) {
    const challenge=await activePage.locator('#verification-slider').isVisible().catch(()=>false);
    const diagnosticScreenshot=await activePage.screenshot({type:'jpeg',quality:55,timeout:5000}).then(b=>b.toString('base64')).catch(()=>null);
    return {diagnosticScreenshot,selectedFarePrice:selectedFare?.price,selectedFareText:selectedFare?.text,startedAt,failedAt:new Date().toISOString(),provider:'Trip.com',stage:'failed',step,diagnosticText:(await activePage.locator('body').innerText().catch(()=>'' )).slice(0,15000),queryUrl,from,to,out,back,reason:challenge?'human_verification_required':String(error.message).split('\n')[0],bookingCompleted:false};
  }
}
