// Horror post-processing: RenderPass → UnrealBloomPass (Step 9: on the HDR
// buffer, before tone mapping, with a threshold above anything merely lit by
// a wand, so only the emissive things bloom: wand tips, spells, runes, eyes,
// the Hearts) → OutputPass (ACES Filmic tone mapping + sRGB) → one full-screen
// pass for film grain, a tightening vignette, chromatic aberration, a subtle
// permanent lens distortion plus the barrel warp of terror, desaturation (held
// in the Cell), a red flash (capture) and a fade to black.

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

/** Bloom tuning: only HDR-bright pixels (emissive, additive) cross the threshold. */
export const BLOOM = { strength: 0.55, radius: 0.14, threshold: 2.0 }; // above any surface a wand lights; emissives are authored HDR

const HorrorShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uResolution: { value: new THREE.Vector2(1, 1) },
    uGrain: { value: 0.05 },
    uVignette: { value: 0.25 },
    uChroma: { value: 0.0015 },
    uWarp: { value: 0 },
    uDesat: { value: 0 },
    uRed: { value: 0 },
    uBlack: { value: 0 },
    uLens: { value: 0.035 }, // a subtle, permanent lens barrel
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform float uTime, uGrain, uVignette, uChroma, uWarp, uDesat, uRed, uBlack, uLens;
    uniform vec2 uResolution;
    varying vec2 vUv;
    float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main() {
      vec2 c = vUv - 0.5;
      float r2 = dot(c, c);
      vec2 uv = 0.5 + c * (1.0 - uWarp * 0.18 + uWarp * r2 * 0.9) * (1.0 - uLens * 0.5 + uLens * r2 * 2.0);
      vec2 off = c * uChroma * (1.0 + r2 * 4.0);
      vec3 col = vec3(
        texture2D(tDiffuse, uv + off).r,
        texture2D(tDiffuse, uv).g,
        texture2D(tDiffuse, uv - off).b);
      float l = dot(col, vec3(0.299, 0.587, 0.114));
      col = mix(col, vec3(l), uDesat);
      col = mix(col, vec3(l * 1.6 + 0.08, l * 0.25, l * 0.22), uRed);
      float d = length(c * vec2(uResolution.x / uResolution.y, 1.0)) * 0.95;
      float inner = mix(0.42, 0.08, uVignette);
      float outer = mix(0.95, 0.55, uVignette);
      col *= 1.0 - smoothstep(inner, outer, d) * 0.97;
      vec2 px = floor(vUv * uResolution / 1.5);
      float n = hash(px + fract(uTime * 37.0) * 91.7) - 0.5;
      col += n * uGrain * (0.6 + l);
      col *= 1.0 - uBlack;
      gl_FragColor = vec4(col, 1.0);
    }`,
};

export class PostFX {
  constructor(renderer, scene, camera) {
    this.renderer = renderer;
    this.composer = new EffectComposer(renderer);
    this.composer.addPass(new RenderPass(scene, camera));
    // Half-resolution bloom: plenty for a glow, cheap enough for 60+ fps.
    const size = renderer.getSize(new THREE.Vector2());
    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x / 2, size.y / 2), BLOOM.strength, BLOOM.radius, BLOOM.threshold);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.pass = new ShaderPass(HorrorShader);
    this.composer.addPass(this.pass);
    this.u = this.pass.uniforms;
    this.resize();
  }

  resize() {
    const size = this.renderer.getSize(new THREE.Vector2());
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
    this.composer.setSize(size.x, size.y);
    this.bloom?.setSize(size.x / 2, size.y / 2);
    this.u.uResolution.value.set(size.x * this.renderer.getPixelRatio(), size.y * this.renderer.getPixelRatio());
  }

  /** Smoothly approach target values: { grain, vignette, chroma, warp, desat, red, black }. */
  set(params, dt) {
    const k = Math.min(1, dt * 6);
    for (const [key, v] of Object.entries(params)) {
      const u = this.u[`u${key[0].toUpperCase()}${key.slice(1)}`];
      if (u) u.value += (v - u.value) * (key === 'red' || key === 'chroma' || key === 'black' ? Math.min(1, dt * 14) : k);
    }
  }

  render(time) {
    this.u.uTime.value = time;
    this.composer.render();
  }

  dispose() { this.composer.dispose(); }
}
