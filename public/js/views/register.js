(function () {
  'use strict';

  var LANGUAGES = [
    'Spanish', 'English', 'French', 'German', 'Italian', 'Portuguese', 'Japanese',
    'Chinese', 'Korean', 'Russian', 'Arabic', 'Dutch', 'Swedish', 'Polish', 'Turkish',
    'Hindi', 'Vietnamese', 'Thai', 'Greek', 'Hebrew', 'Czech', 'Finnish', 'Danish'
  ];

  function langOptions() {
    return '<option value="">Selecciona…</option>' +
      LANGUAGES.map(function (l) { return '<option value="' + l + '">' + l + '</option>'; }).join('');
  }

  function render(container) {
    container.innerHTML =
      '<div class="app-shell">' +
        '<nav class="navbar-bl">' +
          '<a href="#/landing" class="brand" style="text-decoration:none"><span class="parrot">🦜</span> BiLingo Meet</a>' +
          '<div class="nav-links">' +
            '<a href="#/login" class="nav-link"><i class="fa-solid fa-right-to-bracket"></i> Iniciar sesión</a>' +
          '</div>' +
        '</nav>' +
        '<div class="auth-page">' +
          '<form class="auth-card" id="reg-form" style="max-width:520px">' +
            '<h2>Únete a BiLingo Meet <span style="font-size:1.8rem">🎉</span></h2>' +
            '<p class="auth-sub">Reuniones sin barreras de idioma para tu equipo internacional</p>' +
            '<div class="field">' +
              '<label>Nombre para mostrar</label>' +
              '<input type="text" name="displayName" required maxlength="100" placeholder="Cómo te llaman">' +
            '</div>' +
            '<div class="field">' +
              '<label>Email</label>' +
              '<input type="email" name="email" required placeholder="tu@email.com">' +
            '</div>' +
            '<div class="field">' +
              '<label>Contraseña</label>' +
              '<input type="password" name="password" required minlength="6" placeholder="Mínimo 6 caracteres">' +
            '</div>' +
            '<div class="field-row">' +
              '<div class="field">' +
                '<label>Tu idioma nativo</label>' +
                '<select name="nativeLanguage">' + langOptions() + '</select>' +
              '</div>' +
              '<div class="field">' +
                '<label>Idioma de trabajo</label>' +
                '<select name="learningLanguage">' + langOptions() + '</select>' +
              '</div>' +
            '</div>' +
            '<div class="field">' +
              '<label>País</label>' +
              '<input type="text" name="country" maxlength="80" placeholder="Ej: España, México, Argentina…">' +
            '</div>' +
            '<button type="submit" class="btn-bl btn-green" style="width:100%"><i class="fa-solid fa-user-plus"></i> Crear cuenta</button>' +
            '<div class="auth-footer">¿Ya tienes cuenta? <a href="#/login">Inicia sesión</a></div>' +
          '</form>' +
        '</div>' +
      '</div>';

    var form = container.querySelector('#reg-form');
    form.addEventListener('submit', async function (e) {
      e.preventDefault();
      var btn = form.querySelector('button[type=submit]');
      btn.disabled = true;
      var d = new FormData(form);
      try {
        await window.Auth.register({
          email: d.get('email'),
          password: d.get('password'),
          displayName: d.get('displayName'),
          nativeLanguage: d.get('nativeLanguage'),
          learningLanguage: d.get('learningLanguage'),
          country: d.get('country')
        });
        window.UI.notify('¡Bienvenido a BiLingo Meet! 🦜', 'success');
        window.Router.navigate('dashboard');
      } catch (err) {
        window.UI.notify(err.message || 'Error al registrarte', 'error');
        btn.disabled = false;
      }
    });
  }

  window.Router.register('register', render);
})();
