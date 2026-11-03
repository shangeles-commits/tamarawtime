/* Tamaraw Time transit routing through the Transitous MOTIS API. */
(function(root){
 'use strict';
 const API='https://api.transitous.org/api/v1/plan';
 const cache=new Map();

 async function request(url,timeoutMs=18000){
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs);
  try{
   const response=await fetch(url,{signal:controller.signal,headers:{Accept:'application/json'}});
   if(!response.ok)throw new Error('Transit service returned HTTP '+response.status);
   return await response.json();
  }finally{clearTimeout(timer);}
 }

 function decodePolyline(encoded,precision=5){
  if(typeof encoded!=='string'||!encoded)return [];
  const factor=10**precision,points=[];let index=0,lat=0,lng=0;
  while(index<encoded.length){
   let result=0,shift=0,byte;
   do{byte=encoded.charCodeAt(index++)-63;result|=(byte&0x1f)<<shift;shift+=5;}while(byte>=0x20&&index<encoded.length);
   lat+=(result&1?~(result>>1):result>>1);
   result=0;shift=0;
   do{byte=encoded.charCodeAt(index++)-63;result|=(byte&0x1f)<<shift;shift+=5;}while(byte>=0x20&&index<encoded.length);
   lng+=(result&1?~(result>>1):result>>1);
   points.push([lat/factor,lng/factor]);
  }
  return points;
 }

 function modeName(mode){
  const value=String(mode||'').toUpperCase();
  if(['BUS','BUSLOCAL','COACH'].includes(value))return 'Bus / UV';
  if(['RAIL','TRAM','SUBWAY','METRO','FERRY','TRAIN'].includes(value))return 'Train';
  return 'Transit';
 }

 function summarizeLegs(legs){
  return (legs||[]).map(leg=>{
   const from=leg.from?.name||leg.from?.stop?.name||'Start';
   const to=leg.to?.name||leg.to?.stop?.name||'Destination';
   const mode=String(leg.mode||leg.transportMode||'TRANSIT').toUpperCase();
   const route=leg.route?.shortName||leg.route?.longName||leg.route||leg.trip?.route?.shortName||'';
   return {mode,transportMode:modeName(mode),route:String(route||mode).slice(0,40),from,to,duration:Number(leg.duration)||0,distance:Number(leg.distance)||0,geometry:decodePolyline(leg.legGeometry?.points||leg.geometry?.points||leg.legGeometry?.encodedPolyline||'',leg.legGeometry?.precision||5)};
  });
 }

 async function plan(origin,dest,mode='Transit'){
  if(!origin||!dest)return {status:'error',itineraries:[],message:'A valid GPS position and campus destination are required.'};
  const modeKey=String(mode||'Transit');const cacheKey=[origin.lat.toFixed(4),origin.lng.toFixed(4),dest.lat.toFixed(4),dest.lng.toFixed(4),modeKey].join(':');
  const saved=cache.get(cacheKey);if(saved&&Date.now()-saved.at<5*60*1000)return saved.result;
  const params=new URLSearchParams({fromPlace:`${origin.lat},${origin.lng}`,toPlace:`${dest.lat},${dest.lng}`,numItineraries:'5'});
  try{
   const data=await request(API+'?'+params.toString());const raw=data.itineraries||data.direct||[];
   let itineraries=raw.map((item,index)=>{
    const legs=summarizeLegs(item.legs);let seconds=Number(item.duration)||0;if(!seconds&&item.endTime&&item.startTime)seconds=(Date.parse(item.endTime)-Date.parse(item.startTime))/1000;if(!seconds)seconds=legs.reduce((sum,leg)=>sum+leg.duration,0);const duration=Math.max(1,Math.ceil(seconds/60));
    return {id:String(item.id||index),duration,startTime:item.startTime||null,endTime:item.endTime||null,transfers:Number.isFinite(item.transfers)?item.transfers:Math.max(0,legs.filter(leg=>leg.mode!=='WALK').length-1),legs};
   }).filter(item=>item.duration>0&&item.legs.length);
   if(modeKey==='Train')itineraries=itineraries.filter(item=>item.legs.some(leg=>['RAIL','TRAM','SUBWAY','METRO','TRAIN'].includes(leg.mode)));
   if(modeKey==='Bus / UV')itineraries=itineraries.filter(item=>item.legs.some(leg=>['BUS','BUSLOCAL','COACH'].includes(leg.mode)));
   itineraries.sort((a,b)=>a.duration-b.duration);
   const result=itineraries.length?{status:'found',itineraries:itineraries.slice(0,4),message:'Open transit routes from Transitous.'}:{status:'none',itineraries:[],message:`No ${modeKey.toLowerCase()} itinerary was found for this trip. Transit data may not cover this route in Metro Manila.`};
   cache.set(cacheKey,{result,at:Date.now()});return result;
  }catch(error){return {status:'error',itineraries:[],message:error.message||'Transit routing is temporarily unavailable.'};}
 }

 root.TransitRouting={plan,decodePolyline};
 if(typeof module!=='undefined'&&module.exports)module.exports={plan,decodePolyline};
})(typeof window!=='undefined'?window:globalThis);
