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
  dialog.innerHTML = `<h2 id="crop-title"></h2><p class="small muted">Перетащите фото внутри рамки и настройте масштаб. Сохранится только видимая часть.</p><canvas class="crop-canvas" tabindex="0" role="img" aria-label="Выбранная область фотографии"></canvas><label class="field">Масштаб<input data-crop="zoom" aria-label="Масштаб фотографии" type="range" min="1" max="4" step="0.01" value="1"></label><div class="form-grid"><label class="field">По горизонтали<input data-crop="x" type="range" min="-100" max="100" value="0"></label><label class="field">По вертикали<input data-crop="y" type="range" min="-100" max="100" value="0"></label></div><p class="error" data-crop-error role="alert"></p><div class="actions"><button class="primary" data-crop-save type="button">Применить</button><button data-crop-cancel type="button">Отмена</button></div>`;
  dialog.querySelector('h2').textContent = title;
  document.body.append(dialog);
  const canvas = dialog.querySelector('canvas');
  canvas.width = width; canvas.height = Math.round(width / aspect);
  canvas.style.maxWidth = `${48 * aspect}dvh`;
  const context = canvas.getContext('2d');
  const controls = Object.fromEntries(['zoom','x','y'].map(key => [key, dialog.querySelector(`[data-crop="${key}"]`)]));
  const base = Math.max(canvas.width / image.naturalWidth, canvas.height / image.naturalHeight);
  function bounds() {
    const scale = base * Number(controls.zoom.value);
    return {scale, x: Math.max(0, (image.naturalWidth * scale - canvas.width) / 2), y: Math.max(0, (image.naturalHeight * scale - canvas.height) / 2)};
  }
  function draw() {
    const limits = bounds();
    context.fillStyle = '#fff';context.fillRect(0,0,canvas.width,canvas.height);
    context.drawImage(image, (canvas.width - image.naturalWidth * limits.scale) / 2 + limits.x * Number(controls.x.value) / 100,
      (canvas.height - image.naturalHeight * limits.scale) / 2 + limits.y * Number(controls.y.value) / 100,
      image.naturalWidth * limits.scale, image.naturalHeight * limits.scale);
  }
  Object.values(controls).forEach(input => input.oninput = draw);
  let drag;
  canvas.onpointerdown = event => {
    if (event.button !== 0) return;
    canvas.setPointerCapture(event.pointerId);
    drag = {id:event.pointerId,x:event.clientX,y:event.clientY,offsetX:Number(controls.x.value),offsetY:Number(controls.y.value)};
  };
  canvas.onpointermove = event => {
    if (!drag || drag.id !== event.pointerId) return;
    const rect = canvas.getBoundingClientRect(), limits = bounds();
    const factor = canvas.width / rect.width;
    if (limits.x) controls.x.value = Math.max(-100, Math.min(100, drag.offsetX + (event.clientX - drag.x) * factor / limits.x * 100));
    if (limits.y) controls.y.value = Math.max(-100, Math.min(100, drag.offsetY + (event.clientY - drag.y) * factor / limits.y * 100));
    draw();
  };
  canvas.onpointerup = canvas.onpointercancel = canvas.onlostpointercapture = () => { drag = null; };
  canvas.addEventListener('wheel', event => {
    event.preventDefault(); controls.zoom.value = Math.max(1, Math.min(4, Number(controls.zoom.value) * Math.exp(-event.deltaY * .002)));draw();
  }, {passive:false});
  draw();dialog.showModal();
  return new Promise(resolve => {
    let result = null;
    dialog.querySelector('[data-crop-cancel]').onclick = () => dialog.close();
    dialog.querySelector('[data-crop-save]').onclick = () => {
      const save = dialog.querySelector('[data-crop-save]');save.disabled = true;
      canvas.toBlob(blob => {
        if (!blob) {save.disabled=false;dialog.querySelector('[data-crop-error]').textContent='Не удалось обработать фото. Попробуйте ещё раз.';return;}
        result = new File([blob], 'cropped-photo.jpg', {type:'image/jpeg'});dialog.close();
      }, 'image/jpeg', .9);
    };
    dialog.addEventListener('close', () => {URL.revokeObjectURL(objectUrl);dialog.remove();resolve(result);}, {once:true});
  });
}
