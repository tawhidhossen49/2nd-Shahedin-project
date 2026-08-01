/* =========================================================
   light-rays.js — volumetric hero light
   ---------------------------------------------------------
   Ported from the Kexsio LightRays React component. Two things
   had to change rather than be copied across:

   1. NO ogl, NO React. This project is vanilla HTML/CSS/JS on
      Live Server with no bundler, so the npm import could not
      come with it. The valuable part is the fragment shader,
      which is plain GLSL and owes nothing to either — it runs
      here on raw WebGL with a full-screen triangle. Same maths,
      same look, zero dependencies.

   2. THE COLOUR. The original ends with a hard-coded per-channel
      ramp:
          fragColor.x *= 0.1 + brightness * 0.8;
          fragColor.y *= 0.3 + brightness * 0.6;
          fragColor.z *= 0.5 + brightness * 0.5;
      Blue is lifted the most and red crushed the hardest, which
      is what gives that version its cool cast — and it fights
      raysColor rather than obeying it. Here the ramp is neutral,
      so it still falls off vertically but the hue comes entirely
      from raysColor, read from --warm-glow in tokens.css.

   Everything else is kept from the earlier canvas version:
     · stops when scrolled out of view (IntersectionObserver)
     · stops when the tab is hidden
     · prefers-reduced-motion renders ONE static frame, no loop
     · device pixel ratio capped, harder in lite mode
     · lite mode on coarse pointers and narrow viewports
     · falls back to a 2D canvas renderer if WebGL is unavailable,
       so a blocklisted driver degrades instead of going blank

   API
     window.LightRays.start(el, opts) / .destroy(el)
     data-lightrays="lite"  force lite mode
     data-lightrays="off"   skip the host entirely
   ========================================================= */
(function () {
  "use strict";

  var instances = [];

  function readToken(name, fallback) {
    try {
      var v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
      return v || fallback;
    } catch (e) { return fallback; }
  }

  /* "#ffb37a" -> [1, 0.70, 0.48]. Accepts #rgb and #rrggbb. */
  function hexToRgb(hex) {
    var s = String(hex || "").trim();
    var m3 = /^#?([a-f\d])([a-f\d])([a-f\d])$/i.exec(s);
    if (m3) s = "#" + m3[1] + m3[1] + m3[2] + m3[2] + m3[3] + m3[3];
    var m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(s);
    return m
      ? [parseInt(m[1], 16) / 255, parseInt(m[2], 16) / 255, parseInt(m[3], 16) / 255]
      : [1, 1, 1];
  }

  /* Light enters from above the top edge, pointing down. */
  function anchorAndDir(w, h) {
    var outside = 0.2;
    return { anchor: [0.5 * w, -outside * h], dir: [0, 1] };
  }

  var VERT =
    "attribute vec2 position;" +
    "void main(){ gl_Position = vec4(position, 0.0, 1.0); }";

  var FRAG = [
    "precision highp float;",
    "uniform float iTime;",
    "uniform vec2  iResolution;",
    "uniform vec2  rayPos;",
    "uniform vec2  rayDir;",
    "uniform vec3  raysColor;",
    "uniform float raysSpeed;",
    "uniform float lightSpread;",
    "uniform float rayLength;",
    "uniform float pulsating;",
    "uniform float fadeDistance;",
    "uniform float saturation;",
    "uniform vec2  mousePos;",
    "uniform float mouseInfluence;",
    "uniform float noiseAmount;",
    "uniform float distortion;",

    "float noise(vec2 st){",
    "  return fract(sin(dot(st.xy, vec2(12.9898,78.233))) * 43758.5453123);",
    "}",

    "float rayStrength(vec2 raySource, vec2 rayRefDirection, vec2 coord,",
    "                  float seedA, float seedB, float speed){",
    "  vec2 sourceToCoord = coord - raySource;",
    "  vec2 dirNorm = normalize(sourceToCoord);",
    "  float cosAngle = dot(dirNorm, rayRefDirection);",
    "  float distortedAngle = cosAngle + distortion * sin(iTime * 2.0 + length(sourceToCoord) * 0.01) * 0.2;",
    "  float spreadFactor = pow(max(distortedAngle, 0.0), 1.0 / max(lightSpread, 0.001));",
    "  float dist = length(sourceToCoord);",
    "  float maxDistance = iResolution.x * rayLength;",
    "  float lengthFalloff = clamp((maxDistance - dist) / maxDistance, 0.0, 1.0);",
    "  float fadeFalloff = clamp((iResolution.x * fadeDistance - dist) / (iResolution.x * fadeDistance), 0.5, 1.0);",
    "  float pulse = pulsating > 0.5 ? (0.8 + 0.2 * sin(iTime * speed * 3.0)) : 1.0;",
    "  float baseStrength = clamp(",
    "    (0.45 + 0.15 * sin(distortedAngle * seedA + iTime * speed)) +",
    "    (0.3 + 0.2 * cos(-distortedAngle * seedB + iTime * speed)),",
    "    0.0, 1.0);",
    "  return baseStrength * lengthFalloff * fadeFalloff * spreadFactor * pulse;",
    "}",

    "void main(){",
    "  vec2 fragCoord = gl_FragCoord.xy;",
    "  vec2 coord = vec2(fragCoord.x, iResolution.y - fragCoord.y);",
    "  vec2 finalRayDir = rayDir;",
    "  if (mouseInfluence > 0.0) {",
    "    vec2 mouseScreenPos = mousePos * iResolution.xy;",
    "    vec2 mouseDirection = normalize(mouseScreenPos - rayPos);",
    "    finalRayDir = normalize(mix(rayDir, mouseDirection, mouseInfluence));",
    "  }",
    "  vec4 rays1 = vec4(1.0) * rayStrength(rayPos, finalRayDir, coord, 36.2214, 21.11349, 1.5 * raysSpeed);",
    "  vec4 rays2 = vec4(1.0) * rayStrength(rayPos, finalRayDir, coord, 22.3991, 18.0234,  1.1 * raysSpeed);",
    "  vec4 fragColor = rays1 * 0.5 + rays2 * 0.4;",
    "  if (noiseAmount > 0.0) {",
    "    float n = noise(coord * 0.01 + iTime * 0.1);",
    "    fragColor.rgb *= (1.0 - noiseAmount + noiseAmount * n);",
    "  }",
    /* NEUTRAL vertical falloff. The original lifted blue and crushed red
       here, which is the entire source of its cool cast and which overrode
       raysColor. Falling off on all three channels equally keeps the shape
       of the light and lets the tint below decide the hue. */
    "  float brightness = 1.0 - (coord.y / iResolution.y);",
    "  fragColor.rgb *= 0.25 + brightness * 0.75;",
    "  if (saturation != 1.0) {",
    "    float gray = dot(fragColor.rgb, vec3(0.299, 0.587, 0.114));",
    "    fragColor.rgb = mix(vec3(gray), fragColor.rgb, saturation);",
    "  }",
    "  fragColor.rgb *= raysColor;",
    "  gl_FragColor = vec4(fragColor.rgb, 1.0) * fragColor.a;",
    "}",
  ].join("\n");

  function compile(gl, type, src) {
    var sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      gl.deleteShader(sh);
      return null;
    }
    return sh;
  }

  function Rays(host, opts) {
    opts = opts || {};
    this.host = host;
    this.raf = 0;
    this.running = false;
    this.t = 0;

    var flag = host.getAttribute("data-lightrays") || "";
    var coarse = window.matchMedia("(pointer: coarse)").matches;
    this.lite = flag === "lite" || opts.lite === true || coarse || window.innerWidth < 900;
    this.reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    /* Preset. Tuned down from the reference's defaults: this sits behind a
       portrait and headline, not on an empty stage, so the spread is tighter
       and the speed slower. */
    this.cfg = {
      raysSpeed: 0.7,
      lightSpread: 0.72,
      rayLength: 1.5,
      pulsating: 0,
      fadeDistance: 1.1,
      saturation: 1.0,
      mouseInfluence: this.lite ? 0.0 : 0.06,
      noiseAmount: 0.06,
      distortion: 0.02,
    };

    var canvas = document.createElement("canvas");
    canvas.className = "light-rays";
    canvas.setAttribute("aria-hidden", "true");
    host.insertBefore(canvas, host.firstChild);
    this.canvas = canvas;

    this.color = hexToRgb(readToken("--warm-glow", "#ffb37a"));

    this.mouse = { x: 0.5, y: 0.35 };
    this.smooth = { x: 0.5, y: 0.35 };

    this.onResize = this.resize.bind(this);
    this.onVisibility = this.visibility.bind(this);
    this.onMouse = this.mousemove.bind(this);
    this.frame = this.frame.bind(this);

    if (!this.initGL()) { this.initFallback(); }

    this.resize();
    window.addEventListener("resize", this.onResize, { passive: true });
    document.addEventListener("visibilitychange", this.onVisibility);
    if (this.cfg.mouseInfluence > 0 && !this.reduced) {
      window.addEventListener("mousemove", this.onMouse, { passive: true });
    }

    if (this.reduced) {
      this.draw();                 // one static frame, no loop
    } else if ("IntersectionObserver" in window) {
      var self = this;
      this.io = new IntersectionObserver(function (entries) {
        entries.forEach(function (e) { if (e.isIntersecting) self.start(); else self.stop(); });
      }, { threshold: 0 });
      this.io.observe(host);
    } else {
      this.start();
    }
  }

  Rays.prototype.initGL = function () {
    var gl = null;
    try {
      var attrs = { alpha: true, antialias: false, depth: false, stencil: false, premultipliedAlpha: true };
      gl = this.canvas.getContext("webgl", attrs) || this.canvas.getContext("experimental-webgl", attrs);
    } catch (e) { gl = null; }
    if (!gl) return false;

    var vs = compile(gl, gl.VERTEX_SHADER, VERT);
    var fs = compile(gl, gl.FRAGMENT_SHADER, FRAG);
    if (!vs || !fs) return false;

    var prog = gl.createProgram();
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return false;
    gl.useProgram(prog);

    // One oversized triangle covers the viewport with no index buffer.
    var buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    var loc = gl.getAttribLocation(prog, "position");
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);   // premultiplied
    gl.clearColor(0, 0, 0, 0);

    var u = {};
    ["iTime","iResolution","rayPos","rayDir","raysColor","raysSpeed","lightSpread",
     "rayLength","pulsating","fadeDistance","saturation","mousePos","mouseInfluence",
     "noiseAmount","distortion"].forEach(function (n) { u[n] = gl.getUniformLocation(prog, n); });

    this.gl = gl; this.prog = prog; this.u = u; this.buf = buf;
    return true;
  };

  /* 2D fallback: soft beam sprites, blurred once at init. Not as smooth as the
     shader, but it means a blocklisted GPU gets light rather than a blank band. */
  Rays.prototype.initFallback = function () {
    this.ctx = this.canvas.getContext("2d");
    this.fallback = true;
  };

  Rays.prototype.buildSprite = function (len, wide, blur) {
    var rgb = this.color.map(function (v) { return Math.round(v * 255); }).join(",");
    var pad = blur * 2;
    var c = document.createElement("canvas");
    c.width = Math.ceil(wide + pad * 2);
    c.height = Math.ceil(len + pad * 2);
    var g = c.getContext("2d");
    if (!g) return c;
    var cx = c.width / 2;
    var grad = g.createLinearGradient(0, pad, 0, pad + len);
    grad.addColorStop(0, "rgba(" + rgb + ",0.40)");
    grad.addColorStop(0.35, "rgba(" + rgb + ",0.15)");
    grad.addColorStop(1, "rgba(" + rgb + ",0)");
    if (typeof g.filter === "string") g.filter = "blur(" + blur + "px)";
    g.fillStyle = grad;
    g.beginPath();
    g.moveTo(cx - wide * 0.06, pad); g.lineTo(cx + wide * 0.06, pad);
    g.lineTo(cx + wide * 0.5, pad + len); g.lineTo(cx - wide * 0.5, pad + len);
    g.closePath(); g.fill(); g.filter = "none";
    return c;
  };

  Rays.prototype.resize = function () {
    var r = this.host.getBoundingClientRect();
    var w = Math.max(1, Math.round(r.width));
    var h = Math.max(1, Math.round(r.height));
    var cap = this.lite ? 1 : 1.5;
    var dpr = Math.min(window.devicePixelRatio || 1, cap);

    this.w = w; this.h = h; this.dpr = dpr;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);

    if (this.gl) {
      this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    } else if (this.ctx) {
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      var len = h * 1.5;
      var wide = Math.max(120, w * (this.lite ? 0.32 : 0.24));
      this.sprite = this.buildSprite(len, wide, this.lite ? 18 : 30);
      this.rays = [];
      var count = this.lite ? 5 : 9;
      for (var i = 0; i < count; i++) {
        var spread = (i / (count - 1) - 0.5) * 2;
        this.rays.push({
          angle: spread * 0.42, wobble: 0.02 + Math.abs(spread) * 0.03,
          speed: 0.06 + (i % 3) * 0.022, phase: i * 1.7,
          alpha: 0.5 + (1 - Math.abs(spread)) * 0.5,
        });
      }
    }
    if (this.reduced || !this.running) this.draw();
  };

  Rays.prototype.draw = function () {
    if (this.gl) return this.drawGL();
    return this.draw2D();
  };

  Rays.prototype.drawGL = function () {
    var gl = this.gl, u = this.u;
    var W = this.canvas.width, H = this.canvas.height;
    var ad = anchorAndDir(W, H);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.uniform1f(u.iTime, this.t);
    gl.uniform2f(u.iResolution, W, H);
    gl.uniform2f(u.rayPos, ad.anchor[0], ad.anchor[1]);
    gl.uniform2f(u.rayDir, ad.dir[0], ad.dir[1]);
    gl.uniform3f(u.raysColor, this.color[0], this.color[1], this.color[2]);
    gl.uniform1f(u.raysSpeed, this.cfg.raysSpeed);
    gl.uniform1f(u.lightSpread, this.cfg.lightSpread);
    gl.uniform1f(u.rayLength, this.cfg.rayLength);
    gl.uniform1f(u.pulsating, this.cfg.pulsating);
    gl.uniform1f(u.fadeDistance, this.cfg.fadeDistance);
    gl.uniform1f(u.saturation, this.cfg.saturation);
    gl.uniform2f(u.mousePos, this.smooth.x, this.smooth.y);
    gl.uniform1f(u.mouseInfluence, this.cfg.mouseInfluence);
    gl.uniform1f(u.noiseAmount, this.cfg.noiseAmount);
    gl.uniform1f(u.distortion, this.cfg.distortion);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };

  Rays.prototype.draw2D = function () {
    var ctx = this.ctx, w = this.w, h = this.h;
    if (!ctx || !this.sprite) return;
    ctx.clearRect(0, 0, w, h);
    var ox = w * 0.5, oy = -h * 0.12;
    ctx.globalCompositeOperation = "lighter";
    for (var i = 0; i < this.rays.length; i++) {
      var r = this.rays[i];
      var breathe = Math.sin(this.t * r.speed * 8 + r.phase);
      ctx.save();
      ctx.translate(ox, oy);
      ctx.rotate(r.angle + breathe * r.wobble);
      ctx.globalAlpha = r.alpha * (0.62 + breathe * 0.2);
      ctx.drawImage(this.sprite, -this.sprite.width / 2, 0);
      ctx.restore();
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
  };

  Rays.prototype.mousemove = function (e) {
    var r = this.host.getBoundingClientRect();
    this.mouse.x = (e.clientX - r.left) / Math.max(1, r.width);
    this.mouse.y = (e.clientY - r.top) / Math.max(1, r.height);
  };

  Rays.prototype.frame = function (now) {
    this.t = (now || 0) * 0.001;
    // Same easing the reference uses, so the beam trails the cursor instead
    // of snapping to it.
    var s = 0.92;
    this.smooth.x = this.smooth.x * s + this.mouse.x * (1 - s);
    this.smooth.y = this.smooth.y * s + this.mouse.y * (1 - s);
    this.draw();
    this.raf = requestAnimationFrame(this.frame);
  };

  Rays.prototype.start = function () {
    if (this.running || this.reduced || document.hidden) return;
    this.running = true;
    this.raf = requestAnimationFrame(this.frame);
  };

  Rays.prototype.stop = function () {
    this.running = false;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
  };

  Rays.prototype.visibility = function () {
    if (document.hidden) this.stop();
    else if (this.io || !("IntersectionObserver" in window)) this.start();
  };

  Rays.prototype.destroy = function () {
    this.stop();
    window.removeEventListener("resize", this.onResize);
    window.removeEventListener("mousemove", this.onMouse);
    document.removeEventListener("visibilitychange", this.onVisibility);
    if (this.io) this.io.disconnect();
    if (this.gl) {
      try {
        var ext = this.gl.getExtension("WEBGL_lose_context");
        if (ext) ext.loseContext();
      } catch (e) { /* context already gone */ }
    }
    if (this.canvas && this.canvas.parentNode) this.canvas.parentNode.removeChild(this.canvas);
  };

  function start(el, opts) {
    if (!el || el.getAttribute("data-lightrays") === "off") return null;
    if (el.__lightRays) return el.__lightRays;
    if (!document.createElement("canvas").getContext) return null;
    var inst = new Rays(el, opts);
    el.__lightRays = inst;
    instances.push(inst);
    return inst;
  }

  function destroy(el) {
    if (!el || !el.__lightRays) return;
    el.__lightRays.destroy();
    instances.splice(instances.indexOf(el.__lightRays), 1);
    delete el.__lightRays;
  }

  function init() {
    var hosts = document.querySelectorAll(".hero, [data-lightrays]");
    for (var i = 0; i < hosts.length; i++) start(hosts[i]);
  }

  window.LightRays = { start: start, destroy: destroy, instances: instances };

  if (document.readyState !== "loading") init();
  else document.addEventListener("DOMContentLoaded", init);
})();
