/* =========================================================
   light-rays.js — canvas-driven volumetric light for the hero
   ---------------------------------------------------------
   A self-contained animated background. No dependencies, no
   build step, no external assets, no markup required: it finds
   its host, injects its own <canvas> and owns its lifecycle.

   HOW IT STAYS CHEAP
   The naive version of this effect blurs a fresh path every
   frame, which is what makes most copy-paste light-ray
   backgrounds drop frames on a phone. Here the expensive part
   is paid ONCE: a soft-edged beam is rendered into an offscreen
   sprite at init, and each frame is then 6-9 transformed
   drawImage calls. Per-frame cost is transform + composite
   only, with no filter, no path filling and no gradient
   rebuilding.

   Further guards, in order of how much they save:
     · stops completely when scrolled out of view (IO)
     · stops when the tab is hidden
     · prefers-reduced-motion renders ONE static frame, no loop
     · device pixel ratio capped, and capped harder in lite mode
     · lite mode (fewer rays, lower resolution) on small screens
       and coarse pointers, or on demand

   COLOUR
   Deliberately NOT the cool blue-grey of the usual version of
   this effect. It reads from --warm-glow and --accent-ink in
   tokens.css, so the light belongs to this site's warm-ink
   palette instead of importing another brand's.

   API
     window.LightRays.start(el, opts)  attach to a host element
     window.LightRays.destroy(el)      detach and clean up
     data-lightrays="lite"             force lite mode
     data-lightrays="off"              skip the host entirely
   ========================================================= */
(function () {
  "use strict";

  var instances = [];

  function readToken(name, fallback) {
    try {
      var v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
      return v || fallback;
    } catch (e) {
      return fallback;
    }
  }

  /* Accepts #rgb / #rrggbb and returns "r,g,b" for use in rgba(). Falls back
     rather than throwing, because a missing token must not kill the hero. */
  function rgbOf(color, fallback) {
    var hex = String(color || "").trim();
    var m3 = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(hex);
    if (m3) hex = "#" + m3[1] + m3[1] + m3[2] + m3[2] + m3[3] + m3[3];
    var m6 = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
    if (!m6) return fallback;
    return parseInt(m6[1], 16) + "," + parseInt(m6[2], 16) + "," + parseInt(m6[3], 16);
  }

  /* ---- the beam sprite: the only blurred draw in the whole module ----
     A tapered wedge, narrow at the origin and wide at the far end, with the
     gradient fading along its length. Blurring it here means every frame
     afterwards gets soft edges for free. */
  function buildBeam(len, wide, rgb, blur) {
    var pad = blur * 2;
    var c = document.createElement("canvas");
    c.width = Math.ceil(wide + pad * 2);
    c.height = Math.ceil(len + pad * 2);
    var g = c.getContext("2d");
    if (!g) return c;

    var cx = c.width / 2;
    var grad = g.createLinearGradient(0, pad, 0, pad + len);
    grad.addColorStop(0, "rgba(" + rgb + ",0.42)");
    grad.addColorStop(0.35, "rgba(" + rgb + ",0.16)");
    grad.addColorStop(1, "rgba(" + rgb + ",0)");

    if (typeof g.filter === "string") g.filter = "blur(" + blur + "px)";
    g.fillStyle = grad;
    g.beginPath();
    g.moveTo(cx - wide * 0.06, pad);          // narrow at the source
    g.lineTo(cx + wide * 0.06, pad);
    g.lineTo(cx + wide * 0.5, pad + len);     // wide at the far end
    g.lineTo(cx - wide * 0.5, pad + len);
    g.closePath();
    g.fill();
    g.filter = "none";
    return c;
  }

  function Rays(host, opts) {
    opts = opts || {};
    this.host = host;
    this.raf = 0;
    this.running = false;
    this.t = 0;

    var flag = host.getAttribute("data-lightrays") || "";
    var coarse = window.matchMedia("(pointer: coarse)").matches;
    var narrow = window.innerWidth < 900;
    this.lite = flag === "lite" || opts.lite === true || coarse || narrow;

    this.reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    this.count = this.lite ? 5 : 9;

    var canvas = document.createElement("canvas");
    canvas.className = "light-rays";
    canvas.setAttribute("aria-hidden", "true");
    host.insertBefore(canvas, host.firstChild);
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d", { alpha: true });

    var warm = rgbOf(readToken("--warm-glow", "#ffb37a"), "255,179,122");
    var accent = rgbOf(readToken("--accent-ink", "#f4677d"), "244,103,125");

    /* Each ray gets a fixed identity at init: angle, width, speed, phase and
       which of the two tints it carries. Nothing is randomised per frame, so
       the motion is a slow breathing drift rather than a shimmer. */
    this.rays = [];
    for (var i = 0; i < this.count; i++) {
      var spread = (i / (this.count - 1) - 0.5) * 2;   // -1 .. 1
      this.rays.push({
        angle: spread * 0.42,
        wobble: 0.02 + Math.abs(spread) * 0.03,
        speed: 0.06 + (i % 3) * 0.022,
        phase: i * 1.7,
        alpha: 0.5 + (1 - Math.abs(spread)) * 0.5,
        warm: i % 3 !== 1,
      });
    }

    this.tints = { warm: warm, accent: accent };
    this.onResize = this.resize.bind(this);
    this.onVisibility = this.visibility.bind(this);
    this.frame = this.frame.bind(this);

    this.resize();
    window.addEventListener("resize", this.onResize, { passive: true });
    document.addEventListener("visibilitychange", this.onVisibility);

    if (this.reduced) {
      this.draw();                 // one static frame, no loop
    } else if ("IntersectionObserver" in window) {
      var self = this;
      this.io = new IntersectionObserver(function (entries) {
        entries.forEach(function (e) {
          if (e.isIntersecting) self.start(); else self.stop();
        });
      }, { threshold: 0 });
      this.io.observe(host);
    } else {
      this.start();
    }
  }

  Rays.prototype.resize = function () {
    var r = this.host.getBoundingClientRect();
    var w = Math.max(1, Math.round(r.width));
    var h = Math.max(1, Math.round(r.height));
    // Rays are soft by nature, so they survive a low backing store. This is
    // the single biggest perf lever on a phone.
    var cap = this.lite ? 1 : 1.5;
    var dpr = Math.min(window.devicePixelRatio || 1, cap);

    this.w = w;
    this.h = h;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    var len = h * 1.5;
    var wide = Math.max(120, w * (this.lite ? 0.32 : 0.24));
    var blur = this.lite ? 18 : 30;
    this.beamWarm = buildBeam(len, wide, this.tints.warm, blur);
    this.beamAccent = buildBeam(len, wide, this.tints.accent, blur);
    this.beamLen = len;

    if (this.reduced || !this.running) this.draw();
  };

  Rays.prototype.draw = function () {
    var ctx = this.ctx, w = this.w, h = this.h;
    if (!ctx) return;
    ctx.clearRect(0, 0, w, h);

    // origin sits above the top edge, so the beams read as light entering
    var ox = w * 0.5;
    var oy = -h * 0.12;

    ctx.globalCompositeOperation = "lighter";
    for (var i = 0; i < this.rays.length; i++) {
      var r = this.rays[i];
      var breathe = Math.sin(this.t * r.speed + r.phase);
      var angle = r.angle + breathe * r.wobble;
      var sprite = r.warm ? this.beamWarm : this.beamAccent;

      ctx.save();
      ctx.translate(ox, oy);
      ctx.rotate(angle);
      ctx.globalAlpha = r.alpha * (0.62 + breathe * 0.2) * (this.lite ? 0.9 : 1);
      ctx.drawImage(sprite, -sprite.width / 2, 0, sprite.width, sprite.height);
      ctx.restore();
    }

    // a soft bloom where the light enters, sold as one radial rather than
    // another set of beams
    var bloom = ctx.createRadialGradient(ox, oy + h * 0.06, 0, ox, oy + h * 0.06, h * 0.55);
    bloom.addColorStop(0, "rgba(" + this.tints.warm + ",0.10)");
    bloom.addColorStop(1, "rgba(" + this.tints.warm + ",0)");
    ctx.globalAlpha = 1;
    ctx.fillStyle = bloom;
    ctx.fillRect(0, 0, w, h);
    ctx.globalCompositeOperation = "source-over";
  };

  Rays.prototype.frame = function () {
    this.t += this.lite ? 0.006 : 0.0085;   // slow drift, never a shimmer
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
    document.removeEventListener("visibilitychange", this.onVisibility);
    if (this.io) this.io.disconnect();
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
