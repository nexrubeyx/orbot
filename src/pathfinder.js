(() => {
  const EMPTY = 65535;
  const DIRS = [[1, 0], [0, -1], [-1, 0], [0, 1], [1, -1], [-1, -1], [-1, 1], [1, 1]];
  const DYNAMIC = ["x", "y", "d", "a", "hp", "fx", "fy", "sd", "at", "st"];

  class Heap {
    constructor() { this.nodes = []; }
    push(node) {
      const a = this.nodes;
      a.push(node);
      let i = a.length - 1;
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (a[p].priority <= node.priority) break;
        a[i] = a[p]; i = p;
      }
      a[i] = node;
    }
    pop() {
      const a = this.nodes;
      const first = a[0], last = a.pop();
      if (a.length) {
        let i = 0;
        while (true) {
          const left = 2 * i + 1;
          if (left >= a.length) break;
          const right = left + 1;
          const child = right < a.length && a[right].priority < a[left].priority ? right : left;
          if (a[child].priority >= last.priority) break;
          a[i] = a[child]; i = child;
        }
        a[i] = last;
      }
      return first;
    }
    get size() { return this.nodes.length; }
  }

  class GameWorld {
    constructor(map, meta, collision = {}, maskData = null) {
      this.meta = meta;
      this.cw = meta.chunksW;
      this.ch = meta.chunksH;
      this.cs = meta.chunk;
      this.width = this.cw * this.cs;
      this.height = this.ch * this.cs;
      this.floors = [];
      const view = new DataView(map instanceof ArrayBuffer ? map : map.buffer, map.byteOffset || 0, map.byteLength);
      let offset = 0;
      for (let floor = 0; floor < meta.floors; floor++) {
        const count = view.getUint16(offset, true); offset += 2;
        const grid = new Int16Array(this.cw * this.ch);
        for (let i = 0; i < grid.length; i++, offset += 2) grid[i] = view.getInt16(offset, true);
        const tiles = new Uint16Array(count * this.cs * this.cs);
        for (let i = 0; i < tiles.length; i++, offset += 2) tiles[i] = view.getUint16(offset, true);
        this.floors.push({ grid, tiles });
      }
      this.blockSet = new Set(collision.block ?? []);
      this.portalSet = new Set(collision.portal ?? []);
      this.cells = new Map((collision.cells ?? []).map(([floor, x, y, value]) => [(floor * this.height + y) * this.width + x, value]));
      this.mask = maskData ? this.decodeMask(maskData, meta.floors) : null;
    }
    decodeMask(source, floors) {
      const bytes = source instanceof Uint8Array ? source : new Uint8Array(source.buffer ?? source, source.byteOffset ?? 0, source.byteLength);
      const all = [];
      let offset = 0;
      for (let f = 0; f < floors; f++) {
        const row = new Uint8Array(this.width * this.height);
        let filled = 0;
        while (filled < row.length && offset < bytes.length) {
          const value = bytes[offset++];
          let run = 0, shift = 0, byte;
          do { byte = bytes[offset++]; run += (byte & 127) * 2 ** shift; shift += 7; } while (byte & 128);
          row.fill(value, filled, Math.min(row.length, filled + run));
          filled += run;
        }
        all.push(row);
      }
      return all;
    }
    tile(floor, x, y) {
      if (x < 0 || y < 0 || x >= this.width || y >= this.height || !this.floors[floor]) return EMPTY;
      const data = this.floors[floor];
      const chunk = data.grid[(y / this.cs | 0) * this.cw + (x / this.cs | 0)];
      if (chunk < 0) return EMPTY;
      return data.tiles[chunk * this.cs * this.cs + (y % this.cs) * this.cs + (x % this.cs)];
    }
    cell(floor, x, y) { return this.cells.get((floor * this.height + y) * this.width + x); }
    maskAt(floor, x, y) { return this.mask?.[floor]?.[y * this.width + x]; }
    isPortal(floor, x, y) {
      return this.portalSet.has(this.tile(floor, x, y)) && !(this.cells.size && this.cell(floor, x, y) === 1) && this.maskAt(floor, x, y) !== 2;
    }
    isWalkable(floor, x, y) {
      const tile = this.tile(floor, x, y);
      if (tile === EMPTY) return false;
      const cell = this.cell(floor, x, y);
      if (cell !== undefined) return cell === 2;
      const mask = this.maskAt(floor, x, y);
      return mask === undefined ? !this.blockSet.has(tile) : mask === 1 || mask === 3 || (mask !== 2 && this.portalSet.has(tile) && !this.blockSet.has(tile));
    }
    findPath(floor, sx, sy, tx, ty, { adjacent = false, blocked = () => false, cost = () => 0, maxNodes = 4000, diagCost = 19 } = {}) {
      if (!adjacent && !this.isWalkable(floor, tx, ty)) return null;
      const width = this.width, total = width * this.height;
      const score = new Float64Array(total); score.fill(Infinity);
      const cameFrom = new Int32Array(total); cameFrom.fill(-1);
      const closed = new Uint8Array(total);
      const index = (x, y) => y * width + x;
      const isGoal = (x, y) => {
        const distance = Math.max(Math.abs(x - tx), Math.abs(y - ty));
        return adjacent ? distance <= 1 && distance > 0 : distance === 0;
      };
      if (isGoal(sx, sy)) return [];
      const heuristic = (x, y) => {
        const radius = adjacent ? 1 : 0;
        const dx = Math.max(0, Math.abs(x - tx) - radius), dy = Math.max(0, Math.abs(y - ty) - radius);
        return 10 * Math.max(dx, dy) + (diagCost - 10) * Math.min(dx, dy);
      };
      const start = index(sx, sy);
      score[start] = 0;
      const heap = new Heap();
      heap.push({ index: start, priority: heuristic(sx, sy) });
      let visited = 0;
      while (heap.size && visited++ < maxNodes) {
        const current = heap.pop().index;
        if (closed[current]) continue;
        if (isGoal(current % width, current / width | 0)) {
          const path = [];
          for (let at = current; at !== start; at = cameFrom[at]) path.push({ x: at % width, y: at / width | 0 });
          return path.reverse();
        }
        closed[current] = 1;
        const x = current % width, y = current / width | 0;
        for (let dir = 0; dir < DIRS.length; dir++) {
          const nx = x + DIRS[dir][0], ny = y + DIRS[dir][1];
          if (nx < 0 || ny < 0 || nx >= width || ny >= this.height || !this.isWalkable(floor, nx, ny)) continue;
          const ni = index(nx, ny);
          if (closed[ni]) continue;
          const isRequestedTile = nx === tx && ny === ty;
          if (!isRequestedTile && (this.isPortal(floor, nx, ny) || blocked(nx, ny))) continue;
          const nextScore = score[current] + (dir < 4 ? 10 : diagCost) + (isRequestedTile ? 0 : cost(nx, ny));
          if (nextScore >= score[ni]) continue;
          score[ni] = nextScore;
          cameFrom[ni] = current;
          heap.push({ index: ni, priority: nextScore + heuristic(nx, ny) });
        }
      }
      return null;
    }
  }

  Object.defineProperty(window, "__FantasyPathfinder", { value: GameWorld, configurable: false });
})();
