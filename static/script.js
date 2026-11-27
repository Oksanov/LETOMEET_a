let currentUser = null;
const content = document.querySelector('#content');
const navigation = document.querySelector('#navigation');
const dialog = document.querySelector('#contacts');

const filters = {
  activity: [],
  type: [],
  duration: [],
  place: [],
  from: '',
  to: ''
};

let draft = null;
let events = [];
let filterGroups = [];
let eventsView = "map";
let selectedMapFloor;
let selectedMapPeriod = 'all';
let schoolRoomsRequest;
let mapResizeObserver;


async function loadData() {
  const [eventsResponse, filtersResponse] = await Promise.all([
    fetch('/api/events'),
    fetch('/api/filter-groups')
  ]);

  if (!eventsResponse.ok || !filtersResponse.ok) {
    throw new Error('Не удалось загрузить данные LETOMEET.');
  }

  events = await eventsResponse.json();
  filterGroups = await filtersResponse.json();
}


function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[char]));
}


function dateLabel(date) {
  return new Date(date + 'T12:00:00').toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'long'
  });
}


function tags(event) {
  return [event.activity, event.type, event.duration, event.place]
    .map(tag => `<span class="tag">${escapeHtml(tag)}</span>`)
    .join('');
}


function locationMatches(value, selected) {
  return value === selected || String(value || '').startsWith(selected + ' · ');
}

function filterFields() {
  const checkbox = (group, value, label = value) => `<label class="chip"><input type="checkbox" name="${escapeHtml(group.key)}" value="${escapeHtml(value)}" ${(filters[group.key] || []).includes(value) ? 'checked' : ''}>${escapeHtml(label)}</label>`;
  const branch = (group, node) => {
    if (!node.children?.length) return checkbox(group, node.value, node.label);
    const body = node.children.map(child => branch(group, child)).join('');
    // Boarding houses and outdoor locations use the same expandable controls.
    if (node.value === 'Улица' || node.value === 'Дом пансиона' || node.value.startsWith('Дом пансиона · ')) {
      return `<details class="filter-branch" ${locationNodeValues(node.children).some(value => (filters[group.key] || []).includes(value)) ? 'open' : ''}><summary>${escapeHtml(node.label)}</summary><div class="filter-branch-body">${body}</div></details>`;
    }
    return `<div class="filter-location-section"><h3>${escapeHtml(node.label)}</h3><div class="chips">${body}</div></div>`;
  };
  return filterGroups.map(group => {
    const nested = new Set(locationNodeValues(group.children || []));
    const options = group.options.filter(option => !nested.has(option));
    return `<fieldset class="filter-group"><legend>${escapeHtml(group.label)}</legend><div class="chips">${options.map(option => checkbox(group, option)).join('')}</div>${(group.children || []).map(node => branch(group, node)).join('')}</fieldset>`;
  }).join('') + `<fieldset class="filter-group"><legend>Когда</legend><div class="form-grid"><label class="field">С даты<input type="date" name="from" value="${filters.from}"></label><label class="field">По дату<input type="date" name="to" value="${filters.to}"></label></div><p id="date-error" class="error small" hidden>Дата окончания должна быть не раньше начала.</p></fieldset>`;
}

function locationNodeValues(nodes) {
  return nodes.flatMap(node => [node.value, ...locationNodeValues(node.children || [])]);
}

function placeSelectField(group) {
  const nested = new Set(locationNodeValues(group.children || []));
  const option = (value, label = value) => `<option value="${escapeHtml(value)}">${escapeHtml(label)}</option>`;
  const branches = (group.children || []).map(node => {
    const children = node.children || [];
    if (children.some(child => child.children?.length)) {
      return `<optgroup label="${escapeHtml(node.label)}">${option(node.value, 'Любой дом')}</optgroup>` + children.map(child => `<optgroup label="${escapeHtml(node.label + ' · ' + child.label)}">${option(child.value, child.label + ' — другое место')}${(child.children || []).map(leaf => option(leaf.value, leaf.label)).join('')}</optgroup>`).join('');
    }
    return `<optgroup label="${escapeHtml(node.label)}">${option(node.value, 'Другое место на улице')}${children.map(child => option(child.value, child.label)).join('')}</optgroup>`;
  }).join('');
  return `<label class="field">Место<select name="place" required><optgroup label="В школе">${group.options.filter(value => !nested.has(value)).map(value => option(value)).join('')}</optgroup>${branches}</select></label>`;
}


function readFilters(form) {
  const data = new FormData(form);

  filterGroups.forEach(group => {
    filters[group.key] = data.getAll(group.key);
  });

  filters.from = data.get('from') || '';
  filters.to = data.get('to') || '';

  const valid = !filters.from || !filters.to || filters.from <= filters.to;
  const dateError = document.querySelector('#date-error');

  if (dateError) dateError.hidden = valid;

  return valid;
}

async function loadUser() {
  try {
    const response = await fetch('/api/auth/me');

    if (!response.ok) {
      currentUser = null;
      return;
    }

    const data = await response.json();
    currentUser = data.user;
  } catch {
    currentUser = null;
  }

  updateAuthPanel();
}

function updateAuthPanel() {
  const panel = document.querySelector('#auth-panel');

  if (!panel) return;
  const mobileAccount = document.querySelector('#mobile-account');
  if (mobileAccount) {
    mobileAccount.href = currentUser ? '#account' : '#login';
    mobileAccount.setAttribute('aria-label', currentUser ? 'Личный кабинет' : 'Войти в аккаунт');
    mobileAccount.innerHTML = currentUser
      ? avatarMarkup(currentUser, 'auth-avatar')
      : '<svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><circle cx="12" cy="6" r="3.5"/><path d="M4 22v-2a8 8 0 0 1 16 0v2"/></svg>';
  }

  if (!currentUser) {
    panel.innerHTML = `
      <div class="auth-links">
        <a href="#login">Войти</a>
        <a href="#register">Регистрация</a>
      </div>
    `;

    return;
  }

  panel.innerHTML = `
    <div class="auth-user">
      <a class="auth-account" href="#account" aria-label="${escapeHtml(currentUser.username)} — личный кабинет">
        ${currentUser.avatar_url
          ? `<img class="auth-avatar" src="${escapeHtml(currentUser.avatar_url)}" alt="">`
          : `<span class="auth-avatar auth-avatar-placeholder" style="--profile-selected-color:${profileColor(currentUser.avatar_color, '#e3cd86')};background-color:${profileColor(currentUser.avatar_color, '#e3cd86')}" aria-hidden="true">${escapeHtml(Array.from(currentUser.username || '?')[0].toUpperCase())}</span>`}
        <span class="auth-account-name">${escapeHtml(currentUser.username)}</span>
      </a>

        ${
          currentUser.role === 'admin'
            ? `<a href="#admin">Админ</a>`
            : ''
        }

        <button id="logout-button" class="plain">
          Выйти
        </button>
    </div>
  `;

  document.querySelector('#logout-button').onclick =
    async () => {
      await fetch('/api/auth/logout', {
        method: 'POST'
      });

      currentUser = null;

      location.hash = 'home';
      render();
      updateAuthPanel();
    };
}

function registerPage(step = 1, email = '') {
  if (step === 1) {
    content.innerHTML = `
      <section class="auth-page">
        <a class="back" href="#home">← На главную</a>

        <h1>Регистрация</h1>

        <form id="register-form">

          <label class="field">
            Имя
            <input
              name="username"
              maxlength="80"
              required
              placeholder="Например, Егор"
            >
          </label>

          <label class="field">
            Почта
            <input
              name="email"
              type="email"
              required
              placeholder="name@student.letovo.ru"
            >
          </label>

          <p class="small muted">
            Используйте школьную почту
            @student.letovo.ru или @letovo.ru.
          </p>

          <p id="auth-error" class="error"></p>

          <button class="primary" type="submit">
            Получить код
          </button>

        </form>

        <p>
          Уже есть аккаунт?
          <a href="#login">Войти</a>
        </p>
      </section>
    `;

    document.querySelector('#register-form').onsubmit =
      async event => {

        event.preventDefault();

        const data = Object.fromEntries(
          new FormData(event.currentTarget)
        );

        const error = document.querySelector('#auth-error');

        try {
          const response = await fetch(
            '/api/auth/register/request',
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json'
              },
              body: JSON.stringify(data)
            }
          );

          const result = await response.json();

          if (!response.ok) {
            error.textContent =
              result.error || 'Не удалось отправить код.';
            return;
          }

          registerPage(2, data.email);

        } catch {
          error.textContent =
            'Сервер недоступен.';
        }
      };

    return;
  }

  content.innerHTML = `
    <section class="auth-page">
      <a class="back" href="#home">← На главную</a>

      <h1>Подтверждение</h1>

      <p>
        Мы отправили 6-значный код на
        <strong>${escapeHtml(email)}</strong>.
      </p>

      <form id="register-code-form">

        <label class="field">
          Код
          <input
            name="code"
            inputmode="numeric"
            autocomplete="one-time-code"
            maxlength="6"
            required
            placeholder="123456"
          >
        </label>

        <p id="auth-error" class="error"></p>

        <button class="primary" type="submit">
          Создать аккаунт
        </button>

      </form>
    </section>
  `;

  document.querySelector('#register-code-form').onsubmit =
    async event => {

      event.preventDefault();

      const data = Object.fromEntries(
        new FormData(event.currentTarget)
      );

      data.email = email;

      const error = document.querySelector('#auth-error');

      try {
        const response = await fetch(
          '/api/auth/register/verify',
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json'
            },
            body: JSON.stringify(data)
          }
        );

        const result = await response.json();

        if (!response.ok) {
          error.textContent =
            result.error || 'Неверный код.';
          return;
        }

        currentUser = result.user;

        updateAuthPanel();

        location.hash = 'home';

      } catch {
        error.textContent =
          'Сервер недоступен.';
      }
    };
}

function loginPage(step = 1, email = '') {
  if (step === 1) {
    content.innerHTML = `
      <section class="auth-page">
        <a class="back" href="#home">← На главную</a>

        <h1>Вход</h1>

        <form id="login-form">

          <label class="field">
            Почта
            <input
              name="email"
              type="email"
              required
              placeholder="name@student.letovo.ru"
            >
          </label>

          <p id="auth-error" class="error"></p>

          <button class="primary" type="submit">
            Получить код
          </button>

        </form>

        <p>
          Нет аккаунта?
          <a href="#register">Зарегистрироваться</a>
        </p>
      </section>
    `;

    document.querySelector('#login-form').onsubmit =
      async event => {

        event.preventDefault();

        const data = Object.fromEntries(
          new FormData(event.currentTarget)
        );

        const error = document.querySelector('#auth-error');

        try {
          const response = await fetch(
            '/api/auth/login/request',
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json'
              },
              body: JSON.stringify(data)
            }
          );

          const result = await response.json();

          if (!response.ok) {
            error.textContent =
              result.error || 'Не удалось отправить код.';
            return;
          }

          loginPage(2, data.email);

        } catch {
          error.textContent =
            'Сервер недоступен.';
        }
      };

    return;
  }

  content.innerHTML = `
    <section class="auth-page">
      <a class="back" href="#home">← На главную</a>

      <h1>Введите код</h1>

      <p>
        Код отправлен на
        <strong>${escapeHtml(email)}</strong>.
      </p>

      <form id="login-code-form">

        <label class="field">
          Код
          <input
            name="code"
            inputmode="numeric"
            autocomplete="one-time-code"
            maxlength="6"
            required
            placeholder="123456"
          >
        </label>

        <p id="auth-error" class="error"></p>

        <button class="primary" type="submit">
          Войти
        </button>

      </form>
    </section>
  `;

  document.querySelector('#login-code-form').onsubmit =
    async event => {

      event.preventDefault();

      const data = Object.fromEntries(
        new FormData(event.currentTarget)
      );

      data.email = email;

      const error = document.querySelector('#auth-error');

      try {
        const response = await fetch(
          '/api/auth/login/verify',
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json'
            },
            body: JSON.stringify(data)
          }
        );

        const result = await response.json();

        if (!response.ok) {
          error.textContent =
            result.error || 'Неверный код.';
          return;
        }

        currentUser = result.user;

        updateAuthPanel();

        location.hash = 'home';

      } catch {
        error.textContent =
          'Сервер недоступен.';
      }
    };
}

async function adminPage() {
  if (!currentUser || currentUser.role !== 'admin') {
    content.innerHTML = `
      <section class="empty">
        <h1>Доступ запрещён</h1>
        <p class="muted">
          Эта страница доступна только администраторам.
        </p>
        <a href="#home">На главную</a>
      </section>
    `;

    return;
  }

  content.innerHTML = `
    <section class="admin-page">

      <a class="back" href="#home">
        ← На главную
      </a>

      <h1>Админ-панель</h1>

      <div id="admin-stats" class="admin-stats">
        Загрузка...
      </div>

      <section class="form-section">
        <h2>Админы</h2>

        <div id="admin-users">
          Загрузка...
        </div>
      </section>
        <section class="form-section">
          <h2>Мероприятия</h2>

          <div class="admin-event-tools">
            <label class="field">
              Поиск
              <input id="admin-event-search" type="search"
                placeholder="Название, ID, организатор, место...">
            </label>
            <label class="field">
              Статус
              <select id="admin-event-status">
                <option value="all">Все статусы</option>
                <option value="pending">На модерации</option>
                <option value="approved">Опубликовано</option>
                <option value="rejected">Отклонено</option><option value="revision">В редакции пользователя</option><option value="past">Прошедшие</option>
              </select>
            </label>
            <label class="field">
              Сортировка
              <select id="admin-event-sort">
                <option value="date-asc">Сначала ближайшие</option>
                <option value="date-desc">Сначала поздние</option>
                <option value="title">По названию</option>
                <option value="id-desc">По ID: сначала новые</option>
              </select>
            </label>
          </div>
          <p id="admin-event-count" class="small muted" aria-live="polite"></p>
          <div id="admin-events">
            Загрузка...
          </div>
    </section>
  `;

  try {
    const [statsResponse, usersResponse] =
      await Promise.all([
        fetch('/api/admin/stats'),
        fetch('/api/admin/users')
      ]);

    if (!statsResponse.ok || !usersResponse.ok) {
      throw new Error();
    }

    const stats = await statsResponse.json();
    const users = await usersResponse.json();
    const response = await fetch('/api/admin/events');
    const data = await response.json();

    const eventsContainer = document.querySelector('#admin-events');
    const searchInput = document.querySelector('#admin-event-search');
    const statusSelect = document.querySelector('#admin-event-status');
    const sortSelect = document.querySelector('#admin-event-sort');
    const countLabel = document.querySelector('#admin-event-count');

    function renderAdminEvents() {
      const query = searchInput.value.trim().toLocaleLowerCase('ru');
      const status = statusSelect.value;
      const sort = sortSelect.value;

      const filtered = data.events.filter(event => {
        const searchable = [
          event.id, event.title, event.summary, event.organizer,
          event.place, event.room, event.activity, event.type,
          event.pending_changes?.title, event.pending_changes?.summary, event.pending_changes?.room
        ].join(' ').toLocaleLowerCase('ru');

        return (!query || searchable.includes(query)) &&
          (status === 'all' || event.status === status || (status === 'pending' && event.change_status === 'pending') || (status === 'revision' && event.change_status === 'revision'));
      });

      filtered.sort((a, b) => {
        if (sort === 'title') return a.title.localeCompare(b.title, 'ru');
        if (sort === 'id-desc') return b.id - a.id;
        const first = `${a.date} ${a.time}`;
        const second = `${b.date} ${b.time}`;
        return sort === 'date-desc'
          ? second.localeCompare(first)
          : first.localeCompare(second);
      });

      countLabel.textContent = `Показано: ${filtered.length} из ${data.events.length}`;

      const renderEvent = original => {
        const event = original.pending_changes && ['pending','revision'].includes(original.change_status) ? {...original,...original.pending_changes} : original;
        return `
          <article class="account-event">
            <div class="admin-event-main">
              <h3>${escapeHtml(event.title)}</h3>
              ${event.change_status === 'pending' ? '<p class="notice">Изменение опубликованного события. Показана предлагаемая версия.</p>' : ''}
              ${event.change_comment ? `<p class="error">Комментарий к изменению: ${escapeHtml(event.change_comment)}</p>` : ''}
              <p class="meta">
                ID: ${event.id} · ${dateLabel(event.date)} · ${event.time}–${event.end}
                · ${escapeHtml(event.place)} · ${escapeHtml(event.room)}
              </p>
              <p class="muted">${escapeHtml(event.summary)}</p>
              ${event.change_status === 'pending' ? `<details><summary>Описание и детали изменений</summary><p class="description">${escapeHtml(event.description)}</p><div class="chips">${tags(event)}</div><div>${contactLinks(event)}</div></details>` : ''}
              <p>Статус: <strong>${({
                pending: 'На модерации',
                approved: 'Опубликовано',
                rejected: 'Отклонено', revision: 'В редакции пользователя', past: 'Прошедшие'
              })[event.status] || escapeHtml(event.status)}</strong></p>
              ${event.moderation_comment
                ? `<p class="error">Комментарий: ${escapeHtml(event.moderation_comment)}</p>`
                : ''}
            </div>

            <div class="account-event-actions admin-event-actions">
              ${event.image_url ? `
                <a class="admin-event-image-link"
                  href="${escapeHtml(event.image_url)}"
                  target="_blank" rel="noopener noreferrer"
                  title="Открыть изображение в полном размере">
                  <img class="admin-event-image"
                    src="${escapeHtml(event.image_url)}" alt="Обложка мероприятия">
                </a>` : ''}

              <a class="secondary" href="#event/${event.id}">${event.change_status === 'pending' ? 'Открыть текущую версию' : 'Открыть'}</a>

              ${event.status === 'approved' ? `
                <a class="secondary" href="/api/events/${event.id}/qr?download=1">
                  Скачать QR
                </a>` : ''}

              ${event.status === 'pending' || event.change_status === 'pending' ? `
                <button class="primary" onclick="moderateEvent(${event.id}, 'approve', '${event.change_id || ''}')">
                  ${event.change_status === 'pending' ? 'Одобрить изменение' : 'Одобрить'}
                </button>` : ''}

              ${event.change_status === 'pending' ? `<button class="secondary" onclick="moderateEvent(${event.id}, 'reject-change', '${event.change_id || ''}')">Отклонить изменение</button>` : event.status === 'pending' ? `<button class="secondary" onclick="moderateEvent(${event.id}, 'reject')">Отклонить</button>` : ''}

              ${event.status === 'approved' ? `
                <button class="secondary"
                  onclick="moderateEvent(${event.id}, 'unpublish')">
                  Снять с публикации
                </button>` : ''}
            </div>
          </article>
        `;
      };
      const modules = [
        ['К модерации', ['pending']],
        ['Отмодерировано', ['approved', 'rejected']],
        ['В редакции пользователя', ['revision']],
        ['Прошедшие', ['past']]
      ];
      eventsContainer.innerHTML = modules.map(([label, statuses], index) => {
        const items = filtered.filter(event => index === 0 ? event.status === 'pending' || (event.status === 'approved' && event.change_status === 'pending')
          : index === 1 ? statuses.includes(event.status) && !['pending','revision'].includes(event.change_status)
          : index === 2 ? event.status === 'revision' || (event.status === 'approved' && event.change_status === 'revision') : event.status === 'past');
        return `<details class="admin-event-module" ${index === 0 ? 'open' : ''}><summary>${label} <span class="tag">${items.length}</span></summary>${items.map(renderEvent).join('') || '<p class="muted">Нет событий.</p>'}</details>`;
      }).join('');
    }

    searchInput.addEventListener('input', renderAdminEvents);
    statusSelect.addEventListener('change', renderAdminEvents);
    sortSelect.addEventListener('change', renderAdminEvents);
    renderAdminEvents();

    document.querySelector('#admin-stats').innerHTML = `
      <div class="admin-stat">
        <strong>${stats.users}</strong>
        <span>пользователей</span>
      </div>

      <div class="admin-stat">
        <strong>${stats.admins}</strong>
        <span>администраторов</span>
      </div>
    `;

    document.querySelector('#admin-users').innerHTML =
      users.users.length
        ? users.users.map(user => `
            <div class="admin-user">
              <div>
                <strong>
                  ${escapeHtml(user.username)}
                </strong>

                <span class="small muted">
                  ${escapeHtml(user.email)}
                </span>
              </div>

              <span class="tag">
                ${user.role === 'admin'
                  ? 'admin'
                  : 'user'}
              </span>
            </div>
          `).join('')
        : '<p class="muted">Пользователей пока нет.</p>';

  } catch {
    document.querySelector('#admin-users').innerHTML =
      '<p class="error">Не удалось загрузить данные.</p>';
  }
}

async function moderationDecision() {
  const dialog = document.createElement('dialog');
  dialog.className = 'moderation-dialog';
  dialog.setAttribute('aria-labelledby', 'moderation-heading');
  dialog.innerHTML = `<h2 id="moderation-heading">Куда отправить?</h2><div class="moderation-destinations"><button type="button" data-destination="rejected">Полностью отклонить</button><button type="button" data-destination="revision">На редакцию юзеру</button><button type="button" data-cancel>Отмена</button></div><form hidden><label class="field">Комментарий пользователю<textarea name="comment" required maxlength="2000" rows="4"></textarea></label><p class="small muted">Комментарий будет виден автору события.</p><div class="actions"><button class="primary" type="submit">Отправить</button><button type="button" data-cancel>Отмена</button></div></form>`;
  document.body.append(dialog);
  return new Promise(resolve => {
    let destination, result = null;
    dialog.querySelectorAll('[data-destination]').forEach(button => button.onclick = () => {
      destination = button.dataset.destination;
      dialog.querySelector('.moderation-destinations').hidden = true;
      dialog.querySelector('form').hidden = false;
      dialog.querySelector('h2').textContent = destination === 'revision' ? 'Комментарий для доработки' : 'Причина полного отклонения';
      dialog.querySelector('textarea').focus();
    });
    dialog.querySelectorAll('[data-cancel]').forEach(button => button.onclick = () => dialog.close());
    dialog.querySelector('form').onsubmit = event => {
      event.preventDefault();
      const comment = dialog.querySelector('textarea').value.trim();
      if (!comment) return;
      result = {destination, comment}; dialog.close();
    };
    dialog.addEventListener('close', () => { dialog.remove(); resolve(result); }, {once:true});
    dialog.showModal();
  });
}

async function moderateEvent(eventId, action, changeId = null) {
  const decision = action === 'approve' ? {} : await moderationDecision();
  if (!decision) return;
  try {
    const response = await fetch(`/api/admin/events/${eventId}/${action}`, {
      method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({...decision,change_id:changeId})
    });
    const data = await readResponse(response);
    if (!response.ok) throw new Error(data.error || 'Не удалось изменить статус');
    await loadData(); await adminPage();
  } catch (error) { alert(error.message); }
}

async function accountPage() {
  if (!currentUser) {
    content.innerHTML = `
      <section class="empty">
        <h1>Личный кабинет</h1>
        <p class="muted">
          Чтобы открыть личный кабинет, необходимо войти.
        </p>
        <a href="#login">Войти</a>
      </section>
    `;

    return;
  }

  content.innerHTML = `
    <section class="account-page">

      <a class="back" href="#home">
        ← На главную
      </a>

      <h1>Личный кабинет</h1>

      ${profileMarkup()}
      <section class="form-section">
        <h2>Созданные мероприятия</h2>

        <div id="my-events">
          Загрузка...
        </div>
      </section>

      <section class="form-section">
        <h2>Куда я записан(а)?</h2>

        <div id="my-registrations">
          Загрузка...
        </div>
      </section>

    </section>
  `;

  try {
    bindProfile();
    const [myEvents, registrations] = await Promise.all([
      getMyEvents(),
      getMyRegistrations()
    ]);

    const eventsContainer =
      document.querySelector('#my-events');

    const registrationsContainer =
      document.querySelector('#my-registrations');


    // ==========================================
    // МОИ МЕРОПРИЯТИЯ
    // ==========================================

    if (!myEvents.length) {
      eventsContainer.innerHTML = `
        <div class="empty">
          <h3>Пока нет мероприятий</h3>

          <p class="muted">
            Вы ещё не создали ни одного мероприятия.
          </p>

          <a href="#create">
            Создать мероприятие
          </a>
        </div>
      `;
    } else {
      eventsContainer.innerHTML = myEvents.map(event => `
        <article class="account-event">

          <div>
            <h3>
              ${escapeHtml(event.title)}
            </h3>

            <p class="meta">
              <span>
                ${dateLabel(event.date)}
                ·
                ${event.time}–${event.end}
              </span>

              <span>
                ${escapeHtml(event.place)}
                ·
                ${escapeHtml(event.room)}
              </span>
            </p>

            <p class="muted">
              ${escapeHtml(event.summary)}
            </p>

            <p class="muted">
              Участников: ${event.count}
            </p>

            ${event.change_status ? `<p class="notice">${event.change_status === 'pending' ? 'Изменения на модерации. Текущая версия опубликована.' : event.change_status === 'revision' ? 'Изменения возвращены на доработку. Текущая версия опубликована.' : 'Изменения отклонены. Текущая версия опубликована.'}${event.change_comment ? `<br>${escapeHtml(event.change_comment)}` : ''}</p>` : ''}
            <p class="meta">
              Статус: <strong>${({pending:'На модерации',approved:'Опубликовано',rejected:'Отклонено',revision:'В редакции пользователя',past:'Прошедшие'})[event.status] || escapeHtml(event.status)}</strong>
            </p>

            ${event.moderation_comment
              ? `<p class="error">Комментарий администратора: ${escapeHtml(event.moderation_comment)}</p>`
              : ''}
          </div>

          <div class="account-event-actions">
            <a
              class="primary"
              href="#event/${event.id}"
            >
              Открыть
            </a>
            ${!['rejected','past'].includes(event.status) ? `<a class="secondary" href="#edit/${event.id}">Редактировать</a>` : ''}
            <button class="secondary" type="button" onclick="deleteOwnedEvent(${event.id})">Удалить</button>
          </div>

        </article>
      `).join('');
    }


    // ==========================================
    // МОИ ЗАПИСИ
    // ==========================================

    if (!registrations.length) {
      registrationsContainer.innerHTML = `
        <div class="empty">
          <h3>Пока нет записей</h3>

          <p class="muted">
            Вы ещё не записались ни на одно мероприятие.
          </p>

          <a href="#catalog">
            Посмотреть каталог
          </a>
        </div>
      `;
    } else {
      registrationsContainer.innerHTML = registrations.map(event => `
        <article class="account-event">

          <div>
            <h3>
              ${escapeHtml(event.title)}
            </h3>

            <p class="meta">
              <span>
                ${dateLabel(event.date)}
                ·
                ${event.time}–${event.end}
              </span>

              <span>
                ${escapeHtml(event.place)}
                ·
                ${escapeHtml(event.room)}
              </span>
            </p>

            <p class="muted">
              ${escapeHtml(event.summary)}
            </p>
          </div>

          <div class="account-event-actions">
            <a
              class="primary"
              href="#event/${event.id}"
            >
              Открыть
            </a>

            <button
              class="secondary"
              data-leave-event="${event.id}"
            >
              Отменить запись
            </button>
          </div>

        </article>
      `).join('');

      document
        .querySelectorAll('[data-leave-event]')
        .forEach(button => {

          button.onclick = async () => {
            const eventId =
              Number(button.dataset.leaveEvent);

            const success =
              await leaveEvent(eventId);

            if (!success) {
              return;
            }

            await accountPage();
          };
        });
    }

  } catch (error) {
    console.error(error);

    document.querySelector('#my-events').innerHTML = `
      <p class="error">
        Не удалось загрузить ваши мероприятия.
      </p>
    `;

    document.querySelector('#my-registrations').innerHTML = `
      <p class="error">
        Не удалось загрузить ваши записи.
      </p>
    `;
  }
}

function clearFilters() {
  filterGroups.forEach(group => {
    filters[group.key] = [];
  });

  filters.from = '';
  filters.to = '';
  render();
}


function aboutPage() {
  content.innerHTML = `
    <article class="about-page" aria-labelledby="about-title">
      <a class="back" href="#home">← К началу</a>
      <h1 id="about-title">О проекте</h1>
      <p>Всем привет! 🐱</p>
      <p>LETOMEET — это сайт, на котором можно найти интересное тебе событие, присоединиться к чьей-то встрече или собрать свою компанию. Будь то настолки, волейбол, совместный просмотр фильмов, рисование или просто поговорить — здесь можно предложить всё, чем хочется заняться, и позвать остальных!</p>
      <p>Идея проста: чтобы можно понять что, где проводиться и кто и когда это организовывает и можно ли к ним присоединиться :D</p>
      <section aria-labelledby="about-features">
        <h2 id="about-features">Что здесь можно делать</h2>
        <ul>
          <li>Посмотреть все события на карте школы или в каталоге; отфильтровав события по месту, типу и времени, выбрать то, что интересно</li>
          <li>Записаться на событие, нажав «Я пойду» на странице события и связаться с организатором по необходимости</li>
          <li>Добавить своё событие: после проверки оно появится на сайте.</li>
        </ul></section>
      <section aria-labelledby="about-create">
        <h2 id="about-create">Кстати, создать событие может любой зараестрированный</h2>
        <p>Вход по школьной почте. В своём аккаунте можно уже добавить событие — название, описание, время и место. Очень желательно, чтобы из описания было понятно, что конкретно вы собираетесь делать и кому, куда можно прийти 🫡</p>
        <p>Если администратор попросит что-то исправить в событии для публикации, событие отправиться обратно в личный кабинет вместе с комментарием: нужно будет изменить и отправить снова на проверку. После публикации, свои мероприятия также можно редактировать в личном кабинете!</p></section>
      <p class="about-invitation">Приходите, зовите друзей, предлагайте своё!!</p>
      <div class="actions about-actions">
        <a class="primary" href="#catalog">Каталог событий</a>
        <a class="secondary" href="#create">Добавить своё событие</a>
      </div>
    </article>`;
}

function homePage() {
  content.innerHTML = `<section class="home home-start" aria-label="LETOMEET"><div class="home-choices"><a class="home-choice" href="#map"><span>Карта событий</span><span class="arrow" aria-hidden="true">↗</span></a><a class="home-choice" href="#create"><span>Добавить своё событие</span><span class="arrow" aria-hidden="true">+</span></a></div></section>`;
}

function welcomePage() {
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
  const featured = trendingEvents(events,today);
  content.innerHTML = `<section class="home" aria-label="Главная">
    <div class="home-intro"><div><h1>Найдите друг друга</h1></div><a class="secondary" href="#map">На карту ↗</a></div>
    <section class="trending" aria-label="Популярные события" aria-roledescription="карусель">
      <div class="trending-heading"><div><h2>В центре внимания</h2><p class="small muted">Предстоящие события - по числу записавшихся</p></div>
      ${featured.length>1 ? '<div class="slider-controls"><button id="slide-prev" aria-label="Предыдущее событие">←</button><output id="slide-position" aria-live="polite">1 / '+featured.length+'</output><button id="slide-next" aria-label="Следующее событие">→</button></div>' : ''}</div>
      ${featured.length ? `<div class="trending-track" tabindex="0" aria-label="Листайте события свайпом или стрелками">${featured.map((e,i)=>`<article class="trend-slide" aria-label="${i+1} из ${featured.length}">
        <div class="trend-copy"><span class="trend-badge">${Number(e.count)>0 ? `${Number(e.count)} участников` : 'Будь первым участником'}</span><h3>${escapeHtml(e.title)}</h3><p>${escapeHtml(e.summary)}</p><p class="small">${e.regular?'Каждую неделю · ':''}${dateLabel(e.date)} · ${escapeHtml(e.time)}<br>${escapeHtml(e.place)} · ${escapeHtml(e.room)}</p><a class="primary" href="#event/${e.id}">Подробнее о событии ↗</a></div>
        <div class="trend-art">${e.image_url?`<img src="${escapeHtml(e.image_url)}" alt="" ${i?'loading="lazy"':''} decoding="async">`:`<span aria-hidden="true">${escapeHtml(e.card_emoji||'✦')}</span><span class="trend-art-label">LETOMEET / ${String(i+1).padStart(2,'0')}</span>`}</div></article>`).join('')}</div>` : '<div class="trend-empty"><p>Пока нет предстоящих опубликованных событий.</p><a class="primary" href="#create">Добавить событие :D</a></div>'}
    </section>
    <div class="home-choices"><a class="home-choice" href="#catalog"><span>Каталог событий</span><span class="arrow" aria-hidden="true">↗</span></a><a class="home-choice" href="#create"><span>Добавить своё событие</span><span class="arrow" aria-hidden="true">+</span></a></div>
  </section>`;
  const track=content.querySelector('.trending-track');
  if (!track || featured.length<2) return;
  let index=0;
  const prev=content.querySelector('#slide-prev'), next=content.querySelector('#slide-next'), position=content.querySelector('#slide-position');
  const update=()=>{index=Math.round(track.scrollLeft/(track.clientWidth+16)); prev.disabled=index===0;next.disabled=index===featured.length-1;position.textContent=`${index+1} / ${featured.length}`;};
  const move=delta=>track.scrollTo({left:Math.max(0,Math.min(featured.length-1,index+delta))*(track.clientWidth+16),behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});
  prev.onclick=()=>move(-1);next.onclick=()=>move(1);
  track.onkeydown=e=>{if(e.target!==track)return;if(e.key==='ArrowRight'||e.key==='ArrowLeft'){e.preventDefault();move(e.key==='ArrowRight'?1:-1);}};
  track.onscroll=update;update();
}

function filtersPage() {
  content.innerHTML = `
    <section class="filter-page">
      <a class="back" href="#home">← На главную</a>
      <h1>Куда вы хотите?</h1>
      <form id="filter-form">
        ${filterFields()}
        <div class="actions">
          <button class="primary" type="submit">Показать события</button>
          <button id="reset" type="button" class="plain">Сбросить фильтры</button>
        </div>
      </form>
    </section>`;

  document.querySelector('#filter-form').onsubmit = event => {
    event.preventDefault();
    if (readFilters(event.currentTarget)) {
      location.hash = 'catalog';
    }
  };

  document.querySelector('#reset').onclick = clearFilters;
}


function filteredEvents() {
  return events
    .filter(event =>
      filterGroups.every(group =>
        !filters[group.key].length ||
        (group.key === 'place' ? filters.place.some(value => locationMatches(event.place, value)) :
          filters[group.key].includes(event[group.key]))
      ) &&
      (!filters.from || event.date >= filters.from) &&
      (!filters.to || event.date <= filters.to)
    )
    .sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
}


function updateList() {
  const list = filteredEvents();
  const results = document.querySelector('#results');

  results.innerHTML = `
    <div class="list-heading">
      <p>Найдено: ${list.length}</p>
      <span class="small muted">По дате ↑</span>
    </div>
    ${
      list.length
        ? list.map(event => {
            const allowedColors = [
              'cream', 'blue', 'green',
              'lavender', 'peach', 'pink', 'dark'
            ];

            const color = allowedColors.includes(event.card_color)
              ? event.card_color
              : 'cream';

            let emoji = event.card_emoji;

            if (!emoji) {
              const category = [
                event.activity,
                event.type
              ].join(' ').toLowerCase();

              if (category.includes('спорт')) emoji = '🏀';
              else if (category.includes('кино') || category.includes('фильм') || category.includes('просмотр')) emoji = '🎬';
              else if (category.includes('игр')) emoji = '🎮';
              else if (category.includes('музык')) emoji = '🎵';
              else if (category.includes('it') || category.includes('программ')) emoji = '💻';
              else if (category.includes('искусств')) emoji = '🎨';
              else if (category.includes('литератур')) emoji = '📚';
              else if (category.includes('наук') || category.includes('учеб') || category.includes('олимп')) emoji = '🧠';
              else emoji = '✨';
            }

            return `
              <a
                href="#event/${event.id}"
                class="event-row event-card event-card-${color}"
              >
                <div class="event-row-content">
                  ${
                    event.image_url
                      ? `<img
                          class="event-row-image"
                          src="${escapeHtml(event.image_url)}"
                          alt=""
                        >`
                      : ''
                  }

                  <div class="event-row-info">
                    <div class="event-card-title">
                      <span class="event-card-emoji">${escapeHtml(emoji)}</span>
                      <h2>${escapeHtml(event.title)}</h2>
                    </div>

                    ${
                      event.tagline
                        ? `<p class="event-card-tagline">${escapeHtml(event.tagline)}</p>`
                        : ''
                    }

                    <p>${escapeHtml(event.summary)}</p>

                    <div class="meta">
                      <span>${dateLabel(event.date)} · ${event.time}–${event.end}</span>
                      <span>${escapeHtml(event.room)}</span>
                      ${event.regular ? '<span>Еженедельно</span>' : ''}
                    </div>

                    <div class="chips">${tags(event)}</div>


                    <div class="meta">
                      <span>Организатор: ${escapeHtml(event.organizer)}</span>
                      <span>Участников: ${event.count}</span>
                    </div>
                  </div>
                </div>
              </a>
            `;
          }).join('')
        : `
          <div class="empty">
            <h2>Пока ничего не нашлось</h2>
            <p class="muted">Попробуйте выбрать меньше фильтров или другой диапазон дат.</p>
            <button id="empty-reset">Сбросить фильтры</button>
          </div>
        `
    }`;

  const reset = document.querySelector('#empty-reset');
  if (reset) reset.onclick = clearFilters;
}



function catalogPage() {
  content.innerHTML = `
    <div class="heading">
      <h1>Список событий</h1>
      <span class="small muted">События LETOMEET</span>
    </div>

    <div class="catalog-layout">
      <button class="mobile-filter-toggle secondary" id="mobile-filter-toggle" type="button" aria-expanded="false" aria-controls="catalog-filter-panel">☷ Фильтры</button>
      <aside class="sidebar" id="catalog-filter-panel"><div class="catalog-filters"><h2>Фильтры событий</h2><button type="button" class="plain mobile-filter-close" id="mobile-filter-close">Закрыть ×</button>
        <form id="filter-form">
          ${filterFields()}
          <button class="plain" type="button" id="reset">Сбросить фильтры</button>
        </form>
      </div></aside>

      <section id="results" aria-label="События" aria-live="polite"></section>
    </div>`;

  const filterToggle=document.querySelector('#mobile-filter-toggle');
  const filterPanel=document.querySelector('#catalog-filter-panel');
  const closeFilters=()=>{filterPanel.classList.remove('is-open');filterToggle.setAttribute('aria-expanded','false');};
  filterToggle.onclick=()=>{const open=filterPanel.classList.toggle('is-open');filterToggle.setAttribute('aria-expanded',String(open));};
  document.querySelector('#mobile-filter-close').onclick=closeFilters;
  filterPanel.onkeydown=event=>{if(event.key==='Escape'){closeFilters();filterToggle.focus();}};

  document.querySelector('#filter-form').onchange = event => {
    if (readFilters(event.currentTarget)) updateList();
  };

  document.querySelector('#filter-form').onsubmit = event => {
    event.preventDefault();
  };

  document.querySelector('#reset').onclick = clearFilters;
  updateList();
}


function safeContact(value) {
  try { const url = new URL(value); return ['https:','http:'].includes(url.protocol) ? value : ''; }
  catch { return ''; }
}
async function copySchoolContact(button) {
  try {await navigator.clipboard.writeText(button.dataset.email);button.textContent='Почта скопирована';}
  catch {prompt('Скопируйте почту для поиска в Летово Чат:',button.dataset.email);}
}

function contactLinks(event) {
  const raw=String(event.contact || '').trim();
  const email=/^[a-z0-9.!#$%&'*+\/=?^_`{|}~-]+@(student\.letovo\.ru|letovo\.ru)$/i.test(raw);
  const contact=email ? '' : safeContact(raw.startsWith('@')?'https://t.me/'+raw.slice(1):raw);
  const chat=safeContact(event.chat);
  return `${chat ? `<a class="contact" href="${escapeHtml(chat)}" target="_blank" rel="noopener noreferrer">Чат события ↗</a>` : ''}
    ${email ? `<p class="contact">Летово Чат: <strong>${escapeHtml(raw)}</strong></p><button type="button" class="secondary" data-email="${escapeHtml(raw)}" onclick="copySchoolContact(this)">Скопировать почту</button>`
      : contact ? `<a class="contact" href="${escapeHtml(contact)}" target="_blank" rel="noopener noreferrer">Написать организатору ↗</a>` : '<p class="contact muted">Контакт организатора пока не добавлен</p>'}`;
}

async function joinEvent(eventId) {
  try {
  const response = await fetch(`/api/events/${eventId}/join`, {
    method: 'POST'
  });

  const data = await response.json();

  if (!response.ok) {
    alert(data.error || 'Не удалось записаться');
    return false;
  }

  return true;
  } catch { alert('Не удалось связаться с сервером. Попробуйте ещё раз.'); return false; }
}

async function leaveEvent(eventId) {
  try {
  const response = await fetch(`/api/events/${eventId}/join`, {
    method: 'DELETE'
  });

  const data = await response.json();

  if (!response.ok) {
    alert(data.error || 'Не удалось отменить запись');
    return false;
  }

  return true;
  } catch { alert('Не удалось связаться с сервером. Попробуйте ещё раз.'); return false; }
}

async function getMyRegistrations() {
  const response = await fetch('/api/me/registrations');

  if (!response.ok) {
    throw new Error('Не удалось загрузить записи');
  }

  const data = await response.json();

  return data.events || [];
}
async function getMyEvents() {
  const response = await fetch('/api/me/events');

  if (!response.ok) {
    throw new Error('Не удалось загрузить мои мероприятия');
  }

  const data = await response.json();

  return data.events || [];
}

async function eventPage(event, preview = false) {
  if (!event) {
    content.innerHTML = '<h1>Событие не найдено</h1><a href="#catalog">Вернуться в каталог</a>';
    return;
  }

  const published = event.status === "approved";
  content.innerHTML = `
    <a class="back" href="${preview ? '#create' : '#' + eventsView}">
      ← ${preview ? 'Вернуться к форме' : (eventsView === 'map' ? 'К карте событий' : 'К списку событий')}
    </a>

    ${preview ? '<p class="notice">Предпросмотр заявки. Она ещё не отправлена и не опубликована.</p>' : ''}
    ${!preview && !published ? `<section class="notice" role="status">
      <h2>${({rejected:'Заявка отклонена',revision:'Событие возвращено на доработку',past:'Событие завершено'})[event.status] || 'Событие сохранено — ожидает одобрения'}</h2>
      <p>${event.status === 'past' ? 'Событие завершилось и перенесено в архив.' : event.status === 'rejected' ? 'Заявка полностью отклонена. При необходимости создайте новое событие.' : 'Пока событие не опубликовано, оно не отображается в каталоге и на карте. После исправления отправьте его на модерацию.'}</p>
      ${event.moderation_comment ? `<p>Комментарий администратора: ${escapeHtml(event.moderation_comment)}</p>` : ''}
      <a href="#account">Мои события</a>
      ${event.status === 'revision' && currentUser && event.creator_id === currentUser.id
        ? ` · <a href="#edit/${event.id}">Исправить мероприятие</a>`
        : ''}
      ${currentUser?.role === 'admin' ? ' · <a href="#admin">Открыть модерацию</a>' : ''}
      <button type="button" class="secondary" id="refresh-event-status">Обновить статус</button>
    </section>` : ''}


    ${!preview && currentUser?.id === event.creator_id ? `<p class="notice owner-event-notice">${['pending','approved','revision'].includes(event.status) ? 'Это ваше мероприятие, в <a href="#account">личном кабинете</a> его можно редактировать. Участвуете вы в нём автоматически.' : 'Это ваше мероприятие.'}</p>` : ''}
    ${!preview && event.change_status ? `<section class="notice" role="status"><strong>${event.change_status === 'pending' ? 'Изменения ожидают одобрения. Ниже показана опубликованная версия.' : 'Изменения рассмотрены. Опубликованная версия остаётся на сайте.'}</strong>${event.change_comment ? `<p>Комментарий администратора: ${escapeHtml(event.change_comment)}</p>` : ''}</section>` : ''}
    <article class="detail">
      <div class="detail-grid">
        <div class="event-detail-main">
      <div class="event-title-row"><h1>${escapeHtml(event.title)}</h1></div>
      ${!preview && !['rejected','past'].includes(event.status) && currentUser?.id === event.creator_id ? `<div class="owner-event-actions">${!['rejected','past'].includes(event.status) ? `<a class="secondary" href="#edit/${event.id}">Редактировать</a>` : ''}<button class="secondary" type="button" onclick="deleteOwnedEvent(${event.id})">Удалить событие</button></div>` : ''}

      <div class="meta">
        <span>${dateLabel(event.date)} · ${event.time}–${event.end}</span>
        <span>${escapeHtml(event.place)} · ${escapeHtml(event.room)}</span>
        ${event.regular ? '<span>Каждую неделю</span>' : ''}
      </div>

          <p class="description">${escapeHtml(event.description)}</p>

          <section class="event-organizer" aria-label="Организатор и контакты">
          <h2>Контакты</h2>
          <p>Организатор: ${escapeHtml(event.organizer)}</p>
          ${contactLinks(event)}
          </section>

          ${
            (preview || !published)
              ? ''
              : `<div class="join-line">
                <button id="join" class="primary">
                    Я пойду
                </button>

                <button id="leave" class="secondary" style="display: none;">
                    Отменить запись
                </button>

                <span id="count" class="small">
                    Участников: ${event.count}
                </span>
            </div>`
          }
        </div>

        <aside class="detail-side">
          ${event.image_url ? `<img class="event-detail-avatar" src="${escapeHtml(event.image_url)}" alt="Фото события">` : ''}
          <h2>Теги</h2>
          <div class="chips">${tags(event)}</div>


        </aside>
      </div>
      <details class="event-location-compact"><summary>Место на карте</summary><section class="event-location-card" id="event-location-card"><p class="muted">Загружаем план…</p></section></details>
      ${!preview ? eventShareMarkup(event) : ''}
      ${!preview && published ? `
        <section class="event-qr-card" aria-labelledby="event-qr-title">
          <div>
            <h2 id="event-qr-title">QR-код события</h2>
            <p class="muted">Отсканируйте QR-код, чтобы открыть страницу этого события.</p>
            <a class="secondary" href="/api/events/${event.id}/qr?download=1" download>
              Скачать QR-код
            </a>
          </div>
          <img src="/api/events/${event.id}/qr" alt="QR-код мероприятия ${event.id}" width="180" height="180">
        </section>` : ''}
    </article>`;

    const detail = document.querySelector('.detail');
    if (!preview) bindEventSharing(event, detail);
    eventLocationCard(event, detail.querySelector('#event-location-card'));
    if (!preview && !published) {
      document.querySelector('#refresh-event-status').onclick = render;
    }
    if (!preview && published) {
      await commentsPanel(event.id);
      if (!detail.isConnected) return;
      const joinButton = document.querySelector('#join');
      const leaveButton = document.querySelector('#leave');

      if (!currentUser) {
        joinButton.textContent = 'Войти, чтобы записаться';

        joinButton.onclick = () => {
          location.hash = 'login';
        };

        return;
      }

      let registrations;
      try { registrations = await getMyRegistrations(); }
      catch { joinButton.disabled = true; joinButton.textContent = 'Обновите страницу, чтобы проверить запись'; return; }
      if (!detail.isConnected) return;

      let isJoined = registrations.some(
        registeredEvent => registeredEvent.id === event.id
      );

  if (isJoined) {
    joinButton.textContent = 'Вы идёте · открыть контакты';
    leaveButton.style.display = currentUser?.id === event.creator_id ? 'none' : 'inline-block';
  }

  // Кнопка "Я пойду"
  joinButton.onclick = async () => {
    // Если уже записан — открываем контакты
    if (isJoined) {
      document.querySelector('#dialog-links').innerHTML =
        contactLinks(event);

      dialog.showModal();
      return;
    }

    const success = await joinEvent(event.id);

    if (!success) {
      return;
    }

    isJoined = true;

    joinButton.textContent = 'Вы идёте · открыть контакты';
    leaveButton.style.display = currentUser?.id === event.creator_id ? 'none' : 'inline-block';

    event.count += 1;

    document.querySelector('#count').textContent =
      'Участников: ' + event.count;

    document.querySelector('#dialog-links').innerHTML =
      contactLinks(event);

    dialog.showModal();
  };

  // Кнопка "Отменить запись"
  leaveButton.onclick = async () => {
    const success = await leaveEvent(event.id);

    if (!success) {
      return;
    }

    isJoined = false;

    joinButton.textContent = 'Я пойду';
    leaveButton.style.display = 'none';

    event.count -= 1;

    document.querySelector('#count').textContent =
      'Участников: ' + event.count;
  };
}
}


function selectField(key, label, options) {
  return `
    <label class="field">
      ${escapeHtml(label)}
      <select name="${key}" required>
        <option value="">Выберите</option>
        ${options.map(option => `<option value="${escapeHtml(option)}">${escapeHtml(option)}</option>`).join('')}
      </select>
    </label>`;
}



function createPage(editEvent = null) {
  if (editEvent?.pending_changes) editEvent = {...editEvent, ...editEvent.pending_changes};
  if (editEvent && ['rejected','past'].includes(editEvent.status)) {
    content.innerHTML = '<p class="notice">Это событие нельзя редактировать. Создайте новое событие.</p><a href="#create">Добавить событие</a>';
    return;
  }
  if (!currentUser) {
    content.innerHTML = `
      <section class="empty">
        <h1>Добавить событие</h1>

        <p class="muted">
          Чтобы создать мероприятие, необходимо войти в аккаунт.
        </p>

        <a href="#login">Войти</a>
      </section>
    `;

    return;
  }

  const groupsWithoutPlace = filterGroups.filter(
    group => group.key !== 'place'
  );

  const placeGroup = filterGroups.find(
    group => group.key === 'place'
  );

  content.innerHTML = `
    <section class="event-form">
      <a class="back" href="#home">← На главную</a>
      <h1>${editEvent ? "Редактировать мероприятие" : "Добавить своё событие"}</h1>
      ${editEvent ? `<section class="notice"><strong>Изменения должны пройти модерацию.</strong><p>${editEvent.status === 'approved' ? 'До одобрения изменений на сайте останется текущая опубликованная версия.' : 'Событие появится в каталоге и на карте после одобрения.'} Записи участников и комментарии сохранятся.</p><p>${escapeHtml(editEvent.moderation_comment || '')}</p><a href="#event/${editEvent.id}">Вернуться к событию</a></section>` : ''}

      <form id="event-form">
        <div class="form-grid">

          <label class="field full">
            Название мероприятия
            <input
              name="title"
              required
              maxlength="120"
              placeholder="Например, Вечер настольных игр"
            >
          </label>

          <div class="field full">
              Оформление карточки

              <div class="card-design-options">
                <fieldset class="color-picker">
                  <legend>Цвет карточки</legend>
                  <div class="color-swatches">
                    ${[['cream','Кремовый'],['blue','Голубой'],['green','Зелёный'],['lavender','Лавандовый'],['peach','Персиковый'],['pink','Розовый'],['dark','Тёмный']].map(([value,label]) => `
                      <label class="color-option">
                        <input type="radio" name="card_color" value="${value}" ${value==='cream'?'checked':''}>
                        <span class="color-swatch event-card-${value}" aria-hidden="true"></span>
                        <span>${label}</span>
                      </label>`).join('')}
                  </div>
                  <div id="card-color-preview" class="card-color-preview event-card-cream">
                    <strong>Так будет выглядеть карточка</strong>
                    <p class="small">Выбранный цвет: <span id="card-color-name">Кремовый</span></p>
                  </div>
                </fieldset>

                <label class="field">
                  Эмодзи
                  <select name="card_emoji">
                    <option value="">Автоматически</option>
                    <option value="🎓">🎓 Образование</option>
                    <option value="🎬">🎬 Кино</option>
                    <option value="🎮">🎮 Игры</option>
                    <option value="🏀">🏀 Спорт</option>
                    <option value="🎵">🎵 Музыка</option>
                    <option value="💻">💻 IT</option>
                    <option value="🎨">🎨 Искусство</option>
                    <option value="🧠">🧠 Интеллект</option>
                    <option value="📚">📚 Литература</option>
                    <option value="⚽">⚽ Футбол</option>
                    <option value="🏆">🏆 Соревнования</option>
                    <option value="🎤">🎤 Выступления</option>
                  </select>
                </label>
              </div>
            </div>

            <label class="field full">
            Краткое описание
            <input
              name="summary"
              required
              maxlength="180"
              placeholder="Коротко: что будет происходить"
            >
          </label>

          <label class="field full">
            Описание и детали
            <textarea
              name="description"
              required
              maxlength="4000"
              placeholder="Дальнейшее описание: точное объяснение то, что будете делать, уточнения по месту проведения, чат события и тому подобное"
            ></textarea>
          </label>

          <div class="field full">
            <label for="event-image">Фото события — необязательно</label>
            <input id="event-image" type="file" name="image" accept="image/jpeg,image/png,image/webp" aria-describedby="image-help image-status">
            <span id="image-help" class="small muted">JPG, PNG или WEBP · до 4 МБ · до 20 мегапикселей. Перед загрузкой выберите квадратную область фотографии. HEIC и SVG не поддерживаются. На карточке края могут обрезаться.</span>
            <div id="image-preview-panel" hidden>
              <img id="image-preview" class="upload-preview" alt="Предпросмотр обложки">
              <button type="button" class="secondary" id="remove-image">Убрать фото</button>
            </div>
            <span id="image-status" class="small" role="status"></span>
          </div>

        </div>

        <section class="form-section">
          <h2>Когда и где</h2>

          <div class="form-grid">
            <label class="field">
              Дата
              <input type="text" name="date" inputmode="numeric" placeholder="ДД.ММ.ГГГГ" pattern="[0-9]{2}[.][0-9]{2}[.][0-9]{4}" maxlength="10" required>
            </label>

            <label class="field">
              Повторение
              <select name="regular">
                <option value="false">Один раз</option>
                <option value="true">Каждую неделю</option>
              </select>
            </label>

            <label class="field">
              Начало
              <input type="text" name="time" inputmode="numeric" placeholder="ЧЧ:ММ, например 17:30" pattern="([01][0-9]|2[0-3]):[0-5][0-9]" maxlength="5" required>
            </label>

            <label class="field">
              Окончание
              <input type="text" name="end" inputmode="numeric" placeholder="ЧЧ:ММ, например 18:30" pattern="([01][0-9]|2[0-3]):[0-5][0-9]" maxlength="5" required>
            </label>

            ${placeSelectField(placeGroup)}

            <label class="field">
              Где именно
              <input
                name="room"
                required
                maxlength="100"
                placeholder="Кабинет, гостиная, этаж"
              >
            </label>
          </div>
        </section>

        <section class="form-section">
          <h2>Теги</h2>

          <div class="form-grid">
            ${groupsWithoutPlace.map(
              group => selectField(group.key, group.label, group.options)
            ).join('')}
          </div>
        </section>

        <section class="form-section">
          <h2>Контакты</h2>

          <div class="form-grid">
            <label class="field">
              Имя организатора
              <input name="organizer" required maxlength="80">
            </label>

            <label class="field">
              ЛС организатора
              <input type="text" name="contact" required maxlength="200"
                placeholder="Ник в телеграмме или школьная почта для Летово Чат">
              <span class="small muted">Ник с @ автоматически станет ссылкой на Telegram.</span>
            </label>
          </div>
        </section>

        <p class="muted">После сохранения на странице события появятся кнопки для отправки приглашения в Telegram, WhatsApp и другие приложения. Событие станет доступно всем после модерации.</p>
        <p class="error" id="form-error" role="alert"></p>

        <button class="primary" type="submit">
          ${editEvent ? 'Сохранить изменения и отправить на модерацию' : 'Создать событие'}
        </button>
      </form>
    </section>
  `;

  const form = document.querySelector('#event-form');
  // Keep entry formats predictable on systems using an English locale.
  for (const key of ['date', 'time', 'end']) {
    const input = form.elements[key];
    input.addEventListener('input', event => {
      if (event.inputType?.startsWith('delete')) return;
      const digits = input.value.replace(/\D/g, '');
      input.value = key === 'date'
        ? [digits.slice(0,2),digits.slice(2,4),digits.slice(4,8)].filter(Boolean).join('.')
        : [digits.slice(0,2),digits.slice(2,4)].filter(Boolean).join(':');
    });
  }
  const roomInput = form.elements.room;
  if (roomInput) {
    roomInput.setAttribute('list', 'school-rooms');
    const list = document.createElement('datalist'); list.id = 'school-rooms';
    form.append(list);
    loadSchoolRooms().then(rooms => {
      list.innerHTML = rooms.filter(r => !/^(h|std|TR)/.test(r.name)).map(r => `<option value="${escapeHtml(r.name)}">Этаж ${r.floor}</option>`).join('');
    }).catch(() => {});
  }


  const formValues = editEvent || draft;
  if (formValues) {
    Object.keys(formValues).forEach(key => {
      if (key !== 'image' && key !== 'id' && key !== 'creator_id' &&
          key !== 'count' && key !== 'status' && key !== 'moderation_comment' &&
          form.elements[key]) {
        const field = form.elements[key];
        const value = String(formValues[key] ?? '');
        if (field.tagName === 'SELECT' && value && !Array.from(field.options).some(o => o.value === value)) {
          field.add(new Option(value, value));
        }
        field.value = key === 'date' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value.split('-').reverse().join('.') : value;
      }
    });
  }

  const colorLabels = {cream:'Кремовый',blue:'Голубой',green:'Зелёный',lavender:'Лавандовый',peach:'Персиковый',pink:'Розовый',dark:'Тёмный'};
  function updateColorPreview() {
    const value = form.elements.card_color.value;
    const preview = form.querySelector('#card-color-preview');
    preview.className = `card-color-preview event-card-${value}`;
    form.querySelector('#card-color-name').textContent = colorLabels[value];
  }
  form.querySelectorAll('[name="card_color"]').forEach(input => input.addEventListener('change', updateColorPreview));
  updateColorPreview();

  const imageInput = form.elements.image;
  const imagePanel = form.querySelector('#image-preview-panel');
  const imagePreview = form.querySelector('#image-preview');
  const imageStatus = form.querySelector('#image-status');
  let photoVersion = 0;
  let croppedEventFile = null;
  let eventPhotoPreview = null;
  let photoInvalid = false;
  let photoChecking = false;
  let existingImageUrl = editEvent?.image_url || null;

  if (existingImageUrl) {
    imagePreview.src = existingImageUrl;
    imagePanel.hidden = false;
    imageStatus.textContent = 'Текущая обложка мероприятия';
  }

  form.querySelector('#remove-image').onclick = () => {
    photoVersion++;
    croppedEventFile = null;
    if (eventPhotoPreview) URL.revokeObjectURL(eventPhotoPreview);
    eventPhotoPreview = null;
    imageInput.value = '';
    imagePreview.removeAttribute('src');
    imagePanel.hidden = true;
    imageStatus.textContent = '';
    photoInvalid = false;
    photoChecking = false;
    existingImageUrl = null;
  };
  imageInput.onchange = async () => {
    const version = ++photoVersion;
    const file = imageInput.files[0];
    if (!file) return;
    photoChecking = true; photoInvalid = false; imageStatus.textContent = 'Выберите часть фотографии…';
    try {
      const cropped = await cropImageFile(file, {aspect:1,width:800,title:'Фото события'});
      if (version !== photoVersion || !form.isConnected) return;
      if (!cropped) {imageStatus.textContent='Выбор фотографии отменён.';return;}
      croppedEventFile = cropped;
      if (eventPhotoPreview) URL.revokeObjectURL(eventPhotoPreview);
      eventPhotoPreview = URL.createObjectURL(cropped);
      imagePreview.src = eventPhotoPreview;imagePanel.hidden = false;
      imageStatus.textContent='Выбранная область фотографии готова к загрузке.';
    } catch(error) {
      if (version === photoVersion) imageStatus.textContent=error.message;
    } finally {
      if (version === photoVersion) {photoChecking=false;imageInput.value='';}
    }
  };

  form.oninput = () => {
    if (editEvent) return;
    const formData = new FormData(form);
    formData.delete('image');
    draft = Object.fromEntries(formData);
  };

  form.onsubmit = async event => {
    event.preventDefault();
    if (form.dataset.submitting === 'true') return;
    form.dataset.submitting = 'true';
    const submitButton = form.querySelector('[type="submit"]');
    const originalLabel = submitButton.textContent;
    submitButton.disabled = true;
    submitButton.textContent = 'Сохраняем…';
    try {

    const data = Object.fromEntries(new FormData(form));
    if (/^\d{2}\.\d{2}\.\d{4}$/.test(data.date)) data.date = data.date.split('.').reverse().join('-');

    const imageFile = croppedEventFile;
    delete data.image;

    const error = form.querySelector('#form-error');
    error.textContent = '';

    if (photoChecking || photoInvalid) {
      error.textContent = photoChecking ? 'Дождитесь проверки фото.' : 'Исправьте ошибку фото или нажмите «Убрать фото».';
      return;
    }
    // Проверка размера изображения
    if (imageFile && imageFile.size > 4 * 1024 * 1024) {
      error.textContent = 'Изображение должно быть не больше 4 МБ.';
      return;
    }

    // Проверка времени
    if (data.end <= data.time) {
      error.textContent = 'Окончание должно быть позже начала. Укажите время в пределах одного дня.';
      return;
    }

    data.contact = String(data.contact || '').trim();
    if (/^@[A-Za-z0-9_]{1,32}$/.test(data.contact)) data.contact = 'https://t.me/' + data.contact.slice(1);
    const schoolContact = /^[a-z0-9.!#$%&'*+\/=?^_`{|}~-]+@(student\.letovo\.ru|letovo\.ru)$/i.test(data.contact);
    if (!data.contact) {error.textContent='Укажите ЛС организатора.';return;}
    // Проверка ссылок
    for (const key of ['chat', 'contact']) {
      if (key === 'contact' && schoolContact) continue;
      if (!data[key]) continue;

      try {
        const url = new URL(data[key]);

        if (!['https:', 'http:'].includes(url.protocol)) {
          error.textContent = 'Ссылки должны начинаться с https:// или http://.';
          return;
        }
      } catch {
        error.textContent = 'Проверьте ссылки на чат и ЛС организатора.';
        return;
      }
    }

    // Проверка текстовых полей
    for (const key of [
      'title',
      'summary',
      'description',
      'room',
      'organizer'
    ]) {
      data[key] = data[key].trim();

      if (!data[key]) {
        error.textContent = 'Заполните текстовые поля: одних пробелов недостаточно.';
        return;
      }
    }

    // Загрузка изображения
    let imageUrl = null;

    if (imageFile && imageFile.size > 0) {
      const imageData = new FormData();
      imageData.append('image', imageFile);

      try {
        const uploadResponse = await fetch('/api/upload-image', {
          method: 'POST',
          body: imageData
        });

        const uploadResult = await readResponse(uploadResponse);

        if (!uploadResponse.ok) {
          error.textContent = uploadResult.error || 'Не удалось загрузить изображение.';
          return;
        }

        imageUrl = uploadResult.image_url;
        existingImageUrl = imageUrl;
        croppedEventFile = null;
        imageInput.value = '';

      } catch (failure) {
        error.textContent = failure.message || 'Не удалось загрузить изображение.';
        return;
      }
    }

    // Подготовка данных мероприятия
    const payload = {
      ...data,
      regular: data.regular === 'true',
      image_url: imageUrl || existingImageUrl || null
    };

    // Create a new event or resubmit the corrected rejected event.
    try {
      const response = await fetch(
        editEvent ? `/api/events/${editEvent.id}` : '/api/events',
        {
          method: editEvent ? 'PUT' : 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(payload)
        }
      );

      const result = await readResponse(response);

      if (!response.ok) {
        error.textContent = result.error || 'Не удалось создать событие.';
        return;
      }

      if (!editEvent) draft = null;
      const savedEvent = result.event || result;
      if (form.isConnected) location.hash = `event/${savedEvent.id}`;

    } catch (requestError) {
      error.textContent = requestError.message || 'Не удалось связаться с сервером. Попробуйте ещё раз.';
    }
    } finally {
      form.dataset.submitting = 'false';
      submitButton.disabled = false;
      submitButton.textContent = originalLabel;
    }
  };
}



function closeHeaderMenu() {
  document.querySelector('header')?.classList.remove('is-open');
  const toggle = document.querySelector('#menu-toggle');
  toggle?.setAttribute('aria-expanded', 'false');
  toggle?.setAttribute('aria-label', 'Открыть меню');
}

function initHeaderMenu() {
  const header = document.querySelector('header');
  const toggle = document.querySelector('#menu-toggle');
  if (!toggle || !header) return;
  toggle.onclick = () => {
    const open = header.classList.toggle('is-open');
    toggle.setAttribute('aria-expanded', String(open));
    toggle.setAttribute('aria-label', open ? 'Закрыть меню' : 'Открыть меню');
  };
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && header.classList.contains('is-open')) {
      closeHeaderMenu();toggle.focus();
    }
  });
  document.addEventListener('click', event => {
    if (!header.contains(event.target)) closeHeaderMenu();
  });
}

async function render() {
  if (dialog.open) dialog.close();
  content.querySelectorAll("dialog[open]").forEach(item => item.close());
  mapResizeObserver?.disconnect();

  const hash = location.hash;
  const eventPath = location.pathname.match(/^\/events\/(\d+)\/?$/);
  const route = hash.slice(1) || (eventPath ? `event/${eventPath[1]}` :
    location.pathname === '/map' ? 'map' : location.pathname === '/events' ? 'catalog' : 'home');
  document.body.classList.toggle('is-entry', route === 'home');
  closeHeaderMenu();
  navigation.hidden = false;

  navigation.querySelectorAll('a').forEach(link => {
    link.removeAttribute('aria-current');

    if (link.hash === '#' + route) {
      link.setAttribute('aria-current', 'page');
    }
  });

  if (route === 'home') {
    homePage();

  } else if (route === 'about') {
    aboutPage();

  } else if (route === 'welcome') {
    try { await loadData(); } catch (error) {
      if (location.hash === hash) content.innerHTML = `<p class="error">${escapeHtml(error.message)}</p>`;
      return;
    }
    if (location.hash === hash) welcomePage();

  } else if (route === 'filters') {
    filtersPage();

  } else if (route === 'catalog') {
    try { await loadData(); } catch (error) {
      if (location.hash === hash) content.innerHTML = `<p class="error">${escapeHtml(error.message)}</p>`;
      return;
    }
    if (location.hash !== hash) return;
    eventsView = 'catalog';
    catalogPage();

  } else if (route === 'map' || route.startsWith('map/')) {
    eventsView = 'map';
    await mapPage(Number(route.split("/")[1]) || null);

  } else if (route === 'create') {
    createPage();

  } else if (route.startsWith('edit/')) {
    const id = Number(route.split('/')[1]);
    try {
      const response = await fetch(`/api/events/${id}`, {cache: 'no-store'});
      const event = response.ok ? await response.json() : null;
      if (location.hash !== hash) return;
      if (!event || event.creator_id !== currentUser?.id) {
        content.innerHTML = '<section class="empty"><h1>Редактирование недоступно</h1><p>Редактировать можно только собственные мероприятия.</p><a href="#account">Вернуться в личный кабинет</a></section>';
      } else {
        createPage(event);
      }
    } catch {
      if (location.hash === hash) {
        content.innerHTML = '<p class="error">Не удалось загрузить мероприятие. Попробуйте ещё раз.</p><a href="#account">Мои события</a>';
      }
    }

  } else if (route === 'preview' && draft) {
    eventPage(
      {...draft, regular: draft.regular === 'true'},
      true
    );

  } else if (route.startsWith('event/')) {
    const id = Number(route.split('/')[1]);

    let event;
    try {
      const response = await fetch(`/api/events/${id}`, {cache:'no-store'});
      if (!response.ok) {
        const result = await response.json().catch(() => ({}));
        if (location.hash === hash) content.innerHTML = `<p class="error" role="alert">${escapeHtml(result.error || 'Не удалось открыть событие. Проверьте вход в аккаунт и попробуйте снова.')}</p><a href="#account">Мои события</a>`;
        return;
      }
      event = await response.json();
    } catch {
      if (location.hash === hash) content.innerHTML = '<p class="error" role="alert">Не удалось загрузить событие. Проверьте соединение и обновите страницу.</p>';
      return;
    }

    if (location.hash !== hash) return;
    await eventPage(event);

  } else if (route === 'login') {
    loginPage();

  } else if (route === 'register') {
    registerPage();

    } else if (route === 'admin') {
      await adminPage();

    } else if (route === 'account') {
      await accountPage();

  } else {
    content.innerHTML =
      '<h1>Страница не найдена</h1><a href="#home">На главную</a>';
  }

  if (location.hash === hash) window.scrollTo(0, 0);
}


document.querySelector('#close-dialog').onclick = () => dialog.close();
document.querySelector('#done-dialog').onclick = () => dialog.close();

dialog.onclick = event => {
  if (event.target === dialog) {
    const box = dialog.getBoundingClientRect();

    if (
      event.clientX < box.left ||
      event.clientX > box.right ||
      event.clientY < box.top ||
      event.clientY > box.bottom
    ) {
      dialog.close();
    }
  }
};


initHeaderMenu();
window.addEventListener('hashchange', render);


(async function init() {
  try {
    await loadUser();
    await loadData();
    await render();
  } catch (error) {
    content.innerHTML = `
      <section class="empty">
        <h1>LETOMEET</h1>
        <p class="error">
          ${escapeHtml(error.message)}
        </p>
        <p>Проверь, что Flask-сервер запущен.</p>
      </section>`;
  }
})();


async function commentsPanel(eventId) {
  const panel = document.createElement('section');
  panel.className = 'comments-panel';
  document.querySelector('.detail').append(panel);
  panel.innerHTML = `<h2>Комментарии</h2><div class="comment-list"></div>
    ${currentUser ? '<form class="comment-form"><label class="field">Ваш комментарий<textarea name="body" maxlength="2000" required></textarea></label><button class="primary">Отправить</button></form>' : '<p><a href="#login">Войдите</a>, чтобы оставить комментарий.</p>'}<p role="status" class="error"></p>`;
  const status = panel.querySelector('[role=status]');
  async function refresh() {
    const response = await fetch(`/api/events/${eventId}/comments`);
    if (!response.ok) throw new Error('Не удалось загрузить комментарии');
    const rows = await response.json();
    panel.querySelector('.comment-list').innerHTML = rows.length ? rows.map(c => `<article class="comment"><div class="comment-author">${avatarMarkup({username:c.author,avatar_url:c.avatar_url},"comment-avatar")}<strong>${escapeHtml(c.author)}</strong></div><p>${escapeHtml(c.body)}</p><small>${escapeHtml(new Date(c.created_at).toLocaleString('ru'))}</small>${c.can_delete ? `<button class="plain" data-delete="${c.id}">Удалить</button>` : ''}</article>`).join('') : '<p class="muted">Пока нет комментариев.</p>';
  }
  panel.onclick = async e => {
    const id = e.target.dataset.delete;
    if (!id) return;
    try {
      const r = await fetch(`/api/comments/${id}`, {method:'DELETE'});
      if (!r.ok) throw new Error('Не удалось удалить комментарий');
      await refresh();
    } catch (e) { status.textContent = e.message; }
  };
  const form = panel.querySelector('form');
  if (form) form.onsubmit = async e => {
    e.preventDefault();
    const button = form.querySelector('button'); button.disabled = true;
    try {
      const r = await fetch(`/api/events/${eventId}/comments`, {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({body:form.elements.body.value})});
      const data = await r.json();
      if (!r.ok) throw new Error(data.error);
      form.reset(); status.textContent = ''; await refresh();
    } catch(e) { status.textContent = e.message; }
    finally { button.disabled = false; }
  };
  try { await refresh(); } catch(e) { status.textContent = e.message; }
}

function loadSchoolRooms() {
  if (!schoolRoomsRequest) {
    schoolRoomsRequest = fetch('/static/maps/rooms.json')
      .then(response => {
        if (!response.ok) throw new Error('Не удалось загрузить данные о кабинетах.');
        return response.json();
      })
      .catch(error => {
        schoolRoomsRequest = null;
        throw error;
      });
  }
  return schoolRoomsRequest;
}

function normalizeRoom(name) {
  const room = String(name).trim().toLowerCase();
  const classroom = room.match(/^(?:(?:каб\.?|кабинет|аудитория)\s+)?[cс]?(\d{3})$/);
  return classroom ? `c${classroom[1]}` : room;
}

function roomPosition(room) {
  return {x: (room.marker_x ?? room.x) / room.reference_width, y: (room.marker_y ?? room.y) / room.reference_height};
}

function pinPosition({x, y}) {
  return `left:${x * 100}%;top:${y * 100}%`;
}

function schoolMap() {
  return '<div class="school-map"><img alt=""><div class="map-pins" hidden></div></div>';
}

function setSchoolFloor(map, floor, status, onLoad) {
  const image = map.querySelector('img');
  const pins = map.querySelector('.map-pins');
  pins.hidden = true;
  image.alt = `План школы, этаж ${floor}`;
  image.onload = () => { pins.hidden = false; onLoad?.(); };
  image.onerror = () => { status.textContent = 'Не удалось загрузить план этажа.'; };
  image.src = `/static/maps/floor_${floor}.png`;
}

async function loadEventLocation(section, roomName) {
  const status = section.querySelector('[data-map-status]');
  try {
    const rooms = await loadSchoolRooms();
    if (!section.isConnected) return;

    const room = rooms.find(room => normalizeRoom(room.name) === normalizeRoom(roomName));
    if (!room) {
      status.textContent = 'Это место не отмечено на плане школы.';
      return;
    }

    section.insertAdjacentHTML('beforeend', schoolMap());
    const map = section.querySelector('.school-map');
    map.querySelector('.map-pins').innerHTML = `
      <span class="map-pin" style="${pinPosition(roomPosition(room))}"
        role="img" aria-label="${escapeHtml(room.name)}"></span>`;
    status.textContent = `${room.name} · этаж ${room.floor}`;
    setSchoolFloor(map, room.floor, status);
  } catch (error) {
    status.textContent = error.message;
  }
}

function mapCanvasGeometry(viewWidth, viewHeight, imageWidth, imageHeight, zoom) {
  const fit = Math.min(viewWidth / imageWidth, viewHeight / imageHeight, 1);
  const width = imageWidth * fit * zoom / 100;
  const height = imageHeight * fit * zoom / 100;
  return {width, height, canvasWidth: Math.max(viewWidth, width),
    canvasHeight: Math.max(viewHeight, height)};
}

function mapEventPreviewMarkup(events) {
  return events.map(event => {
    const description = Array.from(String(event.description || ''));
    const excerpt = description.length > 70 ? description.slice(0, 67).join('') + '...' : description.join('');
    const image = event.image_url ? `<img src="${escapeHtml(event.image_url)}" alt="" loading="lazy">` : '<span class="map-preview-placeholder" aria-hidden="true">✦</span>';
    return `<article class="map-preview-card">${image}<div class="map-preview-copy"><h3>${escapeHtml(event.title)}</h3><div class="map-preview-tags">${[event.activity, event.type, event.duration].map(tag => `<span class="tag">${escapeHtml(tag)}</span>`).join('')}</div><p>${escapeHtml(excerpt)}</p><a href="#event/${event.id}">Открыть событие ↗</a></div></article>`;
  }).join('');
}

function mapPeriodEvents(events, period, now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {timeZone:'Europe/Moscow',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now);
  const part = key => parts.find(value => value.type === key).value;
  const today = `${part('year')}-${part('month')}-${part('day')}`;
  const end = new Date(today + 'T12:00:00Z');end.setUTCDate(end.getUTCDate() + 3);
  const last = end.toISOString().slice(0,10);
  return events.filter(event => period === 'today' ? event.date === today
    : period === 'next4' ? event.date >= today && event.date <= last : true);
}

function mapFloorEventSections(events, now = new Date()) {
  // The school timetable uses Moscow time, including for visitors abroad.
  const parts = new Intl.DateTimeFormat('en-US', {timeZone: 'Europe/Moscow',
    year: 'numeric', month: '2-digit', day: '2-digit'}).formatToParts(now);
  const part = type => parts.find(item => item.type === type).value;
  const today = `${part('year')}-${part('month')}-${part('day')}`;
  const ordered = [...events].sort((a, b) =>
    `${a.date}T${a.time}`.localeCompare(`${b.date}T${b.time}`) || Number(a.id) - Number(b.id));
  const link = event => `<p><a href="#event/${event.id}">${escapeHtml(event.title)}</a><br><small>${escapeHtml(event.room)} · ${dateLabel(event.date)} · ${escapeHtml(event.time)}</small></p>`;
  const current = ordered.filter(event => event.date === today);
  const later = ordered.filter(event => event.date > today);
  if (!current.length && !later.length) return '<p>Нет событий на этом этаже</p>';
  return `<section aria-labelledby="map-today-title"><h2 id="map-today-title">Сегодня</h2>${current.map(link).join('') || '<p>Нету событий на сегодня.</p>'}</section>
    <section aria-labelledby="map-later-title"><h2 id="map-later-title">После</h2>${later.map(link).join('') || '<p>Нет событий позже.</p>'}</section>`;
}

function bindMapDragging(viewport, zoomControls = null) {
  const pointers = new Map();
  let drag = null, pinch = null, suppressClick = false;
  function pair() {
    const [a, b] = [...pointers.values()];
    return {x: (a.x + b.x) / 2, y: (a.y + b.y) / 2,
      distance: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y))};
  }
  function startDrag(id, point, moved = false) {
    drag = {id, x: point.x, y: point.y, left: viewport.scrollLeft,
      top: viewport.scrollTop, moved};
  }
  viewport.addEventListener('dragstart', event => event.preventDefault());
  viewport.addEventListener('pointerdown', event => {
    if (event.button !== 0) return;
    if (!pointers.size) suppressClick = false;
    pointers.set(event.pointerId, {x: event.clientX, y: event.clientY});
    if (pointers.size === 1) startDrag(event.pointerId, pointers.get(event.pointerId));
    if (pointers.size === 2 && zoomControls) {
      pinch = pair(); drag = null; suppressClick = true;
      for (const id of pointers.keys()) viewport.setPointerCapture(id);
      viewport.classList.add('is-dragging');
    }
  });
  viewport.addEventListener('pointermove', event => {
    if (!pointers.has(event.pointerId)) return;
    pointers.set(event.pointerId, {x: event.clientX, y: event.clientY});
    if (pinch && pointers.size >= 2 && zoomControls) {
      event.preventDefault();
      const next = pair(), rect = viewport.getBoundingClientRect();
      zoomControls.set(zoomControls.get() * next.distance / pinch.distance, {
        x: next.x - rect.left, y: next.y - rect.top,
        fromX: pinch.x - rect.left, fromY: pinch.y - rect.top});
      pinch = next;
      return;
    }
    if (!drag || drag.id !== event.pointerId) return;
    const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
    if (!drag.moved && Math.hypot(dx, dy) < 6) return;
    drag.moved = true; suppressClick = true;
    viewport.setPointerCapture(event.pointerId);
    viewport.classList.add('is-dragging');
    event.preventDefault();
    viewport.scrollLeft = drag.left - dx;
    viewport.scrollTop = drag.top - dy;
  });
  function finish(event) {
    if (!pointers.has(event.pointerId)) return;
    pointers.delete(event.pointerId);
    pinch = null; drag = null;
    if (pointers.size === 1) {
      const [id, point] = [...pointers.entries()][0];
      startDrag(id, point, suppressClick);
    }
    if (!pointers.size) viewport.classList.remove('is-dragging');
    if (viewport.hasPointerCapture(event.pointerId)) viewport.releasePointerCapture(event.pointerId);
  }
  viewport.addEventListener('pointerup', finish);
  viewport.addEventListener('pointercancel', finish);
  viewport.addEventListener('lostpointercapture', finish);
  viewport.addEventListener('pointerleave', event => {
    if (drag && !drag.moved && !pinch) finish(event);
  });
  viewport.addEventListener('wheel', event => {
    if (!zoomControls) return;
    event.preventDefault();
    const rect = viewport.getBoundingClientRect();
    const pixels = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? viewport.clientHeight : 1);
    zoomControls.set(zoomControls.get() * Math.exp(-Math.max(-200, Math.min(200, pixels)) * 0.002),
      {x: event.clientX - rect.left, y: event.clientY - rect.top});
  }, {passive: false});
  viewport.addEventListener('click', event => {
    if (!suppressClick || event.detail === 0) return;
    event.preventDefault(); event.stopImmediatePropagation(); suppressClick = false;
  }, true);
}

async function mapPage(focusedId = null) {
  const hash = location.hash;
  content.innerHTML = `<section aria-labelledby="map-title">
    <h1 id="map-title">Карта событий</h1>
    <p class="small muted" id="map-message" role="status">Загружаем карту…</p>
    <div class="map-controls" hidden>
      <div class="map-period-controls" role="group" aria-label="Когда проходят события">
        <button type="button" class="secondary" data-map-period="today">Сегодня</button>
        <button type="button" class="secondary" data-map-period="next4">Следующие 4 дня</button>
        <button type="button" class="secondary" data-map-period="all">Все</button>
      </div>
      <label class="field">Этаж<select id="map-floor"></select></label>
      <div class="map-zoom-controls" role="group" aria-label="Масштаб карты">
        <div class="map-zoom-range">
          <label for="map-zoom">Масштаб</label><input id="map-zoom" type="range" min="50" max="300" step="1" value="100">
          <output id="map-zoom-label" for="map-zoom">100%</output>
        </div>
        <div class="map-zoom-buttons">
          <button type="button" class="secondary" id="map-zoom-out" aria-label="Уменьшить карту">−</button>
          <button type="button" class="secondary" id="map-zoom-in" aria-label="Увеличить карту">+</button>
          <button type="button" class="secondary" id="map-zoom-reset">Вписать карту</button>
        </div>
      </div>
    </div>
    <p class="small muted">Перетаскивайте карту мышью или двумя пальцами. Приближайте колёсиком мыши, двумя пальцами или кнопками − и +.</p>
    <div class="map-layout"><div class="map-scroll" tabindex="0" role="region" aria-label="План школы. Перетаскивайте мышью или пальцем; с клавиатуры используйте стрелки" hidden>
      <div class="map-canvas">${schoolMap()}</div>
    </div>
    <aside id="map-events" aria-label="События на карте"></aside></div>
    <p class="small muted map-unplaced" hidden></p>
    <dialog class="map-event-picker" aria-labelledby="map-picker-title">
      <div class="dialog-heading">
        <h2 id="map-picker-title">События у этой точки</h2>
        <form method="dialog"><button class="plain" aria-label="Закрыть">×</button></form>
      </div>
      <div class="map-picker-events"></div>
    </dialog>
  </section>`;

  const page = content.firstElementChild;
  const status = page.querySelector('#map-message');

  try {
    const [rooms, mapEvents] = await Promise.all([
      loadSchoolRooms(),
      fetch('/api/events').then(response => {
        if (!response.ok) throw new Error('Не удалось загрузить события для карты.');
        return response.json();
      })
    ]);
    if (location.hash !== hash || !page.isConnected) return;

    let focused = mapEvents.find(event => event.id === focusedId);
    if (focusedId && !focused) {
      const response = await fetch(`/api/events/${focusedId}`);
      if (response.ok) { focused = await response.json(); mapEvents.push(focused); }
      if (location.hash !== hash || !page.isConnected) return;
    }
    const roomsByName = new Map(rooms.map(room => [normalizeRoom(room.name), room]));
    const eventsByFloor = [[], [], [], []];
    const unplacedEvents = [];
    let unplaced = 0;
    function groupMapEvents() {
      eventsByFloor.forEach(events => events.length = 0);
      unplacedEvents.length = 0;unplaced = 0;
    for (const event of mapPeriodEvents(mapEvents, selectedMapPeriod)) {
      const room = roomsByName.get(normalizeRoom(event.room));
      if (room) {
        eventsByFloor[room.floor].push({event, ...roomPosition(room)});
      } else {
        unplaced += 1;
        unplacedEvents.push(event);
      }
    }

    }
    groupMapEvents();

    const select = page.querySelector('#map-floor');
    const zoom = page.querySelector('#map-zoom');
    const zoomLabel = page.querySelector('#map-zoom-label');
    const zoomOut = page.querySelector('#map-zoom-out');
    const zoomIn = page.querySelector('#map-zoom-in');
    const map = page.querySelector('.school-map');
    const pins = page.querySelector('.map-pins');
    const scroll = page.querySelector('.map-scroll');
    const canvas = page.querySelector('.map-canvas');
    bindMapDragging(scroll, {get: () => Number(zoom.value), set: applyZoom});
    const picker = page.querySelector('.map-event-picker');
    const pickerEvents = page.querySelector('.map-picker-events');
    const unplacedNote = page.querySelector('.map-unplaced');

    select.innerHTML = eventsByFloor.map((floorEvents, floor) =>
      `<option value="${floor}">${floor} (${floorEvents.length})</option>`
    ).join('');
    const firstOccupiedFloor = eventsByFloor.findIndex(floorEvents => floorEvents.length);
    const defaultFloor = eventsByFloor[2].length || firstOccupiedFloor === -1 ? 2 : firstOccupiedFloor;
    const focusedRoom = focused && roomsByName.get(normalizeRoom(focused.room));
    select.value = focusedRoom ? focusedRoom.floor : (selectedMapFloor ?? defaultFloor);
    if (unplaced) {
      unplacedNote.hidden = false;
      unplacedNote.textContent = `Событий без точного места: ${unplaced}. Их можно открыть в списке событий.`;
    }
    page.querySelector('.map-controls').hidden = false;
    scroll.hidden = false;

    const preview = document.createElement('div');
    preview.className = 'map-event-preview';
    preview.hidden = true;
    preview.setAttribute('role', 'region');
    preview.setAttribute('aria-label', 'Описание событий на карте');
    page.append(preview);
    let previewTimer, tappedGroup = null;
    function hidePreview() { clearTimeout(previewTimer); preview.hidden = true; }
    let lastMapPointer = 'mouse';
    pins.addEventListener('pointerdown', event => {lastMapPointer=event.pointerType || 'mouse';});
    function scheduleHide() {
      clearTimeout(previewTimer);
      previewTimer = setTimeout(() => {
        if (!preview.contains(document.activeElement)) preview.hidden = true;
      }, 180);
    }
    function showPreview(pin) {
      const group = groups[Number(pin.dataset.previewGroup)];
      if (!group || scroll.classList.contains('is-dragging')) return;
      clearTimeout(previewTimer);
      preview.innerHTML = mapEventPreviewMarkup(group.events);
      preview.hidden = false;
      const rect = pin.getBoundingClientRect();
      const width = preview.offsetWidth;
      const height = preview.offsetHeight;
      preview.style.left = `${Math.max(8, Math.min(window.innerWidth - width - 8, rect.left + rect.width / 2 - width / 2))}px`;
      const below = rect.bottom + 10;
      preview.style.top = `${Math.max(8, below + height <= window.innerHeight - 8 ? below : rect.top - height - 10)}px`;
    }
    pins.addEventListener('pointerover', event => {
      if (event.pointerType === 'touch') return;
      const pin = event.target.closest('[data-preview-group]');
      if (pin) showPreview(pin);
    });
    pins.addEventListener('pointerout', event => {
      if (event.pointerType === 'touch') return;
      if (event.target.closest('[data-preview-group]')) scheduleHide();
    });
    pins.addEventListener('focusin', event => {
      const pin = event.target.closest('[data-preview-group]');
      if (pin) showPreview(pin);
    });
    pins.addEventListener('focusout', scheduleHide);
    preview.addEventListener('pointerenter', () => clearTimeout(previewTimer));
    preview.addEventListener('pointerleave', scheduleHide);
    preview.addEventListener('focusin', () => clearTimeout(previewTimer));
    preview.addEventListener('focusout', scheduleHide);
    preview.addEventListener('click', event => { if (event.target.closest('a')) hidePreview(); });
    page.addEventListener('keydown', event => { if (event.key === 'Escape') hidePreview(); });
    scroll.addEventListener('pointerdown', event => {if (!(event.pointerType === 'touch' && event.target.closest('[data-preview-group]'))) {tappedGroup=null;hidePreview();}});
    scroll.addEventListener('scroll', () => {tappedGroup=null;hidePreview();});

    let groups = [];
    function drawPins() {
      tappedGroup=null;hidePreview();
      groups = [];
      const visible = eventsByFloor[Number(select.value)];
      const {clientWidth: width, clientHeight: height} = map;
      if (!width || !height) return;

      // Group pins that would overlap at this zoom, including events in the same room.
      for (const marker of visible) {
        const group = groups.find(point =>
          Math.hypot((point.x - marker.x) * width, (point.y - marker.y) * height) < 30
        );
        if (group) {
          group.events.push(marker.event);
        } else {
          groups.push({x: marker.x, y: marker.y, events: [marker.event]});
        }
      }

      pins.innerHTML = groups.map((group, index) => {
        const position = pinPosition(group);
        const focusedClass = group.events.some(event => event.id === focusedId) ? " focused-pin" : "";
        const [event] = group.events;
        if (group.events.length === 1) {
          const title = escapeHtml(event.title);
          return `<a class="map-pin${focusedClass}" href="#event/${event.id}" data-preview-group="${index}" aria-label="${title}" style="${position}"></a>`;
        }

        const label = `Событий у этой точки: ${group.events.length}`;
        return `<button class="map-pin${focusedClass}" type="button" data-group="${index}" data-preview-group="${index}" style="${position}"
          aria-label="${label}" aria-haspopup="dialog">${group.events.length}</button>`;
      }).join('');
    }

    pins.onclick = click => {
      const pin = click.target.closest('[data-preview-group]');
      const touch = click.detail !== 0 && (lastMapPointer === 'touch' || matchMedia('(hover: none)').matches);
      if (pin && touch) {
        const index = Number(pin.dataset.previewGroup);
        if (preview.hidden || tappedGroup !== index || !preview.querySelector(`[href="#event/${groups[index]?.events[0]?.id}"]`)) {
          click.preventDefault();tappedGroup=index;showPreview(pin);return;
        }
        tappedGroup=null;
      }
      const button = click.target.closest('[data-group]');
      if (!button) return;
      pickerEvents.innerHTML = groups[Number(button.dataset.group)].events.map(event => `
        <a href="#event/${event.id}">${escapeHtml(event.title)}
          <small>${escapeHtml(event.room)} · ${dateLabel(event.date)} · ${escapeHtml(event.time)}</small>
        </a>`).join('');
      picker.showModal();
    };
    pickerEvents.onclick = click => {
      if (click.target.closest('a')) picker.close();
    };

    function applyZoom(value, anchor = null) {
      const point = anchor && map.offsetWidth && map.offsetHeight ? {
        x: (scroll.scrollLeft + (anchor.fromX ?? anchor.x) - map.offsetLeft) / map.offsetWidth,
        y: (scroll.scrollTop + (anchor.fromY ?? anchor.y) - map.offsetTop) / map.offsetHeight
      } : null;
      const next = Math.max(50, Math.min(300, Math.round(value)));
      zoom.value = next;
      zoomLabel.textContent = `${next}%`;
      zoomOut.disabled = next === 50;
      zoomIn.disabled = next === 300;
      const image = map.querySelector('img');
      if (!image.complete || !image.naturalWidth || !scroll.clientWidth || !scroll.clientHeight) return;
      const size = mapCanvasGeometry(scroll.clientWidth, scroll.clientHeight,
        image.naturalWidth, image.naturalHeight, next);
      canvas.style.width = `${size.canvasWidth}px`;
      canvas.style.height = `${size.canvasHeight}px`;
      map.style.width = `${size.width}px`;
      map.style.height = `${size.height}px`;
      map.style.left = `${(size.canvasWidth - size.width) / 2}px`;
      map.style.top = `${(size.canvasHeight - size.height) / 2}px`;
      scroll.scrollLeft = point ? (size.canvasWidth - size.width) / 2 + point.x * size.width - anchor.x
        : (size.canvasWidth - scroll.clientWidth) / 2;
      scroll.scrollTop = point ? (size.canvasHeight - size.height) / 2 + point.y * size.height - anchor.y
        : (size.canvasHeight - scroll.clientHeight) / 2;
      drawPins();
    }

    function drawFloor() {
      const floor = Number(select.value);
      status.textContent = eventsByFloor[floor].length ? '' : 'На этом этаже пока нет событий.';
      setSchoolFloor(map, floor, status, () => applyZoom(Number(zoom.value)));
      page.querySelector('#map-events').innerHTML = mapFloorEventSections(
        eventsByFloor[floor].map(marker => marker.event));
    }

    const periodButtons = page.querySelectorAll('[data-map-period]');
    function updatePeriodButtons() {
      periodButtons.forEach(button => button.setAttribute('aria-pressed', String(button.dataset.mapPeriod === selectedMapPeriod)));
    }
    periodButtons.forEach(button => button.onclick = () => {
      selectedMapPeriod = button.dataset.mapPeriod;
      groupMapEvents();updatePeriodButtons();
      Array.from(select.options).forEach((option, floor) => option.textContent = `${floor} (${eventsByFloor[floor].length})`);
      unplacedNote.hidden = !unplaced;
      unplacedNote.textContent = `Событий без точного места: ${unplaced}. Их можно открыть в списке событий.`;
      drawFloor();
    });
    updatePeriodButtons();

    zoom.oninput = () => applyZoom(Number(zoom.value));
    zoomIn.onclick = () => applyZoom(Number(zoom.value) + 25);
    zoomOut.onclick = () => applyZoom(Number(zoom.value) - 25);
    page.querySelector('#map-zoom-reset').onclick = () => {
      applyZoom(100);
    };
    select.onchange = () => {
      selectedMapFloor = Number(select.value);
      drawFloor();
    };
    mapResizeObserver = new ResizeObserver(() => applyZoom(Number(zoom.value)));
    mapResizeObserver.observe(scroll);
    drawFloor();
  } catch (error) {
    status.textContent = error.message;
  }
}


async function readResponse(response) {
  const data = await response.json().catch(() => null);
  if (!data) throw new Error(`Сервер вернул ошибку (${response.status}). Попробуйте снова позже.`);
  return data;
}
function loadRooms() { return loadSchoolRooms(); }
function findSchoolRoom(rooms, name) {
  return rooms.find(room => normalizeRoom(room.name) === normalizeRoom(name));
}
function roomMapMarkup(room, compact = false) {
  room = {...room, x: room.marker_x ?? room.x, y: room.marker_y ?? room.y};
  const w = room.reference_width * (compact ? 0.32 : 0.48);
  const h = w * 0.56;
  const x = Math.max(0, Math.min(room.reference_width-w, room.x-w/2));
  const y = Math.max(0, Math.min(room.reference_height-h, room.y-h/2));
  const radius = Math.min(room.reference_width, room.reference_height) * 0.0045;
  return `<div class="room-map-preview"><svg viewBox="${x} ${y} ${w} ${h}" role="img" aria-label="Кабинет ${escapeHtml(room.name)}, этаж ${room.floor}">
    <image href="/static/maps/floor_${room.floor}.png" width="${room.reference_width}" height="${room.reference_height}"/>
    <circle cx="${room.x}" cy="${room.y}" r="${radius*1.8}" fill="#fff" fill-opacity="0.8"/>
    <circle cx="${room.x}" cy="${room.y}" r="${radius}" fill="#a43e25" stroke="#fff" stroke-width="${radius/4}"/>
    </svg><span class="map-caption">📍 ${escapeHtml(room.name)} · этаж ${room.floor}</span></div>`;
}
async function eventLocationCard(event, host) {
  try {
    const rooms = await loadRooms();
    if (!host.isConnected) return;
    const room = findSchoolRoom(rooms,event.room);
    host.innerHTML = `<h2>Место на карте</h2>${room ? roomMapMarkup(room) : `<p>${escapeHtml(event.place)} · ${escapeHtml(event.room)}</p><p class="muted">Для этого места точка на школьном плане не найдена. Уточните место у организатора.</p>`}
      <a class="secondary" href="${event.id ? '#map/'+event.id : '#map'}">Открыть карту школы</a>
      ${room ? '<details class="event-location"><summary>План этажа целиком</summary><p data-map-status role="status">Загружаем план…</p></details>' : ''}`;
    if (room) loadEventLocation(host.querySelector('.event-location'), event.room);
  } catch {
    if (host.isConnected) host.innerHTML = '<h2>Место на карте</h2><p class="muted">План временно недоступен. Попробуйте открыть карту ещё раз.</p><a href="#map">Карта школы</a>';
  }
}
