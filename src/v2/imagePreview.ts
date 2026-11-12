/**
 * First-class image previews for the Images → PDF workflow.
 * No PDF transformation occurs in this layer; worker preserves source order.
 */
export class V2ImagePreview {
  private urls:string[]=[];
  private current=0;
  private destroyed=false;
  constructor(private readonly files:readonly File[],
    private readonly canvas:HTMLCanvasElement,
    private readonly status:HTMLElement,
    private readonly rail:HTMLElement) {}
  async mount():Promise<void>{
    this.urls=this.files.map(file=>URL.createObjectURL(file));
    this.rail.replaceChildren();
    for(let index=0;index<Math.min(this.files.length,90);index++){
      const button=document.createElement('button');
      button.type='button';button.className='df2-thumb df2-image-thumb';
      button.dataset.imageIndex=String(index);
      button.ariaLabel='Preview image '+(index+1)+': '+this.files[index]!.name;
      const img=document.createElement('img');
      img.src=this.urls[index]!;
      img.loading='lazy';img.alt='';
      const span=document.createElement('span');span.textContent=String(index+1);
      button.append(img,span);this.rail.append(button);
    }
    if(this.files.length>90){
      const p=document.createElement('p');p.className='df2-rail-note';
      p.textContent='Showing 90 image thumbnails. All '+this.files.length+' images will be included in the PDF.';
      this.rail.append(p);
    }
    await this.show(0);
  }
  get length():number {return this.files.length;}
  private async loadImage(src:string):Promise<HTMLImageElement>{
    return new Promise((resolve,reject)=>{
      const image=new Image();
      image.onload=()=>resolve(image);
      image.onerror=()=>reject(new Error('This image could not be decoded for preview.'));
      image.src=src;
    });
  }
  async show(index:number):Promise<void>{
    if(this.destroyed||!this.files.length)return;
    const chosen=Math.max(0,Math.min(index,this.files.length-1));
    this.current=chosen;
    const url=this.urls[chosen];if(!url)return;
    this.status.textContent='Rendering image '+(chosen+1)+' of '+this.files.length+'…';
    try{
      const image=await this.loadImage(url);
      if(this.destroyed||this.current!==chosen)return;
      const ratio=Math.min(1,1300/Math.max(image.naturalWidth,image.naturalHeight));
      const width=Math.max(1,Math.round(image.naturalWidth*ratio));
      const height=Math.max(1,Math.round(image.naturalHeight*ratio));
      this.canvas.width=width;this.canvas.height=height;
      this.canvas.style.width=width+'px';this.canvas.style.height=height+'px';
      const ctx=this.canvas.getContext('2d',{alpha:false});
      if(!ctx)throw Error('Canvas preview not supported');
      ctx.fillStyle='#fff';ctx.fillRect(0,0,width,height);ctx.drawImage(image,0,0,width,height);
      this.status.textContent='Image '+(chosen+1)+' of '+this.files.length;
      this.rail.querySelectorAll<HTMLButtonElement>('[data-image-index]').forEach(btn=>{
        btn.setAttribute('aria-pressed',String(Number(btn.dataset.imageIndex)===chosen));
      });
    }catch(e){if(!this.destroyed&&this.current===chosen)this.status.textContent=e instanceof Error?e.message:'Preview unavailable';}
  }
  async next(delta:number):Promise<void>{await this.show(this.current+delta);}
  dispose():void{
    this.destroyed=true;this.urls.forEach(url=>URL.revokeObjectURL(url));this.urls=[];
    this.rail.replaceChildren();this.canvas.width=1;this.canvas.height=1;
  }
}
