import { forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY, type SimulationNodeDatum } from "d3-force";

interface GraphNode { id: string; x: number; y: number; root?: boolean }
interface GraphEdge { source: string; target: string; strength: "strong" | "medium" | "weak" }
interface Particle extends SimulationNodeDatum { id: string; x: number; y: number; radius: number }

/** Spring links, mutual repulsion and gentle gravity, as in the reference force graph. */
export function createMasteryForceLayout(
  nodes: GraphNode[], edges: GraphEdge[], width: number, height: number, compact: boolean,
  onTick: (positions: Record<string, { x: number; y: number }>) => void,
) {
  const particles: Particle[] = nodes.map((node) => ({
    id: node.id, x: node.x / 100 * width, y: node.y / 100 * height,
    radius: node.root ? (compact ? 42 : 58) : (compact ? 30 : 39),
  }));
  const byId = new Map(particles.map((node) => [node.id, node]));
  const links = edges.filter((edge) => byId.has(edge.source) && byId.has(edge.target)).map((edge) => ({ ...edge }));
  const simulation = forceSimulation(particles)
    .force("links", forceLink<Particle, typeof links[number]>(links).id((node) => node.id)
      .distance(Math.min(compact ? 120 : 200, width * .3, height * .4))
      .strength((edge) => edge.strength === "strong" ? .22 : edge.strength === "medium" ? .18 : .14))
    .force("repulsion", forceManyBody<Particle>().strength(compact ? -400 : -800))
    .force("collision", forceCollide<Particle>().radius((node) => node.radius + 5).iterations(3))
    .force("gravityX", forceX<Particle>(width / 2).strength(.025))
    .force("gravityY", forceY<Particle>(height / 2).strength(.025))
    .velocityDecay(.32).alphaDecay(.045).stop();

  function positions() {
    return Object.fromEntries(particles.map((node) => {
      const padX = Math.min(width / 2, node.radius);
      const padY = Math.min(height / 2, node.radius);
      const x = Math.max(padX, Math.min(width - padX, node.x));
      const y = Math.max(padY, Math.min(height - padY, node.y));
      if (x !== node.x) node.vx = 0;
      if (y !== node.y) node.vy = 0;
      node.x = x; node.y = y;
      return [node.id, { x: x / width * 100, y: y / height * 100 }];
    }));
  }
  simulation.on("tick", () => onTick(positions()));
  return {
    width, height, simulation, positions,
    pin(id: string, position: { x: number; y: number }) {
      const node = byId.get(id);
      if (!node) return;
      node.x = node.fx = position.x / 100 * width;
      node.y = node.fy = position.y / 100 * height;
      node.vx = node.vy = 0;
      onTick(positions());
      simulation.alphaTarget(.2).alpha(Math.max(simulation.alpha(), .5)).restart();
    },
    release(id: string) {
      const node = byId.get(id);
      if (!node) return;
      node.fx = node.fy = null;
      simulation.alphaTarget(0).alpha(.5).restart();
    },
    stop() { simulation.stop(); },
  };
}
