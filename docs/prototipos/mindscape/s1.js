
  (function () {
    var sections = Array.prototype.slice.call(document.querySelectorAll('.proto-variant'));
    var keys = sections.map(function (s) { return s.dataset.variant; });
    var label = document.querySelector('[data-proto-label]');
    var current = 0;

    function show(i) {
      current = (i + keys.length) % keys.length;
      sections.forEach(function (s, j) { s.classList.toggle('proto-active', j === current); });
      var name = sections[current].dataset.name || '';
      label.textContent = keys[current] + (name ? ' — ' + name : '');
      location.hash = keys[current];
      window.scrollTo(0, 0);
    }

    document.querySelector('[data-proto-prev]').addEventListener('click', function () { show(current - 1); });
    document.querySelector('[data-proto-next]').addEventListener('click', function () { show(current + 1); });

    document.addEventListener('keydown', function (e) {
      var t = e.target;
      if (t.matches && t.matches('input, textarea, select') || t.isContentEditable) return;
      if (e.key === 'ArrowLeft') show(current - 1);
      if (e.key === 'ArrowRight') show(current + 1);
    });

    var fromHash = keys.indexOf(location.hash.replace('#', ''));
    show(fromHash >= 0 ? fromHash : 0);
  })();
