// Shared by every Millennium Arena mockup: card image URLs, the Eye glyph, themes, stage scaling.

const SMALL = id => `https://images.ygoprodeck.com/images/cards_small/${id}.jpg`;
const BIG = id => `https://images.ygoprodeck.com/images/cards/${id}.jpg`;
const CROP = id => `https://images.ygoprodeck.com/images/cards_cropped/${id}.jpg`;

const EYE = `<svg viewBox="0 0 100 64" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round">
  <path d="M8 14 Q50 -2 92 12"/><path d="M6 30 Q50 4 94 30 Q50 50 6 30Z"/>
  <circle cx="50" cy="28" r="9" fill="currentColor" stroke="none"/>
  <path d="M38 44 L32 60"/><path d="M56 44 Q60 58 72 58 Q82 56 80 48 Q78 42 72 46"/></svg>`;

const DEFAULT_THEME = 'c';   // Arena
const THEMES = [
  {k:'c', name:'Arena', desc:'The default. Graphite HUD: clean, competitive, clear.'},
  {k:'a', name:'Pharaoh', desc:'Obsidian and gold. Ornate, ceremonial, ancient.'},
  {k:'b', name:'Hologram', desc:'Electric cyan projections. Futuristic duel tech.'},
  {k:'d', name:'Shadow Game', desc:'Violet mist and ancient dark magic.'},
];

// The real site saves the theme to the account; the mockup keeps it in this browser.
function getTheme(){
  try { const t = localStorage.getItem('ma-theme'); if (THEMES.some(x => x.k === t)) return t; } catch (e) {}
  return DEFAULT_THEME;
}
function applyTheme(k){
  document.body.dataset.dir = k;
  try { localStorage.setItem('ma-theme', k); } catch (e) {}
  document.querySelectorAll('[data-theme-btn]').forEach(b => b.classList.toggle('on', b.dataset.themeBtn === k));
  document.dispatchEvent(new CustomEvent('themechange', {detail: k}));
}

// Mockup toolbar: quick theme preview (on the real site this lives in Settings)
function themeButtons(){
  const box = document.getElementById('themeBtns');
  if (!box) return;
  box.innerHTML = THEMES.map(t => `<button data-theme-btn="${t.k}">${t.name}</button>`).join('');
  box.querySelectorAll('button').forEach(b => b.onclick = () => applyTheme(b.dataset.themeBtn));
}

function fillMotes(el, n = 40){
  for (let i = 0; i < n; i++) {
    const s = document.createElement('i');
    s.style.left = (10 + Math.random()*80) + '%';
    s.style.top = (30 + Math.random()*65) + '%';
    s.style.animationDuration = (6 + Math.random()*8) + 's';
    s.style.animationDelay = (-Math.random()*14) + 's';
    el.appendChild(s);
  }
}

// ?embed shows a page without the mockup toolbar (the Welcome page shows the duel screen this way)
const EMBED = new URLSearchParams(location.search).has('embed');
function fitStage(){
  const s = Math.min(innerWidth/1600, (innerHeight - (EMBED ? 0 : 52))/900);
  document.getElementById('scaler').style.transform = `translate(-50%,-50%) scale(${s})`;
}
addEventListener('resize', fitStage);

document.addEventListener('DOMContentLoaded', () => {
  if (EMBED) document.body.classList.add('embed');
  themeButtons();
  applyTheme(getTheme());
  document.querySelectorAll('.eye').forEach(e => e.innerHTML = EYE);
  fitStage();
});
