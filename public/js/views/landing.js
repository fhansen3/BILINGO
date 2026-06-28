(function () {
  'use strict';

  function render(container) {
    var isAuth = !!window.Auth.getUser();

    container.innerHTML =
      '<div class="landing">' +
        '<nav class="navbar-bl" style="background: rgba(255,255,255,0.97); backdrop-filter: blur(10px); position: sticky; top:0; z-index:50">' +
          '<a href="#/landing" class="brand" style="text-decoration:none"><span class="parrot">🦜</span> BiLingo Meet</a>' +
          '<div class="nav-links">' +
            (isAuth
              ? '<a href="#/dashboard" class="btn-bl btn-green btn-sm"><i class="fa-solid fa-gauge"></i> Ir al Dashboard</a>'
              : '<a href="#/login" class="nav-link"><i class="fa-solid fa-right-to-bracket"></i> Iniciar sesión</a>' +
                '<a href="#/register" class="btn-bl btn-green btn-sm"><i class="fa-solid fa-rocket"></i> Empezar gratis</a>'
            ) +
          '</div>' +
        '</nav>' +

        // ──────────────── HERO ────────────────
        '<section class="hero">' +
          '<div class="hero-inner">' +
            '<div class="hero-text">' +
              '<div class="hero-pill"><i class="fa-solid fa-bolt"></i> Traducción en tiempo real · Sin instalación</div>' +
              '<h1>Reuniones de trabajo<br><span class="hero-accent">sin barreras de idioma</span></h1>' +
              '<p class="hero-sub">BiLingo Meet es la plataforma de videollamadas para equipos globales. Cada participante habla y escribe en <strong>su propio idioma</strong> — nosotros traducimos el chat en vivo para que todos se entiendan al instante.</p>' +
              '<div class="hero-cta">' +
                (isAuth
                  ? '<a href="#/dashboard" class="btn-bl btn-green btn-lg"><i class="fa-solid fa-video"></i> Iniciar reunión</a>'
                  : '<a href="#/register" class="btn-bl btn-green btn-lg"><i class="fa-solid fa-rocket"></i> Crear cuenta gratis</a>' +
                    '<a href="#/login" class="btn-bl btn-outline btn-lg"><i class="fa-solid fa-right-to-bracket"></i> Iniciar sesión</a>'
                ) +
              '</div>' +
              '<div class="hero-trust">' +
                '<div><i class="fa-solid fa-circle-check" style="color:var(--green)"></i> Sin tarjeta de crédito</div>' +
                '<div><i class="fa-solid fa-circle-check" style="color:var(--green)"></i> Funciona en el navegador</div>' +
                '<div><i class="fa-solid fa-circle-check" style="color:var(--green)"></i> +18 idiomas soportados</div>' +
              '</div>' +
            '</div>' +
            '<div class="hero-visual">' +
              '<div class="hero-mockup">' +
                '<div class="hero-mockup-bar"><span></span><span></span><span></span></div>' +
                '<div class="hero-mockup-body">' +
                  '<div class="mockup-msg left">' +
                    '<div class="mockup-avatar" style="background:#FF9F1C">M</div>' +
                    '<div class="mockup-bubble">' +
                      '<div class="mockup-name">María · Madrid</div>' +
                      '<div class="mockup-translated">Can we review the Q4 budget tomorrow?</div>' +
                      '<div class="mockup-original"><span class="mockup-tag">ES</span> ¿Podemos revisar el presupuesto del Q4 mañana?</div>' +
                    '</div>' +
                  '</div>' +
                  '<div class="mockup-msg right">' +
                    '<div class="mockup-bubble own">' +
                      '<div class="mockup-translated">Sure, 10 AM works for me.</div>' +
                    '</div>' +
                  '</div>' +
                  '<div class="mockup-msg left">' +
                    '<div class="mockup-avatar" style="background:#1CB0F6">K</div>' +
                    '<div class="mockup-bubble">' +
                      '<div class="mockup-name">Kenji · Tokio</div>' +
                      '<div class="mockup-translated">I will send the report before the meeting.</div>' +
                      '<div class="mockup-original"><span class="mockup-tag">JA</span> 会議の前にレポートを送ります。</div>' +
                    '</div>' +
                  '</div>' +
                '</div>' +
              '</div>' +
              '<div class="hero-float-badge">' +
                '<i class="fa-solid fa-language"></i>' +
                '<div><strong>Traducción instantánea</strong><span>ES · EN · JA · DE · FR…</span></div>' +
              '</div>' +
            '</div>' +
          '</div>' +
        '</section>' +

        // ──────────────── LOGOS / SOCIAL PROOF ────────────────
        '<section class="logos-strip">' +
          '<p>Diseñado para equipos distribuidos en</p>' +
          '<div class="logos-row">' +
            '<span><i class="fa-solid fa-globe"></i> Europa</span>' +
            '<span><i class="fa-solid fa-globe-americas"></i> América</span>' +
            '<span><i class="fa-solid fa-globe-asia"></i> Asia</span>' +
            '<span><i class="fa-solid fa-globe-africa"></i> África</span>' +
          '</div>' +
        '</section>' +

        // ──────────────── FEATURES ────────────────
        '<section class="features">' +
          '<div class="section-head">' +
            '<div class="section-eyebrow">Tu reunión, sin fricción</div>' +
            '<h2>Una sola plataforma para equipos globales</h2>' +
            '<p>Olvídate de intérpretes, subtítulos manuales o reuniones bilingües forzadas. Cada miembro de tu equipo participa en el idioma con el que es más productivo.</p>' +
          '</div>' +
          '<div class="features-grid">' +
            '<div class="feature-card">' +
              '<div class="feature-icon green"><i class="fa-solid fa-language"></i></div>' +
              '<h3>Chat traducido en vivo</h3>' +
              '<p>Escribe en español, tu colega lo lee en inglés. Cada participante elige su propio idioma — la traducción ocurre automáticamente y al instante.</p>' +
            '</div>' +
            '<div class="feature-card">' +
              '<div class="feature-icon blue"><i class="fa-solid fa-video"></i></div>' +
              '<h3>Videollamadas HD</h3>' +
              '<p>Conexión peer-to-peer (WebRTC) con audio y vídeo de alta calidad. Sin descargas, sin plugins — todo funciona en el navegador.</p>' +
            '</div>' +
            '<div class="feature-card">' +
              '<div class="feature-icon orange"><i class="fa-solid fa-link"></i></div>' +
              '<h3>Salas con un clic</h3>' +
              '<p>Crea una sala, comparte el código de 6 letras y empieza la reunión. Sin agendas complicadas ni invitaciones de calendario.</p>' +
            '</div>' +
            '<div class="feature-card">' +
              '<div class="feature-icon purple"><i class="fa-solid fa-shield-halved"></i></div>' +
              '<h3>Privado y seguro</h3>' +
              '<p>Tus reuniones son tuyas. Audio y vídeo se transmiten cifrados de punto a punto entre los participantes.</p>' +
            '</div>' +
            '<div class="feature-card">' +
              '<div class="feature-icon yellow"><i class="fa-solid fa-clock-rotate-left"></i></div>' +
              '<h3>Historial guardado</h3>' +
              '<p>El chat traducido queda registrado en cada sala. Revisa decisiones, acuerdos y enlaces compartidos cuando los necesites.</p>' +
            '</div>' +
            '<div class="feature-card">' +
              '<div class="feature-icon red"><i class="fa-solid fa-earth-americas"></i></div>' +
              '<h3>+18 idiomas</h3>' +
              '<p>Español, inglés, francés, alemán, italiano, portugués, japonés, chino, coreano, árabe, ruso y más. Tu equipo, sin fronteras.</p>' +
            '</div>' +
          '</div>' +
        '</section>' +

        // ──────────────── HOW IT WORKS ────────────────
        '<section class="how-section">' +
          '<div class="section-head">' +
            '<div class="section-eyebrow">Cómo funciona</div>' +
            '<h2>De cero a reunión multilingüe en 60 segundos</h2>' +
          '</div>' +
          '<div class="steps-grid">' +
            '<div class="step-card">' +
              '<div class="step-num">1</div>' +
              '<h3><i class="fa-solid fa-user-plus"></i> Crea tu cuenta</h3>' +
              '<p>Regístrate gratis con tu correo. Sin tarjeta de crédito, sin instalaciones.</p>' +
            '</div>' +
            '<div class="step-card">' +
              '<div class="step-num">2</div>' +
              '<h3><i class="fa-solid fa-door-open"></i> Crea una sala</h3>' +
              '<p>Un clic genera un código único. Compártelo con tu equipo por chat, correo o donde sea.</p>' +
            '</div>' +
            '<div class="step-card">' +
              '<div class="step-num">3</div>' +
              '<h3><i class="fa-solid fa-language"></i> Elige tu idioma</h3>' +
              '<p>Al entrar, indicas en qué idioma escribes y en cuál quieres leer. Cada uno configura el suyo.</p>' +
            '</div>' +
            '<div class="step-card">' +
              '<div class="step-num">4</div>' +
              '<h3><i class="fa-solid fa-comments"></i> Trabajen juntos</h3>' +
              '<p>Video, voz y chat traducido en tiempo real. El idioma deja de ser una barrera.</p>' +
            '</div>' +
          '</div>' +
        '</section>' +

        // ──────────────── USE CASES ────────────────
        '<section class="usecases">' +
          '<div class="section-head">' +
            '<div class="section-eyebrow">Casos de uso</div>' +
            '<h2>Para cada reunión que cruza fronteras</h2>' +
          '</div>' +
          '<div class="usecases-grid">' +
            '<div class="usecase-card">' +
              '<i class="fa-solid fa-handshake usecase-ic"></i>' +
              '<h3>Reuniones de cliente</h3>' +
              '<p>Atiende a clientes internacionales en su idioma sin contratar intérpretes.</p>' +
            '</div>' +
            '<div class="usecase-card">' +
              '<i class="fa-solid fa-people-group usecase-ic"></i>' +
              '<h3>Equipos distribuidos</h3>' +
              '<p>Standups, planning y retros con tu equipo global, sin que nadie pierda contexto.</p>' +
            '</div>' +
            '<div class="usecase-card">' +
              '<i class="fa-solid fa-briefcase usecase-ic"></i>' +
              '<h3>Negociaciones</h3>' +
              '<p>Discute contratos y acuerdos con la precisión de leerlo todo escrito y traducido.</p>' +
            '</div>' +
            '<div class="usecase-card">' +
              '<i class="fa-solid fa-graduation-cap usecase-ic"></i>' +
              '<h3>Onboarding & formación</h3>' +
              '<p>Forma a nuevos miembros de tu equipo aunque hablen distintos idiomas que el resto.</p>' +
            '</div>' +
          '</div>' +
        '</section>' +

        // ──────────────── CTA ────────────────
        '<section class="cta-section">' +
          '<div class="cta-card">' +
            '<h2>El idioma ya no es una barrera</h2>' +
            '<p>Únete a los equipos que ya trabajan sin fronteras lingüísticas.</p>' +
            (isAuth
              ? '<a href="#/dashboard" class="btn-bl btn-green btn-lg"><i class="fa-solid fa-video"></i> Ir a mis reuniones</a>'
              : '<a href="#/register" class="btn-bl btn-green btn-lg"><i class="fa-solid fa-rocket"></i> Empezar gratis ahora</a>'
            ) +
          '</div>' +
        '</section>' +

        // ──────────────── FOOTER ────────────────
        '<footer class="landing-footer">' +
          '<div class="footer-inner">' +
            '<div class="brand"><span class="parrot">🦜</span> BiLingo Meet</div>' +
            '<p class="muted">Reuniones de trabajo sin barreras de idioma · © ' + new Date().getFullYear() + '</p>' +
          '</div>' +
        '</footer>' +
      '</div>';
  }

  window.Router.register('landing', render);
})();
