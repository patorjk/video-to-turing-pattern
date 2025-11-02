import { ImageData } from '@napi-rs/canvas';

export interface RGB {
  r: number;
  g: number;
  b: number;
}

export interface LAB {
  l: number;
  a: number;
  b: number;
}

export type SharpenMode = "rgb" | "lab";

export class ImageProcessor {
  private static rgbToLab(r: number, g: number, b: number): LAB {
    let rNorm = r / 255;
    let gNorm = g / 255;
    let bNorm = b / 255;

    rNorm =
      rNorm > 0.04045 ? Math.pow((rNorm + 0.055) / 1.055, 2.4) : rNorm / 12.92;
    gNorm =
      gNorm > 0.04045 ? Math.pow((gNorm + 0.055) / 1.055, 2.4) : gNorm / 12.92;
    bNorm =
      bNorm > 0.04045 ? Math.pow((bNorm + 0.055) / 1.055, 2.4) : bNorm / 12.92;

    let x = (rNorm * 0.4124 + gNorm * 0.3576 + bNorm * 0.1805) / 0.95047;
    let y = (rNorm * 0.2126 + gNorm * 0.7152 + bNorm * 0.0722) / 1.0;
    let z = (rNorm * 0.0193 + gNorm * 0.1192 + bNorm * 0.9505) / 1.08883;

    x = x > 0.008856 ? Math.pow(x, 1 / 3) : 7.787 * x + 16 / 116;
    y = y > 0.008856 ? Math.pow(y, 1 / 3) : 7.787 * y + 16 / 116;
    z = z > 0.008856 ? Math.pow(z, 1 / 3) : 7.787 * z + 16 / 116;

    return {
      l: 116 * y - 16,
      a: 500 * (x - y),
      b: 200 * (y - z),
    };
  }

  private static labToRgb(l: number, a: number, b: number): RGB {
    let y = (l + 16) / 116;
    let x = a / 500 + y;
    let z = y - b / 200;

    x = 0.95047 * (x * x * x > 0.008856 ? x * x * x : (x - 16 / 116) / 7.787);
    y = 1.0 * (y * y * y > 0.008856 ? y * y * y : (y - 16 / 116) / 7.787);
    z = 1.08883 * (z * z * z > 0.008856 ? z * z * z : (z - 16 / 116) / 7.787);

    let r = x * 3.2406 + y * -1.5372 + z * -0.4986;
    let g = x * -0.9689 + y * 1.8758 + z * 0.0415;
    let bl = x * 0.0557 + y * -0.204 + z * 1.057;

    r = r > 0.0031308 ? 1.055 * Math.pow(r, 1 / 2.4) - 0.055 : 12.92 * r;
    g = g > 0.0031308 ? 1.055 * Math.pow(g, 1 / 2.4) - 0.055 : 12.92 * g;
    bl = bl > 0.0031308 ? 1.055 * Math.pow(bl, 1 / 2.4) - 0.055 : 12.92 * bl;

    return {
      r: Math.max(0, Math.min(255, r * 255)),
      g: Math.max(0, Math.min(255, g * 255)),
      b: Math.max(0, Math.min(255, bl * 255)),
    };
  }

  static gaussianBlur(imageData: ImageData, radius: number): ImageData {
    const w = imageData.width;
    const h = imageData.height;
    const data = imageData.data;
    const output = new Uint8ClampedArray(data);

    const kernel: number[] = [];
    let kernelSum = 0;
    const sigma = radius / 3;
    const size = radius * 2 + 1;

    for (let i = 0; i < size; i++) {
      const x = i - radius;
      const value = Math.exp(-(x * x) / (2 * sigma * sigma));
      kernel.push(value);
      kernelSum += value;
    }

    for (let i = 0; i < kernel.length; i++) {
      kernel[i] /= kernelSum;
    }

    const temp = new Uint8ClampedArray(data.length);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let r = 0,
          g = 0,
          b = 0;
        for (let k = 0; k < size; k++) {
          const sx = Math.max(0, Math.min(w - 1, x + k - radius));
          const idx = (y * w + sx) * 4;
          r += data[idx] * kernel[k];
          g += data[idx + 1] * kernel[k];
          b += data[idx + 2] * kernel[k];
        }
        const idx = (y * w + x) * 4;
        temp[idx] = r;
        temp[idx + 1] = g;
        temp[idx + 2] = b;
        temp[idx + 3] = data[idx + 3];
      }
    }

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let r = 0,
          g = 0,
          b = 0;
        for (let k = 0; k < size; k++) {
          const sy = Math.max(0, Math.min(h - 1, y + k - radius));
          const idx = (sy * w + x) * 4;
          r += temp[idx] * kernel[k];
          g += temp[idx + 1] * kernel[k];
          b += temp[idx + 2] * kernel[k];
        }
        const idx = (y * w + x) * 4;
        output[idx] = r;
        output[idx + 1] = g;
        output[idx + 2] = b;
        output[idx + 3] = temp[idx + 3];
      }
    }

    return new ImageData(output, w, h);
  }

  static sharpenImage(
    imageData: ImageData,
    strength: number,
    mode: SharpenMode,
  ): ImageData {
    const w = imageData.width;
    const h = imageData.height;
    const data = imageData.data;
    const output = new Uint8ClampedArray(data);

    if (mode === "rgb") {
      const center = 1 + 4 * strength;
      const edge = -strength;

      for (let y = 1; y < h - 1; y++) {
        for (let x = 1; x < w - 1; x++) {
          for (let c = 0; c < 3; c++) {
            const idx = (y * w + x) * 4 + c;
            const value =
              data[idx] * center +
              data[((y - 1) * w + x) * 4 + c] * edge +
              data[((y + 1) * w + x) * 4 + c] * edge +
              data[(y * w + (x - 1)) * 4 + c] * edge +
              data[(y * w + (x + 1)) * 4 + c] * edge;
            output[idx] = Math.max(0, Math.min(255, value));
          }
        }
      }
    } else {
      const labData = new Float32Array(w * h * 3);
      for (let i = 0; i < w * h; i++) {
        const r = data[i * 4];
        const g = data[i * 4 + 1];
        const b = data[i * 4 + 2];
        const lab = this.rgbToLab(r, g, b);
        labData[i * 3] = lab.l;
        labData[i * 3 + 1] = lab.a;
        labData[i * 3 + 2] = lab.b;
      }

      const center = 1 + 4 * strength;
      const edge = -strength;
      const labOutput = new Float32Array(labData);

      for (let y = 1; y < h - 1; y++) {
        for (let x = 1; x < w - 1; x++) {
          const idx = (y * w + x) * 3;
          const value =
            labData[idx] * center +
            labData[((y - 1) * w + x) * 3] * edge +
            labData[((y + 1) * w + x) * 3] * edge +
            labData[(y * w + (x - 1)) * 3] * edge +
            labData[(y * w + (x + 1)) * 3] * edge;
          labOutput[idx] = Math.max(0, Math.min(100, value));
        }
      }

      for (let i = 0; i < w * h; i++) {
        const l = labOutput[i * 3];
        const a = labOutput[i * 3 + 1];
        const b = labOutput[i * 3 + 2];
        const rgb = this.labToRgb(l, a, b);
        output[i * 4] = rgb.r;
        output[i * 4 + 1] = rgb.g;
        output[i * 4 + 2] = rgb.b;
      }
    }

    return new ImageData(output, w, h);
  }
}
