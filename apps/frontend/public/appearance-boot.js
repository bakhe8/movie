// Keep the guest storage key and allowed values aligned with app/lib/appearance.tsx.
// A stored session contains a user, not a resolved profile. The provider applies
// the authenticated profile preference once it is available; boot never guesses
// which profile belongs to an account or borrows a previous account's cache.
(function () {
  var appearance = 'cinema';
  try {
    var stored = localStorage.getItem('reel.appearance.v1:guest');
    if (stored === 'cinema' || stored === 'premiere' || stored === 'montage') appearance = stored;
  } catch {
    // Storage can be blocked. A visit still starts with a complete appearance.
  }
  document.documentElement.setAttribute('data-appearance', appearance);
})();
