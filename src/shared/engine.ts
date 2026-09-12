import { designSchema, type Design } from './model';
export const ENGINE_VERSION='0.1.0';
export interface TracePoint {hour:number;storedJ:number;percent:number;harvestUw:number;loadUw:number;lit:boolean;online:boolean;}
export interface Result {status:'incomplete'|'incompatible'|'conditional';averageUa:number;peakUa:number;periodS:number;loadUw:number;runtimeHours:number|null;darkHours:number|null;weekLightHours:number;longestDarkHours:number;generationWeekJ:number|null;loadWeekJ:number;requiredAreaCm2:number|null;missing:string[];warnings:string[];errors:string[];trace:TracePoint[];energy:{initialJ:number;harvestJ:number;consumedJ:number;leakJ:number;curtailedJ:number;finalJ:number;balanceErrorJ:number};}
export function isLit(d:Design,hour:number){const absolute=hour+d.light.startHour;const day=Math.floor(absolute/24)%7;const clock=absolute%24;return day<d.light.days&&clock>=d.light.startHour&&clock<d.light.startHour+d.light.hours;}
export function longestDark(d:Design){if(!d.light.days||!d.light.hours)return 168;if(d.light.days===7)return 24-d.light.hours;return (7-d.light.days)*24+24-d.light.hours;}
export function calculate(input:Design):Result{
 const d=designSchema.parse(input);const period=d.load.phases.reduce((n,p)=>n+p.seconds,0);const average=d.load.phases.reduce((n,p)=>n+p.seconds*p.currentUa,0)/period;const peak=Math.max(...d.load.phases.map(p=>p.currentUa));
 const out:Result={status:'conditional',averageUa:average,peakUa:peak,periodS:period,loadUw:average*d.load.voltage,runtimeHours:null,darkHours:null,weekLightHours:d.light.days*d.light.hours,longestDarkHours:longestDark(d),generationWeekJ:null,loadWeekJ:average*d.load.voltage*604800/1e6,requiredAreaCm2:null,missing:[],warnings:['conditional-model'],errors:[],trace:[],energy:{initialJ:0,harvestJ:0,consumedJ:0,leakJ:0,curtailedJ:0,finalJ:0,balanceErrorJ:0}};
 if(d.device==='MHO-C404'&&d.load.phases.every(p=>p.currentUa===0))out.missing.push('load-profile');
 if(d.regulation.iqUa===null&&d.path!=='direct')out.missing.push('regulator-iq');
 const hasPV=d.mode!=='battery';const hasStorage=d.mode!=='pv';const cap=['lic','supercap'].includes(d.storage.kind);
 if(hasPV){if(d.pv.densityUwCm2===null)out.missing.push('pv-density');if(d.pv.voltage===null)out.missing.push('pv-voltage');out.warnings.push('spectrum-linear-approximation');if(!d.regulation.mppt)out.warnings.push('no-iv-curve');}
 if(hasStorage){for(const key of cap?['farads','minVoltage','maxVoltage','leakUa','esr'] as const:['capacityMah','voltage','minVoltage'] as const){if(d.storage[key]===null)out.missing.push(`storage-${key}`);}if(!cap)out.warnings.push('battery-constant-voltage');if(d.storage.esr===null)out.warnings.push('peak-esr-unknown');if(d.storage.leakUa===null)out.warnings.push('leak-unknown');}
 if(d.mode==='hybrid'&&d.storage.kind!=='primary'&&!d.regulation.charger)out.errors.push('charger-required');
 if(d.mode==='hybrid'&&d.storage.kind==='primary'&&d.regulation.charger)out.errors.push('primary-no-charge');
 if(d.path==='direct'){
  const vin=hasStorage?(cap?d.storage.maxVoltage:d.storage.voltage):d.pv.voltage;
  if(vin!==null&&(vin*(hasStorage?d.storage.series:1)>d.load.maxVoltage||vin*(hasStorage?d.storage.series:1)<d.load.minVoltage))out.errors.push('direct-voltage-range');
 }
 if(out.errors.length){out.status='incompatible';return out;}
 if(out.missing.length){out.status='incomplete';return out;}
 const ns=d.storage.series,np=d.storage.parallel;
 const vUpper=(cap?d.storage.maxVoltage!:d.storage.voltage!)*ns;
 const vMinimum=(d.storage.minVoltage??0)*ns;
 const vCut=d.path==='ldo'?Math.max(vMinimum,d.load.voltage+d.regulation.dropout):d.path==='direct'?Math.max(vMinimum,d.load.minVoltage):vMinimum;
 if(hasStorage&&vUpper<=vCut){out.errors.push('storage-voltage-headroom');out.status='incompatible';return out;}
 if(hasPV&&d.path==='ldo'&&d.mode==='pv'&&d.pv.voltage!<d.load.voltage+d.regulation.dropout){out.errors.push('pv-voltage-headroom');out.status='incompatible';return out;}
 const capacitance=(d.storage.farads??0)*np/ns;
 const maximum=hasStorage?(cap?0.5*capacitance*(vUpper*vUpper-vCut*vCut):(d.storage.capacityMah! *np/1000)*vUpper*3600):0;
 const loadW=out.loadUw/1e6;
 const angle=d.light.planeMeasured?1:Math.max(0,Math.cos(d.light.angle*Math.PI/180));
 const pvRaw=hasPV?d.pv.densityUwCm2!*d.pv.areaCm2*d.light.lux/d.pv.referenceLux*angle/1e6:0;
 const genW=pvRaw*(d.regulation.mppt?1:d.pv.utilization)*(d.mode==='hybrid'?d.regulation.harvestEfficiency:d.path==='ldo'?d.load.voltage/d.pv.voltage!:d.path==='converter'?d.regulation.efficiency:1);
 out.generationWeekJ=hasPV?genW*out.weekLightHours*3600:null;

 if(d.mode==='pv'&&genW<peak*d.load.voltage/1e6*(1+d.margin/100)+(d.regulation.iqUa??0)*d.load.voltage/1e6)out.errors.push('pv-peak-shortfall');
 const voltage=(energy:number)=>cap?Math.sqrt(vCut*vCut+2*energy/capacitance):vUpper;
 const demand=(v:number)=>d.path==='ldo'?(average+(d.regulation.iqUa??0))*v/1e6:loadW/(d.path==='converter'?d.regulation.efficiency:1)+(d.regulation.iqUa??0)*v/1e6;
 if(hasPV&&genW>0&&out.weekLightHours>0){const supplyW=hasStorage?demand(vUpper)+(d.storage.leakUa??0)*np*vUpper/1e6:loadW+(d.regulation.iqUa??0)*d.load.voltage/1e6;out.requiredAreaCm2=d.pv.areaCm2*supplyW*168/(genW*out.weekLightHours)*(1+d.margin/100);}
 if(hasStorage&&(d.storage.esr??0)>0){const i=peak*d.load.voltage/(vUpper*(d.path==='converter'?d.regulation.efficiency:1))/1e6;const sag=i*d.storage.esr!*ns/np;if(vUpper-sag<=vCut)out.errors.push('storage-peak-sag');}
 if(out.errors.length){out.status='incompatible';return out;}
 function simulate(hours:number,withLight:boolean,trace:boolean){
  let e=maximum*d.storage.initialPercent/100;const initial=e;let first:number|null=null,totalGen=0,totalUse=0,totalLeak=0,curtail=0;const stepS=60;const stride=Math.max(1,Math.floor(hours*60/420));
  for(let i=0;i<hours*60;i++){
   const hour=i/60;const lit=withLight&&isLit(d,hour);const incoming=lit?genW:0;const v=hasStorage?voltage(e):d.load.voltage;
   const required=hasStorage?demand(v):loadW+(d.regulation.iqUa??0)*d.load.voltage/1e6;
   const leak=hasStorage?(d.storage.leakUa??0)*np*v/1e6:0;
   // Primary backup must never be charged. PV supplies demand first and any excess is discarded.
   const usableIncoming=d.mode==='hybrid'&&d.storage.kind==='primary'?Math.min(incoming,required+leak):incoming;
   const delta=(usableIncoming-required-leak)*stepS;
   const available=e+usableIncoming*stepS;
   const consumed=Math.min(required*stepS,available);const leaked=Math.min(leak*stepS,Math.max(0,available-consumed));
   const online=available+1e-12>=(required+leak)*stepS;
   if(!online&&first===null){const deficit=required+leak-usableIncoming;first=hour+(deficit>0?e/deficit/3600:0);}
   const next=e+delta;
   const dumped=Math.max(0,next-maximum)+(incoming-usableIncoming)*stepS;
   totalGen+=incoming*stepS;totalUse+=consumed;totalLeak+=leaked;curtail+=dumped;
   e=Math.max(0,Math.min(maximum,e+usableIncoming*stepS-consumed-leaked));
   if(trace&&(i%stride===0||i===hours*60-1))out.trace.push({hour:hour+1/60,storedJ:e,percent:maximum>0?e/maximum*100:0,harvestUw:incoming*1e6,loadUw:loadW*1e6,lit,online});
  }
  return {first,initial,harvestJ:totalGen,consumedJ:totalUse,leakJ:totalLeak,curtailedJ:curtail,finalJ:e};
 }
 const run=simulate(d.horizonDays*24,hasPV,true);out.runtimeHours=run.first;
 if(hasStorage)out.darkHours=simulate(d.horizonDays*24,false,false).first;
 else out.darkHours=0;
 out.energy={initialJ:run.initial,harvestJ:run.harvestJ,consumedJ:run.consumedJ,leakJ:run.leakJ,curtailedJ:run.curtailedJ,finalJ:run.finalJ,balanceErrorJ:run.initial+run.harvestJ-run.consumedJ-run.leakJ-run.curtailedJ-run.finalJ};
 if(out.requiredAreaCm2!==null)out.warnings.push('area-energy-only');
 if(hasStorage&&out.darkHours===null)out.warnings.push('horizon-lower-bound');
 return out;
}
