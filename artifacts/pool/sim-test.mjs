import { simulateShot, makeInitialBalls } from './src/lib/physics.ts';
import { applyShotResult, makeInitialGameState } from './src/lib/rules.ts';

const state = makeInitialGameState(makeInitialBalls(), ["You", "—"]);

const shots = [
  { name: "max power straight break", angle: 0, power: 1.0 },
  { name: "max power up", angle: -Math.PI/2, power: 1.0 },
  { name: "low power", angle: 0, power: 0.3 },
  { name: "max with topspin", angle: 0, power: 1.0, tipOffset: { x: 0, y: -1 } },
  { name: "max with draw", angle: 0, power: 1.0, tipOffset: { x: 0, y: 1 } },
  { name: "max with side", angle: 0, power: 1.0, tipOffset: { x: 1, y: 0 } },
  { name: "max diagonal+follow", angle: Math.PI/3, power: 1.0, tipOffset: {x:0,y:-1} },
  { name: "max with follow+side", angle: 0, power: 1.0, tipOffset: { x: 0.7, y: -0.7 } },
];

let runaway = 0;
for (const shot of shots) {
  const sim = simulateShot(state, shot, { tableSpeed: 1, recordFrames: true, frameInterval: 4 });
  const playMs = sim.ticks * (1000/60) / 1.25;
  const stillMoving = sim.finalState.balls.filter(b => !b.inPocket && (b.vel.x !== 0 || b.vel.y !== 0));
  const tag = sim.ticks >= 5990 ? " ⚠️ MAX_TICKS" : "";
  if (sim.ticks >= 5990) runaway++;
  console.log(`${shot.name.padEnd(28)} ticks=${String(sim.ticks).padStart(4)} play=${playMs.toFixed(0).padStart(5)}ms moving=${stillMoving.length}${tag}`);
}
console.log(`\nRunaway shots: ${runaway}`);
