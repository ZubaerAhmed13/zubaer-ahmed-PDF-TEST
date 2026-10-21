import {describe,it,expect} from 'vitest';
import {EditHistory,emptyPlan,type EditPlan} from '../src/pdf/editModel';
import {V2PageEditor} from '../src/v2/pageEditor';
import type {NativeEditPlan} from '../src/pdf/nativeModel';

describe('atomic source edit history',()=>{
  it('keeps exported plan equal to accepted history after a combined-plan budget rejection',()=>{
    const plan=emptyPlan();plan.objects.push({id:'image',page:1,kind:'image',x:0,y:0,width:10,height:10,size:14,color:'#000000',data:'x'.repeat(9*1024*1024)});
    const history=new EditHistory(plan);
    // No DOM is needed: a rejected history commit must exit before repainting.
    const editor=Object.assign(Object.create(V2PageEditor.prototype),{history,plan:history.current}) as {commitSource(source:NativeEditPlan,preview:ArrayBuffer):void;currentPlan:EditPlan};
    const source:NativeEditPlan={fingerprint:'0'.repeat(64),edits:[{id:'1:0',kind:'image',data:'y'.repeat(9*1024*1024)}]};
    expect(()=>editor.commitSource(source,new ArrayBuffer(8))).toThrow(/16 MB/);
    expect(editor.currentPlan).toEqual(history.current);expect(editor.currentPlan.source).toBeUndefined();expect(history.canUndo).toBe(false);
  });
});
