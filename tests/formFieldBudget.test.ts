import {expect,it} from 'vitest';
import {normalizeEditableFields} from '../src/pdf/formFields';
it('rejects excessive widget fan-out before creating page controls',()=>{
  expect(()=>normalizeEditableFields([{name:'Repeated',type:'text',widgets:Array.from({length:1001},()=>({page:1,rect:{x:0,y:0,width:10,height:10}}))}])).toThrow(/widget|complex/i);
});
it('bounds combined choice controls, including choices repeated across page widgets',()=>{
  const choices=Array.from({length:200},(_,i)=>'Option '+i);
  expect(()=>normalizeEditableFields(Array.from({length:26},(_,i)=>({name:'Field'+i,type:'dropdown',choices})))).toThrow(/choice|complex/i);
  expect(()=>normalizeEditableFields([{name:'Repeated list',type:'dropdown',choices,widgets:Array.from({length:101},()=>({page:1,rect:{x:0,y:0,width:10,height:10}}))}])).toThrow(/choice|complex/i);
});
