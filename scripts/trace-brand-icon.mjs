import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const conceptPath = path.join(projectRoot, "assets/brand/edgeever-concept-open-cat.png");
const iconPath = path.join(projectRoot, "assets/brand/edgeever-icon.svg");
const markPath = path.join(projectRoot, "assets/brand/edgeever-mark.svg");
const adaptiveMarkPath = path.join(projectRoot, "apps/mobile/assets/adaptive-icon-foreground.svg");

const source = await readFile(conceptPath);
const { data, info } = await sharp(source)
  .removeAlpha()
  .blur(0.8)
  .raw()
  .toBuffer({ resolveWithObject: true });
const { width, height, channels } = info;
const pixelCount = width * height;
const mask = new Uint8Array(pixelCount);

for (let index = 0; index < pixelCount; index += 1) {
  const offset = index * channels;
  const red = data[offset];
  const green = data[offset + 1];
  const blue = data[offset + 2];
  // The approved concept uses a near-black mark over a green field. Trace only
  // genuinely dark pixels so the generated backdrop variation cannot leak into
  // the production vector.
  if (red < 72 && green < 72 && blue < 72) {
    mask[index] = 1;
  }
}

// Remove isolated antialiasing noise while preserving every meaningful contour.
const visited = new Uint8Array(pixelCount);
const queue = new Int32Array(pixelCount);
for (let start = 0; start < pixelCount; start += 1) {
  if (!mask[start] || visited[start]) continue;
  let head = 0;
  let tail = 0;
  queue[tail++] = start;
  visited[start] = 1;
  const members = [];
  while (head < tail) {
    const index = queue[head++];
    members.push(index);
    const x = index % width;
    const y = Math.floor(index / width);
    const neighbors = [];
    if (x > 0) neighbors.push(index - 1);
    if (x + 1 < width) neighbors.push(index + 1);
    if (y > 0) neighbors.push(index - width);
    if (y + 1 < height) neighbors.push(index + width);
    for (const neighbor of neighbors) {
      if (mask[neighbor] && !visited[neighbor]) {
        visited[neighbor] = 1;
        queue[tail++] = neighbor;
      }
    }
  }
  if (members.length < 80) {
    for (const index of members) mask[index] = 0;
  }
}

const stride = width + 1;
const edges = new Map();
let edgeCount = 0;
const addEdge = (fromX, fromY, toX, toY) => {
  const from = fromY * stride + fromX;
  const to = toY * stride + toX;
  const destinations = edges.get(from);
  if (destinations) destinations.push(to);
  else edges.set(from, [to]);
  edgeCount += 1;
};
const isFilled = (x, y) => x >= 0 && x < width && y >= 0 && y < height && mask[y * width + x];

for (let y = 0; y < height; y += 1) {
  for (let x = 0; x < width; x += 1) {
    if (!isFilled(x, y)) continue;
    if (!isFilled(x, y - 1)) addEdge(x, y, x + 1, y);
    if (!isFilled(x + 1, y)) addEdge(x + 1, y, x + 1, y + 1);
    if (!isFilled(x, y + 1)) addEdge(x + 1, y + 1, x, y + 1);
    if (!isFilled(x - 1, y)) addEdge(x, y + 1, x, y);
  }
}

const takeEdge = (from) => {
  const destinations = edges.get(from);
  if (!destinations?.length) return null;
  const to = destinations.pop();
  if (!destinations.length) edges.delete(from);
  edgeCount -= 1;
  return to;
};
const point = (value) => [value % stride, Math.floor(value / stride)];
const simplifyCollinear = (points) => {
  const simplified = [];
  for (const current of points) {
    while (simplified.length >= 2) {
      const a = simplified[simplified.length - 2];
      const b = simplified[simplified.length - 1];
      if ((b[0] - a[0]) * (current[1] - b[1]) !== (b[1] - a[1]) * (current[0] - b[0])) break;
      simplified.pop();
    }
    simplified.push(current);
  }
  return simplified;
};
const perpendicularDistanceSquared = (point, start, end) => {
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  if (dx === 0 && dy === 0) {
    return (point[0] - start[0]) ** 2 + (point[1] - start[1]) ** 2;
  }
  const numerator = dy * point[0] - dx * point[1] + end[0] * start[1] - end[1] * start[0];
  return (numerator * numerator) / (dx * dx + dy * dy);
};
const simplifyOpen = (points, epsilonSquared) => {
  if (points.length <= 2) return points;
  let furthestIndex = 0;
  let furthestDistance = 0;
  for (let index = 1; index < points.length - 1; index += 1) {
    const distance = perpendicularDistanceSquared(points[index], points[0], points[points.length - 1]);
    if (distance > furthestDistance) {
      furthestDistance = distance;
      furthestIndex = index;
    }
  }
  if (furthestDistance <= epsilonSquared) return [points[0], points[points.length - 1]];
  return [
    ...simplifyOpen(points.slice(0, furthestIndex + 1), epsilonSquared).slice(0, -1),
    ...simplifyOpen(points.slice(furthestIndex), epsilonSquared),
  ];
};
const simplifyClosed = (points, epsilon = 1.5) => {
  const ring = points.slice(0, -1);
  let anchorIndex = 0;
  for (let index = 1; index < ring.length; index += 1) {
    if (ring[index][0] < ring[anchorIndex][0]) anchorIndex = index;
  }
  let oppositeIndex = anchorIndex;
  let furthestDistance = -1;
  for (let index = 0; index < ring.length; index += 1) {
    const dx = ring[index][0] - ring[anchorIndex][0];
    const dy = ring[index][1] - ring[anchorIndex][1];
    const distance = dx * dx + dy * dy;
    if (distance > furthestDistance) {
      furthestDistance = distance;
      oppositeIndex = index;
    }
  }
  const rotate = (index) => ring[(index + ring.length) % ring.length];
  const first = [];
  for (let index = anchorIndex; index !== oppositeIndex; index = (index + 1) % ring.length) first.push(ring[index]);
  first.push(ring[oppositeIndex]);
  const second = [];
  for (let index = oppositeIndex; index !== anchorIndex; index = (index + 1) % ring.length) second.push(ring[index]);
  second.push(rotate(anchorIndex));
  const epsilonSquared = epsilon * epsilon;
  return [
    ...simplifyOpen(first, epsilonSquared).slice(0, -1),
    ...simplifyOpen(second, epsilonSquared).slice(0, -1),
  ];
};
const polygonArea = (points) => {
  let area = 0;
  for (let index = 0; index < points.length - 1; index += 1) {
    area += points[index][0] * points[index + 1][1] - points[index + 1][0] * points[index][1];
  }
  return area / 2;
};

const loops = [];
while (edgeCount > 0) {
  const start = edges.keys().next().value;
  const points = [point(start)];
  let current = start;
  let guard = 0;
  do {
    const next = takeEdge(current);
    if (next === null) throw new Error(`Open contour at edge ${current}`);
    current = next;
    points.push(point(current));
    guard += 1;
    if (guard > width * height * 2) throw new Error("Contour tracing exceeded safety limit");
  } while (current !== start);
  const collinear = simplifyCollinear(points);
  if (collinear.length >= 4 && Math.abs(polygonArea(collinear)) >= 300) {
    loops.push(simplifyClosed(collinear));
  }
}

const midpoint = (a, b) => [Number(((a[0] + b[0]) / 2).toFixed(2)), Number(((a[1] + b[1]) / 2).toFixed(2))];
const pathData = loops
  .map((loop) => {
    const start = midpoint(loop[loop.length - 1], loop[0]);
    const curves = loop.map((current, index) => {
      const end = midpoint(current, loop[(index + 1) % loop.length]);
      return `Q${current[0]} ${current[1]} ${end[0]} ${end[1]}`;
    });
    return `M${start[0]} ${start[1]}${curves.join("")}Z`;
  })
  .join("");
const iconSize = 1024;
const tileInset = 100;
const tileSize = 824;
const tileRadius = 188;
const sourceCropInset = 72;
const sourceCropSize = width - sourceCropInset * 2;
const scale = Number((tileSize / sourceCropSize).toFixed(8));
const transform = `translate(${tileInset} ${tileInset}) scale(${scale}) translate(-${sourceCropInset} -${sourceCropInset})`;
const title = "  <title id=\"title\">EdgeEver</title>\n  <desc id=\"desc\">An open cat face in near-black on the EdgeEver green rounded tile.</desc>\n";
const sharedPath = `    <path fill=\"#07130b\" fill-rule=\"evenodd\" d=\"${pathData}\" />\n`;
const transformedMark = `  <g transform=\"${transform}\">\n${sharedPath}  </g>\n`;
const iconSvg = `<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 ${iconSize} ${iconSize}\" role=\"img\" aria-labelledby=\"title desc\">\n${title}  <rect x=\"${tileInset}\" y=\"${tileInset}\" width=\"${tileSize}\" height=\"${tileSize}\" rx=\"${tileRadius}\" fill=\"#16a06e\" />\n${transformedMark}</svg>\n`;
const markSvg = `<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 ${iconSize} ${iconSize}\" role=\"img\" aria-label=\"EdgeEver\">\n${transformedMark}</svg>\n`;

await writeFile(iconPath, iconSvg);
await writeFile(markPath, markSvg);
await writeFile(adaptiveMarkPath, markSvg);
console.log(`[trace-brand-icon] traced ${loops.length} contours from ${width}x${height} open-cat concept`);
