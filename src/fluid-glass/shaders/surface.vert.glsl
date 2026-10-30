uniform sampler2D heightmap;

varying vec2 vUv;
varying vec3 vSurfaceNormal;
varying float vHeight;
varying float vCharge;

void main() {
  vec2 cell = vec2(1.0 / FBO_WIDTH, 1.0 / FBO_HEIGHT);
  float height = texture2D(heightmap, uv).x;
  float leftHeight = texture2D(heightmap, uv - vec2(cell.x, 0.0)).x;
  float rightHeight = texture2D(heightmap, uv + vec2(cell.x, 0.0)).x;
  float downHeight = texture2D(heightmap, uv - vec2(0.0, cell.y)).x;
  float upHeight = texture2D(heightmap, uv + vec2(0.0, cell.y)).x;

  vec2 slope = vec2(leftHeight - rightHeight, downHeight - upHeight);
  vSurfaceNormal = normalize(vec3(slope * 1.7, 0.12));
  vUv = uv;
  vHeight = height;
  vCharge = texture2D(heightmap, uv).z;

  vec3 displaced = position;
  displaced.z += height * 5.0;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(displaced, 1.0);
}
