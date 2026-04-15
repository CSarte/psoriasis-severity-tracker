import { useEffect, useRef } from "react";

const W = 520;
const H = 130;
const GROUND = 92;
const DINO_X = 60;
const DINO_W = 22;
const DINO_H = 28;
const GRAVITY = 0.65;
const JUMP_VY = -13;

function drawDino(ctx, y, onGround, frame) {
  const gx = DINO_X;
  const gy = y;

  // Body
  ctx.fillStyle = "#374151";
  ctx.fillRect(gx, gy - DINO_H, DINO_W, DINO_H - 8);

  // Head (slightly wider)
  ctx.fillRect(gx + 2, gy - DINO_H - 8, DINO_W - 2, 12);

  // Tail
  ctx.fillRect(gx - 7, gy - DINO_H + 8, 9, 6);

  // Eye
  ctx.fillStyle = "white";
  ctx.fillRect(gx + 14, gy - DINO_H - 5, 6, 6);
  ctx.fillStyle = "#1f2937";
  ctx.fillRect(gx + 16, gy - DINO_H - 3, 3, 3);

  // Legs (animate when on ground)
  ctx.fillStyle = "#374151";
  if (!onGround) {
    // Tucked in the air
    ctx.fillRect(gx + 3, gy - 8, 6, 8);
    ctx.fillRect(gx + 12, gy - 8, 6, 8);
  } else if (frame % 2 === 0) {
    ctx.fillRect(gx + 2, gy - 8, 7, 10);
    ctx.fillRect(gx + 12, gy - 8, 7, 5);
  } else {
    ctx.fillRect(gx + 2, gy - 8, 7, 5);
    ctx.fillRect(gx + 12, gy - 8, 7, 10);
  }
}

function drawCactus(ctx, x) {
  ctx.fillStyle = "#15803d";
  // Main stem
  ctx.fillRect(x + 5, GROUND - 36, 9, 36);
  // Left arm
  ctx.fillRect(x, GROUND - 32, 7, 5);
  ctx.fillRect(x, GROUND - 38, 5, 12);
  // Right arm
  ctx.fillRect(x + 10, GROUND - 26, 7, 5);
  ctx.fillRect(x + 13, GROUND - 32, 5, 12);
}

function drawCloud(ctx, x, y) {
  ctx.fillStyle = "#e5e7eb";
  ctx.fillRect(x, y, 40, 10);
  ctx.fillRect(x + 5, y - 8, 28, 10);
  ctx.fillRect(x + 10, y - 14, 18, 8);
}

export default function DinoGame({ active }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    if (!active) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");

    const state = {
      running: true,
      dino: { y: GROUND, vy: 0, onGround: true },
      cacti: [],
      clouds: [{ x: 200, y: 25 }, { x: 420, y: 15 }],
      score: 0,
      frameCount: 0,
      speed: 4,
      lastCactus: 0,
      frameId: null,
    };

    const jump = () => {
      if (state.dino.onGround) {
        state.dino.vy = JUMP_VY;
        state.dino.onGround = false;
      }
    };

    const onKey = (e) => {
      if (e.code === "Space" || e.code === "ArrowUp") {
        e.preventDefault();
        jump();
      }
    };
    window.addEventListener("keydown", onKey);
    canvas.addEventListener("click", jump);

    const loop = (ts) => {
      if (!state.running) return;

      ctx.clearRect(0, 0, W, H);

      // Background
      ctx.fillStyle = "#f9fafb";
      ctx.fillRect(0, 0, W, H);

      // Ground line
      ctx.fillStyle = "#9ca3af";
      ctx.fillRect(0, GROUND + 2, W, 2);

      // Clouds (parallax)
      for (const c of state.clouds) {
        c.x -= state.speed * 0.3;
        if (c.x < -50) c.x = W + 20;
        drawCloud(ctx, c.x, c.y);
      }

      // Dino physics
      state.dino.vy += GRAVITY;
      state.dino.y += state.dino.vy;
      if (state.dino.y >= GROUND) {
        state.dino.y = GROUND;
        state.dino.vy = 0;
        state.dino.onGround = true;
      }

      const legFrame = Math.floor(state.frameCount / 8) % 2;
      drawDino(ctx, state.dino.y, state.dino.onGround, legFrame);

      // Speed increases with score
      state.speed = 4 + state.score * 0.0025;

      // Spawn cacti
      const spawnGap = Math.max(900, 2000 - state.score * 1.5);
      if (ts - state.lastCactus > spawnGap) {
        state.cacti.push({ x: W + 10 });
        state.lastCactus = ts;
      }

      // Move + draw cacti
      state.cacti = state.cacti.filter((c) => c.x > -30);
      for (const c of state.cacti) {
        c.x -= state.speed;
        drawCactus(ctx, c.x);

        // Collision: horizontal overlap AND dino's feet are below the cactus top
        // (dino hasn't jumped high enough to clear it)
        const hit =
          DINO_X + 5 < c.x + 18 &&
          DINO_X + DINO_W - 5 > c.x + 4 &&
          state.dino.y > GROUND - 30;

        if (hit) {
          // Flash red briefly then reset
          ctx.fillStyle = "rgba(239,68,68,0.25)";
          ctx.fillRect(0, 0, W, H);
          state.score = 0;
          state.cacti = [];
          state.dino = { y: GROUND, vy: 0, onGround: true };
          state.speed = 4;
          state.lastCactus = ts;
          break;
        }
      }

      // Score display
      state.score++;
      state.frameCount++;
      const displayScore = String(Math.floor(state.score / 8)).padStart(5, "0");
      ctx.fillStyle = "#6b7280";
      ctx.font = "bold 13px monospace";
      ctx.fillText(`HI  ${displayScore}`, W - 110, 20);

      // Hint
      ctx.fillStyle = "#9ca3af";
      ctx.font = "11px sans-serif";
      ctx.fillText("Click or press  ↑  /  Space  to jump", 12, 16);

      state.frameId = requestAnimationFrame(loop);
    };

    state.frameId = requestAnimationFrame(loop);

    return () => {
      state.running = false;
      if (state.frameId) cancelAnimationFrame(state.frameId);
      window.removeEventListener("keydown", onKey);
      canvas.removeEventListener("click", jump);
    };
  }, [active]);

  if (!active) return null;

  return (
    <div className="flex flex-col items-center mt-2">
      <canvas
        ref={canvasRef}
        width={W}
        height={H}
        className="border border-gray-200 rounded-lg cursor-pointer w-full max-w-lg shadow-sm"
      />
      <p className="text-xs text-gray-400 mt-1">Keep yourself entertained while the model runs!</p>
    </div>
  );
}
