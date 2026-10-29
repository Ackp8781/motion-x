/* "Try the effects": runs Motion X's real effect shaders (effects.js, the same file the app uses) on a
   demo frame, in the visitor's browser. The frame sits inset on the stage like a clip on a canvas, so
   glows, shadows, 3D and particles have room to show. */
(function () {
  const FX = window.AckFX;
  const stage = document.getElementById('pgCanvas');
  if (!FX || !stage) return;
  const W = 960, H = 540, K = 0.5;                    // stage = a 1920×1080 project shown at half size
  const LW = 640, LH = 360;                           // the clip on it
  const gl = stage.getContext('webgl', { premultipliedAlpha: false, alpha: true, antialias: false });
  if (!gl) { document.getElementById('pgWrap').classList.add('nogl'); return; }

  // ---- source: the demo frame, inset with rounded corners, on a transparent stage ----
  const src = document.createElement('canvas'); src.width = W; src.height = H;
  const img = new Image();
  img.onload = () => {
    const g = src.getContext('2d'), x = (W - LW) / 2, y = (H - LH) / 2;
    g.save(); g.beginPath(); g.roundRect(x, y, LW, LH, 14); g.clip(); g.drawImage(img, x, y, LW, LH); g.restore();
    dirty = true; draw();
  };
  img.src = 'assets/sample.jpg';

  // ---- tiny WebGL pipeline (the same idea as the app's) ----
  const VS = 'attribute vec2 a; void main(){ gl_Position=vec4(a,0.0,1.0); }';
  const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  function mkTex() {
    const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
    for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
    return t;
  }
  function compile(fs) {
    const sh = (type, s) => { const o = gl.createShader(type); gl.shaderSource(o, s); gl.compileShader(o); if (!gl.getShaderParameter(o, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(o)); return o; };
    const p = gl.createProgram(); gl.attachShader(p, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(p);
    const loc = {};
    return { p, a: gl.getAttribLocation(p, 'a'), u: n => (n in loc ? loc[n] : (loc[n] = gl.getUniformLocation(p, n))) };
  }
  const texIn = mkTex();
  const blit = compile('precision highp float; uniform sampler2D uTex; uniform vec2 uRes; void main(){ gl_FragColor=texture2D(uTex,vec2(gl_FragCoord.x,uRes.y-gl_FragCoord.y)/uRes); }');
  const progs = {};
  let dirty = true;
  const rgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255);
  function render(fx, t) {
    stage.width = W; stage.height = H; gl.viewport(0, 0, W, H);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, texIn);
    if (dirty) { gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src); dirty = false; }
    const d = FX.DEFS[fx.type];
    let prog = blit;
    try { prog = progs[fx.type] || (progs[fx.type] = compile(FX.fragmentSource(fx.type))); } catch (e) { console.error(e); }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.useProgram(prog.p);
    gl.uniform1i(prog.u('uTex'), 0); gl.uniform2f(prog.u('uRes'), W, H);
    if (prog !== blit) {
      gl.uniform1f(prog.u('uK'), K); gl.uniform2f(prog.u('uCenter'), W / 2, H / 2); gl.uniform2f(prog.u('uSize'), LW, LH); gl.uniform1f(prog.u('uTime'), t);
      for (const p of d.params) gl.uniform1f(prog.u('u_' + p.key), +(fx[p.key] ?? p.def));
      for (const c of d.colors) gl.uniform3f(prog.u('u_' + c.key), ...rgb(fx[c.key] || c.def));
    }
    // the effect writes straight to the screen, flipped the same way the app's final copy is
    gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.enableVertexAttribArray(prog.a); gl.vertexAttribPointer(prog.a, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
  // The shaders read the texture with row 0 at the top; draw them through a flip so the picture is upright
  stage.style.transform = 'scaleY(-1)';

  // ---- UI ----
  const SHOW = ['Light & Shadow', 'Glitch', 'Distort', 'Particles', 'Stylize', 'Color', 'Blur', '3D', 'Motion', 'Generate', 'Wipes'];
  const list = Object.values(FX.DEFS).filter(d => d.kind === 'gl' && !d.hidden && d.cat !== 'Keying');
  let cat = 'Light & Shadow', fx = FX.defaults('lensflare'), touched = new Set();
  const catsEl = document.getElementById('pgCats'), fxEl = document.getElementById('pgFx'), setEl = document.getElementById('pgSet'), nameEl = document.getElementById('pgName');
  function pick(type) {
    fx = FX.defaults(type); touched = new Set();
    nameEl.textContent = FX.DEFS[type].name + ' · ' + FX.DEFS[type].cat;
    renderFx(); renderSettings();
  }
  function renderCats() {
    catsEl.innerHTML = '';
    for (const c of SHOW) {
      const b = document.createElement('button'); b.className = 'pgc' + (c === cat ? ' on' : ''); b.textContent = c;
      b.onclick = () => { cat = c; renderCats(); renderFx(); const first = list.find(d => d.cat === c); if (first) pick(first.type); };
      catsEl.appendChild(b);
    }
  }
  function renderFx() {
    fxEl.innerHTML = '';
    for (const d of list.filter(d => d.cat === cat)) {
      const b = document.createElement('button'); b.className = 'pgf' + (d.type === fx.type ? ' on' : ''); b.textContent = d.name;
      b.onclick = () => pick(d.type);
      fxEl.appendChild(b);
    }
  }
  function renderSettings() {
    const d = FX.DEFS[fx.type]; setEl.innerHTML = '';
    for (const p of d.params.slice(0, 5)) {
      const row = document.createElement('label'); row.className = 'pgs';
      if (p.options) {
        const s = document.createElement('select');
        p.options.forEach((o, i) => { const op = document.createElement('option'); op.value = i; op.textContent = o; s.appendChild(op); });
        s.value = fx[p.key]; s.oninput = () => { fx[p.key] = +s.value; };
        row.append(Object.assign(document.createElement('span'), { textContent: p.label }), s);
      } else {
        const v = document.createElement('b'), r = document.createElement('input');
        r.type = 'range'; r.min = p.min; r.max = p.max; r.step = p.step; r.value = fx[p.key];
        // keep big ranges usable: limit position-style sliders to the visible stage
        if (/^(x|y|cx|cy)$/.test(p.key)) { r.min = -900; r.max = 900; }
        const show = () => { v.textContent = (+(+r.value).toFixed(2)).toString(); };
        r.oninput = () => { fx[p.key] = +r.value; touched.add(p.key); show(); };
        show();
        row.append(Object.assign(document.createElement('span'), { textContent: p.label }), r, v);
      }
      setEl.appendChild(row);
    }
    for (const c of d.colors.slice(0, 2)) {
      const row = document.createElement('label'); row.className = 'pgs';
      const i = document.createElement('input'); i.type = 'color'; i.value = fx[c.key]; i.oninput = () => { fx[c.key] = i.value; };
      row.append(Object.assign(document.createElement('span'), { textContent: c.label }), i);
      setEl.appendChild(row);
    }
    document.getElementById('pgReset').onclick = () => pick(fx.type);
  }

  // ---- loop: runs only while the playground is on screen ----
  let visible = false, raf = 0;
  const t0 = performance.now();
  function frame() {
    raf = 0;
    if (!visible) return;
    const t = (performance.now() - t0) / 1000;
    const cur = (FX.DEFS[fx.type].cat === 'Wipes' && !touched.has('completion')) ? { ...fx, completion: 50 - 50 * Math.cos(t * 1.2) } : fx;
    render(cur, t);
    raf = requestAnimationFrame(frame);
  }
  function draw() { if (!raf) raf = requestAnimationFrame(frame); }
  new IntersectionObserver(es => { visible = es[0].isIntersecting; if (visible) draw(); }, { rootMargin: '100px' }).observe(stage);
  renderCats(); pick('lensflare');
})();
