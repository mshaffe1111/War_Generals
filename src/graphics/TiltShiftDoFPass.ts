import * as THREE from 'three';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';

/**
 * Tabletop Tilt-Shift Depth of Field Pass:
 * Strictly enforces `edge0 < edge1` in GLSL `smoothstep` so the focus band `[0.06..0.82]`
 * stays 100% sharp (`coc = 0.0`) while only the distant upper tent backdrop softens!
 */
export function createTabletopTiltShiftPass(): ShaderPass {
  const shader = {
    uniforms: {
      tDiffuse: { value: null },
      uResolution: { value: new THREE.Vector2(412, 915) },
      uStrength: { value: 1.0 },
      uFocusBand: { value: new THREE.Vector2(0.06, 0.82) },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D tDiffuse;
      uniform vec2 uResolution;
      uniform float uStrength;
      uniform vec2 uFocusBand;
      varying vec2 vUv;

      void main() {
        float topEdge0 = min(uFocusBand.y, 0.985);
        float topBlur = smoothstep(topEdge0, 0.995, vUv.y);
        float botEdge1 = max(uFocusBand.x, 0.015);
        float botBlur = (1.0 - smoothstep(0.0, botEdge1, vUv.y)) * 0.25;
        float coc = clamp(max(topBlur, botBlur) * uStrength, 0.0, 1.0);

        if (coc < 0.02) {
          gl_FragColor = texture2D(tDiffuse, vUv);
          return;
        }

        vec2 texel = (1.0 / uResolution) * (coc * 2.8);
        vec4 sum = texture2D(tDiffuse, vUv) * 0.227027;
        sum += texture2D(tDiffuse, vUv + vec2(texel.x * 1.38, texel.y * 0.6)) * 0.194594;
        sum += texture2D(tDiffuse, vUv - vec2(texel.x * 1.38, texel.y * 0.6)) * 0.194594;
        sum += texture2D(tDiffuse, vUv + vec2(-texel.x * 0.6, texel.y * 1.38)) * 0.191892;
        sum += texture2D(tDiffuse, vUv - vec2(-texel.x * 0.6, texel.y * 1.38)) * 0.191892;
        gl_FragColor = sum;
      }
    `,
  };

  return new ShaderPass(shader);
}
