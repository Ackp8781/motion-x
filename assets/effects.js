/* Effect catalogue: categories, settings and GPU shaders.
   Loaded by the page (window.AckFX) for the library, settings panel and rendering, and by main.js
   (require) to validate saved settings. 'css' effects are drawn with CSS filters / ffmpeg (see color.js
   and lookFilters in main.js); 'gl' effects run as WebGL fragment shaders in frame space, and layers
   that use them are rendered by the page for both the preview and the export, so they always match.

   Shader conventions: p = pixel position (render px, origin top-left), c = layer colour at p (straight
   alpha), C = layer centre, uSize = layer size, uK = render px per project px (multiply px settings by
   uK), uTime = seconds since the layer starts. Each shader sets `o`. Settings arrive as u_<key>. */
(function (root) {
  const CATEGORIES = ['Blur', 'Color', 'Light & Shadow', 'Distort', 'Stylize', 'Glitch', 'Generate', 'Particles', '3D', 'Motion', 'Wipes', 'Keying'];

  const N = (key, label, min, max, step, def) => ({ key, label, min, max, step, def });
  const O = (key, label, options, def = 0) => ({ key, label, options, def, min: 0, max: options.length - 1, step: 1 });
  const COL = (key, label, def) => ({ key, label, def });
  const GEN = [N('blend', 'Blend %', 0, 100, 1, 100), O('cover', 'Fill', ['Layer shape', 'Whole frame'])];
  const COVER = O('cover', 'Draw on', ['Layer only', 'Whole frame']);
  const DONE = N('completion', 'Completion %', 0, 100, 1, 50);
  const FEATHER = N('feather', 'Feather %', 0, 100, 1, 5);

  const HEADER = `precision highp float;
uniform sampler2D uTex; uniform vec2 uRes; uniform float uK; uniform vec2 uCenter; uniform vec2 uSize; uniform float uTime;
#define PI 3.14159265
vec4 tex(vec2 q){ if(q.x<0.0||q.y<0.0||q.x>uRes.x||q.y>uRes.y) return vec4(0.0); return texture2D(uTex,q/uRes); }
vec4 pm(vec4 c){ return vec4(c.rgb*c.a,c.a); }
vec4 unpm(vec4 c){ return c.a>0.0001 ? vec4(c.rgb/c.a,c.a) : vec4(0.0); }
float lum(vec3 c){ return dot(c,vec3(0.2126,0.7152,0.0722)); }
float hash(vec2 q){ return fract(sin(dot(q,vec2(127.1,311.7)))*43758.5453); }
float noise(vec2 q){ vec2 i=floor(q),f=fract(q); f=f*f*(3.0-2.0*f);
  return mix(mix(hash(i),hash(i+vec2(1.0,0.0)),f.x),mix(hash(i+vec2(0.0,1.0)),hash(i+vec2(1.0,1.0)),f.x),f.y); }
float fbm(vec2 q,float oct){ float v=0.0,a=0.5; for(int i=0;i<8;i++){ if(float(i)>=oct) break; v+=a*noise(q); q*=2.0; a*=0.5; } return v; }
mat2 rot(float a){ float c=cos(a),s=sin(a); return mat2(c,s,-s,c); }
vec4 over(vec4 f,vec4 b){ float a=f.a+b.a*(1.0-f.a); return a>0.0001 ? vec4((f.rgb*f.a+b.rgb*b.a*(1.0-f.a))/a,a) : vec4(0.0); }
vec4 genMix(vec4 c,vec3 g,float blend,float cover){ float b=blend/100.0; if(cover>0.5) return vec4(mix(c.rgb,g,b),mix(c.a,1.0,b)); return vec4(mix(c.rgb,g,b),c.a); }
float maxSide(){ return max(uSize.x,uSize.y); }
vec4 split3(vec4 r,vec4 g,vec4 b){ float a=max(max(r.a,g.a),b.a); return a>0.0001 ? vec4(r.r*r.a/a,g.g*g.a/a,b.b*b.a/a,a) : vec4(0.0); }
float L(vec2 q){ vec4 s=tex(q); return lum(s.rgb)*s.a; }
float sobel(vec2 q,float k){
  float tl=L(q+vec2(-k,-k)),t=L(q+vec2(0.0,-k)),tr=L(q+vec2(k,-k)),l=L(q+vec2(-k,0.0)),r=L(q+vec2(k,0.0)),bl=L(q+vec2(-k,k)),b=L(q+vec2(0.0,k)),br=L(q+vec2(k,k));
  return length(vec2(-tl-2.0*l-bl+tr+2.0*r+br,-tl-2.0*t-tr+bl+2.0*b+br)); }
vec3 hueRot(vec3 col,float a){ float cs=cos(a),sn=sin(a);
  mat3 m=mat3(0.213+cs*0.787-sn*0.213,0.213-cs*0.213+sn*0.143,0.213-cs*0.213-sn*0.787,
              0.715-cs*0.715-sn*0.715,0.715+cs*0.285+sn*0.140,0.715-cs*0.715+sn*0.715,
              0.072-cs*0.072+sn*0.928,0.072-cs*0.072-sn*0.283,0.072+cs*0.928+sn*0.072);
  return clamp(m*col,0.0,1.0); }
vec3 yuv(vec3 c){ return vec3(lum(c),-0.1146*c.r-0.3854*c.g+0.5*c.b,0.5*c.r-0.4542*c.g-0.0458*c.b); }
// Add light g on top of c; the result's alpha grows where the light is bright (so glows reach past the shape)
vec4 addLight(vec4 c,vec3 g){ vec4 q=pm(c); float al=clamp(max(q.a,lum(g)),0.0,1.0); return unpm(vec4(min(q.rgb+g,vec3(al)),al)); }
// Particles/overlays of colour col and coverage a: over the layer only, or over the whole frame
vec4 overlay(vec4 c,vec3 col,float a,float cover){ a=clamp(a,0.0,1.0); return cover>0.5 ? over(vec4(col,a),c) : vec4(mix(c.rgb,col,a),c.a); }
// Wipe helper: 0..1 visible amount where x (0..1) runs across the wipe, k = completion 0..1, f = feather 0..1
float wipe(float x,float k,float f){ f=max(f,0.0001); float e=k*(1.0+f); return smoothstep(e-f,e,x); }
float bayer2(vec2 a){ return 2.0*a.x*(1.0-a.y)+3.0*a.y*(1.0-a.x)+a.x*a.y; }
// Signed distances for mask shapes (negative inside), after Inigo Quilez; y points up in these
float sdHeart(vec2 p){ p.x=abs(p.x); if(p.y+p.x>1.0) return length(p-vec2(0.25,0.75))-0.35355;
  vec2 a=p-vec2(0.0,1.0), b=p-0.5*max(p.x+p.y,0.0); return sqrt(min(dot(a,a),dot(b,b)))*sign(p.x-p.y); }
float sdStar5(vec2 p,float r,float rf){ vec2 k1=vec2(0.809016994375,-0.587785252292), k2=vec2(-k1.x,k1.y);
  p.x=abs(p.x); p-=2.0*max(dot(k1,p),0.0)*k1; p-=2.0*max(dot(k2,p),0.0)*k2; p.x=abs(p.x); p.y-=r;
  vec2 ba=rf*vec2(-k1.y,k1.x)-vec2(0.0,1.0); float h=clamp(dot(p,ba)/dot(ba,ba),0.0,r); return length(p-ba*h)*sign(p.y*ba.x-p.x*ba.y); }
`;
  const MASK_SHAPES = ['line', 'mirror', 'circle', 'rect', 'heart', 'star'];

  const DEFS = {
    // ---------- CSS effects (classic filters; exported with ffmpeg) ----------
    blur: { name: 'Gaussian Blur', cat: 'Blur', kind: 'css' },
    glow: { name: 'Glow', cat: 'Light & Shadow', kind: 'css' },
    shadow: { name: 'Drop Shadow', cat: 'Light & Shadow', kind: 'css' },
    outline: { name: 'Outline', cat: 'Light & Shadow', kind: 'css' },
    bw: { name: 'Black & White', cat: 'Color', kind: 'css' },
    sepia: { name: 'Sepia', cat: 'Color', kind: 'css' },
    invert: { name: 'Invert', cat: 'Color', kind: 'css' },

    // ---------- Blur ----------
    dirblur: { name: 'Directional Blur', cat: 'Blur', params: [N('angle', 'Angle°', -180, 180, 1, 0), N('length', 'Length', 0, 300, 1, 30)],
      glsl: `vec2 d=vec2(cos(radians(u_angle)),sin(radians(u_angle)))*u_length*uK; vec4 a=vec4(0.0);
        for(int i=0;i<40;i++){ a+=pm(tex(p+d*(float(i)/39.0-0.5))); } o=unpm(a/40.0);` },
    zoomblur: { name: 'Zoom Blur', cat: 'Blur', params: [N('amount', 'Amount %', 0, 100, 1, 30), N('cx', 'Centre X', -2000, 2000, 1, 0), N('cy', 'Centre Y', -2000, 2000, 1, 0)],
      glsl: `vec2 cc=C+vec2(u_cx,u_cy)*uK; vec4 a=vec4(0.0);
        for(int i=0;i<40;i++){ a+=pm(tex(mix(p,cc,float(i)/39.0*u_amount/200.0))); } o=unpm(a/40.0);` },
    spinblur: { name: 'Spin Blur', cat: 'Blur', params: [N('angle', 'Angle°', 0, 90, 0.5, 10), N('cx', 'Centre X', -2000, 2000, 1, 0), N('cy', 'Centre Y', -2000, 2000, 1, 0)],
      glsl: `vec2 cc=C+vec2(u_cx,u_cy)*uK; vec4 a=vec4(0.0);
        for(int i=0;i<40;i++){ a+=pm(tex(cc+rot((float(i)/39.0-0.5)*radians(u_angle))*(p-cc))); } o=unpm(a/40.0);` },

    // ---------- Color ----------
    duotone: { name: 'Duotone', cat: 'Color', params: [N('amount', 'Amount %', 0, 100, 1, 100)], colors: [COL('dark', 'Shadows', '#1b1464'), COL('light', 'Highlights', '#ffb347')],
      glsl: `o=vec4(mix(c.rgb,mix(u_dark,u_light,lum(c.rgb)),u_amount/100.0),c.a);` },
    colorfill: { name: 'Color Fill', cat: 'Color', params: [N('amount', 'Amount %', 0, 100, 1, 60)], colors: [COL('color', 'Color', '#ff3366')],
      glsl: `o=vec4(mix(c.rgb,u_color,u_amount/100.0),c.a);` },
    vignette: { name: 'Vignette', cat: 'Color', params: [N('amount', 'Amount %', 0, 100, 1, 60), N('size', 'Size %', 0, 100, 1, 55), N('soft', 'Softness %', 0, 100, 1, 45)],
      glsl: `vec2 q=(p-C)/(uSize*0.5+0.001); float d=length(q)/1.4142, s=u_size/100.0;
        float v=smoothstep(s,s+u_soft/100.0+0.001,d); o=vec4(c.rgb*(1.0-v*u_amount/100.0),c.a);` },
    threshold: { name: 'Threshold', cat: 'Color', params: [N('level', 'Level %', 0, 100, 1, 50), N('amount', 'Amount %', 0, 100, 1, 100)],
      glsl: `o=vec4(mix(c.rgb,vec3(step(u_level/100.0,lum(c.rgb))),u_amount/100.0),c.a);` },
    posterize: { name: 'Posterize', cat: 'Color', params: [N('levels', 'Levels', 2, 16, 1, 4)],
      glsl: `float n=max(2.0,floor(u_levels)); o=vec4(floor(c.rgb*(n-0.0001))/(n-1.0),c.a);` },
    huecycle: { name: 'Color Cycle', cat: 'Color', params: [N('shift', 'Hue shift°', -180, 180, 1, 0), N('speed', 'Speed °/s', -720, 720, 1, 90)],
      glsl: `o=vec4(hueRot(c.rgb,radians(u_shift+u_speed*uTime)),c.a);` },

    // ---------- Light & Shadow ----------
    rays: { name: 'Light Rays', cat: 'Light & Shadow', params: [N('strength', 'Strength %', 0, 300, 1, 100), N('length', 'Length %', 0, 100, 1, 40), N('threshold', 'Threshold %', 0, 100, 1, 55)],
      glsl: `vec4 a=vec4(0.0); for(int i=0;i<48;i++){ vec4 s=tex(mix(p,C,float(i)/48.0*u_length/100.0));
          float b=max(lum(s.rgb)-u_threshold/100.0,0.0)*s.a; a.rgb+=s.rgb*b; }
        vec3 r=a.rgb/48.0*u_strength/100.0*4.0; vec4 q=pm(c); float al=clamp(max(q.a,lum(r)*2.0),0.0,1.0);
        o=unpm(vec4(min(q.rgb+r,vec3(al)),al));` },
    shine: { name: 'Shine', cat: 'Light & Shadow', params: [N('angle', 'Angle°', -180, 180, 1, 30), N('width', 'Width %', 1, 100, 1, 15), N('speed', 'Speed', 0, 5, 0.05, 0.6), N('intensity', 'Intensity %', 0, 100, 1, 80)],
      colors: [COL('color', 'Color', '#ffffff')],
      glsl: `vec2 dir=vec2(cos(radians(u_angle)),sin(radians(u_angle))); float x=dot(p-C,dir)/(maxSide()+0.001);
        float pos=fract(uTime*u_speed)*2.4-1.2; float band=1.0-smoothstep(0.0,u_width/100.0,abs(x-pos));
        o=vec4(mix(c.rgb,u_color,band*u_intensity/100.0),c.a);` },
    neonedge: { name: 'Neon Edges', cat: 'Light & Shadow', params: [N('strength', 'Strength %', 0, 500, 1, 150), N('keep', 'Keep original %', 0, 100, 1, 40)],
      colors: [COL('color', 'Color', '#00e5ff')],
      glsl: `float e=clamp(sobel(p,max(1.0,uK))*u_strength/100.0,0.0,1.0); o=over(vec4(u_color,e),vec4(c.rgb,c.a*u_keep/100.0));` },

    // ---------- Distort ----------
    swirl: { name: 'Swirl', cat: 'Distort', params: [N('angle', 'Angle°', -1080, 1080, 1, 180), N('radius', 'Radius', 1, 3000, 1, 300)],
      glsl: `vec2 d=p-C; float r=length(d), R=u_radius*uK; if(r<R){ float t=1.0-r/R; d=rot(radians(u_angle)*t*t)*d; } o=tex(C+d);` },
    bulge: { name: 'Bulge / Pinch', cat: 'Distort', params: [N('amount', 'Amount', -100, 100, 1, 50), N('radius', 'Radius', 1, 3000, 1, 300)],
      glsl: `vec2 d=p-C; float r=length(d), R=u_radius*uK; if(r<R&&r>0.0){ float n=r/R, a=u_amount/100.0;
          float m=a>=0.0 ? pow(n,1.0+a*1.5) : pow(n,1.0/(1.0-a*1.5)); d=d/r*m*R; } o=tex(C+d);` },
    wave: { name: 'Wave', cat: 'Distort', params: [N('amplitude', 'Amplitude', 0, 300, 1, 20), N('wavelength', 'Wavelength', 5, 3000, 1, 200), N('speed', 'Speed', -5, 5, 0.05, 1), O('direction', 'Direction', ['Horizontal', 'Vertical'])],
      glsl: `float ph=uTime*u_speed*2.0*PI; vec2 q=p;
        if(u_direction<0.5) q.x+=sin(p.y/(u_wavelength*uK)*2.0*PI+ph)*u_amplitude*uK; else q.y+=sin(p.x/(u_wavelength*uK)*2.0*PI+ph)*u_amplitude*uK;
        o=tex(q);` },
    ripple: { name: 'Ripple', cat: 'Distort', params: [N('amplitude', 'Amplitude', 0, 200, 1, 12), N('wavelength', 'Wavelength', 5, 2000, 1, 80), N('speed', 'Speed', -5, 5, 0.05, 1)],
      glsl: `vec2 d=p-C; float r=length(d)+0.0001; o=tex(p+d/r*sin(r/(u_wavelength*uK)*2.0*PI-uTime*u_speed*2.0*PI)*u_amplitude*uK);` },
    fisheye: { name: 'Fisheye', cat: 'Distort', params: [N('amount', 'Amount', -100, 300, 1, 80)],
      glsl: `float R=maxSide()*0.5+0.001; vec2 d=(p-C)/R; float k=u_amount/100.0; o=tex(C+d*(1.0+k*dot(d,d))/(1.0+k)*R);` },
    mirror: { name: 'Mirror', cat: 'Distort', params: [O('mode', 'Mirror', ['Left → right', 'Top → bottom', 'Four-way'])],
      glsl: `vec2 q=p; if(u_mode<0.5||u_mode>1.5){ if(q.x>C.x) q.x=2.0*C.x-q.x; } if(u_mode>0.5){ if(q.y>C.y) q.y=2.0*C.y-q.y; } o=tex(q);` },
    kaleido: { name: 'Kaleidoscope', cat: 'Distort', params: [N('segments', 'Segments', 2, 24, 1, 6), N('rotation', 'Rotation°', -180, 180, 1, 0)],
      glsl: `vec2 d=p-C; float a=atan(d.y,d.x)+radians(u_rotation), sg=2.0*PI/max(2.0,floor(u_segments));
        a=mod(a,sg); a=min(a,sg-a); o=tex(C+length(d)*vec2(cos(a),sin(a)));` },
    warp: { name: 'Turbulent Warp', cat: 'Distort', params: [N('amount', 'Amount', 0, 300, 1, 30), N('scale', 'Scale', 5, 2000, 1, 120), N('speed', 'Speed', 0, 5, 0.05, 0.5)],
      glsl: `float s=u_scale*uK+0.001; vec2 n=vec2(noise(p/s+vec2(uTime*u_speed,0.0)),noise(p/s+vec2(17.3,uTime*u_speed)))-0.5; o=tex(p+n*2.0*u_amount*uK);` },
    tile: { name: 'Tile', cat: 'Distort', params: [N('count', 'Tiles', 1, 12, 1, 3)],
      glsl: `vec2 o0=C-uSize*0.5; vec2 q=(p-o0)/(uSize+0.001);
        if(q.x>=0.0&&q.y>=0.0&&q.x<=1.0&&q.y<=1.0){ q=fract(q*max(1.0,floor(u_count))); o=tex(o0+q*uSize); }` },

    // ---------- Stylize ----------
    pixelate: { name: 'Pixelate', cat: 'Stylize', params: [N('size', 'Block size', 1, 300, 1, 16)],
      glsl: `float s=max(1.0,u_size*uK); o=tex((floor(p/s)+0.5)*s);` },
    halftone: { name: 'Halftone', cat: 'Stylize', params: [N('size', 'Dot size', 3, 100, 1, 12), N('angle', 'Angle°', -90, 90, 1, 45), N('amount', 'Amount %', 0, 100, 1, 100)],
      glsl: `float s=max(2.0,u_size*uK), an=radians(u_angle); vec2 q=rot(an)*p; vec2 cell=(floor(q/s)+0.5)*s; vec4 sc=tex(rot(-an)*cell);
        float rad=s*0.5*sqrt(clamp(1.0-lum(sc.rgb),0.0,1.0))*1.35+s*0.08; float inside=1.0-smoothstep(rad-1.0,rad+1.0,length(q-cell));
        o=mix(c,vec4(sc.rgb,sc.a*inside),u_amount/100.0);` },
    emboss: { name: 'Emboss', cat: 'Stylize', params: [N('strength', 'Strength %', 0, 500, 1, 200), N('angle', 'Light angle°', -180, 180, 1, 45), N('amount', 'Amount %', 0, 100, 1, 100)],
      glsl: `vec2 d=vec2(cos(radians(u_angle)),sin(radians(u_angle)))*max(1.0,uK); float df=L(p+d)-L(p-d);
        o=vec4(mix(c.rgb,clamp(vec3(0.5+df*u_strength/100.0),0.0,1.0),u_amount/100.0),c.a);` },
    edges: { name: 'Find Edges', cat: 'Stylize', params: [N('strength', 'Strength %', 0, 500, 1, 200), O('invert', 'Look', ['Light lines', 'Dark lines (sketch)']), N('amount', 'Amount %', 0, 100, 1, 100)],
      glsl: `float e=clamp(sobel(p,max(1.0,uK))*u_strength/100.0,0.0,1.0); if(u_invert>0.5) e=1.0-e; o=vec4(mix(c.rgb,vec3(e),u_amount/100.0),c.a);` },
    scanlines: { name: 'Scanlines', cat: 'Stylize', params: [N('density', 'Line spacing', 2, 50, 1, 4), N('opacity', 'Opacity %', 0, 100, 1, 35), N('speed', 'Scroll speed', -5, 5, 0.05, 0)],
      glsl: `float d=max(1.0,u_density)*uK; float ln=step(0.5,fract((p.y+uTime*u_speed*d*4.0)/d)); o=vec4(c.rgb*(1.0-ln*u_opacity/100.0),c.a);` },
    grain: { name: 'Film Grain', cat: 'Stylize', params: [N('amount', 'Amount %', 0, 100, 1, 25), N('size', 'Grain size', 1, 10, 0.5, 1.5)],
      glsl: `float s=max(1.0,u_size*uK), f=floor(uTime*24.0); float n=hash(floor(p/s)+vec2(f*13.1,f*7.7))-0.5; o=vec4(clamp(c.rgb+n*u_amount/100.0,0.0,1.0),c.a);` },
    oldfilm: { name: 'Old Film', cat: 'Stylize', params: [N('amount', 'Amount %', 0, 100, 1, 70)],
      glsl: `float a=u_amount/100.0, l=lum(c.rgb), fr=floor(uTime*24.0); vec3 sep=vec3(l*1.07,l*0.89,l*0.69)+vec3(0.05,0.02,0.0);
        float n=hash(floor(p/max(1.0,1.5*uK))+fr)-0.5, fl=1.0+(hash(vec2(fr,3.7))-0.5)*0.15;
        float sx=hash(vec2(fr,1.0))*uRes.x; float scr=(1.0-smoothstep(0.0,1.2*uK,abs(p.x-sx)))*step(0.7,hash(vec2(fr,2.0)))*0.5;
        float vg=smoothstep(0.6,1.5,length((p-C)/(uSize*0.5+0.001)));
        o=vec4(mix(c.rgb,clamp((sep+n*0.25)*fl*(1.0-vg*0.6)+scr,0.0,1.0),a),c.a);` },

    // ---------- Glitch ----------
    rgbsplit: { name: 'RGB Split', cat: 'Glitch', params: [N('distance', 'Distance', 0, 200, 1, 12), N('angle', 'Angle°', -180, 180, 1, 0)],
      glsl: `vec2 d=vec2(cos(radians(u_angle)),sin(radians(u_angle)))*u_distance*uK; o=split3(tex(p+d),c,tex(p-d));` },
    chroma: { name: 'Chromatic Aberration', cat: 'Glitch', params: [N('amount', 'Amount', 0, 200, 1, 15)],
      glsl: `vec2 d=(p-C)/(maxSide()*0.5+0.001)*u_amount*uK; o=split3(tex(p+d),c,tex(p-d));` },
    glitch: { name: 'Glitch', cat: 'Glitch', params: [N('amount', 'Amount %', 0, 100, 1, 50), N('block', 'Block size', 2, 200, 1, 24), N('speed', 'Speed', 0, 30, 0.5, 8)],
      glsl: `float ts=floor(uTime*u_speed), bs=max(1.0,u_block*uK), row=floor(p.y/bs), a=u_amount/100.0; vec2 q=p;
        if(hash(vec2(row,ts))<a*0.5) q.x+=(hash(vec2(row,ts+1.0))-0.5)*2.0*a*uSize.x*0.3;
        float sh=(hash(vec2(ts,9.1))-0.5)*a*20.0*uK; o=split3(tex(q+vec2(sh,0.0)),tex(q),tex(q-vec2(sh,0.0)));` },
    vhs: { name: 'VHS', cat: 'Glitch', params: [N('amount', 'Amount %', 0, 100, 1, 60)],
      glsl: `float a=u_amount/100.0, fr=floor(uTime*30.0);
        float wob=(sin(p.y/uK*0.08+uTime*6.0)*1.5+(noise(vec2(p.y/uK*0.05,uTime*4.0))-0.5)*4.0)*a*uK;
        vec2 q=p+vec2(wob,0.0); float sh=3.0*a*uK; vec4 s=split3(tex(q+vec2(sh,0.0)),tex(q),tex(q-vec2(sh,0.0)));
        float ln=step(0.985,hash(vec2(floor(p.y/(2.0*uK)),fr)))*a; vec3 col=mix(s.rgb,vec3(1.0),ln*0.6);
        col=mix(vec3(lum(col)),col,1.0-a*0.3)+(hash(p+fr)-0.5)*0.08*a; o=vec4(clamp(col,0.0,1.0),s.a);` },

    // ---------- Generate (procedural) ----------
    noise: { name: 'Fractal Noise', cat: 'Generate', params: [N('scale', 'Scale', 5, 2000, 1, 180), N('contrast', 'Contrast %', 0, 300, 1, 100), N('detail', 'Detail', 1, 8, 1, 5), N('speed', 'Evolution', 0, 5, 0.05, 0.4), ...GEN],
      colors: [COL('a', 'Dark', '#000000'), COL('b', 'Light', '#ffffff')],
      glsl: `float v=fbm(p/(u_scale*uK+0.001)+vec2(uTime*u_speed,uTime*u_speed*0.7),u_detail); v=clamp((v-0.5)*u_contrast/100.0*1.6+0.5,0.0,1.0);
        o=genMix(c,mix(u_a,u_b,v),u_blend,u_cover);` },
    gradfill: { name: 'Gradient', cat: 'Generate', params: [N('angle', 'Angle°', -180, 180, 1, 90), O('shape', 'Shape', ['Linear', 'Radial']), ...GEN],
      colors: [COL('a', 'Start', '#7b61ff'), COL('b', 'End', '#ff4f8b')],
      glsl: `float t; if(u_shape<0.5){ vec2 dir=vec2(cos(radians(u_angle)),sin(radians(u_angle))); t=dot(p-C,dir)/(maxSide()+0.001)+0.5; }
        else t=length(p-C)/(maxSide()*0.5+0.001); o=genMix(c,mix(u_a,u_b,clamp(t,0.0,1.0)),u_blend,u_cover);` },
    checker: { name: 'Checkerboard', cat: 'Generate', params: [N('size', 'Square size', 2, 500, 1, 40), ...GEN], colors: [COL('a', 'Color 1', '#ffffff'), COL('b', 'Color 2', '#222222')],
      glsl: `float s=max(1.0,u_size*uK); o=genMix(c,mix(u_a,u_b,mod(floor(p.x/s)+floor(p.y/s),2.0)),u_blend,u_cover);` },
    stripes: { name: 'Stripes', cat: 'Generate', params: [N('width', 'Width', 1, 500, 1, 20), N('angle', 'Angle°', -180, 180, 1, 45), N('speed', 'Scroll speed', -10, 10, 0.1, 0), ...GEN],
      colors: [COL('a', 'Color 1', '#ffd84d'), COL('b', 'Color 2', '#111111')],
      glsl: `vec2 dir=vec2(cos(radians(u_angle)),sin(radians(u_angle))); float w=max(1.0,u_width*uK);
        o=genMix(c,mix(u_a,u_b,step(0.5,fract(dot(p,dir)/(2.0*w)+uTime*u_speed*0.5))),u_blend,u_cover);` },
    grid: { name: 'Grid', cat: 'Generate', params: [N('spacing', 'Spacing', 4, 500, 1, 40), N('thickness', 'Line width', 0.5, 50, 0.5, 2), ...GEN],
      colors: [COL('a', 'Lines', '#ffffff'), COL('b', 'Background', '#1a1a1a')],
      glsl: `float s=max(2.0,u_spacing*uK), th=max(0.5,u_thickness*uK); vec2 m=mod(p,s); o=genMix(c,(m.x<th||m.y<th)?u_a:u_b,u_blend,u_cover);` },
    dots: { name: 'Polka Dots', cat: 'Generate', params: [N('spacing', 'Spacing', 4, 500, 1, 30), N('radius', 'Dot size %', 0, 70, 1, 35), ...GEN],
      colors: [COL('a', 'Dots', '#ffffff'), COL('b', 'Background', '#1cc8d6')],
      glsl: `float s=max(2.0,u_spacing*uK); vec2 cell=(floor(p/s)+0.5)*s; float r=s*u_radius/100.0;
        o=genMix(c,mix(u_b,u_a,1.0-smoothstep(r-1.0,r+1.0,length(p-cell))),u_blend,u_cover);` },
    plasma: { name: 'Plasma', cat: 'Generate', params: [N('scale', 'Scale', 5, 2000, 1, 200), N('speed', 'Speed', 0, 5, 0.05, 0.6), ...GEN],
      glsl: `float f=6.0/(u_scale*uK+0.001), t=uTime*u_speed*2.0; vec2 q=p-C;
        float v=sin(q.x*f+t)+sin(q.y*f*0.8+t*1.3)+sin((q.x+q.y)*f*0.6+t*0.7)+sin(length(q)*f+t*1.7);
        o=genMix(c,0.5+0.5*cos(v+vec3(0.0,2.0,4.0)),u_blend,u_cover);` },
    cells: { name: 'Cells', cat: 'Generate', params: [N('scale', 'Scale', 5, 1000, 1, 80), N('speed', 'Speed', 0, 5, 0.05, 0.4), ...GEN],
      colors: [COL('a', 'Centre', '#0b1d51'), COL('b', 'Edge', '#1cc8d6')],
      glsl: `vec2 g=p/(u_scale*uK+0.001), i=floor(g); float md=10.0;
        for(int y=-1;y<=1;y++) for(int x=-1;x<=1;x++){ vec2 nb=vec2(float(x),float(y)); vec2 pt=vec2(hash(i+nb),hash(i+nb+7.7));
          pt=0.5+0.5*sin(uTime*u_speed*2.0+6.2831*pt); md=min(md,length(nb+pt-fract(g))); }
        o=genMix(c,mix(u_a,u_b,clamp(md,0.0,1.0)),u_blend,u_cover);` },

    // ---------- 3D ----------
    rot3d: { name: '3D Rotate', cat: '3D', params: [N('tiltx', 'Tilt X°', -180, 180, 1, 30), N('tilty', 'Tilt Y°', -180, 180, 1, -25), N('rotz', 'Rotate Z°', -180, 180, 1, 0), N('persp', 'Perspective %', 10, 500, 1, 150)],
      glsl: `float D=maxSide()*u_persp/100.0+0.001; vec3 e=vec3(0.0,0.0,-D); float ax=radians(u_tiltx), ay=radians(u_tilty), az=radians(u_rotz);
        mat3 Rx=mat3(1.0,0.0,0.0, 0.0,cos(ax),sin(ax), 0.0,-sin(ax),cos(ax));
        mat3 Ry=mat3(cos(ay),0.0,-sin(ay), 0.0,1.0,0.0, sin(ay),0.0,cos(ay));
        mat3 Rz=mat3(cos(az),sin(az),0.0, -sin(az),cos(az),0.0, 0.0,0.0,1.0);
        mat3 R=Rz*Ry*Rx; vec3 n=R*vec3(0.0,0.0,1.0); vec3 rd=vec3(p-C,0.0)-e; float den=dot(rd,n); o=vec4(0.0);
        if(abs(den)>1e-5){ float s=dot(-e,n)/den; if(s>0.0){ vec3 P=e+s*rd; o=tex(C+vec2(dot(P,R[0]),dot(P,R[1]))); } }` },
    extrude: { name: '3D Extrude', cat: '3D', params: [N('depth', 'Depth', 0, 300, 1, 40), N('angle', 'Angle°', -180, 180, 1, 45), N('shade', 'Shading %', 0, 100, 1, 60)],
      glsl: `vec2 d=vec2(cos(radians(u_angle)),sin(radians(u_angle)))*u_depth*uK; vec4 ex=vec4(0.0);
        for(int i=1;i<=32;i++){ float t=float(i)/32.0; vec4 s=tex(p-d*t); if(s.a>0.01){ ex=vec4(s.rgb*(1.0-u_shade/100.0*(0.4+0.6*t)),s.a); break; } }
        o=over(c,ex);` },
    reflection: { name: 'Reflection', cat: '3D', params: [N('gap', 'Gap', 0, 300, 1, 0), N('length', 'Fade length %', 1, 100, 1, 50), N('opacity', 'Opacity %', 0, 100, 1, 40)],
      glsl: `float bottom=C.y+uSize.y*0.5, gap=u_gap*uK; vec4 r=vec4(0.0);
        if(p.y>bottom+gap){ float dy=p.y-bottom-gap; vec4 s=tex(vec2(p.x,bottom-dy)); float f=1.0-clamp(dy/(uSize.y*u_length/100.0+0.001),0.0,1.0);
          r=vec4(s.rgb,s.a*f*u_opacity/100.0); }
        o=over(c,r);` },
    cylinder: { name: 'Cylinder Wrap', cat: '3D', params: [N('curve', 'Curve %', 0, 100, 1, 60)],
      glsl: `float hw=uSize.x*0.5+0.001, x=(p.x-C.x)/hw, k=max(0.001,u_curve/100.0*1.5);
        if(abs(x)<=1.0){ float xs=clamp(x*sin(k),-1.0,1.0); vec4 s=tex(vec2(C.x+asin(xs)/k*hw,p.y)); o=vec4(s.rgb*mix(1.0,sqrt(max(0.0,1.0-xs*xs)),0.6),s.a); }` },

    // ---------- Motion (procedural movement) ----------
    shake: { name: 'Shake', cat: 'Motion', params: [N('amount', 'Amount', 0, 300, 1, 15), N('speed', 'Speed', 0, 30, 0.5, 8), N('rotation', 'Rotation°', 0, 45, 0.5, 2)],
      glsl: `float t=uTime*u_speed; vec2 off=(vec2(noise(vec2(t,0.0)),noise(vec2(0.0,t+7.0)))-0.5)*2.0*u_amount*uK;
        float a=(noise(vec2(t+3.0,t))-0.5)*2.0*radians(u_rotation); o=tex(C+rot(-a)*(p-C-off));` },
    swing: { name: 'Swing', cat: 'Motion', params: [N('angle', 'Angle°', 0, 90, 0.5, 10), N('speed', 'Speed', 0, 5, 0.05, 1)],
      glsl: `float a=sin(uTime*u_speed*2.0*PI)*radians(u_angle); vec2 pv=C-vec2(0.0,uSize.y*0.5); o=tex(pv+rot(-a)*(p-pv));` },
    pulse: { name: 'Pulse', cat: 'Motion', params: [N('amount', 'Amount %', 0, 100, 1, 8), N('speed', 'Speed', 0, 10, 0.05, 2)],
      glsl: `float s=1.0+sin(uTime*u_speed*2.0*PI)*u_amount/100.0; o=tex(C+(p-C)/max(0.01,s));` },
    wiggle: { name: 'Float', cat: 'Motion', params: [N('amount', 'Amount', 0, 300, 1, 20), N('speed', 'Speed', 0, 5, 0.05, 0.8)],
      glsl: `float t=uTime*u_speed; o=tex(p-vec2(sin(t*2.1)+0.5*sin(t*3.7+1.0),cos(t*1.7)+0.5*sin(t*2.9+2.0))/1.5*u_amount*uK);` },
    bounce: { name: 'Bounce', cat: 'Motion', params: [N('height', 'Height', 0, 500, 1, 40), N('speed', 'Speed', 0, 5, 0.05, 1.5)],
      glsl: `o=tex(p+vec2(0.0,abs(sin(uTime*u_speed*PI))*u_height*uK));` },

    /* ---------- More effects, after After Effects, Alight Motion and CapCut ---------- */
    lensblur: { name: 'Lens Blur', cat: 'Blur', params: [N('radius', 'Radius', 0, 150, 1, 12), N('bright', 'Bokeh highlights %', 0, 200, 1, 60)],
      glsl: `float R=u_radius*uK; vec4 a=vec4(0.0); float w=0.0;
        for(int i=0;i<64;i++){ float fi=float(i); float r=sqrt((fi+0.5)/64.0)*R, an=fi*2.39996; vec4 s=pm(tex(p+vec2(cos(an),sin(an))*r));
          float b=1.0+pow(lum(s.rgb),4.0)*u_bright/25.0; a+=s*b; w+=b; }
        o=unpm(a/w);` },
    leavecolor: { name: 'Color Isolation', cat: 'Color', params: [N('tolerance', 'Tolerance %', 0, 100, 1, 30), N('softness', 'Softness %', 0, 100, 1, 20)],
      colors: [COL('key', 'Keep color', '#ff2020')],
      glsl: `vec3 hc=yuv(c.rgb), hk=yuv(u_key); float d=distance(normalize(hc.yz+1e-5),normalize(hk.yz+1e-5));
        float t=u_tolerance/100.0, sf=u_softness/100.0+0.001; float keep=(1.0-smoothstep(t,t+sf,d))*smoothstep(0.02,0.08,length(hc.yz));
        o=vec4(mix(vec3(lum(c.rgb)),c.rgb,keep),c.a);` },
    tritone: { name: 'Tritone', cat: 'Color', params: [N('amount', 'Amount %', 0, 100, 1, 100)],
      colors: [COL('dark', 'Shadows', '#120a2a'), COL('mid', 'Midtones', '#d43f6a'), COL('light', 'Highlights', '#ffe9a8')],
      glsl: `float l=lum(c.rgb); vec3 t=l<0.5 ? mix(u_dark,u_mid,l*2.0) : mix(u_mid,u_light,l*2.0-1.0); o=vec4(mix(c.rgb,t,u_amount/100.0),c.a);` },
    rainbow: { name: 'Rainbow', cat: 'Color', params: [N('angle', 'Angle°', -180, 180, 1, 30), N('scale', 'Bands %', 10, 400, 1, 100), N('speed', 'Speed', -5, 5, 0.05, 0.3),
      N('blend', 'Blend %', 0, 100, 1, 60), O('cover', 'Fill', ['Layer shape', 'Whole frame'])],
      glsl: `vec2 dir=vec2(cos(radians(u_angle)),sin(radians(u_angle))); float t=dot(p-C,dir)/(maxSide()+0.001)*u_scale/100.0+uTime*u_speed;
        vec3 rb=0.5+0.5*cos(6.2831*(t+vec3(0.0,0.33,0.67))); o=genMix(c,1.0-(1.0-c.rgb)*(1.0-rb*0.85),u_blend,u_cover);` },
    bloom: { name: 'Bloom', cat: 'Light & Shadow', params: [N('threshold', 'Threshold %', 0, 100, 1, 60), N('radius', 'Radius', 1, 300, 1, 40), N('intensity', 'Intensity %', 0, 500, 1, 150)],
      colors: [COL('color', 'Tint', '#ffffff')],
      glsl: `vec3 acc=vec3(0.0); float R=u_radius*uK;
        for(int i=0;i<48;i++){ float fi=float(i); float r=sqrt((fi+0.5)/48.0)*R, an=fi*2.39996; vec4 s=tex(p+vec2(cos(an),sin(an))*r); acc+=max(s.rgb*s.a-u_threshold/100.0,0.0); }
        o=addLight(c,acc/48.0*u_intensity/100.0*3.0*u_color);` },
    lensflare: { name: 'Lens Flare', cat: 'Light & Shadow', params: [N('x', 'Flare X', -3000, 3000, 1, -110), N('y', 'Flare Y', -3000, 3000, 1, -75), N('size', 'Size %', 5, 300, 1, 100), N('brightness', 'Brightness %', 0, 300, 1, 100)],
      colors: [COL('color', 'Color', '#ffd9a0')],
      glsl: `vec2 F=C+vec2(u_x,u_y)*uK; float S=maxSide()*u_size/100.0+0.001; vec2 d=p-F; float r=length(d)/S;
        float core=exp(-r*r*60.0)*1.5+exp(-r*6.0)*0.35, ring=exp(-pow((r-0.18)*40.0,2.0))*0.25;
        float streak=exp(-abs(d.y)/(S*0.006))*exp(-abs(d.x)/(S*0.5))*0.6; vec2 ax=C-F; float gh=0.0;
        for(int i=1;i<=4;i++){ float fi=float(i); vec2 gp=F+ax*(0.5+fi*0.45); gh+=exp(-pow(length(p-gp)/(S*(0.02+0.025*fi)),2.0))*0.18; }
        o=addLight(c,((core+ring+streak)*u_color+gh*vec3(0.6,0.8,1.0))*u_brightness/100.0);` },
    lightleak: { name: 'Light Leak', cat: 'Light & Shadow', params: [N('intensity', 'Intensity %', 0, 200, 1, 80), N('speed', 'Speed', 0, 3, 0.05, 0.4)],
      colors: [COL('a', 'Color 1', '#ff7a2a'), COL('b', 'Color 2', '#ff2a6a')],
      glsl: `vec2 q=(p-C)/(maxSide()+0.001); float t=uTime*u_speed;
        float b1=exp(-pow(length(q-vec2(-0.45+0.25*sin(t*1.1),-0.3+0.2*cos(t*0.9))),2.0)*6.0);
        float b2=exp(-pow(length(q-vec2(0.45+0.2*cos(t*0.7),0.3+0.25*sin(t*1.3))),2.0)*5.0);
        vec3 g=clamp((u_a*b1+u_b*b2)*u_intensity/100.0,0.0,1.0); o=vec4(1.0-(1.0-c.rgb)*(1.0-g),c.a);` },
    flash: { name: 'Flash', cat: 'Light & Shadow', params: [N('speed', 'Flashes / s', 0.1, 10, 0.1, 1), N('decay', 'Fade speed', 1, 30, 0.5, 8), N('intensity', 'Intensity %', 0, 100, 1, 90)],
      colors: [COL('color', 'Color', '#ffffff')],
      glsl: `float f=exp(-fract(uTime*u_speed)*u_decay); o=vec4(mix(c.rgb,u_color,f*u_intensity/100.0),c.a);` },
    polar: { name: 'Polar Coordinates', cat: 'Distort', params: [O('mode', 'Convert', ['Rect → polar', 'Polar → rect'])],
      glsl: `vec2 o0=C-uSize*0.5; float R=min(uSize.x,uSize.y)*0.5+0.001; o=vec4(0.0);
        if(u_mode<0.5){ vec2 d=p-C; float v=length(d)/R; if(v<=1.0) o=tex(o0+vec2(atan(d.y,d.x)/(2.0*PI)+0.5,v)*uSize); }
        else { vec2 q=(p-o0)/(uSize+0.001); if(q.x>=0.0&&q.y>=0.0&&q.x<=1.0&&q.y<=1.0){ float an=(q.x-0.5)*2.0*PI; o=tex(C+q.y*R*vec2(cos(an),sin(an))); } }` },
    offset: { name: 'Offset', cat: 'Distort', params: [N('x', 'Shift X %', -100, 100, 1, 0), N('y', 'Shift Y %', -100, 100, 1, 0), N('sx', 'Scroll X %/s', -200, 200, 1, 20), N('sy', 'Scroll Y %/s', -200, 200, 1, 0)],
      glsl: `vec2 o0=C-uSize*0.5; vec2 q=(p-o0)/(uSize+0.001);
        if(q.x>=0.0&&q.y>=0.0&&q.x<=1.0&&q.y<=1.0){ q=fract(q-vec2(u_x,u_y)/100.0-vec2(u_sx,u_sy)/100.0*uTime); o=tex(o0+q*uSize); }` },
    underwater: { name: 'Underwater', cat: 'Distort', params: [N('amount', 'Amount', 0, 100, 1, 40), N('scale', 'Scale', 10, 1000, 1, 150), N('speed', 'Speed', 0, 5, 0.05, 1), N('tintamt', 'Blue tint %', 0, 100, 1, 30)],
      colors: [COL('tint', 'Tint', '#2a8bd6')],
      glsl: `float s=u_scale*uK+0.001, t=uTime*u_speed;
        vec2 w=vec2(sin(p.y/s*3.0+t*2.0)+sin((p.x+p.y)/s*1.7+t*1.3),cos(p.x/s*2.6+t*1.7)+sin((p.x-p.y)/s*2.1-t))*0.1*u_amount*uK;
        vec4 s0=tex(p+w); float caus=pow(0.5+0.5*sin((p.x+w.x*8.0)/s*5.0+t*2.0)*sin((p.y+w.y*8.0)/s*5.0-t*1.6),6.0);
        o=vec4(clamp(mix(s0.rgb,s0.rgb*u_tint*1.4,u_tintamt/100.0)+caus*0.25*u_amount/100.0,0.0,1.0),s0.a);` },
    splitscreen: { name: 'Split Screen', cat: 'Distort', params: [O('count', 'Copies', ['2 (stacked)', '3 (stacked)', '4 (2×2)', '9 (3×3)', '16 (4×4)'], 2)],
      glsl: `vec2 n=u_count<0.5?vec2(1.0,2.0):u_count<1.5?vec2(1.0,3.0):u_count<2.5?vec2(2.0):u_count<3.5?vec2(3.0):vec2(4.0);
        vec2 o0=C-uSize*0.5; vec2 q=(p-o0)/(uSize+0.001);
        if(q.x>=0.0&&q.y>=0.0&&q.x<=1.0&&q.y<=1.0){ vec2 cell=uSize/n; o=tex(C+(fract(q*n)-0.5)*cell*min(n.x,n.y)); }` },
    cartoon: { name: 'Cartoon', cat: 'Stylize', params: [N('levels', 'Color levels', 2, 12, 1, 5), N('edge', 'Line strength %', 0, 500, 1, 150), N('thick', 'Line width', 0.5, 6, 0.5, 1.5)],
      glsl: `float n=max(2.0,floor(u_levels)); vec3 pc=floor(c.rgb*(n-0.0001))/(n-1.0);
        float e=clamp(sobel(p,max(1.0,u_thick*uK))*u_edge/100.0,0.0,1.0); o=vec4(mix(pc,vec3(0.0),smoothstep(0.3,0.7,e)),c.a);` },
    oilpaint: { name: 'Oil Paint', cat: 'Stylize', params: [N('radius', 'Brush size', 1, 30, 0.5, 5)],
      glsl: `float st=max(0.5,u_radius*uK/4.0); vec3 m0=vec3(0.0),m1=vec3(0.0),m2=vec3(0.0),m3=vec3(0.0),v0=vec3(0.0),v1=vec3(0.0),v2=vec3(0.0),v3=vec3(0.0);
        for(int j=0;j<=4;j++) for(int i=0;i<=4;i++){ vec2 d=vec2(float(i),float(j))*st; vec3 a;
          a=tex(p-d).rgb; m0+=a; v0+=a*a; a=tex(p+vec2(d.x,-d.y)).rgb; m1+=a; v1+=a*a;
          a=tex(p+vec2(-d.x,d.y)).rgb; m2+=a; v2+=a*a; a=tex(p+d).rgb; m3+=a; v3+=a*a; }
        m0/=25.0; m1/=25.0; m2/=25.0; m3/=25.0;
        float s0=dot(abs(v0/25.0-m0*m0),vec3(1.0)), s1=dot(abs(v1/25.0-m1*m1),vec3(1.0)), s2=dot(abs(v2/25.0-m2*m2),vec3(1.0)), s3=dot(abs(v3/25.0-m3*m3),vec3(1.0));
        vec3 r=m0; float b=s0; if(s1<b){ b=s1; r=m1; } if(s2<b){ b=s2; r=m2; } if(s3<b){ r=m3; } o=vec4(r,c.a);` },
    crt: { name: 'Old TV', cat: 'Stylize', params: [N('curve', 'Screen curve %', 0, 100, 1, 40), N('lines', 'Scanlines %', 0, 100, 1, 50), N('vignette', 'Vignette %', 0, 100, 1, 60)],
      glsl: `vec2 hs=uSize*0.5+0.001; vec2 q=(p-C)/hs;
        if(max(abs(q.x),abs(q.y))<=1.0){ q*=1.0+u_curve/100.0*0.25*dot(q,q);
          if(abs(q.x)>1.0||abs(q.y)>1.0) o=vec4(0.0,0.0,0.0,1.0);
          else { vec2 sp=C+q*hs; vec4 s=tex(sp); float ln=0.5+0.5*sin(sp.y/max(1.0,uK)*PI);
            vec3 col=s.rgb*(1.0-u_lines/100.0*0.5*(1.0-ln))*(1.0-smoothstep(0.5,1.5,length(q))*u_vignette/100.0)*(1.0-0.04*sin(uTime*60.0));
            o=vec4(col,s.a); } }` },
    letterbox: { name: 'Cinema Bars', cat: 'Stylize', params: [N('size', 'Bar size %', 0, 50, 0.5, 12), O('sides', 'Bars', ['Top & bottom', 'Left & right'])],
      colors: [COL('color', 'Color', '#000000')],
      glsl: `vec2 q=(p-C)/(uSize*0.5+0.001); float v=u_sides<0.5?abs(q.y):abs(q.x);
        if(max(abs(q.x),abs(q.y))<=1.0 && v>1.0-2.0*u_size/100.0) o=vec4(u_color,max(c.a,1.0));` },
    dither: { name: 'Dither', cat: 'Stylize', params: [N('levels', 'Levels', 2, 8, 1, 2), N('size', 'Pixel size', 1, 20, 1, 2), O('mode', 'Colors', ['Color', 'Black & white'])],
      glsl: `float s=max(1.0,u_size*uK); vec2 cell=floor(p/s); vec4 sc=tex((cell+0.5)*s); vec2 b=mod(cell,4.0);
        float thr=(4.0*bayer2(mod(b,2.0))+bayer2(floor(b/2.0))+0.5)/16.0; float n=max(1.0,floor(u_levels)-1.0);
        vec3 src=u_mode>0.5?vec3(lum(sc.rgb)):sc.rgb; o=vec4(floor(src*n+thr)/n,sc.a);` },
    blockglitch: { name: 'Block Glitch', cat: 'Glitch', params: [N('amount', 'Amount %', 0, 100, 1, 50), N('block', 'Block size', 2, 200, 1, 20), N('shift', 'Shift', 0, 500, 1, 80), N('speed', 'Speed', 0, 30, 0.5, 10)],
      glsl: `float ts=floor(uTime*u_speed), bs=max(2.0,u_block*uK); vec2 cell=floor(p/vec2(bs*3.0,bs)); float h=hash(cell+ts);
        if(h<u_amount/100.0*0.35){ vec4 s=tex(p+vec2((hash(cell+ts+3.1)-0.5)*u_shift*uK,0.0)); float m=hash(cell+ts+5.0);
          if(m<0.33) s.rgb=s.gbr; else if(m<0.66) s.rgb=vec3(1.0)-s.rgb; o=s; }` },
    tvstatic: { name: 'TV Static', cat: 'Glitch', params: [N('blend', 'Blend %', 0, 100, 1, 45), O('cover', 'Fill', ['Layer shape', 'Whole frame'])],
      glsl: `float fr=floor(uTime*30.0); float n=hash(floor(p/max(1.0,2.0*uK))+fr*17.0); float roll=0.5+0.5*sin((p.y/max(uK,0.001)+uTime*120.0)*0.05);
        o=genMix(c,vec3(n)*(0.7+0.3*roll),u_blend,u_cover);` },
    snow: { name: 'Snow', cat: 'Particles', params: [N('amount', 'Amount %', 0, 100, 1, 50), N('size', 'Flake size', 1, 30, 0.5, 5), N('speed', 'Speed', 0, 5, 0.05, 1), N('wind', 'Wind', -5, 5, 0.05, 0.5), COVER],
      colors: [COL('color', 'Color', '#ffffff')],
      glsl: `float a=0.0;
        for(int li=0;li<3;li++){ float fl=float(li), cs=(70.0-fl*18.0)*uK;
          vec2 q=p-vec2(uTime*u_wind*30.0*uK+sin(uTime*0.8+fl*2.0)*10.0*uK, uTime*u_speed*(50.0+fl*35.0)*uK);
          vec2 cell=floor(q/cs), f=fract(q/cs); if(hash(cell+fl*13.0)<u_amount/100.0){
            vec2 pos=0.2+0.6*vec2(hash(cell+1.3+fl),hash(cell+2.7+fl)); float r=(0.6+0.8*hash(cell+4.1))*u_size*uK*(0.6+fl*0.25)/cs;
            a=max(a,(1.0-smoothstep(r*0.4,r,length(f-pos)))*(0.55+fl*0.22)); } }
        o=overlay(c,u_color,a,u_cover);` },
    rain: { name: 'Rain', cat: 'Particles', params: [N('amount', 'Amount %', 0, 100, 1, 50), N('speed', 'Speed', 0, 5, 0.05, 1.5), N('slant', 'Slant', -1, 1, 0.01, 0.15), N('opacity', 'Opacity %', 0, 100, 1, 60), COVER],
      colors: [COL('color', 'Color', '#cfdcff')],
      glsl: `float a=0.0;
        for(int li=0;li<2;li++){ float fl=float(li); vec2 cs=vec2(18.0+fl*8.0,140.0)*uK; vec2 q=p; q.x+=q.y*u_slant; q.y-=uTime*u_speed*(700.0+fl*300.0)*uK;
          vec2 cell=floor(q/cs), f=fract(q/cs); if(hash(cell+fl*7.0)<u_amount/100.0){
            float x=0.2+0.6*hash(cell+1.7), y0=hash(cell+3.3)*0.5, ln=0.35+0.3*hash(cell+5.1);
            a=max(a,(1.0-smoothstep(0.6*uK,1.4*uK,abs(f.x-x)*cs.x))*step(y0,f.y)*step(f.y,y0+ln)*(f.y-y0)/ln); } }
        o=overlay(c,u_color,a*u_opacity/100.0,u_cover);` },
    sparkle: { name: 'Sparkles', cat: 'Particles', params: [N('amount', 'Amount %', 0, 100, 1, 35), N('spacing', 'Spacing', 10, 500, 1, 70), N('size', 'Size', 1, 100, 0.5, 12), N('speed', 'Twinkle speed', 0, 5, 0.05, 1), COVER],
      colors: [COL('color', 'Color', '#fff4c2')],
      glsl: `float cs=u_spacing*uK+0.001; vec2 cell=floor(p/cs), f=fract(p/cs)-0.5; float h=hash(cell), s=0.0;
        if(h<u_amount/100.0){ vec2 d=(f-(vec2(hash(cell+1.7),hash(cell+3.1))-0.5)*0.5)*cs/(u_size*uK+0.001);
          float tw=pow(0.5+0.5*sin(uTime*u_speed*4.0+h*40.0),3.0);
          s=(exp(-dot(d,d)*8.0)+0.6*(exp(-abs(d.x)*25.0-abs(d.y)*2.5)+exp(-abs(d.y)*25.0-abs(d.x)*2.5)))*tw; }
        o=u_cover>0.5 ? over(vec4(u_color,clamp(s,0.0,1.0)),c) : vec4(clamp(c.rgb+u_color*s,0.0,1.0),c.a);` },
    hearts: { name: 'Floating Hearts', cat: 'Particles', params: [N('amount', 'Amount %', 0, 100, 1, 35), N('size', 'Size', 5, 200, 1, 26), N('speed', 'Speed', 0, 5, 0.05, 0.8), COVER],
      colors: [COL('color', 'Color', '#ff4f8b')],
      glsl: `float cs=u_size*uK*3.0+0.001; vec2 q=p+vec2(0.0,uTime*u_speed*60.0*uK); vec2 cell=floor(q/cs), f=fract(q/cs)-0.5; float a=0.0;
        if(hash(cell)<u_amount/100.0){ vec2 d=(f-vec2(sin(uTime*2.0+hash(cell)*20.0)*0.12,0.0))*3.0; a=1.0-smoothstep(-0.03,0.03,sdHeart(vec2(d.x,-d.y)+vec2(0.0,0.45))); }
        o=overlay(c,u_color,a,u_cover);` },
    radiowaves: { name: 'Radio Waves', cat: 'Generate', params: [N('x', 'Centre X', -3000, 3000, 1, 0), N('y', 'Centre Y', -3000, 3000, 1, 0), N('spacing', 'Spacing', 5, 500, 1, 60),
      N('width', 'Ring width', 0.5, 100, 0.5, 6), N('speed', 'Speed', -5, 5, 0.05, 1), N('fade', 'Fade distance', 10, 5000, 1, 600), COVER],
      colors: [COL('color', 'Color', '#1cc8d6')],
      glsl: `float r=length(p-C-vec2(u_x,u_y)*uK)/max(uK,0.001); float w=mod(r-uTime*u_speed*100.0,u_spacing);
        float ring=1.0-smoothstep(u_width*0.5,u_width*0.5+1.5,abs(w-u_spacing*0.5)); o=overlay(c,u_color,ring*exp(-r/u_fade),u_cover);` },
    bevel: { name: 'Bevel Edges', cat: '3D', params: [N('depth', 'Depth', 1, 200, 1, 14), N('angle', 'Light angle°', -180, 180, 1, -135), N('intensity', 'Intensity %', 0, 200, 1, 70)],
      glsl: `vec2 hs=uSize*0.5, q=p-C, m=hs-abs(q); float d=max(1.0,u_depth*uK), e=min(m.x,m.y);
        if(e>=0.0&&e<d){ vec2 n=m.x<m.y?vec2(sign(q.x),0.0):vec2(0.0,sign(q.y)); float sh=dot(n,vec2(cos(radians(u_angle)),sin(radians(u_angle))))*(1.0-e/d)*u_intensity/100.0;
          o=vec4(clamp(c.rgb+sh*0.5,0.0,1.0),c.a); }` },
    spin: { name: 'Spin', cat: 'Motion', params: [N('speed', 'Speed °/s', -1080, 1080, 1, 90), N('angle', 'Start angle°', -180, 180, 1, 0)],
      glsl: `o=tex(C+rot(-radians(u_angle+u_speed*uTime))*(p-C));` },
    strobe: { name: 'Strobe', cat: 'Motion', params: [N('speed', 'Blinks / s', 0.1, 30, 0.1, 4), N('duty', 'Visible %', 0, 100, 1, 50), N('min', 'Off opacity %', 0, 100, 1, 0)],
      glsl: `o=vec4(c.rgb,c.a*mix(u_min/100.0,1.0,step(fract(uTime*u_speed),u_duty/100.0)));` },
    squash: { name: 'Squash & Stretch', cat: 'Motion', params: [N('amount', 'Amount %', 0, 60, 1, 15), N('speed', 'Speed', 0, 5, 0.05, 1.5)],
      glsl: `float s=sin(uTime*u_speed*2.0*PI)*u_amount/100.0; vec2 pv=C+vec2(0.0,uSize.y*0.5); o=tex(pv+(p-pv)/vec2(1.0+s,max(0.05,1.0-s)));` },
    zoompunch: { name: 'Zoom Punch', cat: 'Motion', params: [N('amount', 'Amount %', 0, 100, 1, 20), N('speed', 'Beats / s', 0.1, 8, 0.05, 2), N('decay', 'Snap back', 1, 30, 0.5, 6)],
      glsl: `float z=1.0+u_amount/100.0*exp(-fract(uTime*u_speed)*u_decay); o=tex(C+(p-C)/z);` },
    linearwipe: { name: 'Linear Wipe', cat: 'Wipes', params: [DONE, N('angle', 'Angle°', -180, 180, 1, 0), FEATHER],
      glsl: `vec2 dir=vec2(cos(radians(u_angle)),sin(radians(u_angle))); vec2 hs=uSize*0.5; float ext=abs(dir.x)*hs.x+abs(dir.y)*hs.y+0.001;
        o=vec4(c.rgb,c.a*wipe(dot(p-C,dir)/ext*0.5+0.5,u_completion/100.0,u_feather/100.0));` },
    radialwipe: { name: 'Radial Wipe', cat: 'Wipes', params: [DONE, N('start', 'Start angle°', -180, 180, 1, -90), FEATHER, O('dir', 'Direction', ['Clockwise', 'Counter-clockwise'])],
      glsl: `vec2 d=p-C; float a=fract((atan(d.y,d.x)-radians(u_start))/(2.0*PI)); if(u_dir>0.5) a=1.0-a;
        o=vec4(c.rgb,c.a*wipe(a,u_completion/100.0,u_feather/100.0*0.3));` },
    iriswipe: { name: 'Iris Wipe', cat: 'Wipes', params: [DONE, FEATHER, O('shape', 'Shape', ['Circle', 'Diamond', 'Square'])],
      glsl: `vec2 hs=uSize*0.5+0.001, q=p-C; float r=u_shape<0.5?length(q)/length(hs):u_shape<1.5?(abs(q.x)+abs(q.y))/(hs.x+hs.y):max(abs(q.x)/hs.x,abs(q.y)/hs.y);
        o=vec4(c.rgb,c.a*wipe(1.0-r,u_completion/100.0,u_feather/100.0));` },
    blinds: { name: 'Venetian Blinds', cat: 'Wipes', params: [DONE, N('width', 'Blind width', 2, 500, 1, 40), N('angle', 'Angle°', -180, 180, 1, 0), FEATHER],
      glsl: `vec2 dir=vec2(cos(radians(u_angle)),sin(radians(u_angle))); float x=fract(dot(p,dir)/(u_width*uK+0.001));
        o=vec4(c.rgb,c.a*wipe(x,u_completion/100.0,u_feather/100.0));` },
    blockdissolve: { name: 'Block Dissolve', cat: 'Wipes', params: [DONE, N('block', 'Block size', 1, 300, 1, 24), N('soft', 'Softness %', 0, 100, 1, 10)],
      glsl: `float bs=max(1.0,u_block*uK); o=vec4(c.rgb,c.a*wipe(hash(floor(p/bs)+3.3),u_completion/100.0,u_soft/100.0));` },

    // ---------- Keying ----------
    chromakey: { name: 'Chroma Key', cat: 'Keying', params: [N('tolerance', 'Tolerance %', 0, 100, 1, 25), N('softness', 'Softness %', 0, 100, 1, 10), N('spill', 'Spill removal %', 0, 100, 1, 50)],
      colors: [COL('key', 'Key color', '#00ff00')],
      glsl: `float d=distance(yuv(c.rgb).yz,yuv(u_key).yz), tol=u_tolerance/100.0*0.4, sf=u_softness/100.0*0.4+0.0001;
        float f=smoothstep(tol,tol+sf,d); o=vec4(mix(c.rgb,vec3(lum(c.rgb)),u_spill/100.0*(1.0-f)),c.a*f);` },
    lumakey: { name: 'Luma Key', cat: 'Keying', params: [N('threshold', 'Threshold %', 0, 100, 1, 20), N('softness', 'Softness %', 0, 100, 1, 10), O('invert', 'Remove', ['Darks', 'Lights'])],
      glsl: `float f=smoothstep(u_threshold/100.0,u_threshold/100.0+u_softness/100.0+0.0001,lum(c.rgb)); if(u_invert>0.5) f=1.0-f; o=vec4(c.rgb,c.a*f);` }
  };
  /* Mask (not in the library: it's the Mask tab). The page passes everything already in render px:
     centre (mx, my), half size (hw, hh), rotation°, corner roundness %, feather px, invert 0/1. */
  DEFS.mask = { name: 'Mask', cat: 'Mask', hidden: true,
    params: [N('shape', 'Shape', 0, 5, 1, 2), N('mx', 'X', -1e6, 1e6, 0.01, 0), N('my', 'Y', -1e6, 1e6, 0.01, 0), N('hw', 'Half width', 0, 1e6, 0.01, 100),
      N('hh', 'Half height', 0, 1e6, 0.01, 100), N('rot', 'Rotation', -1e5, 1e5, 0.01, 0), N('round', 'Roundness', 0, 100, 1, 0),
      N('feather', 'Feather', 0, 1e5, 0.01, 0), N('invert', 'Invert', 0, 1, 1, 0)],
    glsl: `vec2 q=rot(-radians(u_rot))*(p-vec2(u_mx,u_my)); float hw=max(u_hw,0.001), hh=max(u_hh,0.001), d;
      if(u_shape<0.5) d=q.y;
      else if(u_shape<1.5) d=abs(q.y)-hh;
      else if(u_shape<2.5) d=(length(q/vec2(hw,hh))-1.0)*min(hw,hh);
      else if(u_shape<3.5){ float rd=u_round/100.0*min(hw,hh); vec2 e=abs(q)-vec2(hw,hh)+rd; d=length(max(e,0.0))+min(max(e.x,e.y),0.0)-rd; }
      else if(u_shape<4.5) d=sdHeart(vec2(q.x/hw*0.6,-q.y/hh*0.55+0.5))*hh/0.55;
      else { float s=min(hw,hh); d=sdStar5(vec2(q.x,-q.y)/s,1.0,0.45)*s; }
      float f=max(u_feather,0.75); float a=1.0-smoothstep(-f*0.5,f*0.5,d); if(u_invert>0.5) a=1.0-a; o=vec4(c.rgb,c.a*a);` };

  for (const t in DEFS) { const d = DEFS[t]; d.type = t; if (!d.kind) d.kind = 'gl'; d.params = d.params || []; d.colors = d.colors || []; }

  // Default settings for a new effect of this type (css types get theirs from the library presets)
  function defaults(type) {
    const d = DEFS[type], o = { type };
    for (const p of d.params) o[p.key] = p.def;
    for (const c of d.colors) o[c.key] = c.def;
    return o;
  }
  const isGL = type => !!DEFS[type] && DEFS[type].kind === 'gl';
  // Numeric settings that can be keyframed (everything numeric except option pickers)
  const animParams = type => isGL(type) ? DEFS[type].params.filter(p => !p.options).map(p => p.key) : [];

  function fragmentSource(type) {
    const d = DEFS[type];
    const uni = d.params.map(p => `uniform float u_${p.key};`).concat(d.colors.map(c => `uniform vec3 u_${c.key};`)).join('\n');
    return `${HEADER}\n${uni}\nvoid main(){ vec2 p=gl_FragCoord.xy; vec2 C=uCenter; vec4 c=tex(p); vec4 o=c;\n${d.glsl}\ngl_FragColor=clamp(o,0.0,1.0); }`;
  }

  const api = { CATEGORIES, DEFS, MASK_SHAPES, defaults, isGL, animParams, fragmentSource };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.AckFX = api;
})(typeof window !== 'undefined' ? window : globalThis);
