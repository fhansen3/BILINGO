(function () {
  'use strict';

  var LANGUAGES = [
    'Spanish', 'English', 'French', 'German', 'Italian', 'Portuguese', 'Japanese',
    'Chinese', 'Korean', 'Russian', 'Arabic', 'Dutch', 'Swedish', 'Polish', 'Turkish',
    'Hindi', 'Vietnamese', 'Thai', 'Greek', 'Hebrew', 'Czech', 'Finnish', 'Danish'
  ];

  async function render(container) {
    var user = window.Auth.getUser();
    var profile;
    try { profile = await window.API.get('api/auth/me'); } catch (e) { profile = user; }

    function opts(selected) {
      return '<option value="">—</option>' + LANGUAGES.map(function (l) {
        return '<option value="' + l + '"' + (l === selected ? ' selected' : '') + '>' + l + '</option>';
      }).join('');
    }

    container.innerHTML =
      '<div class="app-shell">' +
        window.AppNav(user) +
        '<main class="main-content" style="max-width:760px">' +
          '<div class="page-header"><div><h2>Tu perfil</h2><p class="subtitle">Edita cómo te ven los demás en tus reuniones</p></div></div>' +
          '<div class="card-bl">' +
            '<div style="display:flex; gap:20px; align-items:center; margin-bottom:24px">' +
              window.UI.avatar(profile.display_name, profile.avatar_color, 'lg') +
              '<div>' +
                '<div style="font-size:1.4rem; font-weight:900">' + window.UI.escapeHtml(profile.display_name) + '</div>' +
                '<div class="muted">' + window.UI.escapeHtml(profile.email) + '</div>' +
              '</div>' +
            '</div>' +
            '<form id="profile-form">' +
              '<div class="field"><label>Nombre para mostrar</label><input name="display_name" value="' + window.UI.escapeHtml(profile.display_name) + '" required></div>' +
              '<div class="field"><label>Bio</label><textarea name="bio" placeholder="Tu rol, equipo o algo sobre ti…">' + window.UI.escapeHtml(profile.bio || '') + '</textarea></div>' +
              '<div class="field-row">' +
                '<div class="field"><label>Idioma en el que hablas</label><select name="native_language">' + opts(profile.native_language) + '</select><small class="muted">El idioma en el que escribes y hablas durante las reuniones.</small></div>' +
                '<div class="field"><label>Idioma en el que prefieres recibir</label><select name="learning_language">' + opts(profile.learning_language) + '</select><small class="muted">Cuando alguien escriba en otro idioma, lo verás traducido a este.</small></div>' +
              '</div>' +
              '<input type="hidden" name="proficiency_level" value="' + window.UI.escapeHtml(profile.proficiency_level || 'fluent') + '">' +
              '<div class="field-row">' +
                '<div class="field"><label>País</label><input name="country" value="' + window.UI.escapeHtml(profile.country || '') + '"></div>' +
                '<div class="field"><label>Empresa / Equipo</label><input name="company" value="' + window.UI.escapeHtml(profile.company || '') + '" placeholder="Opcional"></div>' +
              '</div>' +
              '<div class="field">' +
                '<label>Color de avatar</label>' +
                '<div style="display:flex; gap:10px">' +
                  ['#58CC02','#1CB0F6','#FF9600','#CE82FF','#FF4B4B','#FFC800','#2B70C9'].map(function (c) {
                    return '<button type="button" class="color-swatch" data-color="' + c + '" style="width:40px;height:40px;border-radius:50%;border:3px solid ' + (profile.avatar_color === c ? '#000' : 'transparent') + ';background:' + c + ';cursor:pointer"></button>';
                  }).join('') +
                '</div>' +
                '<input type="hidden" name="avatar_color" value="' + window.UI.escapeHtml(profile.avatar_color || '#58CC02') + '">' +
              '</div>' +
              '<button type="submit" class="btn-bl btn-green"><i class="fa-solid fa-floppy-disk"></i> Guardar cambios</button>' +
            '</form>' +
          '</div>' +
        '</main>' +
      '</div>';

    var form = container.querySelector('#profile-form');
    container.querySelectorAll('.color-swatch').forEach(function (sw) {
      sw.addEventListener('click', function () {
        form.elements.avatar_color.value = sw.dataset.color;
        container.querySelectorAll('.color-swatch').forEach(function (s) { s.style.borderColor = 'transparent'; });
        sw.style.borderColor = '#000';
      });
    });

    form.addEventListener('submit', async function (e) {
      e.preventDefault();
      var data = Object.fromEntries(new FormData(form).entries());
      try {
        await window.API.put('api/users/me', data);
        window.UI.notify('Perfil actualizado 🎉', 'success');
        await window.Auth.check();
      } catch (err) {
        window.UI.notify(err.message || 'Error al guardar', 'error');
      }
    });

    container.querySelector('#logout-btn').addEventListener('click', async function () {
      await window.Auth.logout();
      window.Router.navigate('landing');
    });
  }

  window.Router.register('profile', render);
})();
