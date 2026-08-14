import { Application, Graphics } from "pixi.js";
import { STATE, DISPLAY_ID } from "../state";
import type { TestPattern } from "@aquarium/shared";

// ============================================================
// display/renderer/test-pattern-overlay.ts
// デバッグ/キャリブレーション用テストパターンのオーバーレイ描画
// ============================================================

export let currentPattern: TestPattern = "off";

let testGraphics: Graphics | null = null;
let displayNumber: number | undefined;

export function setDisplayNumber(value?: number): void {
  displayNumber = value;
}

export function drawTestPattern(app: Application, pattern: TestPattern): void {
  currentPattern = pattern;
  testGraphics?.destroy();
  testGraphics = null;
  document.getElementById("worldmap-overlay")?.remove();
  document.getElementById("calibration-overlay")?.remove();
  document.getElementById("gradient-overlay")?.remove();
  if (pattern === "off") {
    document.getElementById("vp-overlay")?.remove();
    return;
  }

  const g = new Graphics();
  g.zIndex = 10000;

  const ww = window.innerWidth;
  const wh = window.innerHeight;

  switch (pattern) {
    case "white": g.rect(0, 0, ww, wh).fill({ color: 0xffffff }); break;
    case "black": g.rect(0, 0, ww, wh).fill({ color: 0x000000 }); break;

    case "colorbars": {
      const bars = [0xffffff, 0xffff00, 0x00ffff, 0x00ff00, 0xff00ff, 0xff0000, 0x0000ff, 0x000000];
      const barW = ww / bars.length;
      bars.forEach((color, i) => g.rect(i * barW, 0, barW + 1, wh * 0.72).fill({ color }));
      const gray = [0xffffff, 0xd9d9d9, 0xb6b6b6, 0x929292, 0x6d6d6d, 0x494949, 0x242424, 0x000000];
      gray.forEach((color, i) => g.rect(i * barW, wh * 0.72, barW + 1, wh * 0.28).fill({ color }));
      break;
    }

    case "crosshair": {
      g.rect(0, 0, ww, wh).fill({ color: 0x000000 });
      g.setStrokeStyle({ width: 1, color: 0xffffff });
      g.moveTo(ww/2, 0).lineTo(ww/2, wh);
      g.moveTo(0, wh/2).lineTo(ww, wh/2);
      g.stroke();
      g.setStrokeStyle({ width: 3, color: 0xff4444 });
      const T = 30; const L = 80;
      [[0,0],[ww,0],[0,wh],[ww,wh]].forEach(([cx, cy]) => {
        const dx = cx === 0 ? 1 : -1;
        const dy = cy === 0 ? 1 : -1;
        g.moveTo(cx! + dx * T, cy!).lineTo(cx! + dx * L, cy!);
        g.moveTo(cx!, cy! + dy * T).lineTo(cx!, cy! + dy * L);
      });
      g.stroke();
      break;
    }

    case "grid": {
      g.rect(0, 0, ww, wh).fill({ color: 0x0a0a1a });
      g.setStrokeStyle({ width: 1, color: 0x00ff44, alpha: 0.5 });
      for (let x = 0; x <= ww; x += 100) g.moveTo(x, 0).lineTo(x, wh);
      for (let y = 0; y <= wh; y += 100) g.moveTo(0, y).lineTo(ww, y);
      g.stroke();
      g.setStrokeStyle({ width: 0.5, color: 0x00ff44, alpha: 0.2 });
      for (let x = 50; x <= ww; x += 100) g.moveTo(x, 0).lineTo(x, wh);
      for (let y = 50; y <= wh; y += 100) g.moveTo(0, y).lineTo(ww, y);
      g.stroke();
      g.setStrokeStyle({ width: 3, color: 0xff4444 });
      const C = 80;
      [[0,0],[ww,0],[0,wh],[ww,wh]].forEach(([cx, cy]) => {
        const dx = cx === 0 ? 1 : -1;
        const dy = cy === 0 ? 1 : -1;
        g.moveTo(cx! + dx * 10, cy!).lineTo(cx! + dx * C, cy!);
        g.moveTo(cx!, cy! + dy * 10).lineTo(cx!, cy! + dy * C);
      });
      g.stroke();
      break;
    }

    case "gradient": {
      const canvas = document.createElement("canvas");
      canvas.id = "gradient-overlay";
      canvas.width = ww;
      canvas.height = wh;
      Object.assign(canvas.style, { position: "fixed", inset: "0", width: "100%", height: "100%", zIndex: "10001", pointerEvents: "none" });
      const ctx = canvas.getContext("2d")!;
      const horizontal = ctx.createLinearGradient(0, 0, ww, 0);
      horizontal.addColorStop(0, "#000000");
      horizontal.addColorStop(0.25, "#ff0000");
      horizontal.addColorStop(0.5, "#00ff00");
      horizontal.addColorStop(0.75, "#0000ff");
      horizontal.addColorStop(1, "#ffffff");
      ctx.fillStyle = horizontal;
      ctx.fillRect(0, 0, ww, wh * 0.65);
      const vertical = ctx.createLinearGradient(0, wh * 0.65, 0, wh);
      vertical.addColorStop(0, "#ffffff");
      vertical.addColorStop(1, "#000000");
      ctx.fillStyle = vertical;
      ctx.fillRect(0, wh * 0.65, ww, wh * 0.35);
      document.body.appendChild(canvas);
      break;
    }

    case "identify": {
      // 水槽の位置関係を見ながら識別できるよう、背景は塗り潰さず番号だけを重ねる。
      let calDiv = document.getElementById("calibration-overlay");
      if (!calDiv) {
        calDiv = document.createElement("div");
        calDiv.id = "calibration-overlay";
        document.body.appendChild(calDiv);
      }
      Object.assign(calDiv.style, {
        position: "fixed", inset: "0", display: "flex", alignItems: "center",
        justifyContent: "center", pointerEvents: "none", zIndex: "10001",
      });
      calDiv.innerHTML = `<div style="font-family:monospace;color:#fff;font-size:min(52vw,52vh);line-height:1;font-weight:900;text-shadow:0 0 18px #000,0 0 40px #000,0 0 70px #00aaff;-webkit-text-stroke:4px #001a3a">${displayNumber ?? "?"}</div>`;
      break;
    }
    // calibration は詳細調整用なので従来どおり全面パターンを表示する。
    case "calibration": {
      g.rect(0, 0, ww, wh).fill({ color: 0x0a0820 });
      g.setStrokeStyle({ width: 6, color: 0x00aaff });
      g.rect(6, 6, ww - 12, wh - 12).stroke();
      const cx2 = ww / 2, cy2 = wh / 2;
      g.setStrokeStyle({ width: 3, color: 0xffffff, alpha: 0.4 });
      g.moveTo(cx2, 0).lineTo(cx2, wh);
      g.moveTo(0, cy2).lineTo(ww, cy2);
      g.stroke();

      let calDiv = document.getElementById("calibration-overlay");
      if (!calDiv) {
        calDiv = document.createElement("div");
        calDiv.id = "calibration-overlay";
        Object.assign(calDiv.style, {
          position: "fixed", inset: "0",
          display: "flex", flexDirection: "column",
          alignItems: "center", justifyContent: "center",
          pointerEvents: "none", zIndex: "10001",
        });
        document.body.appendChild(calDiv);
      }
      calDiv.innerHTML = `
        <div style="font-family:monospace;color:#ffffff;font-size:32vw;line-height:0.85;font-weight:900;text-shadow:0 0 40px #00aaff">${displayNumber ?? "?"}</div>
        <div style="font-family:monospace;color:#00aaff;font-size:4vw;font-weight:bold;margin-top:0.3em">${DISPLAY_ID}</div>
        <div style="font-family:monospace;color:#ffffff;font-size:3vw;margin-top:1em;opacity:0.7">
          ${STATE.VP.width}&times;${STATE.VP.height} &nbsp;|&nbsp; scale: ${STATE.VP.scale} &nbsp;|&nbsp; pos: (${STATE.VP.x}, ${STATE.VP.y})
        </div>
      `;
      break;
    }

    case "worldmap": {
      g.rect(0, 0, ww, wh).fill({ color: 0x000820 });

      const wStep = 100;
      const wx0 = Math.floor(STATE.VP.x / wStep) * wStep;
      const wy0 = Math.floor(STATE.VP.y / wStep) * wStep;
      const wRight  = STATE.VP.x + STATE.VP.width;
      const wBottom = STATE.VP.y + STATE.VP.height;
      g.setStrokeStyle({ width: 0.5, color: 0x1a4a7a, alpha: 0.9 });
      for (let wx = wx0; wx <= wRight;  wx += wStep) g.moveTo((wx - STATE.VP.x) * STATE.scaleX, 0).lineTo((wx - STATE.VP.x) * STATE.scaleX, wh);
      for (let wy = wy0; wy <= wBottom; wy += wStep) g.moveTo(0, (wy - STATE.VP.y) * STATE.scaleY).lineTo(ww, (wy - STATE.VP.y) * STATE.scaleY);
      g.stroke();

      const mStep = 500;
      const mx0 = Math.floor(STATE.VP.x / mStep) * mStep;
      const my0 = Math.floor(STATE.VP.y / mStep) * mStep;
      g.setStrokeStyle({ width: 1.5, color: 0x2a7acc, alpha: 0.9 });
      for (let wx = mx0; wx <= wRight;  wx += mStep) g.moveTo((wx - STATE.VP.x) * STATE.scaleX, 0).lineTo((wx - STATE.VP.x) * STATE.scaleX, wh);
      for (let wy = my0; wy <= wBottom; wy += mStep) g.moveTo(0, (wy - STATE.VP.y) * STATE.scaleY).lineTo(ww, (wy - STATE.VP.y) * STATE.scaleY);
      g.stroke();

      if (STATE.VP.x <= 0 && STATE.VP.y <= 0 && wRight >= 0 && wBottom >= 0) {
        const ox = -STATE.VP.x * STATE.scaleX;
        const oy = -STATE.VP.y * STATE.scaleY;
        g.setStrokeStyle({ width: 3, color: 0xff4444 });
        g.moveTo(ox - 24, oy).lineTo(ox + 24, oy);
        g.moveTo(ox, oy - 24).lineTo(ox, oy + 24);
        g.stroke();
      }

      drawWorldmapOverlay();
      break;
    }
  }

  app.stage.addChild(g);
  testGraphics = g;

  if (pattern === "grid" || pattern === "crosshair") drawViewportInfo();
}

function drawWorldmapOverlay(): void {
  document.getElementById("worldmap-overlay")?.remove();

  const cvs = document.createElement("canvas");
  cvs.id = "worldmap-overlay";
  cvs.width  = window.innerWidth;
  cvs.height = window.innerHeight;
  Object.assign(cvs.style, {
    position: "fixed", inset: "0", width: "100%", height: "100%",
    pointerEvents: "none", zIndex: "99998",
  });
  document.body.appendChild(cvs);

  const ctx = cvs.getContext("2d")!;
  ctx.clearRect(0, 0, cvs.width, cvs.height);

  ctx.fillStyle = "#4a9aff";
  ctx.font = `bold ${Math.round(13 * STATE.scaleY)}px monospace`;
  ctx.textBaseline = "top";
  const mStep = 500;
  const mx0 = Math.ceil(STATE.VP.x / mStep) * mStep;
  const my0 = Math.ceil(STATE.VP.y / mStep) * mStep;
  const wRight  = STATE.VP.x + STATE.VP.width;
  const wBottom = STATE.VP.y + STATE.VP.height;

  for (let wx = mx0; wx < wRight; wx += mStep) {
    ctx.fillText(String(wx), (wx - STATE.VP.x) * STATE.scaleX + 3, 3 * STATE.scaleY);
  }
  for (let wy = my0; wy < wBottom; wy += mStep) {
    ctx.fillText(String(wy), 3, (wy - STATE.VP.y) * STATE.scaleY + 2 * STATE.scaleY);
  }

  ctx.fillStyle = "rgba(0,8,32,0.8)";
  ctx.fillRect(0, 0, ctx.measureText(`ID: ${DISPLAY_ID}`).width + 12 * STATE.scaleX, 24 * STATE.scaleY);
  ctx.fillStyle = "#7ec8e3";
  ctx.font = `${Math.round(11 * STATE.scaleY)}px monospace`;
  ctx.fillText(`ID: ${DISPLAY_ID}  [${STATE.VP.x},${STATE.VP.y} / ${STATE.VP.width}×${STATE.VP.height}]`, 6, 6);

  const WORLD_W = STATE.WORLD_W;
  const WORLD_H = STATE.WORLD_H;
  const MINI_W_CSS = 200;
  const MINI_H_CSS = Math.round(MINI_W_CSS * WORLD_H / WORLD_W);
  // Canvasの内部サイズをCSSピクセルに合わせているため、ここではDPRを重ねない。
  const pR = 1;
  const MINI_W = MINI_W_CSS * pR;
  const MINI_H = MINI_H_CSS * pR;
  const MARGIN  = 16 * pR;
  const MINI_X = cvs.width  - MINI_W - MARGIN;
  const MINI_Y = cvs.height - MINI_H - MARGIN;

  ctx.fillStyle = "rgba(0,8,32,0.9)";
  ctx.fillRect(MINI_X - 1, MINI_Y - 1, MINI_W + 2, MINI_H + 2);
  ctx.strokeStyle = "#2a6aaa";
  ctx.lineWidth = 1;
  ctx.strokeRect(MINI_X, MINI_Y, MINI_W, MINI_H);

  ctx.strokeStyle = "rgba(42,106,170,0.4)";
  ctx.lineWidth = 0.5;
  for (let i = 1; i < 4; i++) {
    ctx.beginPath(); ctx.moveTo(MINI_X + MINI_W * i / 4, MINI_Y); ctx.lineTo(MINI_X + MINI_W * i / 4, MINI_Y + MINI_H); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(MINI_X, MINI_Y + MINI_H * i / 4); ctx.lineTo(MINI_X + MINI_W, MINI_Y + MINI_H * i / 4); ctx.stroke();
  }

  const vpMiniX = MINI_X + (STATE.VP.x / WORLD_W) * MINI_W;
  const vpMiniY = MINI_Y + (STATE.VP.y / WORLD_H) * MINI_H;
  const vpMiniW = (STATE.VP.width / WORLD_W) * MINI_W;
  const vpMiniH = (STATE.VP.height / WORLD_H) * MINI_H;
  ctx.fillStyle = "rgba(0,200,100,0.25)";
  ctx.fillRect(vpMiniX, vpMiniY, vpMiniW, vpMiniH);
  ctx.strokeStyle = "#00c864";
  ctx.lineWidth = 1.5;
  ctx.strokeRect(vpMiniX, vpMiniY, vpMiniW, vpMiniH);

  ctx.fillStyle = "#7ec8e3";
  ctx.font = `bold ${Math.max(10, 9 * pR)}px monospace`;
  ctx.textBaseline = "bottom";
  ctx.fillText(`World: ${WORLD_W}×${WORLD_H}`, MINI_X + 3, MINI_Y - 2);
}

function drawViewportInfo(): void {
  document.getElementById("vp-overlay")?.remove();
  const div = document.createElement("div");
  div.id = "vp-overlay";
  Object.assign(div.style, {
    position: "fixed", top: "20px", left: "20px",
    background: "rgba(0,0,0,0.7)", color: "#00ff44",
    fontFamily: "monospace", fontSize: "16px",
    padding: "12px 16px", borderRadius: "8px",
    border: "1px solid #00ff44", lineHeight: "1.6",
    zIndex: "99999", pointerEvents: "none",
  });
  div.innerHTML = `
    <strong>🖥 Display Info</strong><br>
    ID: ${DISPLAY_ID}<br>
    Viewport: x=${STATE.VP.x}, y=${STATE.VP.y}<br>
    Size: ${STATE.VP.width} × ${STATE.VP.height}<br>
    Scale: ${STATE.VP.scale}<br>
    Screen: ${window.screen.width} × ${window.screen.height}
  `.trim();
  document.body.appendChild(div);
}
