import {processingConnection,processingProfile,signInForProcessing,signOutForProcessing} from '../app/cloudSync';

export function mountProcessingAccount(host:HTMLElement,changed:()=>void=()=>{}):()=>void{
  let disposed=false,password:HTMLInputElement|null=null;
  const paint=()=>{
    if(disposed)return;host.replaceChildren();
    const identity=document.createElement('p'),status=document.createElement('p');status.setAttribute('role','status');status.setAttribute('aria-live','polite');
    if(!processingConnection()){identity.textContent='Account sign-in is not configured in this build.';host.append(identity);return;}
    const profile=processingProfile();
    if(profile){
      identity.textContent='Signed in'+(profile.email?' as '+profile.email:' to DocFlow');
      const out=document.createElement('button');out.type='button';out.className='df2-btn df2-btn-outline';out.textContent='Sign out of DocFlow';
      out.addEventListener('click',()=>{out.disabled=true;const done=signOutForProcessing();changed();identity.textContent='Signed out of this tab.';void done.then(()=>{paint();changed();});});host.append(identity,out,status);return;
    }
    identity.textContent='Sign in with your confirmed DocFlow account. Staging processing is restricted to approved test accounts.';
    const email=document.createElement('input');email.type='email';email.autocomplete='username';email.maxLength=320;
    password=document.createElement('input');password.type='password';password.autocomplete='current-password';password.maxLength=1024;
    const secret=password;
    const field=(label:string,input:HTMLInputElement)=>{const el=document.createElement('label');el.className='df2-control';el.append(label,input);return el;};
    const button=document.createElement('button');button.type='button';button.className='df2-btn df2-btn-outline';button.textContent='Sign in to DocFlow';
    const submit=async()=>{
      if(button.disabled)return;if(!email.value.trim()||!secret.value||!email.reportValidity()){status.textContent='Enter your account email and password.';return;}
      button.disabled=true;status.textContent='Signing in…';
      try{await signInForProcessing(email.value,secret.value);if(!disposed){paint();changed();}}catch(error){if(!disposed)status.textContent=error instanceof Error?error.message:'Sign-in failed.';}finally{secret.value='';button.disabled=false;}
    };
    button.addEventListener('click',()=>void submit());
    for(const input of [email,secret])input.addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();event.stopPropagation();void submit();}});
    host.append(identity,field('DocFlow account email',email),field('DocFlow account password',secret),button,status);
  };
  paint();return()=>{disposed=true;if(password)password.value='';host.replaceChildren();};
}
