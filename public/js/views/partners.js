(function () {
  'use strict';

  var LANGUAGES = [
    'Spanish', 'English', 'French', 'German', 'Italian', 'Portuguese', 'Japanese',
    'Chinese', 'Korean', 'Russian', 'Arabic', 'Dutch', 'Swedish', 'Polish', 'Turkish',
    'Hindi', 'Vietnamese', 'Thai', 'Greek', 'Hebrew', 'Czech', 'Finnish', 'Danish'
  ];

  async function render(container) {
    var user = window.Auth.getUser();
    container.innerHTML =
      '<div class="app-shell">' +
        window.AppNav(user) +
        '<main class="main-content">' +
          '<div class="page-header">' +
            '<div><h2>Buscar colegas</h2><p class="subtitle">Encuentra a alguien de tu equipo para invitar a una reunión</p></div>' +
          '</div>' +
          '<div class="card-bl">' +
            '<form id="filter-form" style="display:grid; grid-template-columns: 1fr 1fr auto auto; gap:12px; align-items:end">' +
              '<div class="field" style="margin:0"><label>Idioma nativo</label><select name="native"><option value="">Cualquiera</option>' +
                LANGUAGES.map(function (l) { return '<option value="' + l + '">' + l + '</option>'; }).join('') +
              '</select></div>' +
              '<div class="field" style="margin:0"><label>Otro idioma</label><select name="learning"><option value="">Cualquiera</option>' +
                LANGUAGES.map(function (l) { return '<option value="' + l + '">' + l + '</option>'; }).join('') +
              '</select></div>' +
              '<div class="field" style="margin:0"><label><input type="checkbox" name="online" value="1" style="width:auto; margin-right:6px"> Solo en línea</label></div>' +
              '<button type="submit" class="btn-bl btn-green"><i class="fa-solid fa-magnifying-glass"></i> Buscar</button>' +
            '</form>' +
          '</div>' +
          '<div id="partners-result"><p class="muted">Cargando…</p></div>' +
        '</main>' +
      '</div>';

    var form = container.querySelector('#filter-form');
    var result = container.querySelector('#partners-result');

    async function inviteFlow(partnerId, partnerName) {
      // Ask whether to invite to an existing active room or create a new one.
      var myRooms = [];
      try {
        myRooms = await window.API.get('api/rooms/mine');
      } catch (e) { /* ignore */ }
      var activeRooms = (myRooms || []).filter(function (r) {
        return r.status === 'waiting' || r.status === 'open' || r.status === 'active';
      });

      var roomCode = null;
      if (activeRooms.length) {
        // Use the most recent active one.
        roomCode = activeRooms[0].room_code;
      } else {
        // Create a new room on the fly.
        try {
          var room = await window.API.post('api/rooms', { topic: 'Reunión con ' + partnerName });
          roomCode = room.room_code;
        } catch (err) {
          window.UI.notify(err.message || 'No se pudo crear la sala', 'error');
          return;
        }
      }

      // Send the invitation.
      try {
        await window.API.post('api/rooms/' + roomCode + '/invite', {
          user_id: partnerId,
          message: 'Te invito a una reunión'
        });
        window.UI.notify('Invitación enviada a ' + partnerName, 'success');
        // Open the room so the host is ready when the invitee accepts.
        window.Router.navigate('room/' + roomCode);
      } catch (err) {
        window.UI.notify(err.message || 'No se pudo enviar la invitación', 'error');
      }
    }

    async function load() {
      result.innerHTML = '<p class="muted">Cargando…</p>';
      var fd = new FormData(form);
      var qs = [];
      if (fd.get('learning')) qs.push('learning=' + encodeURIComponent(fd.get('learning')));
      if (fd.get('native')) qs.push('native=' + encodeURIComponent(fd.get('native')));
      if (fd.get('online')) qs.push('online=true');
      try {
        var list = await window.API.get('api/users/partners' + (qs.length ? '?' + qs.join('&') : ''));
        if (!list.length) {
          result.innerHTML = '<div class="empty-state"><i class="fa-solid fa-user-slash"></i><h3>Sin resultados</h3><p>Prueba con otros filtros</p></div>';
          return;
        }
        result.innerHTML = '<div class="partner-list">' + list.map(card).join('') + '</div>';
        result.querySelectorAll('[data-invite]').forEach(function (b) {
          b.addEventListener('click', function () {
            var pid = b.getAttribute('data-invite');
            var pname = b.getAttribute('data-name') || 'tu colega';
            b.disabled = true;
            inviteFlow(pid, pname).finally(function () { b.disabled = false; });
          });
        });
      } catch (err) {
        result.innerHTML = '<div class="empty-state"><i class="fa-solid fa-circle-exclamation"></i><h3>Error</h3><p>' + window.UI.escapeHtml(err.message) + '</p></div>';
      }
    }

    function card(p) {
      return '<div class="partner-card">' +
        '<div class="partner-head">' +
          window.UI.avatar(p.display_name, p.avatar_color) +
          '<div class="partner-info">' +
            '<div class="partner-name">' + window.UI.escapeHtml(p.display_name) + ' <span class="online-dot ' + (p.is_online ? 'online' : '') + '"></span></div>' +
            '<div class="partner-meta">' + window.UI.escapeHtml(p.country || 'Sin país') + ' · ' + (p.is_online ? 'En línea' : 'Desconectado') + '</div>' +
          '</div>' +
        '</div>' +
        (p.bio ? '<div style="font-size:0.9rem; color:var(--text-soft)">' + window.UI.escapeHtml(p.bio.length > 120 ? p.bio.slice(0, 117) + '…' : p.bio) + '</div>' : '') +
        '<div class="lang-pills">' +
          (p.native_language ? '<span class="lang-pill"><i class="fa-solid fa-microphone"></i> ' + window.UI.escapeHtml(p.native_language) + '</span>' : '') +
          (p.learning_language ? '<span class="lang-pill learn"><i class="fa-solid fa-book"></i> ' + window.UI.escapeHtml(p.learning_language) + '</span>' : '') +
        '</div>' +
        '<button class="btn-bl btn-green btn-sm" data-invite="' + p.id + '" data-name="' + window.UI.escapeHtml(p.display_name) + '"><i class="fa-solid fa-video"></i> Invitar a reunión</button>' +
      '</div>';
    }

    form.addEventListener('submit', function (e) { e.preventDefault(); load(); });
    load();

    var logoutBtn = container.querySelector('#logout-btn');
    if (logoutBtn) {
      logoutBtn.addEventListener('click', async function () {
        await window.Auth.logout();
        window.Router.navigate('landing');
      });
    }
  }

  window.Router.register('partners', render);
})();
