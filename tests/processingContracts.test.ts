import {describe,it,expect} from 'vitest';
import {parseCreateJobRequest,validateOutput,validateStorageUrl,canTransition,canPublishResult,LIMITS,NOTICE_VERSION} from '../backend/contracts';

const id='12345678-1234-4123-8123-123456789abc';
const owner='22345678-1234-4123-8123-123456789abc';
const sha='a'.repeat(64);
function request(operation='compress'){
  return {operation,idempotencyKey:id,consent:{accepted:true,noticeVersion:NOTICE_VERSION},files:[{name:'source.pdf',type:'application/pdf',size:1000,sha256:sha}],options:{}};
}
describe('processing request contract',()=>{
  it('uses actual bounded image controls and does not mutate caller input',()=>{
    const input=request(),before=structuredClone(input),parsed=parseCreateJobRequest(input);
    expect(parsed.options).toEqual({jpegQuality:85,dpi:150,maxImagePixels:2200});expect(input).toEqual(before);
  });
  it('accepts matching OOXML declarations and explicit English/German OCR controls',()=>{
    const office=request('office-to-pdf');office.files=[{name:'report.docx',type:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',size:1000,sha256:sha}];
    expect(parseCreateJobRequest(office).operation).toBe('office-to-pdf');
    const ocr={...request('ocr'),options:{languages:['eng','deu'],deskew:false,rotate:true}};
    expect(parseCreateJobRequest(ocr).options).toEqual(ocr.options);
  });
  it('requires current explicit upload consent and rejects owner injection',()=>{
    expect(()=>parseCreateJobRequest({...request(),consent:{accepted:false,noticeVersion:NOTICE_VERSION}})).toThrow(/consent|notice/i);
    expect(()=>parseCreateJobRequest({...request(),consent:{accepted:true,noticeVersion:'old'}})).toThrow(/notice/i);
    expect(()=>parseCreateJobRequest({...request(),user_id:owner})).toThrow(/unknown|field/i);
  });
  it('rejects malformed types, filename traversal, mismatched MIME and resource excess',()=>{
    const variants=[
      {...request(),files:[{...request().files[0],size:LIMITS.inputBytes+1}]},
      {...request(),files:[{...request().files[0],size:'1000'}]},
      {...request(),files:[{...request().files[0],name:'../source.pdf'}]},
      {...request(),files:[{...request().files[0],name:'source.docx'}]},
      {...request(),files:[{...request().files[0],sha256:'bad'}]},
      {...request(),files:[]},
      {...request(),files:[...request().files,...request().files]},
      {...request(),idempotencyKey:'not-a-uuid'},
      {...request(),operation:'run-command'},
      {...request(),operation:['compress']},
    ];
    for(const value of variants)expect(()=>parseCreateJobRequest(value)).toThrow();
  });
  it('rejects unsupported/unsafe options rather than silently ignoring them',()=>{
    for(const options of [{jpegQuality:1},{jpegQuality:Infinity},{dpi:'150'},{dpi:301},{maxImagePixels:5001},{command:'rm'},['jpegQuality']])expect(()=>parseCreateJobRequest({...request(),options})).toThrow();
    for(const options of [{languages:['fra']},{languages:['eng','eng']},{rotate:'true'},{deskew:null},{languages:[]}])expect(()=>parseCreateJobRequest({...request('ocr'),options})).toThrow();
    expect(()=>parseCreateJobRequest({...request('office-to-pdf'),options:{macro:true}})).toThrow();
  });
});
describe('worker storage and output boundary',()=>{
  const project='https://ruefkvkavvycposzahit.supabase.co';
  const path=`docflow-processing/${owner}/${id}/input/0.pdf`;
  it('allows only the exact signed object and rejects redirects/host/path confusion',()=>{
    const url=`${project}/storage/v1/object/sign/${path}?token=opaque-token`;
    expect(validateStorageUrl(url,project,path,'download')).toBe(url);
    for(const value of [url.replace('https:','http:'),url.replace('.co/','.co.evil.test/'),url.replace('/input/0.pdf','/input/1.pdf'),url.replace('?token=opaque-token',''),url.replace('/input/0.pdf','/input/%2e%2e/other.pdf')])expect(()=>validateStorageUrl(value,project,path,'download')).toThrow();
    expect(()=>validateStorageUrl(url,project,path,'upload')).toThrow();
  });
  it('accepts measured PDFs and rejects invalid or oversized output metadata',()=>{
    const output={name:'result.pdf',type:'application/pdf',size:1000,sha256:sha,pages:2};
    expect(validateOutput(output)).toEqual(output);
    for(const value of [{...output,name:'../result.pdf'},{...output,pages:0},{...output,pages:101},{...output,size:LIMITS.outputBytes+1},{...output,sha256:'bad'},{...output,type:'text/html'},{...output,publicUrl:'https://example.com'}])expect(()=>validateOutput(value)).toThrow();
  });
});
describe('durable job state races',()=>{
  it('cannot publish cancelled/expired jobs or stale attempts and leases',()=>{
    const now=Date.parse('2026-10-24T12:00:00Z'),job={state:'running',attempt:2,leaseUntil:'2026-10-24T12:03:00Z',expiresAt:'2026-10-24T12:30:00Z'};
    expect(canPublishResult(job,2,now)).toBe(true);
    for(const state of ['queued','cancelling','cancelled','failed','expired','completed'])expect(canPublishResult({...job,state},2,now)).toBe(false);
    expect(canPublishResult(job,1,now)).toBe(false);expect(canPublishResult(job,2,now+181000)).toBe(false);
    expect(canPublishResult({...job,expiresAt:'bad'},2,now)).toBe(false);
  });
  it('keeps terminal states terminal while permitting explicit expiry',()=>{
    expect(canTransition('queued','running')).toBe(true);expect(canTransition('running','cancelling')).toBe(true);expect(canTransition('cancelling','cancelled')).toBe(true);
    for(const state of ['completed','failed','cancelled','expired'])expect(canTransition(state,'running')).toBe(false);
    expect(canTransition('completed','expired')).toBe(true);expect(canTransition('cancelling','completed')).toBe(false);
  });
});
