import {describe,it,expect} from 'vitest';
import {cloneDesign,changeMode,changeStorage,designSchema} from '../src/shared/model';
import {calculate} from '../src/shared/engine';
describe('ready simulation presets',()=>{
  for(const mode of ['pv','battery','hybrid'] as const) it(`${mode} calculates without missing parameters`,()=>{
    const d=changeMode(cloneDesign(),mode);
    expect(designSchema.safeParse(d).success).toBe(true);
    expect(calculate(d).missing).toEqual([]);
    expect(calculate(d).errors).toEqual([]);
  });
  for(const kind of ['primary','rechargeable','lic','supercap'] as const) it(`${kind} has a complete compatible hybrid template`,()=>{
    const d=changeStorage(changeMode(cloneDesign(),'hybrid'),kind);
    expect(calculate(d).missing).toEqual([]);
    expect(calculate(d).errors).toEqual([]);
  });
  it('measured panel lux bypasses tilt without losing the chosen angle',()=>{
    const d=cloneDesign(); const baseline=calculate(d);
    d.light.angle=67.5;d.light.planeMeasured=true;
    expect(calculate(d).generationWeekJ).toEqual(baseline.generationWeekJ);
    d.light.planeMeasured=false;
    expect(calculate(d).generationWeekJ!).toBeLessThan(baseline.generationWeekJ!);
    expect(d.light.angle).toBe(67.5);
  });
});
