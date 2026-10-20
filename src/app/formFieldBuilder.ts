import '../styles/form-builder.css';

type FieldKind = 'text' | 'checkbox' | 'dropdown';
interface NewField {
  type: FieldKind; name: string; page: number; left: number;
  top: number; width: number; height: number; required: boolean; choices?: string[];
}
const LIMIT = 40;

/** UI-only form-definition authoring. Actual editable PDF widgets are created in the worker. */
export function mountFormFieldBuilder(host: HTMLElement, output: HTMLTextAreaElement): { dispose(): void } {
  const fields: NewField[] = [];
  let sequence = 0;
  host.classList.add('df-field-builder');
  const intro = document.createElement('div');
  intro.className = 'df-builder-intro';
  intro.innerHTML = '<strong>Add editable PDF fields</strong><p>Choose a field type, name it, and set its position from the page’s top-left corner. The exported PDF contains actual AcroForm widgets, not just drawn shapes. Your source PDF stays unchanged.</p>';
  const actions = document.createElement('div');
  actions.className = 'df-builder-add';
  for (const [kind, label] of [['text','Text field'],['checkbox','Checkbox'],['dropdown','Dropdown']] as const) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'secondary';
    button.textContent = '+ ' + label;
    button.dataset.addFieldType = kind;
    actions.append(button);
  }
  const status = document.createElement('p');
  status.className = 'df-builder-status';
  status.setAttribute('role','status');
  status.setAttribute('aria-live','polite');
  status.textContent = 'No fields added yet.';
  const list = document.createElement('div');
  list.className = 'df-builder-list';
  const hint = document.createElement('p');
  hint.className = 'df-builder-hint';
  hint.textContent = 'Position and size are percentages of the source page. Each field must fit entirely within its page. Inspect the downloaded PDF before distributing.';
  host.append(intro,actions,status,list,hint);

  const write = (): void => {
    output.value = JSON.stringify(fields);
    output.dispatchEvent(new Event('input',{bubbles:true}));
    status.textContent = fields.length + ' editable ' + (fields.length === 1 ? 'field' : 'fields') + ' prepared · up to 40 per run';
    actions.querySelectorAll<HTMLButtonElement>('button').forEach(button => { button.disabled = fields.length >= LIMIT; });
  };
  const labeled = (parent: HTMLElement, name: string, node: HTMLElement): void => {
    const label = document.createElement('label');
    label.className = 'df-builder-property';
    const heading = document.createElement('span');
    heading.textContent = name;
    label.append(heading,node);
    parent.append(label);
  };
  const inputText = (value: string, change: (value: string) => void): HTMLInputElement => {
    const node = document.createElement('input');
    node.type='text'; node.maxLength=80; node.value=value;
    node.addEventListener('input',()=>change(node.value));
    return node;
  };
  const inputNum = (value: number, min: number, max: number, change: (number: number)=>void): HTMLInputElement => {
    const node=document.createElement('input');
    node.type='number';node.min=String(min);node.max=String(max);node.step='1';node.value=String(value);
    node.addEventListener('input',()=>change(Number(node.value)));
    return node;
  };
  const draw = (): void => {
    list.replaceChildren();
    fields.forEach((field,index)=>{
      const card=document.createElement('article');card.className='df-builder-card';
      const top=document.createElement('div');top.className='df-builder-card-top';
      const title=document.createElement('strong');
      title.textContent=(index+1)+'. '+(field.type==='text'?'Text field':field.type==='checkbox'?'Checkbox':'Dropdown');
      const remove=document.createElement('button');
      remove.type='button';remove.className='secondary';remove.textContent='Remove';
      remove.setAttribute('aria-label','Remove field '+field.name);
      remove.addEventListener('click',()=>{fields.splice(index,1);draw();write();});
      top.append(title,remove);card.append(top);
      const grid=document.createElement('div');grid.className='df-builder-properties';
      const named=inputText(field.name, value=>{field.name=value;remove.setAttribute('aria-label','Remove field '+value);write();});
      labeled(grid,'Field name',named);
      labeled(grid,'Page',inputNum(field.page,1,1000,value=>{field.page=value;write();}));
      labeled(grid,'Left (%)',inputNum(field.left,0,99,value=>{field.left=value;write();}));
      labeled(grid,'Top (%)',inputNum(field.top,0,99,value=>{field.top=value;write();}));
      labeled(grid,'Width (%)',inputNum(field.width,1,100,value=>{field.width=value;write();}));
      labeled(grid,'Height (%)',inputNum(field.height,1,100,value=>{field.height=value;write();}));
      if(field.type==='dropdown'){
        const choices=document.createElement('textarea');
        choices.rows=3;choices.value=field.choices?.join('\n')??'';
        choices.setAttribute('aria-label','Dropdown choices, one per line');
        choices.addEventListener('input',()=>{field.choices=choices.value.split(/\r?\n/g).map(x=>x.trim()).filter(Boolean);write();});
        labeled(grid,'Dropdown choices · one per line',choices);
      }
      const required=document.createElement('label');required.className='df-builder-required';
      const toggle=document.createElement('input');toggle.type='checkbox';toggle.checked=field.required;
      toggle.addEventListener('change',()=>{field.required=toggle.checked;write();});
      required.append(toggle,document.createTextNode('Required field'));
      card.append(grid,required);
      list.append(card);
    });
  };
  const add = (kind: FieldKind): void => {
    if(fields.length>=LIMIT)return;
    sequence++;
    fields.push({type:kind,name:'Field'+sequence,page:1,left:15,top:15+((fields.length*10)%70),
      width:kind==='checkbox'?5:40,height:kind==='checkbox'?5:7,required:false,
      ...(kind==='dropdown'?{choices:['Option 1','Option 2']}: {})});
    draw();write();
    const last=list.lastElementChild;
    last?.querySelector<HTMLInputElement>('input[type=text]')?.focus();
  };
  const onActions = (event: MouseEvent): void => {
    const target = event.target instanceof Element ? event.target.closest<HTMLButtonElement>('[data-add-field-type]'):null;
    const kind=target?.dataset.addFieldType;
    if(kind==='text'||kind==='checkbox'||kind==='dropdown')add(kind);
  };
  actions.addEventListener('click',onActions);
  write();
  return {dispose:()=>{actions.removeEventListener('click',onActions);host.replaceChildren();}};
}
