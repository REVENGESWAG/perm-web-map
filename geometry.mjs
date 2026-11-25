export function lineLength(points, distance) {
  return points.slice(1).reduce((total, point, index) => total + distance(points[index], point), 0);
}

// Sum signed spherical triangles so concave polygons also work.
export function polygonArea(points, radius) {
  const radians = Math.PI / 180;
  const vectors = points.map(({ lat, lng }) => {
    const latitude = lat * radians;
    const longitude = lng * radians;
    return [Math.cos(latitude) * Math.cos(longitude), Math.cos(latitude) * Math.sin(longitude), Math.sin(latitude)];
  });
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const [origin] = vectors;
  let sum = 0;
  for (let i = 1; i < vectors.length - 1; i += 1) {
    const a = vectors[i];
    const b = vectors[i + 1];
    const [ax, ay, az] = a.map((value, axis) => value - origin[axis]);
    const [bx, by, bz] = b.map((value, axis) => value - origin[axis]);
    const determinant = dot(origin, [ay * bz - az * by, az * bx - ax * bz, ax * by - ay * bx]);
    sum += 2 * Math.atan2(determinant, 1 + dot(origin, a) + dot(a, b) + dot(b, origin));
  }
  const angle = Math.abs(sum) % (4 * Math.PI);
  return Math.min(angle, 4 * Math.PI - angle) * radius ** 2;
}
