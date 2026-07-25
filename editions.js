/* 这一帧怎么说 · Editions 级交互首页
   Lenis 平滑滚动 + GSAP ScrollTrigger 章节编排 + 全站粒子画布 */
(() => {
  "use strict";
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ——— Loading:粒子聚成「帧」——— */
  const loader = document.getElementById("loader");
  const finishLoad = () => {
    if (!loader || loader.classList.contains("done")) return;
    loader.classList.add("done");
    document.body.classList.add("loaded");
    setTimeout(() => loader.remove(), 950);
  };
  if (loader) {
    if (reduced) {
      finishLoad();
    } else {
      const canvas = document.getElementById("loaderCanvas");
      const ctx = canvas.getContext("2d");
      const dpr = Math.min(devicePixelRatio || 1, 2);
      const resize = () => {
        canvas.width = innerWidth * dpr;
        canvas.height = innerHeight * dpr;
      };
      resize();
      const sampleGlyph = () => {
        const S = 320;
        const off = document.createElement("canvas");
        off.width = S;
        off.height = S;
        const o = off.getContext("2d");
        o.fillStyle = "#fff";
        o.font = `800 ${S * 0.74}px "Noto Sans SC", "PingFang SC", sans-serif`;
        o.textAlign = "center";
        o.textBaseline = "middle";
        o.fillText("帧", S / 2, S / 2 + S * 0.03);
        const data = o.getImageData(0, 0, S, S).data;
        const pts = [];
        for (let y = 0; y < S; y += 4) {
          for (let x = 0; x < S; x += 4) {
            if (data[(y * S + x) * 4 + 3] > 120) pts.push({ x: x / S - 0.5, y: y / S - 0.5 });
          }
        }
        return pts;
      };
      const easeOutExpo = (t) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t));
      const start = () => {
        const pts = sampleGlyph();
        const scale = Math.min(innerWidth, innerHeight) * 0.34;
        const cx = innerWidth / 2;
        const cy = innerHeight / 2 - innerHeight * 0.03;
        const ASSEMBLE = 1400;
        const HOLD = 600;
        const BURST = 650;
        const particles = pts.map((p) => {
          const roll = Math.random();
          return {
            sx: Math.random() * innerWidth,
            sy: Math.random() * innerHeight,
            tx: cx + p.x * scale,
            ty: cy + p.y * scale,
            delay: Math.random() * 400,
            r: Math.random() * 1.1 + 0.8,
            color: roll < 0.12 ? "163,230,53" : roll < 0.2 ? "246,168,200" : "255,255,255",
            vx: 0, vy: 0, bx: 0, by: 0
          };
        });
        const t0 = performance.now();
        let raf;
        const tick = (now) => {
          const el = now - t0;
          ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
          ctx.clearRect(0, 0, innerWidth, innerHeight);
          for (const p of particles) {
            let x, y, alpha;
            if (el < ASSEMBLE + p.delay) {
              const t = easeOutExpo(Math.max(0, Math.min(1, (el - p.delay) / (ASSEMBLE - 300))));
              x = p.sx + (p.tx - p.sx) * t;
              y = p.sy + (p.ty - p.sy) * t;
              alpha = 0.25 + t * 0.75;
              p.bx = x; p.by = y;
            } else if (el < ASSEMBLE + HOLD) {
              x = p.tx; y = p.ty; alpha = 1;
              p.bx = x; p.by = y;
            } else {
              if (!p.vx && !p.vy) {
                const ang = Math.atan2(p.by - cy, p.bx - cx) + (Math.random() - 0.5);
                const sp = Math.random() * 4 + 2;
                p.vx = Math.cos(ang) * sp;
                p.vy = Math.sin(ang) * sp;
              }
              const bt = (el - ASSEMBLE - HOLD) / BURST;
              p.vx *= 1.02; p.vy *= 1.02;
              p.bx += p.vx; p.by += p.vy;
              x = p.bx; y = p.by;
              alpha = Math.max(0, 1 - bt);
            }
            if (alpha <= 0) continue;
            ctx.fillStyle = `rgba(${p.color},${alpha})`;
            ctx.beginPath();
            ctx.arc(x, y, p.r, 0, Math.PI * 2);
            ctx.fill();
          }
          if (el < ASSEMBLE + HOLD + BURST) raf = requestAnimationFrame(tick);
          else finishLoad();
        };
        raf = requestAnimationFrame(tick);
        loader.addEventListener("click", () => { cancelAnimationFrame(raf); finishLoad(); });
      };
      Promise.race([
        document.fonts.load('800 160px "Noto Sans SC"', "帧").catch(() => {}),
        new Promise((r) => setTimeout(r, 900))
      ]).then(start);
    }
  }

  if (reduced || !window.gsap) {
    document.body.classList.add("loaded");
    if (!window.gsap) console.warn("GSAP 未加载,使用静态布局");
    return;
  }

  gsap.registerPlugin(ScrollTrigger);

  /* ——— Lenis 平滑滚动 ——— */
  let lenis = null;
  if (window.Lenis) {
    lenis = new Lenis({ lerp: 0.09, smoothWheel: true });
    lenis.on("scroll", ScrollTrigger.update);
    gsap.ticker.add((t) => lenis.raf(t * 1000));
    gsap.ticker.lagSmoothing(0);
  }
  const scrollTo = (target) => {
    if (lenis) lenis.scrollTo(target, { offset: -20 });
    else document.querySelector(target)?.scrollIntoView({ behavior: "smooth" });
  };
  document.querySelectorAll('a[href^="#"]').forEach((a) => {
    a.addEventListener("click", (e) => {
      e.preventDefault();
      scrollTo(a.getAttribute("href"));
    });
  });

  /* ——— 全站粒子画布:花瓣流,随章节换主题色 ——— */
  const THEMES = {
    spring: ["163,230,53", "196,244,130", "96,168,70", "246,168,200", "255,255,255"],
    blossom: ["246,168,200", "255,200,220", "255,255,255", "163,230,53"],
    aurora: ["169,140,255", "120,200,220", "255,255,255", "163,230,53"],
    gold: ["255,213,104", "255,236,180", "163,230,53", "255,255,255"]
  };
  const petals = document.getElementById("petals");
  const pctx = petals.getContext("2d");
  const dpr = Math.min(devicePixelRatio || 1, 2);
  let W = 0, H = 0, palette = THEMES.spring, scrollVel = 0;
  const sizePetals = () => {
    W = innerWidth; H = innerHeight;
    petals.width = W * dpr;
    petals.height = H * dpr;
  };
  sizePetals();
  addEventListener("resize", sizePetals);
  if (lenis) lenis.on("scroll", (e) => { scrollVel = Math.min(Math.abs(e.velocity) / 40, 2); });
  const spawnPetal = () => ({
    x: Math.random() * W,
    y: Math.random() * H,
    vx: 0, vy: 0,
    speed: Math.random() * 0.8 + 0.4,
    size: Math.random() * 1.5 + 0.5,
    color: palette[(Math.random() * palette.length) | 0],
    alpha: Math.random() * 0.5 + 0.18,
    life: Math.random() * 500 + 300
  });
  const petalCount = Math.min(750, Math.floor((innerWidth * innerHeight) / 2600));
  const petalList = Array.from({ length: petalCount }, spawnPetal);
  let pt = 0;
  const field = (x, y) =>
    (Math.cos(x * 0.0021 + pt * 0.35) + Math.sin(y * 0.0027 - pt * 0.28)
      + Math.sin((x + y) * 0.0013 + pt * 0.18)) * Math.PI * 0.7;
  const petalStep = () => {
    pt += 0.008 + scrollVel * 0.01;
    scrollVel *= 0.94;
    pctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    pctx.globalCompositeOperation = "destination-in";
    pctx.fillStyle = "rgba(0,0,0,0.9)";
    pctx.fillRect(0, 0, W, H);
    pctx.globalCompositeOperation = "source-over";
    for (const p of petalList) {
      const a = field(p.x, p.y);
      p.vx += Math.cos(a) * 0.04 * p.speed;
      p.vy += Math.sin(a) * 0.04 * p.speed - 0.003;
      p.vx *= 0.96; p.vy *= 0.96;
      p.x += p.vx; p.y += p.vy;
      if (--p.life < 0 || p.x < -12 || p.x > W + 12 || p.y < -12 || p.y > H + 12) {
        Object.assign(p, spawnPetal());
      }
      pctx.fillStyle = `rgba(${p.color},${p.alpha})`;
      pctx.beginPath();
      pctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      pctx.fill();
    }
    requestAnimationFrame(petalStep);
  };
  requestAnimationFrame(petalStep);

  /* ——— 极光星云画布:大面积流动色场(对标 Editions hero)——— */
  const AURORA_THEMES = {
    spring: [[52, 148, 92], [246, 105, 180], [120, 210, 60], [46, 56, 165]],
    blossom: [[246, 105, 180], [255, 150, 200], [125, 92, 255], [120, 210, 60]],
    aurora: [[125, 92, 255], [80, 200, 230], [169, 140, 255], [246, 105, 180]],
    gold: [[255, 180, 60], [246, 105, 180], [120, 210, 60], [125, 92, 255]]
  };
  const aurora = document.getElementById("aurora");
  const actx = aurora.getContext("2d");
  const ASCALE = 0.25;
  let aw = 0, ah = 0, auroraTheme = "spring";
  const sizeAurora = () => {
    aw = Math.max(2, Math.round(innerWidth * ASCALE));
    ah = Math.max(2, Math.round(innerHeight * ASCALE));
    aurora.width = aw;
    aurora.height = ah;
  };
  sizeAurora();
  addEventListener("resize", sizeAurora);
  const blobs = [
    { fx: 0.5, fy: 0.42, fr: 0.62, ci: 1, sp: 0.21, ph: 0, a: 0.85 },
    { fx: 0.22, fy: 0.18, fr: 0.5, ci: 0, sp: 0.16, ph: 2.1, a: 0.7 },
    { fx: 0.82, fy: 0.2, fr: 0.46, ci: 0, sp: 0.13, ph: 4.2, a: 0.6 },
    { fx: 0.5, fy: 0.95, fr: 0.58, ci: 2, sp: 0.18, ph: 1.2, a: 0.75 },
    { fx: 0.08, fy: 0.75, fr: 0.4, ci: 3, sp: 0.11, ph: 3.3, a: 0.5 },
    { fx: 0.92, fy: 0.7, fr: 0.42, ci: 2, sp: 0.14, ph: 5.1, a: 0.5 }
  ].map((b) => ({ ...b, cur: [...AURORA_THEMES.spring[b.ci % 4]] }));
  let at = 0;
  const auroraStep = () => {
    at += 0.0035 + scrollVel * 0.004;
    const pal = AURORA_THEMES[auroraTheme] || AURORA_THEMES.spring;
    actx.clearRect(0, 0, aw, ah);
    actx.globalCompositeOperation = "lighter";
    for (const b of blobs) {
      const tgt = pal[b.ci % pal.length];
      for (let i = 0; i < 3; i++) b.cur[i] += (tgt[i] - b.cur[i]) * 0.03;
      const wx = b.fx + Math.sin(at * b.sp * 3 + b.ph) * 0.09;
      const wy = b.fy + Math.cos(at * b.sp * 2.4 + b.ph * 1.7) * 0.08;
      const x = wx * aw, y = wy * ah, r = b.fr * Math.max(aw, ah);
      const [cr, cg, cb] = b.cur.map(Math.round);
      const g = actx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, `rgba(${cr},${cg},${cb},${0.32 * b.a})`);
      g.addColorStop(0.55, `rgba(${cr},${cg},${cb},${0.12 * b.a})`);
      g.addColorStop(1, "rgba(0,0,0,0)");
      actx.fillStyle = g;
      actx.beginPath();
      actx.arc(x, y, r, 0, Math.PI * 2);
      actx.fill();
    }
    requestAnimationFrame(auroraStep);
  };
  requestAnimationFrame(auroraStep);

  /* ——— 章节胶囊 + 主题切换 ——— */
  const pill = document.getElementById("chapterPill");
  const pillName = document.getElementById("pillName");
  const menu = document.getElementById("chapterMenu");
  pill.addEventListener("click", () => menu.classList.toggle("open"));
  menu.querySelectorAll("a").forEach((a) =>
    a.addEventListener("click", () => menu.classList.remove("open"))
  );
  document.querySelectorAll("[data-chapter]").forEach((sec) => {
    ScrollTrigger.create({
      trigger: sec,
      start: "top 55%",
      end: "bottom 55%",
      onToggle: (self) => {
        if (!self.isActive) return;
        pillName.textContent = sec.dataset.chapter;
        const theme = sec.dataset.theme;
        if (theme && THEMES[theme] && theme !== palette._name) {
          palette = THEMES[theme];
          palette._name = theme;
          auroraTheme = theme;
          petalList.forEach((p, i) => {
            if (i % 2 === 0) p.color = palette[(Math.random() * palette.length) | 0];
          });
        }
      }
    });
  });

  /* ——— 文字逐字拆分(em.ac 内的字用品牌绿,其余实色白)——— */
  document.querySelectorAll("[data-split]").forEach((el) => {
    const nodes = [...el.childNodes];
    const text = el.textContent;
    el.textContent = "";
    el.setAttribute("aria-label", text);
    const addChars = (source, accent) => {
      [...source].forEach((ch) => {
        const span = document.createElement("span");
        span.className = accent ? "ch ac" : "ch";
        span.textContent = ch === " " ? " " : ch;
        el.appendChild(span);
      });
    };
    nodes.forEach((node) => {
      const accent = node.nodeType === 1 && node.matches("em.ac");
      addChars(node.textContent, accent);
    });
  });

  /* ——— Hero:单词场漂移(布局在 CSS,这里只加滚动视差)——— */
  const wordField = document.getElementById("wordField");
  if (wordField) {
    gsap.to(wordField, {
      y: -120, opacity: 0.25, ease: "none",
      scrollTrigger: { trigger: ".ed-hero", start: "top top", end: "bottom 30%", scrub: true }
    });
  }
  gsap.timeline({ delay: 2.6 })
    .from(".ed-hero .hero-eyebrow", { opacity: 0, y: 20, duration: .8, ease: "power3.out" })
    .from(".ed-hero h1 .ch", { yPercent: 118, opacity: 0, rotate: 5, duration: 1, stagger: .028, ease: "power4.out" }, "-=.4")
    .from(".hero-sub", { opacity: 0, y: 24, duration: .7, ease: "power3.out" }, "-=.5")
    .from(".hero-actions a", { opacity: 0, y: 26, duration: .7, stagger: .1, ease: "power3.out" }, "-=.45")
    .from(".hero-trust", { opacity: 0, y: 16, duration: .6, ease: "power3.out" }, "-=.4")
    .from(".hero-bottom", { opacity: 0, y: 20, duration: .7, ease: "power3.out" }, "-=.4");
  gsap.to(".hero-inner", {
    scale: .92, opacity: 0, ease: "none",
    scrollTrigger: { trigger: ".ed-hero", start: "top top", end: "bottom 35%", scrub: true }
  });

  /* ——— 章节 pin + 编排 ——— */
  const canPin = matchMedia("(min-width: 901px)").matches;
  document.querySelectorAll(".ed-chapter").forEach((ch) => {
    const stage = ch.querySelector(".chapter-stage");
    if (canPin) {
      ScrollTrigger.create({
        trigger: ch, start: "top top", end: "bottom bottom",
        pin: stage, pinSpacing: false
      });
    }
    const chars = ch.querySelectorAll("h2 .ch");
    gsap.from(chars, {
      yPercent: 118, opacity: 0, rotate: 5, duration: .9, stagger: .03, ease: "power4.out",
      scrollTrigger: { trigger: ch, start: "top 42%" }
    });
    const visual = ch.querySelector("[data-float]");
    if (visual) {
      gsap.fromTo(visual, { opacity: 0, y: 110, rotate: 3 }, {
        opacity: 1, y: 0, rotate: 0, duration: 1.1, ease: "power3.out",
        scrollTrigger: { trigger: ch, start: "top 36%" }
      });
      if (canPin) {
        gsap.to(visual, {
          y: -70, ease: "none",
          scrollTrigger: { trigger: ch, start: "top top", end: "bottom bottom", scrub: true }
        });
      }
    }
    if (canPin) {
      gsap.to(ch.querySelector(".chapter-copy"), {
        opacity: 0, y: -50, ease: "none",
        scrollTrigger: { trigger: ch, start: "60% bottom", end: "bottom 70%", scrub: true }
      });
    }
  });

  /* ——— 场景带横向滚动 ——— */
  const track = document.getElementById("scenesTrack");
  if (track) {
    const getDist = () => Math.max(0, track.scrollWidth - innerWidth + 48);
    gsap.to(track, {
      x: () => -getDist(),
      ease: "none",
      scrollTrigger: {
        trigger: ".ed-scenes",
        start: "top top",
        end: () => `+=${getDist()}`,
        scrub: 1,
        pin: ".scenes-pin",
        invalidateOnRefresh: true
      }
    });
    track.querySelectorAll(".scene-card").forEach((card) => {
      gsap.from(card, {
        opacity: 0, y: 60, duration: .8, ease: "power3.out",
        scrollTrigger: { trigger: ".ed-scenes", start: "top 60%" }
      });
    });
  }

  /* ——— Manifesto / CTA ——— */
  [".ed-manifesto", ".ed-cta"].forEach((sel) => {
    const el = document.querySelector(sel);
    if (!el) return;
    gsap.from(el.querySelectorAll("h2 .ch"), {
      yPercent: 118, opacity: 0, duration: .9, stagger: .02, ease: "power4.out",
      scrollTrigger: { trigger: el, start: "top 62%" }
    });
    gsap.from(el.querySelectorAll("p,.hero-actions,.review-home-frame,.review-home-actions"), {
      opacity: 0, y: 26, duration: .8, stagger: .12, ease: "power3.out",
      scrollTrigger: { trigger: el, start: "top 58%" }
    });
  });

  /* ——— CTA 粒子爆发 ——— */
  ScrollTrigger.create({
    trigger: ".ed-cta",
    start: "top 45%",
    once: true,
    onEnter: () => {
      const cx = innerWidth / 2, cy = innerHeight / 2;
      for (let i = 0; i < 90; i++) {
        const p = petalList[(Math.random() * petalList.length) | 0];
        const ang = Math.random() * Math.PI * 2;
        p.x = cx; p.y = cy;
        p.vx = Math.cos(ang) * (Math.random() * 9 + 3);
        p.vy = Math.sin(ang) * (Math.random() * 9 + 3);
        p.life = 240;
        p.alpha = 0.9;
      }
    }
  });

  /* ——— LevelLens:同一帧,三副水平眼镜 ——— */
  const lensCard = document.querySelector(".lens-card");
  if (lensCard) {
    const tabs = [...lensCard.querySelectorAll(".lens-switch button")];
    const panels = [...lensCard.querySelectorAll("#lensWords > div")];
    tabs.forEach((tab) => {
      tab.addEventListener("click", () => {
        tabs.forEach((t) => t.classList.toggle("active", t === tab));
        panels.forEach((p) => {
          const show = p.dataset.lens === tab.dataset.lens;
          p.hidden = !show;
          if (show) gsap.from(p.children, { opacity: 0, y: 14, duration: .45, stagger: .06, ease: "power3.out" });
        });
      });
    });
  }

  /* ——— 首页复习卡:遮住 → 显示 → 自评 ——— */
  const rhReveal = document.getElementById("reviewHomeReveal");
  if (rhReveal) {
    const answer = document.getElementById("reviewHomeAnswer");
    const grade = document.getElementById("reviewHomeGrade");
    rhReveal.addEventListener("click", () => {
      answer.hidden = false;
      grade.hidden = false;
      rhReveal.hidden = true;
      gsap.from(answer, { opacity: 0, y: 16, duration: .5, ease: "power3.out" });
    });
    grade.querySelectorAll("button").forEach((btn) => {
      btn.addEventListener("click", () => {
        answer.hidden = true;
        grade.hidden = true;
        rhReveal.hidden = false;
        rhReveal.textContent = btn.dataset.grade === "known" ? "✓ 已认识 · 再看一次" : "再记一次 · 显示表达";
      });
    });
  }

  addEventListener("load", () => ScrollTrigger.refresh());
})();
