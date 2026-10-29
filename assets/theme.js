// Runs before the page paints: apply the theme the visitor picked last time (otherwise the system's)
try { const t = localStorage.getItem('mx-theme'); if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t; } catch (e) {}
