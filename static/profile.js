function profileColor(value, fallback = '#e3cd86') {
  return /^#[0-9a-f]{6}$/i.test(value || '') ? value : fallback;
}

function avatarMarkup(user, className = 'profile-avatar') {
  return user.avatar_url
    ? `<img class="${className}" src="${escapeHtml(user.avatar_url)}" alt="Фото профиля">`
    : `<span class="${className} avatar-initials" style="--profile-selected-color:${profileColor(user.avatar_color)};background:${profileColor(user.avatar_color)}" aria-hidden="true">${escapeHtml((user.username || '?').trim().slice(0,2).toUpperCase())}</span>`;
}

const PROFILE_EVENT_COLORS = [
  ['cream','Кремовый','#f8f4e8'], ['blue','Голубой','#edf4fa'],
  ['green','Зелёный','#edf4eb'], ['lavender','Лавандовый','#f2eff8'],
  ['peach','Персиковый','#fbf0e8'], ['pink','Розовый','#f8edf1'],
  ['burgundy','Бордовый','#dfb3bf'], ['dark','Тёмный','#34352f']
];

function profilePhotoField(key) {
  const value = currentUser[`${key}_color`];
  const selected = PROFILE_EVENT_COLORS.some(([, , hex]) => hex === value) ? value : PROFILE_EVENT_COLORS[0][2];
  const hasPhoto = Boolean(currentUser[`${key}_url`]);
  const label = key === 'banner' ? 'Цвет баннера' : 'Фон аватарки';
  const explanation = key === 'banner'
    ? 'Для того, чтобы поставить цветной баннер, нужно удалить фотографию.'
    : 'Для того, чтобы поставить цветной фон аватарки, нужно удалить фотографию.';
  return `<div class="profile-upload">
    ${key === 'avatar' ? '<p class="small muted">JPG, PNG или WEBP, до 4 МБ и 20 мегапикселей. Для аватара лучше квадрат, для баннера — 1500 × 500. Перед загрузкой можно выбрать область фотографии. Аватар виден рядом с вашими комментариями.</p>' : ''}
    <fieldset class="profile-color-picker" data-profile-colors="${key}" aria-describedby="${key}-color-help" ${hasPhoto ? 'disabled' : ''}>
      <legend>${label}</legend>
      <div class="color-swatches">${PROFILE_EVENT_COLORS.map(([name, title, hex]) => `<label class="color-option"><input type="radio" name="${key}_color" value="${hex}" ${selected === hex ? 'checked' : ''}><span class="color-swatch event-card-${name}" aria-hidden="true"></span><span>${title}</span></label>`).join('')}</div>
    </fieldset>
    <p class="small muted" id="${key}-color-help" data-profile-color-help="${key}" ${hasPhoto ? '' : 'hidden'}>${explanation}</p>
    <label class="field">${key === 'avatar' ? '' : 'Баннер'}<input aria-label="${key === 'avatar' ? 'Добавить фото аватара' : 'Добавить фото баннера'}" type="file" data-profile-file="${key}" accept="image/jpeg,image/png,image/webp"></label>
    <div data-profile-preview="${key}"></div><button class="secondary" type="button" data-profile-remove="${key}">Убрать ${key === 'avatar' ? 'фото' : 'баннер'}</button>
  </div>`;
}

function profileMarkup() {
  return `<section class="profile-card" aria-label="Профиль">
    <div class="profile-banner" style="--profile-selected-color:${profileColor(currentUser.banner_color)};background:${profileColor(currentUser.banner_color)}">${currentUser.banner_url ? `<img src="${escapeHtml(currentUser.banner_url)}" alt="Баннер профиля">` : ''}</div>
    <div class="profile-identity">${avatarMarkup(currentUser)}<div><h2>${escapeHtml(currentUser.username)}</h2><p class="small muted">${escapeHtml(currentUser.email)}</p></div></div>
    <details class="profile-editor"><summary>Редактировать профиль</summary>
      <form id="profile-form">
        <label class="field">Имя<input name="username" required maxlength="80" value="${escapeHtml(currentUser.username)}"></label>

        ${['avatar','banner'].map(profilePhotoField).join('')}
        <p class="error" id="profile-error" role="alert"></p>
        <button class="primary" type="submit">Сохранить профиль</button>
      </form>
    </details>
  </section>`;
}

function bindProfile() {
  const form=document.querySelector('#profile-form');
  const state={avatar:{url:currentUser.avatar_url},banner:{url:currentUser.banner_url}};
  const error=form.querySelector('#profile-error');
  function syncAppearance(key) {
    const image=state[key];
    const photo=image.preview || image.url;
    const picker=form.querySelector(`[data-profile-colors="${key}"]`);
    picker.disabled=Boolean(photo) || Boolean(form.dataset.busy);
    form.querySelector(`[data-profile-color-help="${key}"]`).hidden=!photo;
    const selected=form.querySelector(`input[name="${key}_color"]:checked`);
    const color=profileColor(selected?.value);
    if (key === 'banner') {
      const banner=document.querySelector('.profile-banner');
      banner.style.background=color;
      banner.style.setProperty('--profile-selected-color',color);
      banner.innerHTML=photo ? `<img src="${escapeHtml(photo)}" alt="Баннер профиля">` : '';
    } else {
      const avatar=document.querySelector('.profile-identity .profile-avatar');
      if (avatar) avatar.outerHTML=avatarMarkup({...currentUser,avatar_url:photo||null,avatar_color:color});
    }
  }
  for (const key of ['avatar','banner']) {
    form.querySelectorAll(`input[name="${key}_color"]`).forEach(input => {
      input.onchange=()=>syncAppearance(key);
    });
  }
  function renderPreview(key) {
    const image=state[key];
    form.querySelector(`[data-profile-preview="${key}"]`).innerHTML=image.preview||image.url
      ? `<img class="profile-${key}-preview" src="${escapeHtml(image.preview||image.url)}" alt="Предпросмотр">` : '<p class="small muted">Изображение не выбрано</p>';
    syncAppearance(key);
  }
  for (const key of ['avatar','banner']) {
    renderPreview(key);
    const input=form.querySelector(`[data-profile-file="${key}"]`);
    let version = 0;
    input.onchange=async()=>{
      const file=input.files[0]; if (!file) return;
      const selectedVersion = ++version;
      error.textContent='';
      try {
        const cropped = await cropImageFile(file, {aspect:key==='banner'?3:1,width:key==='banner'?1500:512,title:key==='banner'?'Обрезка баннера':'Обрезка аватара'});
        if (selectedVersion !== version || !form.isConnected || !cropped) return;
        if (state[key].preview) URL.revokeObjectURL(state[key].preview);
        state[key]={file:cropped,preview:URL.createObjectURL(cropped)};renderPreview(key);
      } catch(err) {error.textContent=err.message;}
      finally {input.value='';}
    };
    form.querySelector(`[data-profile-remove="${key}"]`).onclick=()=>{
      version++;
      if (state[key].preview) URL.revokeObjectURL(state[key].preview);
      state[key]={url:null};input.value='';renderPreview(key);
    };
  }
  form.onsubmit=async e=>{
    e.preventDefault();
    if(form.dataset.busy)return;
    form.dataset.busy='1';error.textContent='';
    const name=form.elements.username.value;
    const avatarColor=form.elements.avatar_color.value, bannerColor=form.elements.banner_color.value;
    form.querySelectorAll('button,input').forEach(el=>el.disabled=true);
    try {
      for(const key of ['avatar','banner']) if(state[key].file){
        const body=new FormData();body.append('image',state[key].file);
        const response=await fetch('/api/upload-image',{method:'POST',body});
        const data=await response.json();if(!response.ok)throw new Error(data.error||'Не удалось загрузить фото');
        state[key].url=data.image_url;delete state[key].file;
      }
      const response=await fetch('/api/me/profile',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:name,avatar_color:avatarColor,banner_color:bannerColor,avatar_url:state.avatar.url||null,banner_url:state.banner.url||null})});
      const data=await response.json();if(!response.ok)throw new Error(data.error||'Не удалось сохранить профиль');
      currentUser=data.user;updateAuthPanel();
      for(const key of ['avatar','banner'])if(state[key].preview)URL.revokeObjectURL(state[key].preview);
      if(form.isConnected){await render();}
    }catch(err){if(form.isConnected)error.textContent=err.message;}
    finally{delete form.dataset.busy;form.querySelectorAll('button,input').forEach(el=>el.disabled=false);if(form.isConnected){syncAppearance('avatar');syncAppearance('banner');}}
  };
}

async function deleteOwnedEvent(id) {
  if(!confirm('Удалить событие вместе с записями и комментариями? Восстановить его через сайт будет нельзя.'))return;
  try {
    const response=await fetch(`/api/events/${id}`,{method:'DELETE'});
    const data=await response.json();if(!response.ok)throw new Error(data.error||'Не удалось удалить событие');
    await loadData();
    if(location.hash==='#account')await render();else location.hash='account';
  }catch(error){alert(error.message);}
}
