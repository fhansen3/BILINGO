(function () {
  'use strict';

  // NOTE: este archivo era el formulario de registro de la SPA antigua, que pedía
  // dos idiomas (nativo + "de trabajo") y NO pedía código de empresa. El flujo
  // de registro vigente vive en el formulario server-rendered en views/signup.ejs
  // — pide solo el idioma nativo y el código de empresa, hace al primer usuario
  // de una empresa nueva company_admin con 500 créditos de bienvenida, y si el
  // código ya existe muestra el email del admin de esa empresa para que el
  // usuario solicite el alta.
  //
  // Por compatibilidad con cualquier link/bookmark que aún apunte a #/register,
  // este módulo simplemente redirige al formulario real.

  function render(container) {
    container.innerHTML =
      '<div class="auth-page" style="text-align:center;padding:3rem 1rem">' +
        '<div class="auth-card" style="max-width:420px;margin:0 auto">' +
          '<h2><span style="font-size:1.6rem">🦜</span> Crear cuenta</h2>' +
          '<p class="auth-sub" style="margin:.5rem 0 1.25rem">Te llevamos al formulario de registro…</p>' +
          '<a href="signup" class="btn-bl btn-green" style="display:inline-block">' +
            '<i class="fa-solid fa-user-plus"></i> Ir al registro' +
          '</a>' +
        '</div>' +
      '</div>';

    // Redirección inmediata por JS (sin leading slash → respeta el proxy).
    setTimeout(function () {
      try { window.location.assign('signup'); } catch (_) {}
    }, 50);
  }

  if (window.Router && typeof window.Router.register === 'function') {
    window.Router.register('register', render);
  }
})();
