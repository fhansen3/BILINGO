(function () {
  'use strict';

  async function render(container) {
    var user = window.Auth.getUser();
    container.innerHTML =
      '<div class="app-shell">' +
        window.AppNav(user) +
        '<main class="main-content">' +
          '<div class="page-header">' +
            '<div><h2><i class="fa-solid fa-shield-halved" style="color:var(--red)"></i> Panel de administración</h2><p class="subtitle">Gestiona usuarios, salas y reportes</p></div>' +
          '</div>' +
          '<div class="stats-row" id="admin-stats"></div>' +
          '<div class="tabs-bl">' +
            '<button class="tab-bl active" data-tab="users"><i class="fa-solid fa-users"></i> Usuarios</button>' +
            '<button class="tab-bl" data-tab="rooms"><i class="fa-solid fa-video"></i> Salas</button>' +
            '<button class="tab-bl" data-tab="reports"><i class="fa-solid fa-flag"></i> Reportes</button>' +
          '</div>' +
          '<div id="admin-content"><p class="muted">Cargando…</p></div>' +
        '</main>' +
      '</div>';

    var statsEl = container.querySelector('#admin-stats');
    var contentEl = container.querySelector('#admin-content');

    try {
      var stats = await window.API.get('api/admin/stats');
      statsEl.innerHTML =
        statCard('fa-users', 'bg-green', stats.totalUsers, 'Usuarios totales') +
        statCard('fa-circle-dot', 'bg-blue', stats.onlineUsers, 'En línea ahora') +
        statCard('fa-video', 'bg-orange', stats.activeRooms, 'Salas activas') +
        statCard('fa-clock', 'bg-purple', stats.totalMinutes, 'Minutos practicados') +
        statCard('fa-comments', 'bg-yellow', stats.totalMessages, 'Mensajes enviados') +
        statCard('fa-flag', 'bg-red', stats.pendingReports, 'Reportes pendientes');
    } catch (e) { console.error(e); }

    container.querySelectorAll('.tab-bl').forEach(function (t) {
      t.addEventListener('click', function () {
        container.querySelectorAll('.tab-bl').forEach(function (x) { x.classList.remove('active'); });
        t.classList.add('active');
        load(t.dataset.tab);
      });
    });

    async function load(tab) {
      contentEl.innerHTML = '<p class="muted">Cargando…</p>';
      try {
        if (tab === 'users') return renderUsers(await window.API.get('api/admin/users'));
        if (tab === 'rooms') return renderRooms(await window.API.get('api/admin/rooms'));
        if (tab === 'reports') return renderReports(await window.API.get('api/admin/reports'));
      } catch (err) {
        contentEl.innerHTML = '<div class="empty-state"><i class="fa-solid fa-circle-exclamation"></i><h3>Error</h3><p>' + window.UI.escapeHtml(err.message) + '</p></div>';
      }
    }

    function renderUsers(users) {
      if (!users.length) return contentEl.innerHTML = empty('users', 'Sin usuarios');
      contentEl.innerHTML = '<table class="table-bl"><thead><tr>' +
        '<th>Usuario</th><th>Email</th><th>Rol</th><th>Estado</th><th>Online</th><th>Idiomas</th><th>Acciones</th>' +
        '</tr></thead><tbody>' +
        users.map(function (u) {
          var statusBadge = u.status === 'active' ? 'green' : (u.status === 'banned' ? 'red' : 'orange');
          return '<tr>' +
            '<td><strong>' + window.UI.escapeHtml(u.display_name) + '</strong></td>' +
            '<td>' + window.UI.escapeHtml(u.email) + '</td>' +
            '<td>' + (u.role === 'admin' ? '<span class="badge-bl blue">Admin</span>' : '<span class="badge-bl gray">User</span>') + '</td>' +
            '<td><span class="badge-bl ' + statusBadge + '">' + u.status + '</span></td>' +
            '<td>' + (u.is_online ? '<span class="online-dot online"></span>' : '<span class="online-dot"></span>') + '</td>' +
            '<td style="font-size:0.85rem">' + window.UI.escapeHtml(u.native_language || '?') + ' → ' + window.UI.escapeHtml(u.learning_language || '?') + '</td>' +
            '<td>' +
              (u.status !== 'banned'
                ? '<button class="btn-bl btn-red btn-sm" data-ban="' + u.id + '"><i class="fa-solid fa-ban"></i> Banear</button>'
                : '<button class="btn-bl btn-green btn-sm" data-activate="' + u.id + '"><i class="fa-solid fa-check"></i> Activar</button>'
              ) +
            '</td>' +
          '</tr>';
        }).join('') +
        '</tbody></table>';

      contentEl.querySelectorAll('[data-ban]').forEach(function (b) {
        b.addEventListener('click', async function () {
          if (!await window.UI.confirm('Banear usuario', '¿Confirmas que quieres banear a este usuario?')) return;
          try {
            await window.API.put('api/admin/users/' + b.dataset.ban + '/status', { status: 'banned' });
            window.UI.notify('Usuario baneado', 'success');
            load('users');
          } catch (err) { window.UI.notify(err.message, 'error'); }
        });
      });
      contentEl.querySelectorAll('[data-activate]').forEach(function (b) {
        b.addEventListener('click', async function () {
          try {
            await window.API.put('api/admin/users/' + b.dataset.activate + '/status', { status: 'active' });
            window.UI.notify('Usuario activado', 'success');
            load('users');
          } catch (err) { window.UI.notify(err.message, 'error'); }
        });
      });
    }

    function renderRooms(rooms) {
      if (!rooms.length) return contentEl.innerHTML = empty('video', 'Sin salas');
      contentEl.innerHTML = '<table class="table-bl"><thead><tr>' +
        '<th>Código</th><th>Anfitrión</th><th>Invitado</th><th>Tema</th><th>Estado</th><th>Duración</th><th>Creada</th>' +
        '</tr></thead><tbody>' +
        rooms.map(function (r) {
          var statusBadge = r.status === 'active' ? 'green' : (r.status === 'ended' ? 'gray' : 'orange');
          var dur = r.duration_seconds ? Math.round(r.duration_seconds / 60) + ' min' : '—';
          return '<tr>' +
            '<td><strong>' + window.UI.escapeHtml(r.room_code) + '</strong></td>' +
            '<td>' + window.UI.escapeHtml(r.host_name || '—') + '</td>' +
            '<td>' + window.UI.escapeHtml(r.guest_name || '—') + '</td>' +
            '<td>' + window.UI.escapeHtml(r.topic || '—') + '</td>' +
            '<td><span class="badge-bl ' + statusBadge + '">' + r.status + '</span></td>' +
            '<td>' + dur + '</td>' +
            '<td style="font-size:0.85rem">' + new Date(r.created_at).toLocaleString() + '</td>' +
          '</tr>';
        }).join('') +
        '</tbody></table>';
    }

    function renderReports(reports) {
      if (!reports.length) return contentEl.innerHTML = empty('flag', 'Sin reportes');
      contentEl.innerHTML = '<table class="table-bl"><thead><tr>' +
        '<th>Reportante</th><th>Reportado</th><th>Razón</th><th>Detalles</th><th>Estado</th><th>Fecha</th><th>Acciones</th>' +
        '</tr></thead><tbody>' +
        reports.map(function (r) {
          var statusBadge = r.status === 'pending' ? 'orange' : (r.status === 'resolved' ? 'green' : (r.status === 'dismissed' ? 'gray' : 'blue'));
          return '<tr>' +
            '<td>' + window.UI.escapeHtml(r.reporter_name) + '</td>' +
            '<td><strong>' + window.UI.escapeHtml(r.reported_name) + '</strong><br><small class="muted">' + window.UI.escapeHtml(r.reported_email) + '</small></td>' +
            '<td>' + window.UI.escapeHtml(r.reason) + '</td>' +
            '<td style="max-width:240px; font-size:0.85rem">' + window.UI.escapeHtml(r.details || '—') + '</td>' +
            '<td><span class="badge-bl ' + statusBadge + '">' + r.status + '</span></td>' +
            '<td style="font-size:0.85rem">' + new Date(r.created_at).toLocaleString() + '</td>' +
            '<td>' +
              '<button class="btn-bl btn-green btn-sm" data-resolve="' + r.id + '"><i class="fa-solid fa-check"></i></button> ' +
              '<button class="btn-bl btn-outline btn-sm" data-dismiss="' + r.id + '"><i class="fa-solid fa-xmark"></i></button>' +
            '</td>' +
          '</tr>';
        }).join('') +
        '</tbody></table>';

      contentEl.querySelectorAll('[data-resolve]').forEach(function (b) {
        b.addEventListener('click', async function () {
          await window.API.put('api/admin/reports/' + b.dataset.resolve, { status: 'resolved' });
          window.UI.notify('Reporte resuelto', 'success'); load('reports');
        });
      });
      contentEl.querySelectorAll('[data-dismiss]').forEach(function (b) {
        b.addEventListener('click', async function () {
          await window.API.put('api/admin/reports/' + b.dataset.dismiss, { status: 'dismissed' });
          window.UI.notify('Reporte descartado', 'info'); load('reports');
        });
      });
    }

    function empty(icon, text) {
      return '<div class="empty-state"><i class="fa-solid fa-' + icon + '"></i><h3>' + window.UI.escapeHtml(text) + '</h3></div>';
    }

    function statCard(icon, bg, value, label) {
      return '<div class="stat-card">' +
        '<div class="stat-icon ' + bg + '"><i class="fa-solid ' + icon + '"></i></div>' +
        '<div><div class="stat-value">' + window.UI.escapeHtml(String(value)) + '</div><div class="stat-label">' + window.UI.escapeHtml(label) + '</div></div>' +
      '</div>';
    }

    load('users');

    container.querySelector('#logout-btn').addEventListener('click', async function () {
      await window.Auth.logout();
      window.Router.navigate('landing');
    });
  }

  window.Router.register('admin', render);
})();
