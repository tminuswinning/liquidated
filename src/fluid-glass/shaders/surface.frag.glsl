uniform float time;
uniform float dominance;
uniform float impulse;
uniform vec2 viewport;

varying vec2 vUv;
varying vec3 vSurfaceNormal;
varying float vHeight;
varying float vCharge;

float hash21(vec2 point) {
  point = fract(point * vec2(123.34, 456.21));
  point += dot(point, point + 45.32);
  return fract(point.x * point.y);
}

float noise21(vec2 point) {
  vec2 index = floor(point);
  vec2 fraction = fract(point);
  fraction = fraction * fraction * (3.0 - 2.0 * fraction);

  float a = hash21(index);
  float b = hash21(index + vec2(1.0, 0.0));
  float c = hash21(index + vec2(0.0, 1.0));
  float d = hash21(index + vec2(1.0, 1.0));
  return mix(mix(a, b, fraction.x), mix(c, d, fraction.x), fraction.y);
}

float fbm(vec2 point) {
  float value = 0.0;
  float amplitude = 0.56;
  mat2 rotation = mat2(0.82, -0.57, 0.57, 0.82);
  for (int octave = 0; octave < 4; octave++) {
    value += noise21(point) * amplitude;
    point = rotation * point * 2.03 + 7.19;
    amplitude *= 0.48;
  }
  return value;
}

vec3 stormField(vec2 uv) {
  float aspect = viewport.x / max(viewport.y, 1.0);
  vec2 point = (uv - 0.5) * vec2(aspect, 1.0);
  point += vec2(time * 0.012, -time * 0.006);

  float broad = fbm(point * 1.42 + vec2(-1.7, 2.1));
  float folded = 1.0 - abs(fbm(point * 3.15 - vec2(time * 0.008, 1.4)) * 2.0 - 1.0);
  float cloud = smoothstep(0.24, 0.94, broad * 0.76 + folded * 0.38);
  float darkPocket = smoothstep(0.42, 0.92, fbm(point * 2.4 + vec2(4.8, -2.2)));
  float horizon = exp(-pow((uv.y - 0.54) * 3.2, 2.0));

  vec3 black = vec3(0.006, 0.008, 0.011);
  vec3 graphite = vec3(0.075, 0.083, 0.09);
  vec3 silver = vec3(0.48, 0.5, 0.51);
  vec3 color = mix(black, graphite, cloud);
  color = mix(color, silver, pow(cloud, 3.0) * (0.28 + horizon * 0.36));
  color *= 1.0 - darkPocket * 0.58;
  return color;
}

vec3 spectral(float phase) {
  return 0.5 + 0.5 * cos(phase + vec3(0.0, 2.08, 4.16));
}

void main() {
  vec3 normal = normalize(vSurfaceNormal);
  float slope = clamp(length(normal.xy), 0.0, 1.0);
  float heightEnergy = smoothstep(0.02, 1.8, abs(vHeight));
  float fresnel = pow(1.0 - clamp(normal.z, 0.0, 1.0), 2.1);
  float body = smoothstep(0.025, 0.38, slope * 0.9 + heightEnergy * 0.58);

  vec2 refraction = normal.xy * (0.038 + slope * 0.095 + impulse * 0.012);
  vec3 background = stormField(vUv);
  vec3 refracted = stormField(clamp(vUv + refraction, vec2(0.002), vec2(0.998)));

  float filmPhase = vHeight * 2.8 + slope * 11.0 + vUv.x * 2.2 - vUv.y * 1.4 + time * 0.16;
  vec3 film = spectral(filmPhase);
  float filmAmount = clamp(fresnel * 0.84 + slope * 0.28, 0.0, 0.78);

  vec3 lightDirection = normalize(vec3(-0.36, 0.62, 0.92));
  vec3 rimDirection = normalize(vec3(0.72, -0.28, 0.64));
  float key = pow(max(dot(normal, lightDirection), 0.0), 54.0);
  float rim = pow(max(dot(normal, rimDirection), 0.0), 92.0);
  float whiteEdge = smoothstep(0.43, 0.94, fresnel + slope * 0.36);

  vec3 glass = mix(refracted * 0.72, refracted * 1.2 + vec3(0.035), 0.48 + fresnel * 0.34);
  glass += film * filmAmount * (0.18 + impulse * 0.09);
  glass += vec3(0.92, 0.96, 1.0) * (key * 1.35 + rim * 0.8 + whiteEdge * 0.22);

  vec3 buyTint = vec3(0.18, 0.74, 0.62);
  vec3 sellTint = vec3(0.93, 0.35, 0.16);
  float signedCharge = clamp(vCharge, -1.0, 1.0);
  vec3 tradeTint = signedCharge >= 0.0 ? buyTint : sellTint;
  glass = mix(glass, glass + tradeTint * abs(signedCharge) * 0.34, body * 0.72);

  vec3 dominanceTint = dominance >= 0.0 ? buyTint : sellTint;
  background += dominanceTint * abs(dominance) * 0.028;

  float liquidPresence = clamp(body * 0.83 + fresnel * 0.55, 0.0, 1.0);
  vec3 color = mix(background, glass, liquidPresence);

  float vignette = smoothstep(1.2, 0.22, length((vUv - 0.5) * vec2(viewport.x / max(viewport.y, 1.0), 1.0)));
  color *= 0.68 + vignette * 0.46;
  color = color / (color + vec3(0.72));

  gl_FragColor = vec4(color, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
