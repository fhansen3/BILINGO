(function () {
  'use strict';

  function render(container) {
    container.innerHTML =
      '<div class="app-shell">' +
        '<nav class="navbar-bl">' +
          '<a href="#/landing" class="brand" style="text-decoration:none"><span class="parrot">🦜</span> BiLingo Meet</a>' +
          '<div class="nav-links">' +
            '<a href="#/register" class="nav-link"><i class="fa-solid fa-user-plus"></i> Crear cuenta</a>' +
          '</div>' +
        '</nav>' +
        '<div class="auth-page">' +
          '<form class="auth-card" id="login-form">' +
            '<h2>¡Bienvenido de vuelta! <span style="font-size:1.8rem">👋</span></h2>' +
            '<p class="auth-sub">Inicia sesión para seguir practicando</p>' +
            '<div class="field">' +
              '<label>Email</label>' +
              '<input type="email" name="email" required autocomplete="email" placeholder="tu@email.com">' +
            '</div>' +
            '<div class="field">' +
              '<label>Contraseña</label>' +
              '<input type="password" name="password" required autocomplete="current-password" placeholder="••••••••">' +
            '</div>' +
            '<button type="submit" class="btn-bl btn-green" style="width:100%"><i class="fa-solid fa-right-to-bracket"></i> Entrar</button>' +
            '<div class="auth-footer">¿No tienes cuenta? <a href="#/register">Regístrate gratis</a></div>' +
          '</form>' +
        '</div>' +
      '</div>';

    var form = container.querySelector('#login-form');
    form.addEventListener('submit', async function (e) {
      e.preventDefault();
      var btn = form.querySelector('button[type=submit]');
      btn.disabled = true;
      try {
        var data = new FormData(form);
        await window.Auth.login(data.get('email'), data.get('password'));
        window.UI.notify('¡Hola de nuevo! 🎉', 'success');
        window.Router.navigate('dashboard');
      } catch (err) {
        window.UI.notify(err.message || 'Error al iniciar sesión', 'error');
        btn.disabled = false;
      }
    });
  }

  window.Router.register('login', render);
})();
