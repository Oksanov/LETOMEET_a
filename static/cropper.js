// Shared local crop editor: only the chosen crop is uploaded.
async function cropImageFile(file, {aspect = 1, width = 800, title = 'Выберите часть фотографии'} = {}) {
  if (!/\.(jpe?g|png|webp)$/i.test(file.name) || file.size > 4 * 1024 * 1024) {
    throw new Error('Выберите JPG, PNG или WEBP до 4 МБ.');
  }
  const objectUrl = URL.createObjectURL(file);
  const image = new Image();
  try {
    image.src = objectUrl;
    await image.decode();
    if (image.naturalWidth * image.naturalHeight > 20000000) throw new Error('Фотография больше 20 мегапикселей. Уменьшите её размер.');
  } catch (error) {
    URL.revokeObjectURL(objectUrl);
    throw new Error(error.message || 'Не удалось открыть изображение');
  }
  const dialog = document.createElement('dialog');
  dialog.className = 'crop-dialog';
  dialog.setAttribute('aria-labelledby', 'crop-title');
  dialog.innerHTML = `<h2 id="crop-title"></h2><p class="small muted" data-crop-help></p><canvas class="crop-canvas" tabindex="0" role="img" aria-label="Выбранная область фотографии. Стрелки двигают фото, плюс и минус меняют масштаб."></canvas><label class="field">Масштаб<input data-crop="zoom" aria-label="Масштаб фотографии" type="range" min="1" max="4" step="0.01" value="1"></label><div class="form-grid crop-legacy-controls"><label class="field">По горизонтали<input data-crop="x" type="range" min="-100" max="100" value="0"></label><label class="field">По вертикали<input data-crop="y" type="range" min="-100" max="100" value="0"></label></div><p class="error" data-crop-error role="alert"></p><div class="crop-footer"><button class="secondary crop-mode-toggle" data-crop-mode-toggle type="button"></button><div class="actions"><button class="primary" data-crop-save type="button">Применить</button><button data-crop-cancel type="button">Отмена</button></div></div>`;
  dialog.querySelector('h2').textContent = title;
  document.body.append(dialog);
  const canvas = dialog.querySelector('canvas');
  canvas.width = width;canvas.height = Math.round(width/aspect);canvas.style.maxWidth = `${48*aspect}dvh`;
  const context = canvas.getContext('2d');
  const controls = Object.fromEntries(['zoom','x','y'].map(key => [key, dialog.querySelector(`[data-crop="${key}"]`)]));
  const base = Math.max(canvas.width/image.naturalWidth,canvas.height/image.naturalHeight);
  let zoom = 1, x = 0, y = 0, mode = 'new';
  try {if(localStorage.getItem('letomeet-crop-mode')==='old')mode='old';}catch{}
  function limits() {
    const scale=base*zoom;
    return {scale,x:Math.max(0,(image.naturalWidth*scale-canvas.width)/2),y:Math.max(0,(image.naturalHeight*scale-canvas.height)/2)};
  }
  function draw() {
    const bounds=limits();
    x=Math.max(-bounds.x,Math.min(bounds.x,x));y=Math.max(-bounds.y,Math.min(bounds.y,y));
    controls.zoom.value=String(zoom);
    controls.x.value=String(bounds.x?x/bounds.x*100:0);controls.y.value=String(bounds.y?y/bounds.y*100:0);
    context.fillStyle='#fff';context.fillRect(0,0,canvas.width,canvas.height);
    context.drawImage(image,(canvas.width-image.naturalWidth*bounds.scale)/2+x,
      (canvas.height-image.naturalHeight*bounds.scale)/2+y,image.naturalWidth*bounds.scale,image.naturalHeight*bounds.scale);
  }
  function canvasPoint(event) {
    const rect=canvas.getBoundingClientRect();
    return {x:(event.clientX-rect.left)*canvas.width/rect.width,y:(event.clientY-rect.top)*canvas.height/rect.height};
  }
  function setZoom(value, from={x:canvas.width/2,y:canvas.height/2}, to=from) {
    const oldScale=base*zoom;
    const imageX=(from.x-(canvas.width-image.naturalWidth*oldScale)/2-x)/oldScale;
    const imageY=(from.y-(canvas.height-image.naturalHeight*oldScale)/2-y)/oldScale;
    zoom=Math.max(1,Math.min(4,value));
    const newScale=base*zoom;
    x=to.x-imageX*newScale-(canvas.width-image.naturalWidth*newScale)/2;
    y=to.y-imageY*newScale-(canvas.height-image.naturalHeight*newScale)/2;
    draw();
  }
  controls.zoom.oninput=()=>setZoom(Number(controls.zoom.value));
  controls.x.oninput=()=>{x=limits().x*Number(controls.x.value)/100;draw();};
  controls.y.oninput=()=>{y=limits().y*Number(controls.y.value)/100;draw();};
  const pointers=new Map();let drag=null,pinch=null;
  function pair() {
    const [a,b]=[...pointers.values()];
    return {x:(a.x+b.x)/2,y:(a.y+b.y)/2,distance:Math.max(1,Math.hypot(a.x-b.x,a.y-b.y))};
  }
  function rebase() {
    pinch=mode==='new' && pointers.size>=2?pair():null;
    drag=!pinch&&pointers.size?{id:[...pointers.keys()][0],point:[...pointers.values()][0],x,y}:null;
    canvas.classList.toggle('is-dragging',pointers.size>0);
  }
  function finish(event) {
    if(!pointers.has(event.pointerId))return;
    pointers.delete(event.pointerId);rebase();
    if(canvas.hasPointerCapture(event.pointerId))canvas.releasePointerCapture(event.pointerId);
  }
  canvas.onpointerdown=event=>{
    if(event.button!==0)return;
    if(mode==='old'&&pointers.size)return;
    pointers.set(event.pointerId,canvasPoint(event));canvas.setPointerCapture(event.pointerId);rebase();
  };
  canvas.onpointermove=event=>{
    if(!pointers.has(event.pointerId))return;
    event.preventDefault();const point=canvasPoint(event);pointers.set(event.pointerId,point);
    if(pinch&&mode==='new'&&pointers.size>=2){
      const next=pair();setZoom(zoom*next.distance/pinch.distance,pinch,next);pinch=next;
    }else if(drag&&drag.id===event.pointerId){
      x=drag.x+point.x-drag.point.x;y=drag.y+point.y-drag.point.y;draw();
    }
  };
  canvas.onpointerup=canvas.onpointercancel=canvas.onlostpointercapture=finish;
  canvas.addEventListener('wheel',event=>{
    event.preventDefault();
    const delta=event.deltaY*(event.deltaMode===1?16:event.deltaMode===2?canvas.clientHeight:1);
    setZoom(zoom*Math.exp(-Math.max(-200,Math.min(200,delta))*.002),mode==='new'?canvasPoint(event):undefined);
  },{passive:false});
  canvas.ondblclick=()=>{zoom=1;x=0;y=0;draw();};
  canvas.onkeydown=event=>{
    const delta=canvas.width*.025;
    if(event.key==='ArrowLeft')x-=delta;else if(event.key==='ArrowRight')x+=delta;
    else if(event.key==='ArrowUp')y-=delta;else if(event.key==='ArrowDown')y+=delta;
    else if(event.key==='+'||event.key==='='){event.preventDefault();setZoom(zoom*1.1);return;}
    else if(event.key==='-'){event.preventDefault();setZoom(zoom/1.1);return;}else return;
    event.preventDefault();draw();
  };
  const modeButton=dialog.querySelector('[data-crop-mode-toggle]');
  function updateMode(){
    dialog.dataset.cropMode=mode;
    modeButton.textContent=mode==='new'?'Старая версия':'Новая версия';
    modeButton.setAttribute('aria-label',mode==='new'?'Переключить на старую версию кроппера':'Переключить на новую версию кроппера');
    dialog.querySelector('[data-crop-help]').textContent=mode==='new'
      ?'Двигайте фото мышью или пальцем. Масштаб — колёсиком, двумя пальцами или ползунком. Двойной клик возвращает исходный кадр.'
      :'Перетащите фото внутри рамки или используйте ползунки положения и масштаба.';
    rebase();
  }
  modeButton.onclick=()=>{mode=mode==='new'?'old':'new';try{localStorage.setItem('letomeet-crop-mode',mode);}catch{}updateMode();};
  updateMode();draw();dialog.showModal();
  return new Promise(resolve=>{
    let result=null;
    dialog.querySelector('[data-crop-cancel]').onclick=()=>dialog.close();
    dialog.querySelector('[data-crop-save]').onclick=()=>{
      const save=dialog.querySelector('[data-crop-save]');save.disabled=true;
      canvas.toBlob(blob=>{
        if(!dialog.isConnected)return;
        if(!blob){save.disabled=false;dialog.querySelector('[data-crop-error]').textContent='Не удалось обработать фото. Попробуйте ещё раз.';return;}
        result=new File([blob],'cropped-photo.jpg',{type:'image/jpeg'});dialog.close();
      },'image/jpeg',.9);
    };
    dialog.addEventListener('close',()=>{URL.revokeObjectURL(objectUrl);dialog.remove();resolve(result);},{once:true});
  });
}
