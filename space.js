// Full-screen WebGL cosmos: stars, nebula, a marbled purple planet with rings.
// Driven by window.SPACE = { scroll, beat, warp, mx, my } which app.js updates.
(function () {
  const S = (window.SPACE = { scroll: 0, beat: 0, warp: 0, mx: 0, my: 0 });
  const canvas = document.getElementById('space');
  const gl = canvas.getContext('webgl', { antialias: false, alpha: false, powerPreference: 'high-performance' });
  if (!gl) { canvas.classList.add('fallback'); return; }

  const mobile = document.documentElement.classList.contains('m');

  const vert = 'attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}';
  const frag = `
precision highp float;
uniform vec2 uRes; uniform float uT, uScroll, uBeat, uWarp; uniform vec2 uMouse;
#define OCT ${mobile ? 4 : 5}

float hash(vec2 p){ p=fract(p*vec2(123.34,456.21)); p+=dot(p,p+45.32); return fract(p.x*p.y); }
float noise(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f);
  return mix(mix(hash(i),hash(i+vec2(1,0)),f.x), mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x), f.y); }
float fbm(vec2 p){ float a=.5, v=0.; for(int i=0;i<OCT;i++){ v+=a*noise(p); p=p*2.03+vec2(17.1,9.2); a*=.5; } return v; }

vec3 stars(vec2 uv, float scale, float seed){
  uv*=scale; vec2 id=floor(uv), f=fract(uv)-.5;
  float h=hash(id+seed);
  vec2 off=(vec2(hash(id+seed+1.3),hash(id+seed+2.7))-.5)*.7;
  float d=length(f-off);
  float tw=.6+.4*sin(uT*(1.+h*3.)+h*40.);
  float b=smoothstep(.06,.0,d)*step(.82,h)*tw;
  return b*mix(vec3(.75,.8,1.),vec3(1.,.85,.7),hash(id+seed+5.));
}

void main(){
  vec2 uv=(gl_FragCoord.xy-.5*uRes)/uRes.y;
  uv+=uMouse*.02;
  float s=uScroll;
  vec3 col=vec3(0.);

  // hyperspace on launch: zoom plus radial streaks
  vec2 su=uv*(1.-uWarp*.85);
  for(int i=0;i<3;i++){
    float fi=float(i);
    vec2 q=su*(1.+fi*.35)+vec2(0.,s*(.25+fi*.3));
    col+=stars(q,14.+fi*9.,fi*13.)*(1.-fi*.22);
  }
  float ang=atan(uv.y,uv.x);
  col+=uWarp*vec3(.7,.6,1.)*pow(noise(vec2(ang*40.,uT*8.)),6.)*smoothstep(.0,.7,length(uv))*2.;

  // nebula
  vec2 p=uv*1.3+vec2(uT*.008,s*.7);
  float n=fbm(p+1.6*fbm(p*1.7-uT*.015));
  vec3 neb=mix(vec3(.28,.08,.62),vec3(.05,.25,.7),smoothstep(.3,.8,fbm(p*.6+4.)));
  neb=mix(neb,vec3(.95,.42,.12),smoothstep(.72,1.,s)*.75);
  col+=neb*pow(n,2.6)*(1.1+uBeat*.5);

  // planet travels across the sky as you scroll
  vec2 c=vec2(mix(${mobile ? '.12' : '.52'},-.62,s)+.06*sin(s*6.283), mix(${mobile ? '-.42' : '-.2'},.22,s)-.1*sin(s*3.1415));
  float r=${mobile ? '.30' : '.40'}*(1.-.25*s)*(1.+uBeat*.012);
  vec2 d=uv-c; float dl=length(d);

  // ring (drawn behind and in front of the planet)
  vec2 rq=mat2(.94,-.34,.34,.94)*d; rq.y/=.22;
  float rr=length(rq)/r;
  float band=smoothstep(1.45,1.55,rr)*smoothstep(2.25,2.05,rr);
  band*=.55+.45*sin(rr*70.)*sin(rr*23.+1.);
  vec3 ringCol=mix(vec3(.75,.55,1.),vec3(1.,.8,.6),rr-1.4)*band*.55;
  bool front=rq.y<0.;

  if(dl<r){
    vec3 nrm=vec3(d/r, sqrt(1.-dl*dl/(r*r)));
    vec2 sp=vec2(atan(nrm.x,nrm.z)+uT*.03, asin(nrm.y))*1.6;
    float m=fbm(sp*2.+2.5*fbm(sp*3.+uT*.01));
    vec3 surf=mix(vec3(.10,.03,.24),vec3(.62,.30,.98),smoothstep(.3,.75,m));
    surf=mix(surf,vec3(1.,.82,.95),smoothstep(.72,.9,m)*.6);
    vec3 L=normalize(vec3(-.6+uMouse.x*.3,.45,.65));
    float dif=clamp(dot(nrm,L),0.,1.);
    float rim=pow(1.-nrm.z,3.);
    vec3 pc=surf*(.04+1.15*dif)+vec3(.55,.35,1.)*rim*(.5+uBeat*.6)*smoothstep(-.3,.5,dot(nrm,L));
    col=pc;
    if(front) col=mix(col,ringCol*1.6,band*.8);
  } else {
    float glow=exp(-(dl-r)*${mobile ? '9.' : '7.'});
    col+=vec3(.5,.28,1.)*glow*(.45+uBeat*.35);
    col+=ringCol;
  }

  // Masada sunrise at the end of the page
  float sun=smoothstep(.8,1.,s);
  col+=vec3(1.,.5,.16)*sun*exp(-(uv.y+.55)*3.2)*.9;

  col+=uWarp*uWarp*vec3(.6,.5,1.)*.9;
  col*=1.-.45*dot(uv,uv)*.6;
  col=pow(col,vec3(.9));
  gl_FragColor=vec4(col,1.);
}`;

  function sh(type, src) {
    const o = gl.createShader(type); gl.shaderSource(o, src); gl.compileShader(o);
    if (!gl.getShaderParameter(o, gl.COMPILE_STATUS)) console.error(gl.getShaderInfoLog(o));
    return o;
  }
  const prog = gl.createProgram();
  gl.attachShader(prog, sh(gl.VERTEX_SHADER, vert));
  gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, frag));
  gl.linkProgram(prog); gl.useProgram(prog);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, 'p');
  gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  const U = {};
  ['uRes', 'uT', 'uScroll', 'uBeat', 'uWarp', 'uMouse'].forEach(n => (U[n] = gl.getUniformLocation(prog, n)));

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, mobile ? 1 : 1.25);
    canvas.width = Math.round(innerWidth * dpr); canvas.height = Math.round(innerHeight * dpr);
    gl.viewport(0, 0, canvas.width, canvas.height);
  }
  addEventListener('resize', resize); resize();

  let sScroll = 0, mx = 0, my = 0;
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  function frame(t) {
    sScroll += (S.scroll - sScroll) * 0.06;
    mx += (S.mx - mx) * 0.05; my += (S.my - my) * 0.05;
    gl.uniform2f(U.uRes, canvas.width, canvas.height);
    gl.uniform1f(U.uT, still ? 20 : t / 1000);
    gl.uniform1f(U.uScroll, sScroll);
    gl.uniform1f(U.uBeat, S.beat);
    gl.uniform1f(U.uWarp, S.warp);
    gl.uniform2f(U.uMouse, mx, my);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    if (!document.hidden) requestAnimationFrame(frame);
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden) requestAnimationFrame(frame); });
  requestAnimationFrame(frame);
})();
