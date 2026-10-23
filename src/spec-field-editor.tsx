import type {FieldEvidence} from './shared/spec-evidence';
import type {Locale} from './shared/model';
import {parameterUnits} from './shared/component-parameters';

export function SpecFieldEditor({fields,onChange,parameters,locale}:{fields:FieldEvidence[];onChange:(fields:FieldEvidence[])=>void;parameters:Record<string,unknown>|null;locale:Locale}){
  const bi=(zh:string,en:string)=>locale==='zh'?zh:en;
  const update=(index:number,patch:Partial<FieldEvidence>)=>onChange(fields.map((field,i)=>i===index?{...field,...patch,method:'manual'}:field));
  return <section className="spec-evidence-editor">
    <h3>{bi('逐字段来源与测试条件','Field sources and test conditions')}</h3>
    <p className="caption">{bi('来源记录由提交者确认；PDF/OCR 提取不等于厂家参数已核实。单位使用演算的标准单位；未知页码或条件请留空。修改参数后需要重新确认对应来源。','These are submitter-confirmed claims, not automatically verified manufacturer facts. Units match the calculator. Leave unknown pages or conditions blank; reconfirm evidence after changing a value.')}</p>
    {fields.map((field,index)=><fieldset key={field.parameter}>
      <legend>{field.parameter} · {typeof field.value==='number'?Number(field.value.toPrecision(8)):field.value??'—'} {field.unit}</legend>
      <p className={parameters?.[field.parameter]===field.value?'caption':'warning'}>{parameters?.[field.parameter]===field.value?bi('与当前参数一致','Matches current parameter'):bi('参数已改变：请核对原文，再点击重新确认，或移除此来源','Parameter changed: verify the original, then reconfirm or remove this evidence')}</p>
      <div className="parameter-grid">
        <label className="field"><span>{bi('原文页码（未知留空）','Source page (blank if unknown)')}</span><input type="number" min="1" max="10000" value={field.page??''} onChange={e=>update(index,{page:e.target.value?Number(e.target.value):null})}/></label>
        <label className="field"><span>{bi('标准单位','Canonical unit')}</span><input value={field.unit} readOnly aria-readonly="true"/></label>
      </div>
      <label className="field"><span>{bi('原文摘录','Source excerpt')}</span><textarea maxLength={1000} value={field.excerpt} onChange={e=>update(index,{excerpt:e.target.value})}/></label>
      <label className="field"><span>{bi('测试条件（温度、光源、负载等）','Test conditions (temperature, light, load, etc.)')}</span><input maxLength={500} value={field.conditions} onChange={e=>update(index,{conditions:e.target.value})}/></label>
      <p className="caption">{bi('提交者声明的来源方式：','Submitter-declared method: ')}{field.method}</p>
      <button type="button" disabled={!parameters||!Object.hasOwn(parameters,field.parameter)} onClick={()=>update(index,{value:parameters![field.parameter] as FieldEvidence['value'],unit:parameterUnits[field.parameter]??field.unit})}>{bi('按当前参数重新确认（人工）','Reconfirm current value (manual)')}</button>
      <button type="button" onClick={()=>onChange(fields.filter((_,i)=>i!==index))}>{bi('移除此来源','Remove evidence')}</button>
    </fieldset>)}
    {!fields.length&&<p className="caption">{bi('尚无逐字段来源；这会明确保留为未知。可采用提取候选值或手动添加。','No field sources yet; provenance remains explicitly unknown. Use extracted candidates or add a manual entry.')}</p>}
    <label className="field"><span>{bi('为当前参数添加人工来源','Add a manual source for a parameter')}</span><select value="" onChange={e=>{
      const parameter=e.target.value;if(!parameter||!parameters)return;
      onChange([...fields,{parameter,value:parameters[parameter] as FieldEvidence['value'],unit:parameterUnits[parameter]??'',page:null,excerpt:'',conditions:'',method:'manual'}]);
    }}><option value="">{bi('选择需要记录来源的参数','Choose a parameter')}</option>{Object.keys(parameters??{}).filter(key=>!fields.some(f=>f.parameter===key)).map(key=><option key={key} value={key}>{key}</option>)}</select></label>
  </section>;
}
