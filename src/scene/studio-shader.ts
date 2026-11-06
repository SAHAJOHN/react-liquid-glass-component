import { MAX_SCENE_CLIPS } from './clip-stack'

/**
 * Adapted from liquid-glass-studio f7b28c3 (MIT, Charles Yin 2024).
 * Color conversion helpers: GLSL-Color-Functions (MIT, Adam Lastowka 2022).
 * Full notices are distributed in THIRD_PARTY_NOTICES.md.
 */
export const studioVertexSource = `
attribute vec2 a_position;
uniform vec2 u_viewport;
uniform vec4 u_rect;
varying vec2 v_screen;
void main() {
  v_screen = u_rect.xy + a_position * u_rect.zw;
  vec2 clip = v_screen / u_viewport;
  gl_Position = vec4(clip.x * 2.0 - 1.0, 1.0 - clip.y * 2.0, 0.0, 1.0);
}
`

export const studioSdfSource = `
float studioSdf(vec2 point, vec2 size, float radius, float roundness) {
  vec2 d = abs(point - size * 0.5) - size * 0.5;
  float r = clamp(radius, 0.0, min(size.x, size.y) * 0.5);
  if (r > 0.0 && d.x > -r && d.y > -r) {
    vec2 corner = abs(point - size * 0.5) - size * 0.5 + r;
    float n = max(2.0, roundness);
    return pow(pow(abs(corner.x), n) + pow(abs(corner.y), n), 1.0 / n) - r;
  }
  return min(max(d.x, d.y), 0.0) + length(max(d, 0.0));
}
`

const colorSource = `
// Color space conversions: HSV / sRGB / linear RGB / XYZ / Lab / LCH.
// Pure helper functions (no uniforms) — meant to be '#include'd into a shader
// that already declares '#version' and 'precision'.
// LCH stack from https://github.com/Rachmanin0xFF/GLSL-Color-Functions/blob/main/color-functions.glsl

vec3 hsv2rgb(vec3 c) {
  vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
  vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
  return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}

//                          0.3127/0.3290  1.0  (1.0-0.3127-0.3290)/0.329
const vec3 D65_WHITE = vec3(0.95045592705, 1.0, 1.08905775076);
//                          0.3457/0.3585  1.0  (1.0-0.3457-0.3585)/0.3585
const vec3 D50_WHITE = vec3(0.96429567643, 1.0, 0.82510460251);
vec3 WHITE = D65_WHITE;
const mat3 RGB_TO_XYZ_M = mat3(
  0.4124, 0.3576, 0.1805,
  0.2126, 0.7152, 0.0722,
  0.0193, 0.1192, 0.9505
);
const mat3 XYZ_TO_XYZ50_M = mat3(
   1.0479298208405488  ,  0.022946793341019088, -0.05019222954313557 ,
   0.029627815688159344,  0.990434484573249   , -0.01707382502938514 ,
  -0.009243058152591178,  0.015055144896577895,  0.7518742899580008
);
const mat3 XYZ_TO_RGB_M = mat3(
   3.2406255, -1.537208 , -0.4986286,
  -0.9689307,  1.8757561,  0.0415175,
   0.0557101, -0.2040211,  1.0569959
);
const mat3 XYZ50_TO_XYZ_M = mat3(
   0.9554734527042182  , -0.023098536874261423,  0.0632593086610217  ,
  -0.028369706963208136,  1.0099954580058226  ,  0.021041398966943008,
   0.012314001688319899, -0.020507696433477912,  1.3303659366080753
);
float UNCOMPAND_SRGB(float a) {
  return a > 0.04045
    ? pow((a + 0.055) / 1.055, 2.4)
    : a / 12.92;
}
float COMPAND_RGB(float a) {
  return a <= 0.0031308
    ? 12.92 * a
    : 1.055 * pow(a, 0.41666666666) - 0.055;
}
vec3 RGB_TO_XYZ(vec3 rgb) {
  return WHITE == D65_WHITE
    ? rgb * RGB_TO_XYZ_M
    : rgb * RGB_TO_XYZ_M * XYZ_TO_XYZ50_M;
}
vec3 SRGB_TO_RGB(vec3 srgb) {
  return vec3(UNCOMPAND_SRGB(srgb.x), UNCOMPAND_SRGB(srgb.y), UNCOMPAND_SRGB(srgb.z));
}
vec3 RGB_TO_SRGB(vec3 rgb) {
  return vec3(COMPAND_RGB(rgb.x), COMPAND_RGB(rgb.y), COMPAND_RGB(rgb.z));
}
vec3 SRGB_TO_XYZ(vec3 srgb) {
  return RGB_TO_XYZ(SRGB_TO_RGB(srgb));
}
float XYZ_TO_LAB_F(float x) {
  //          (24/116)^3                         1/(3*(6/29)^2)     4/29
  return x > 0.00885645167
    ? pow(x, 0.333333333)
    : 7.78703703704 * x + 0.13793103448;
}
vec3 XYZ_TO_LAB(vec3 xyz) {
  vec3 xyz_scaled = xyz / WHITE;
  xyz_scaled = vec3(
    XYZ_TO_LAB_F(xyz_scaled.x),
    XYZ_TO_LAB_F(xyz_scaled.y),
    XYZ_TO_LAB_F(xyz_scaled.z)
  );
  return vec3(
    116.0 * xyz_scaled.y - 16.0,
    500.0 * (xyz_scaled.x - xyz_scaled.y),
    200.0 * (xyz_scaled.y - xyz_scaled.z)
  );
}
vec3 SRGB_TO_LAB(vec3 srgb) {
  return XYZ_TO_LAB(SRGB_TO_XYZ(srgb));
}
vec3 LAB_TO_LCH(vec3 Lab) {
  return vec3(Lab.x, sqrt(dot(Lab.yz, Lab.yz)), atan(Lab.z, Lab.y) * 57.2957795131);
}
vec3 SRGB_TO_LCH(vec3 srgb) {
  return LAB_TO_LCH(SRGB_TO_LAB(srgb));
}
vec3 XYZ_TO_RGB(vec3 xyz) {
  return WHITE == D65_WHITE
    ? xyz * XYZ_TO_RGB_M
    : xyz * XYZ50_TO_XYZ_M * XYZ_TO_RGB_M;
}
vec3 XYZ_TO_SRGB(vec3 xyz) {
  return RGB_TO_SRGB(XYZ_TO_RGB(xyz));
}
float LAB_TO_XYZ_F(float x) {
  //                                     3*(6/29)^2         4/29
  return x > 0.206897
    ? x * x * x
    : 0.12841854934 * (x - 0.137931034);
}
vec3 LAB_TO_XYZ(vec3 Lab) {
  float w = (Lab.x + 16.0) / 116.0;
  return WHITE *
  vec3(LAB_TO_XYZ_F(w + Lab.y / 500.0), LAB_TO_XYZ_F(w), LAB_TO_XYZ_F(w - Lab.z / 200.0));
}
vec3 LAB_TO_SRGB(vec3 lab) {
  return XYZ_TO_SRGB(LAB_TO_XYZ(lab));
}
vec3 LCH_TO_LAB(vec3 LCh) {
  return vec3(LCh.x, LCh.y * cos(LCh.z * 0.01745329251), LCh.y * sin(LCh.z * 0.01745329251));
}
vec3 LCH_TO_SRGB(vec3 lch) {
  return LAB_TO_SRGB(LCH_TO_LAB(lch));
}

`

export const studioFragmentSource = `
precision highp float;
uniform sampler2D u_source;
uniform sampler2D u_blurred;
uniform vec2 u_viewport;
uniform vec4 u_lens;
#ifdef STUDIO_CAPACITY
uniform vec4 u_shape;
#else
uniform vec2 u_shape;
#endif
uniform vec4 u_refraction;
uniform vec3 u_fresnel;
uniform vec4 u_glare;
uniform vec2 u_glareDirection;
uniform vec4 u_tint;
uniform vec4 u_shadow;
uniform vec4 u_surfaceInfo;
uniform vec3 u_flags;
uniform vec4 u_clips[${MAX_SCENE_CLIPS}];
uniform vec2 u_clipShapes[${MAX_SCENE_CLIPS}];
varying vec2 v_screen;
#define u_referenceDpr u_surfaceInfo.x
#define u_opacity u_surfaceInfo.y
#define u_magnification u_surfaceInfo.z
#define u_pixelRatio u_surfaceInfo.w
#define u_blurEdge (u_flags.x > 0.5)
#define u_shadowPass (u_flags.y > 0.5)
const float PI = 3.14159265359;
${studioSdfSource}
${colorSource}

float distanceAt(vec2 point) {
  return studioSdf(point - u_lens.xy, u_lens.zw, u_shape.x, u_shape.y);
}
vec2 normalAt(vec2 point) {
  float h = 1.0 / u_referenceDpr;
  vec2 grad = vec2(
    distanceAt(point + vec2(h, 0.0)) - distanceAt(point - vec2(h, 0.0)),
    distanceAt(point + vec2(0.0, h)) - distanceAt(point - vec2(0.0, h))
  ) / (2.0 * h);
  // Reference gradients are taken in physical coordinates from SDF/viewportHeight.
  return vec2(grad.x, -grad.y) * (1.414213562 * 1000.0 / (u_viewport.y * u_referenceDpr));
}
vec2 screenUv(vec2 point) {
  return vec2(point.x / u_viewport.x, 1.0 - point.y / u_viewport.y);
}
vec4 sampleBlurred(vec2 uv) {
#ifdef STUDIO_CAPACITY
  if (u_shape.w < 1.0) {
  float halfTexelY = 0.5 / u_shape.z;
  float activeY = clamp(uv.y, halfTexelY, 1.0 - halfTexelY);
  return texture2D(u_blurred, vec2(uv.x, activeY * u_shape.w));
  }
#endif
  return texture2D(u_blurred, uv);
}
vec3 dispersed(vec2 center, vec2 offset, float mixRate) {
  vec3 factor = vec3(1.0 + 0.02 * u_refraction.w, 1.0, 1.0 - 0.02 * u_refraction.w);
  vec3 sharp = vec3(
    texture2D(u_source, center + offset * factor.r).r,
    texture2D(u_source, center + offset * factor.g).g,
    texture2D(u_source, center + offset * factor.b).b
  );
  vec3 blurred = vec3(
    sampleBlurred(center + offset * factor.r).r,
    sampleBlurred(center + offset * factor.g).g,
    sampleBlurred(center + offset * factor.b).b
  );
  return mix(sharp, blurred, mixRate);
}
float edgeHighlight(float distance, float range, float hardness) {
  if (range <= 0.0) return 0.0;
  float value = 1.0 - distance / 1500.0 * pow(500.0 / range, 2.0) + hardness;
  // The reference's pow(negative, 5) is undefined GLSL; its clamped result is zero.
  return pow(clamp(value, 0.0, 1.0), 5.0);
}
void main() {
  float clipCoverage = u_opacity;
  for (int i = 0; i < ${MAX_SCENE_CLIPS}; i++) {
    if (float(i) < u_flags.z) {
      float clipDistance = studioSdf(v_screen - u_clips[i].xy, u_clips[i].zw, u_clipShapes[i].x, u_clipShapes[i].y);
      float aa = 0.75 / u_pixelRatio;
      clipCoverage *= 1.0 - smoothstep(-aa, aa, clipDistance);
    }
  }
  if (clipCoverage <= 0.0) discard;
  if (u_shadowPass) {
    // Reference user Y is in GL coordinates; CSS Y points down.
    float shadowDistance = distanceAt(v_screen + vec2(-u_shadow.z, u_shadow.w));
    float shadow = exp(-abs(shadowDistance) / u_shadow.x) * 0.6 * u_shadow.y;
    gl_FragColor = vec4(vec3(shadow * clipCoverage), 0.0);
    return;
  }
  float d = distanceAt(v_screen);
  float aa = 0.001 * u_viewport.y;
  float coverage = 1.0 - smoothstep(-aa, aa, d);
  if (coverage <= 0.0) discard;
  float depth = -d;
  float edgeFactor = 0.0;
  if (depth < u_refraction.x) {
    float ratio = 1.0 - depth / u_refraction.x;
    float incident = asin(clamp(ratio * ratio, -1.0, 1.0));
    float transmitted = asin(clamp(sin(incident) / u_refraction.z, -1.0, 1.0));
    edgeFactor = -tan(transmitted - incident);
  }
  vec2 uv = screenUv(v_screen);
  // Optional body lens is an extension. It is exactly zero for the reference defaults.
  vec2 p = v_screen - u_lens.xy - u_lens.zw * 0.5;
  float bodyWeight = smoothstep(0.0, min(u_lens.z, u_lens.w) * 0.2, max(depth, 0.0));
  vec2 body = -p * (1.0 - 1.0 / u_magnification) * bodyWeight;
  body *= max(depth, 0.0) / max(max(depth, 0.0) + length(body), 0.0001);
  vec2 bodyUv = vec2(body.x, -body.y) / u_viewport;
  vec3 color;
  if (edgeFactor <= 0.0) {
    color = sampleBlurred(uv + bodyUv).rgb;
    color = mix(color, u_tint.rgb, u_tint.a * 0.8);
  } else {
    vec2 normal = normalAt(v_screen);
    vec2 offset = -normal * edgeFactor * u_refraction.y * u_referenceDpr * vec2(u_viewport.y / u_viewport.x, 1.0);
    float edgeHeight = depth / u_refraction.x;
    vec3 blurredPixel = dispersed(uv + bodyUv, offset, u_blurEdge ? 1.0 : edgeHeight);
    color = mix(blurredPixel, u_tint.rgb, u_tint.a * 0.8);
    float fresnel = edgeHighlight(depth, u_fresnel.x, u_fresnel.y);
    vec3 fresnelLch = SRGB_TO_LCH(mix(vec3(1.0), u_tint.rgb, u_tint.a * 0.5));
    fresnelLch.x = clamp(fresnelLch.x + 20.0 * fresnel * u_fresnel.z, 0.0, 100.0);
    color = mix(color, LCH_TO_SRGB(fresnelLch), fresnel * u_fresnel.z * 0.7 * length(normal));
    float glareGeometry = edgeHighlight(depth, u_glare.x, u_glare.y);
    vec2 direction = length(normal) > 0.000001 ? normalize(normal) : vec2(1.0, 0.0);
    float angle = atan(direction.y, direction.x);
    if (angle < 0.0) angle += 2.0 * PI;
    angle = (angle - PI / 4.0 + u_glareDirection.y) * 2.0;
    bool farSide = (angle > PI * 1.5 && angle < PI * 3.5) || angle < -PI * 0.5;
    float glareAngle = (0.5 + sin(angle) * 0.5) * (farSide ? 1.2 * u_glareDirection.x : 1.2) * u_glare.z;
    glareAngle = clamp(pow(max(glareAngle, 0.0), 0.1 + u_glare.w * 2.0), 0.0, 1.0);
    vec3 glareLch = SRGB_TO_LCH(mix(blurredPixel, u_tint.rgb, u_tint.a * 0.5));
    glareLch.x = clamp(glareLch.x + 150.0 * glareAngle * glareGeometry, 0.0, 120.0);
    glareLch.y += 30.0 * glareAngle * glareGeometry;
    color = mix(color, LCH_TO_SRGB(glareLch), glareAngle * glareGeometry * length(normal));
  }
  // Blend the optical edge in the shader, before the fixed-point framebuffer
  // clamps wide-gamut LCH highlights, matching the reference's final mix.
  color = mix(texture2D(u_source, uv).rgb, color, coverage);
  gl_FragColor = vec4(color * clipCoverage, clipCoverage);
}
`

export const studioBlurFragmentSource = `
precision highp float;
uniform sampler2D u_source;
uniform sampler2D u_kernelTexture;
uniform bool u_kernelPacked;
uniform vec2 u_viewport;
#ifdef STUDIO_CAPACITY
uniform vec3 u_direction;
#else
uniform vec2 u_direction;
#endif
uniform vec4 u_bounds;
uniform float u_center;
uniform float u_normalization;
uniform int u_count;
varying vec2 v_screen;
vec4 sampleAt(vec2 uv) {
  vec2 sampled = clamp(uv, u_bounds.xy, u_bounds.zw);
#ifdef STUDIO_CAPACITY
  if (u_direction.z < 1.0) sampled.y *= u_direction.z;
#endif
  return texture2D(u_source, sampled);
}
void main() {
  vec2 uv = vec2(v_screen.x / u_viewport.x, 1.0 - v_screen.y / u_viewport.y);
  vec4 value = sampleAt(uv) * u_center;
  for (int i = 0; i < 100; i++) {
    if (i >= u_count) break;
    vec4 encoded = texture2D(u_kernelTexture, vec2((float(i) + 0.5) / 100.0, 0.5));
    vec2 pair = encoded.rg;
    if (u_kernelPacked) {
      pair = vec2(dot(encoded.rg, vec2(256.0, 1.0)) * 200.0 / 257.0,
                  dot(encoded.ba, vec2(256.0, 1.0)) / 257.0);
    }
    value += (sampleAt(uv + u_direction.xy * pair.x) + sampleAt(uv - u_direction.xy * pair.x)) * pair.y;
  }
  gl_FragColor = value * u_normalization;
}
`
