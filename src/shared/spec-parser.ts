import type {FieldEvidence} from './spec-evidence';
// Normalize calculator units; preserve source text and require human confirmation.
export function extractCandidates(text:string,page:number|null=null,method:FieldEvidence['method']='pdf-text'):FieldEvidence[]{
  const definitions:[string,RegExp,string,(n:number,u:string)=>number][]=[
    ['capacityMah',/\b(\d+(?:\.\d+)?)\s*(mAh|Ah)\b/gi,'mAh',(n,u)=>n*(u.toLowerCase()==='ah'?1000:1)],
    ['farads',/\b(\d+(?:\.\d+)?)\s*(mF|µF|μF|uF|F)\b/g,'F',(n,u)=>n*(u==='mF'?1e-3:u==='F'?1:1e-6)],
    ['voltage',/\b(\d+(?:\.\d+)?)\s*(mV|V)\b/g,'V',(n,u)=>n*(u==='mV'?1e-3:1)],
    ['iqUa',/(?:quiescent\s+current|静态电流)[^\n]{0,45}?(\d+(?:\.\d+)?)\s*(nA|µA|μA|uA|mA)\b/gi,'µA',current],
    ['leakUa',/(?:leakage\s+current|漏电流)[^\n]{0,45}?(\d+(?:\.\d+)?)\s*(nA|µA|μA|uA|mA)\b/gi,'µA',current],
  ];
  const candidates:FieldEvidence[]=[];
  for(const [parameter,regex,unit,normalize] of definitions){
    for(const match of text.slice(0,150000).matchAll(regex)){
      if(candidates.length>=80)return candidates;
      // Never silently turn a negative rating positive or confuse milli/mega prefixes.
      if(/[-−]\s*\d/.test(match[0]) || /[-−]\s*$/.test(text.slice(Math.max(0,match.index!-8),match.index)))continue;
      const numberStart=match.index!+match[0].lastIndexOf(match[1]);
      if(/[\w.,]/.test(text[numberStart-1]??''))continue;
      if(parameter==='capacityMah'&&!['mAh','Ah'].includes(match[2]))continue;
      if((parameter==='iqUa'||parameter==='leakUa')&&!['nA','µA','μA','uA','mA'].includes(match[2]))continue;
      candidates.push({parameter,value:normalize(Number(match[1]),match[2]),unit,page,
        excerpt:text.slice(Math.max(0,match.index!-70),match.index!+match[0].length+70).replace(/\s+/g,' '),
        conditions:'',method});
    }
  }
  return candidates;
}
function current(n:number,u:string){return n*(u==='nA'?0.001:u==='mA'?1000:1);}
