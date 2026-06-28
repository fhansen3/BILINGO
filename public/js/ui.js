(function () {
  'use strict';

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function notify(message, type) {
    type = type || 'success';
    var container = document.getElementById('toast-container');
    if (!container) return;
    var icons = { success: 'fa-circle-check', error: 'fa-circle-xmark', warn: 'fa-triangle-exclamation', info: 'fa-circle-info' };
    var toast = document.createElement('div');
    toast.className = 'toast-bl ' + type;
    toast.innerHTML = '<i class="fa-solid ' + icons[type] + '"></i><span>' + escapeHtml(message) + '</span>';
    container.appendChild(toast);
    setTimeout(function () {
      toast.style.transition = 'opacity 0.25s, transform 0.25s';
      toast.style.opacity = '0';
      toast.style.transform = 'translateX(100%)';
      setTimeout(function () { toast.remove(); }, 250);
    }, 3500);
  }

  function confirm(title, body) {
    return new Promise(function (resolve) {
      var root = document.getElementById('modal-root');
      var wrap = document.createElement('div');
      wrap.className = 'modal-backdrop-bl';
      wrap.innerHTML =
        '<div class="modal-bl">' +
          '<h3>' + escapeHtml(title) + '</h3>' +
          '<div class="modal-body">' + escapeHtml(body) + '</div>' +
          '<div class="modal-actions">' +
            '<button class="btn-bl btn-outline btn-sm" data-act="no"><i class="fa-solid fa-xmark"></i> Cancelar</button>' +
            '<button class="btn-bl btn-green btn-sm" data-act="yes"><i class="fa-solid fa-check"></i> Confirmar</button>' +
          '</div>' +
        '</div>';
      function close(v) { wrap.remove(); resolve(v); }
      wrap.addEventListener('click', function (e) {
        if (e.target === wrap) close(false);
        if (e.target.closest('[data-act=yes]')) close(true);
        if (e.target.closest('[data-act=no]')) close(false);
      });
      root.appendChild(wrap);
    });
  }

  function avatar(name, color, size) {
    var letter = (name || '?').trim().charAt(0).toUpperCase();
    var cls = size === 'sm' ? 'avatar avatar-sm' : (size === 'lg' ? 'avatar avatar-lg' : 'avatar');
    return '<div class="' + cls + '" style="background:' + escapeHtml(color || '#58CC02') + '">' + escapeHtml(letter) + '</div>';
  }

  window.UI = { notify: notify, confirm: confirm, escapeHtml: escapeHtml, avatar: avatar };
})();
