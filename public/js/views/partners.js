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
            '<div><h2>Buscar compañeros</h2><p class="subtitle">Encuentra a alguien con quien practicar</p></div>' +
          '</div>' +
          '<div class="card-bl">' +
            '<form id="filter-form" style="display:grid; grid-template-columns: 1fr 1fr auto auto; gap:12px; align-items:end">' +
              '<div class="field" style="margin:0"><label>Habla mi idioma</label><select name="learning"><option value="">Cualquiera</option>' +
                LANGUAGES.map(function (l) { return '<option value="' + l + '"' + (user.native_language === l ? ' selected' : '') + '>' + l + '</option>'; }).join('') +
              '</select></div>' +
              '<div class="field" style="margin:0"><label>Aprende mi idioma</label><select name="native"><option value="">Cualquiera</option>' +
                LANGUAGES.map(function (l) { return '<option value="' + l + '"' + (user.learning_language === l ? ' selected' : '') + '>' + l + '</option>'; }).join('') +
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
          b.addEventListener('click', async function () {
            try {
              var room = await window.API.post('api/rooms', { topic: 'Invitación directa' });
              await navigator.clipboard.writeText(window.location.origin + window.location.pathname + '#/room/' + room.room_code).catch(function(){});
              window.UI.notify('Sala creada · código ' + room.room_code + ' copiado', 'success');
              window.Router.navigate('room/' + room.room_code);
            } catch (err) {
              window.UI.notify(err.message || 'Error', 'error');
            }
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
        '<button class="btn-bl btn-green btn-sm" data-invite="' + p.id + '"><i class="fa-solid fa-video"></i> Invitar a sala</button>' +
      '</div>';
    }

    form.addEventListener('submit', function (e) { e.preventDefault(); load(); });
    load();

    container.querySelector('#logout-btn').addEventListener('click', async function () {
      await window.Auth.logout();
      window.Router.navigate('landing');
    });
  }

  window.Router.register('partners', render);
})();
