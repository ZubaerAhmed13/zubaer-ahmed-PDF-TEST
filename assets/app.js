(()=>{
'use strict';
const $=(s,r=document)=>r.querySelector(s), $$=(s,r=document)=>[...r.querySelectorAll(s)];
const CV_URL='assets/Zubaer_Ahmed_CV.pdf';
const roles={
 finance:{label:'Finance & Risk',intro:'For analytical finance, controlling, FP&A support, credit/risk and finance-operations roles.',evidence:['BBA major in Finance with Financial Analysis & Control, Management Accounting and Investment Analysis coursework.','Mutual Trust Bank exposure to banking workflows, structured reporting, onboarding documentation and Core Banking Systems.','Excel-based analytical work and personal Financial Workstation project.','Entrepreneurship studies add business-model, market and strategic context.'],skills:['Excel','Financial Analysis','Management Accounting','Reporting','Banking Systems','SAP ERP FI · learning']},
 banking:{label:'Banking, Credit & Compliance',intro:'For banking operations, credit support, AML/compliance and documentation-heavy finance roles.',evidence:['General Banking Internship at Mutual Trust Bank PLC supporting account opening, customer records and transaction-related workflows.','Exposure to AML/CFT requirements, documentation accuracy and Core Banking Systems.','Finance degree foundation plus structured reporting experience.','Process discipline from high-volume operations at Picnic.'],skills:['Core Banking Systems','AML/CFT','Documentation','Customer Onboarding','Excel','Finance']},
 analysis:{label:'Business Analysis & Change',intro:'For process analysis, transformation, operational excellence and change-support roles.',evidence:['Identified a product-placement bottleneck at Picnic and proposed a layout change that improved workflow for a 15–20 person team.','Lufthansa-linked Design Thinking work: research, interviews, synthesis, prototyping, testing, iteration and final pitch.','Business-plan and innovation projects demonstrate structured problem framing and recommendations.','Jira, reporting and cross-functional communication support practical change work.'],skills:['Process Improvement','Design Thinking','Structured Analysis','Jira','Stakeholder Communication','Reporting']},
 pmo:{label:'Project & PMO',intro:'For project coordination, PMO support, transformation projects and cross-functional teams.',evidence:['Project & Change Management coursework including a four-person campus event project.','Two semester-long industry-linked innovation courses with team collaboration, milestones, prototypes and presentations.','Experience coordinating operational issues with shift leadership at Picnic.','PowerPoint, Word, Trello, Teams/SharePoint and Jira support project coordination.'],skills:['Project Coordination','PMO Support','PowerPoint','Word','Trello','Jira']},
 ops:{label:'Operations & Supply Chain',intro:'For operations, supply chain, logistics, continuous improvement and quality-focused roles.',evidence:['Current Picnic experience with WMS, replenishment, inventory audits, quality checks and KPI-driven fulfilment.','Up to 240 picks/hour productivity evidence while maintaining accuracy.','Process-improvement suggestion affecting a 15–20 person workflow.','Experience with real-time issue escalation and operational coordination.'],skills:['WMS','Inventory Accuracy','Quality','KPI Tracking','Process Improvement','Operations']},
 digital:{label:'Digital Business & AI',intro:'For digital transformation, AI-enabled business, product operations and business-tech roles.',evidence:['Built multiple browser tools: AI Resume Builder, Financial Workstation, Persona AI, PDF Toolkit and Scheduling System.','Uses AI tools for research, business reports, market analysis and presentation support.','HTML/CSS/JavaScript prototyping combined with business and finance knowledge.','Currently learning SAP ERP Finance (FI), with Power BI planned next.'],skills:['AI Tools','Prompt Design','HTML/CSS/JS','Digital Product Thinking','SAP ERP FI · learning','Business Analysis']}
};
let activeRole='analysis'; try{activeRole=localStorage.getItem('za-role')||'analysis'}catch(e){}
function renderRole(){
 const wrap=$('#roleChips'); if(!wrap)return;
 wrap.innerHTML='';
 Object.entries(roles).forEach(([k,v])=>{const b=document.createElement('button');b.className='roleChip'+(k===activeRole?' active':'');b.type='button';b.textContent=v.label;b.onclick=()=>{activeRole=k;try{localStorage.setItem('za-role',k)}catch(e){};renderRole()};wrap.appendChild(b)});
 const r=roles[activeRole]; $('#focusTitle').textContent=r.label; $('#focusIntro').textContent=r.intro; $('#focusEvidence').innerHTML=r.evidence.map(x=>`<div class="ev">${x}</div>`).join(''); $('#focusSkills').innerHTML=r.skills.map(x=>`<span class="tag">${x}</span>`).join('');
}
renderRole();

async function loadGallery(){
 try{
   const res=await fetch('assets/lufthansa-gallery.txt?v=13',{cache:'no-store'});
   if(!res.ok)throw new Error('gallery data unavailable');
   const data=(await res.text()).trim();
   if(!data.startsWith('data:image/'))throw new Error('invalid gallery data');
   $$('.spritePhoto').forEach(el=>{
     el.style.setProperty('background-image',`url("${data}")`,'important');
     el.style.setProperty('background-size','200% 200%','important');
     el.style.setProperty('background-repeat','no-repeat','important');
   });
 }catch(err){console.error('Lufthansa gallery could not load:',err)}
}
loadGallery();

function downloadCV(){const a=document.createElement('a');a.href=CV_URL;a.download='Zubaer_Ahmed_CV.pdf';document.body.appendChild(a);a.click();a.remove()}
['downloadCV','downloadCV2','downloadCV3'].forEach(id=>$('#'+id)?.addEventListener('click',downloadCV));
let saved;try{saved=localStorage.getItem('za-theme')}catch(e){} if(saved)document.documentElement.dataset.theme=saved;
$('#theme')?.addEventListener('click',()=>{const n=document.documentElement.dataset.theme==='dark'?'light':'dark';document.documentElement.dataset.theme=n;try{localStorage.setItem('za-theme',n)}catch(e){}});
const modal=$('#recruiterModal'); $$('[data-recruiter]').forEach(b=>b.addEventListener('click',()=>modal?.classList.add('open'))); $$('[data-close]').forEach(b=>b.addEventListener('click',()=>modal?.classList.remove('open'))); modal?.addEventListener('click',e=>{if(e.target===modal)modal.classList.remove('open')});
const toast=$('#toast'); function showToast(t){if(!toast)return;toast.textContent=t;toast.classList.add('show');setTimeout(()=>toast.classList.remove('show'),1600)}
$('#copyEmail')?.addEventListener('click',async()=>{try{await navigator.clipboard.writeText('zubaerknight@gmail.com');showToast('Email copied')}catch(e){showToast('Copy unavailable')}});
const filters=$$('.filter'),projects=$$('.project');filters.forEach(f=>f.addEventListener('click',()=>{filters.forEach(x=>x.classList.remove('active'));f.classList.add('active');const c=f.dataset.filter;projects.forEach(p=>p.classList.toggle('hidden',c!=='all'&&!p.dataset.cat.includes(c)))}));
if('IntersectionObserver'in window){const o=new IntersectionObserver(es=>es.forEach(e=>{if(e.isIntersecting){e.target.classList.add('visible');o.unobserve(e.target)}}),{threshold:.06});$$('.reveal').forEach(el=>o.observe(el))}else{$$('.reveal').forEach(el=>el.classList.add('visible'))}
$('#openGallery')?.addEventListener('click',()=>$('#gallery')?.scrollIntoView({behavior:'smooth',block:'center'}));
const lb=$('#lightbox'), lbSprite=$('#lightboxSprite');
$$('.pic').forEach(p=>p.addEventListener('click',()=>{if(!lb||!lbSprite)return;lbSprite.className='spritePhoto sprite'+(p.dataset.sprite||'1');lb.classList.add('open')})); lb?.addEventListener('click',()=>lb.classList.remove('open'));
document.addEventListener('keydown',e=>{if(e.key==='Escape'){modal?.classList.remove('open');lb?.classList.remove('open')}});
if($('#year'))$('#year').textContent=new Date().getFullYear();
$('#menu')?.addEventListener('click',()=>{const links=[['Experience','#experience'],['Lufthansa collaboration','#lufthansa'],['Projects','#projects'],['Skills','#skills'],['Certificates','#certifications'],['Education','#education'],['Contact','#contact']];const m=document.createElement('div');m.className='modalBack open';m.innerHTML=`<div class="modal" style="max-width:420px"><div class="modalHead"><h2 style="font-size:28px">Navigate</h2><button class="close">×</button></div><div class="contactLinks" style="margin-top:20px">${links.map(([n,h])=>`<a class="contactItem" href="${h}"><strong>${n}</strong><b>→</b></a>`).join('')}</div></div>`;document.body.appendChild(m);m.querySelector('.close').onclick=()=>m.remove();m.onclick=e=>{if(e.target===m)m.remove()};m.querySelectorAll('a').forEach(a=>a.onclick=()=>m.remove())});
})();