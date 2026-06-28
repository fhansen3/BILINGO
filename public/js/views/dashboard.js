(function () {
  'use strict';

  function navbar(user) {
    var isAdmin = user.role === 'admin';
    return '<nav class="navbar-bl">' +
      '<a href="#/dashboard" class="brand" style="text-decoration:none"><span class="parrot">🦜</span> BiLingo Meet</a>' +
      '<div class="nav-links">' +
        '<a href="#/dashboard" class="nav-link"><i class="fa-solid fa-house"></i> Inicio</a>' +
        '<a href="#/partners" class="nav-link"><i class="fa-solid fa-users"></i> Contactos</a>' +
        '<a href="#/profile" class="nav-link"><i class="fa-solid fa-user"></i> Perfil</a>' +
        (isAdmin ? '<a href="#/admin" class="nav-link"><i class="fa-solid fa-shield-halved"></i> Admin</a>' : '') +
        '<button class="nav-link" id="logout-btn"><i class="fa-solid fa-right-from-bracket"></i> Salir</button>' +
      '</div>' +
    '</nav>';
  }
  window.AppNav = navbar;

  async function render(container) {
    var user = window.Auth.getUser();
    container.innerHTML =
      '<div class="app-shell">' +
        navbar(user) +
        '<main class="main-content">' +
          '<div class="page-header">' +
            '<div>' +
              '<h2>¡Hola, ' + window.UI.escapeHtml(user.display_name) + '! ' + window.UI.avatar(user.display_name, user.avatar_color, 'sm').replace('<div', '<span style="display:inline-flex;vertical-align:middle"').replace('</div', '</span') + '</h2>' +
              '<p class="subtitle">Tu sala de reuniones para equipos internacionales.</p>' +
            '</div>' +
          '</div>' +
          '<div class="stats-row" id="my-stats"></div>' +
          '<div class="dash-grid">' +
            '<div>' +
              '<div class="card-bl">' +
                '<div class="card-title"><i class="fa-solid fa-video"></i> Nueva reunión</div>' +
                '<p class="muted">Crea una sala y comparte el código con tu equipo, o únete a una existente.</p>' +
                '<div style="display:flex; gap:10px; flex-wrap:wrap; margin-top:8px">' +
                  '<button class="btn-bl btn-green" id="new-room-btn"><i class="fa-solid fa-plus"></i> Crear sala</button>' +
                  '<button class="btn-bl btn-blue" id="join-room-btn"><i class="fa-solid fa-door-open"></i> Unirme con código</button>' +
                  '<a href="#/partners" class="btn-bl btn-orange"><i class="fa-solid fa-magnifying-glass"></i> Invitar contactos</a>' +
                '</div>' +
              '</div>' +
              '<div class="card-bl">' +
                '<div class="card-title"><i class="fa-solid fa-clock-rotate-left"></i> Reuniones recientes</div>' +
                '<div id="my-rooms"><p class="muted">Cargando…</p></div>' +
              '</div>' +
            '</div>' +
            '<div>' +
              '<div class="card-bl">' +
                '<div class="card-title"><i class="fa-solid fa-fire"></i> Equipo en línea</div>' +
                '<div id="online-list"><p class="muted">Cargando…</p></div>' +
              '</div>' +
            '</div>' +
          '</div>' +
        '</main>' +
        '<footer class="app-footer">© BiLingo Meet · Reuniones sin barreras de idioma para equipos internacionales</footer>' +
      '</div>';

    container.querySelector('#logout-btn').addEventListener('click', async function () {
      await window.Auth.logout();
      window.UI.notify('¡Hasta pronto! 👋', 'info');
      window.Router.navigate('landing');
    });

    container.querySelector('#new-room-btn').addEventListener('click', async function () {
      try {
        var room = await window.API.post('api/rooms', { topic: 'Reunión de equipo' });
        window.Router.navigate('room/' + room.room_code);
      } catch (err) {
        window.UI.notify(err.message || 'Error al crear sala', 'error');
      }
    });

    container.querySelector('#join-room-btn').addEventListener('click', function () {
      var code = prompt('Introduce el código de la sala:');
      if (code) window.Router.navigate('room/' + code.trim().toUpperCase());
    });

    // Load stats
    try {
      var mine = await window.API.get('api/rooms/mine');
      var totalMin = mine.reduce(function (a, r) { return a + (r.duration_seconds || 0); }, 0) / 60;
      var statsEl = container.querySelector('#my-stats');
      statsEl.innerHTML =
        statCard('fa-video', 'bg-green', mine.length, 'Reuniones totales') +
        statCard('fa-clock', 'bg-blue', Math.round(totalMin), 'Minutos en reuniones') +
        statCard('fa-language', 'bg-orange', user.learning_language || '—', 'Idioma de trabajo') +
        statCard('fa-flag', 'bg-purple', user.native_language || '—', 'Idioma nativo');

      var roomsEl = container.querySelector('#my-rooms');
      if (!mine.length) {
        roomsEl.innerHTML = '<div class="empty-state"><i class="fa-solid fa-mug-hot"></i><h3>Aún no tienes reuniones</h3><p>Crea la primera y empieza a colaborar con tu equipo.</p></div>';
      } else {
        roomsEl.innerHTML = mine.slice(0, 6).map(function (r) {
          var statusBadge = r.status === 'active'
            ? '<span class="badge-bl green">Activa</span>'
            : (r.status === 'ended' ? '<span class="badge-bl gray">Terminada</span>' : '<span class="badge-bl orange">Esperando</span>');
          var dur = r.duration_seconds ? Math.round(r.duration_seconds / 60) + ' min' : '—';
          return '<div style="display:flex; justify-content:space-between; align-items:center; padding:12px 0; border-bottom:1px solid var(--border)">' +
            '<div>' +
              '<div style="font-weight:800">Sala ' + window.UI.escapeHtml(r.room_code) + '</div>' +
              '<div class="muted" style="font-size:0.85rem">' + window.UI.escapeHtml(r.topic || 'Sin tema') + ' · ' + dur + '</div>' +
            '</div>' +
            '<div style="display:flex; gap:8px; align-items:center">' + statusBadge +
              (r.status !== 'ended' ? '<a href="#/room/' + r.room_code + '" class="btn-bl btn-blue btn-sm"><i class="fa-solid fa-door-open"></i> Entrar</a>' : '') +
            '</div>' +
          '</div>';
        }).join('');
      }
    } catch (e) {
      console.error(e);
    }

    try {
      var partners = await window.API.get('api/users/partners?online=true');
      var olEl = container.querySelector('#online-list');
      if (!partners.length) {
        olEl.innerHTML = '<div class="empty-state"><i class="fa-solid fa-users-slash"></i><h3>Nadie en línea ahora</h3><p>Vuelve más tarde o invita a un colega.</p></div>';
      } else {
        olEl.innerHTML = partners.slice(0, 6).map(function (p) {
          return '<div style="display:flex; align-items:center; gap:12px; padding:10px 0; border-bottom:1px solid var(--border)">' +
            window.UI.avatar(p.display_name, p.avatar_color, 'sm') +
            '<div style="flex:1; min-width:0">' +
              '<div style="font-weight:800">' + window.UI.escapeHtml(p.display_name) + ' <span class="online-dot online"></span></div>' +
              '<div class="muted" style="font-size:0.8rem">' + window.UI.escapeHtml(p.native_language || '?') + ' · ' + window.UI.escapeHtml(p.country || '—') + '</div>' +
            '</div>' +
          '</div>';
        }).join('');
      }
    } catch (e) {
      console.error(e);
    }
  }

  function statCard(icon, bg, value, label) {
    return '<div class="stat-card">' +
      '<div class="stat-icon ' + bg + '"><i class="fa-solid ' + icon + '"></i></div>' +
      '<div><div class="stat-value">' + window.UI.escapeHtml(String(value)) + '</div><div class="stat-label">' + window.UI.escapeHtml(label) + '</div></div>' +
    '</div>';
  }

  window.Router.register('dashboard', render);
})();
