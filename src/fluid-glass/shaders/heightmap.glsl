#define PI 3.1415926538
#define MAX_DROPS 18

uniform int dropCount;
uniform vec2 dropPos[MAX_DROPS];
uniform vec2 dropDirection[MAX_DROPS];
uniform float dropRadius[MAX_DROPS];
uniform float dropAmplitude[MAX_DROPS];
uniform float dropCharge[MAX_DROPS];
uniform float viscosity;
uniform float chargeDecay;

void main() {
  vec2 cell = 1.0 / resolution.xy;
  vec2 uv = gl_FragCoord.xy * cell;
  vec4 state = texture2D(heightmap, uv);

  vec4 north = texture2D(heightmap, uv + vec2(0.0, cell.y));
  vec4 south = texture2D(heightmap, uv - vec2(0.0, cell.y));
  vec4 east = texture2D(heightmap, uv + vec2(cell.x, 0.0));
  vec4 west = texture2D(heightmap, uv - vec2(cell.x, 0.0));

  float nextHeight = ((north.x + south.x + east.x + west.x) * 0.5 - state.y) * viscosity;
  float nextCharge = ((north.z + south.z + east.z + west.z) * 0.5 - state.w) * chargeDecay;
  vec2 world = (uv - 0.5) * vec2(GEOM_WIDTH, GEOM_HEIGHT);

  for (int i = 0; i < MAX_DROPS; i++) {
    if (i >= dropCount) break;

    vec2 axis = normalize(dropDirection[i] + vec2(0.0001, 0.0));
    vec2 normalAxis = vec2(-axis.y, axis.x);
    vec2 delta = world - dropPos[i];
    vec2 stretched = vec2(dot(delta, axis) * 0.62, dot(delta, normalAxis));
    float phase = clamp(length(stretched) * PI / max(dropRadius[i], 1.0), 0.0, PI);
    float influence = (cos(phase) + 1.0) * 0.5;
    influence *= influence;

    nextHeight += influence * dropAmplitude[i];
    nextCharge += influence * dropCharge[i] * 0.5;
  }

  gl_FragColor = vec4(
    clamp(nextHeight, -5.0, 5.0),
    state.x,
    clamp(nextCharge, -1.4, 1.4),
    state.z
  );
}
