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
  // Pre-computed lookup tables for LAB conversion (significant speedup)
  private static sRGBtoLinearLUT: Float32Array | null = null;
  private static linearToSRGBLUT: Float32Array | null = null;

  private static initLookupTables() {
    if (this.sRGBtoLinearLUT !== null) return;

    // Build lookup tables for gamma correction (256 entries)
    this.sRGBtoLinearLUT = new Float32Array(256);
    this.linearToSRGBLUT = new Float32Array(4096); // Higher resolution for reverse

    for (let i = 0; i < 256; i++) {
      const val = i / 255;
      this.sRGBtoLinearLUT[i] = val <= 0.04045
        ? val / 12.92
        : Math.pow((val + 0.055) / 1.055, 2.4);
    }

    for (let i = 0; i < 4096; i++) {
      const val = i / 4095;
      this.linearToSRGBLUT[i] = val <= 0.0031308
        ? 12.92 * val
        : 1.055 * Math.pow(val, 1 / 2.4) - 0.055;
    }
  }

  private static rgbToLab(r: number, g: number, b: number): LAB {
    this.initLookupTables();

    // Use lookup tables instead of computing pow every time
    const rNorm = this.sRGBtoLinearLUT![r];
    const gNorm = this.sRGBtoLinearLUT![g];
    const bNorm = this.sRGBtoLinearLUT![b];

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
    this.initLookupTables();

    let y = (l + 16) / 116;
    let x = a / 500 + y;
    let z = y - b / 200;

    x = 0.95047 * (x * x * x > 0.008856 ? x * x * x : (x - 16 / 116) / 7.787);
    y = 1.0 * (y * y * y > 0.008856 ? y * y * y : (y - 16 / 116) / 7.787);
    z = 1.08883 * (z * z * z > 0.008856 ? z * z * z : (z - 16 / 116) / 7.787);

    let rLin = x * 3.2406 + y * -1.5372 + z * -0.4986;
    let gLin = x * -0.9689 + y * 1.8758 + z * 0.0415;
    let bLin = x * 0.0557 + y * -0.204 + z * 1.057;

    // Clamp before lookup
    rLin = Math.max(0, Math.min(1, rLin));
    gLin = Math.max(0, Math.min(1, gLin));
    bLin = Math.max(0, Math.min(1, bLin));

    const rIdx = Math.floor(rLin * 4095);
    const gIdx = Math.floor(gLin * 4095);
    const bIdx = Math.floor(bLin * 4095);

    return {
      r: Math.max(0, Math.min(255, this.linearToSRGBLUT![rIdx] * 255)),
      g: Math.max(0, Math.min(255, this.linearToSRGBLUT![gIdx] * 255)),
      b: Math.max(0, Math.min(255, this.linearToSRGBLUT![bIdx] * 255)),
    };
  }

  /**
   * Fast box blur - single pass horizontal
   * Used as building block for approximating Gaussian blur
   */
  private static boxBlurHorizontal(
    input: Uint8ClampedArray,
    output: Uint8ClampedArray,
    w: number,
    h: number,
    radius: number
  ): void {
    const size = radius * 2 + 1;
    const divisor = 1 / size;

    for (let y = 0; y < h; y++) {
      const rowStart = y * w * 4;
      let rSum = 0, gSum = 0, bSum = 0;

      // Initialize sum with first radius+1 pixels
      for (let x = 0; x <= radius && x < w; x++) {
        const idx = rowStart + x * 4;
        rSum += input[idx];
        gSum += input[idx + 1];
        bSum += input[idx + 2];
      }

      // Process each pixel using sliding window
      for (let x = 0; x < w; x++) {
        const outIdx = rowStart + x * 4;
        output[outIdx] = rSum * divisor;
        output[outIdx + 1] = gSum * divisor;
        output[outIdx + 2] = bSum * divisor;
        output[outIdx + 3] = input[outIdx + 3];

        // Slide window: remove leftmost, add rightmost
        const leftX = x - radius;
        const rightX = x + radius + 1;

        if (leftX >= 0) {
          const leftIdx = rowStart + leftX * 4;
          rSum -= input[leftIdx];
          gSum -= input[leftIdx + 1];
          bSum -= input[leftIdx + 2];
        }

        if (rightX < w) {
          const rightIdx = rowStart + rightX * 4;
          rSum += input[rightIdx];
          gSum += input[rightIdx + 1];
          bSum += input[rightIdx + 2];
        }
      }
    }
  }

  /**
   * Fast box blur - single pass vertical
   */
  private static boxBlurVertical(
    input: Uint8ClampedArray,
    output: Uint8ClampedArray,
    w: number,
    h: number,
    radius: number
  ): void {
    const size = radius * 2 + 1;
    const divisor = 1 / size;

    for (let x = 0; x < w; x++) {
      const colStart = x * 4;
      let rSum = 0, gSum = 0, bSum = 0;

      // Initialize sum with first radius+1 pixels
      for (let y = 0; y <= radius && y < h; y++) {
        const idx = y * w * 4 + colStart;
        rSum += input[idx];
        gSum += input[idx + 1];
        bSum += input[idx + 2];
      }

      // Process each pixel using sliding window
      for (let y = 0; y < h; y++) {
        const outIdx = y * w * 4 + colStart;
        output[outIdx] = rSum * divisor;
        output[outIdx + 1] = gSum * divisor;
        output[outIdx + 2] = bSum * divisor;
        output[outIdx + 3] = input[outIdx + 3];

        // Slide window: remove topmost, add bottommost
        const topY = y - radius;
        const bottomY = y + radius + 1;

        if (topY >= 0) {
          const topIdx = topY * w * 4 + colStart;
          rSum -= input[topIdx];
          gSum -= input[topIdx + 1];
          bSum -= input[topIdx + 2];
        }

        if (bottomY < h) {
          const bottomIdx = bottomY * w * 4 + colStart;
          rSum += input[bottomIdx];
          gSum += input[bottomIdx + 1];
          bSum += input[bottomIdx + 2];
        }
      }
    }
  }

  /**
   * Approximate Gaussian blur using multiple box blur passes
   * This is MUCH faster for large radii (3-5x faster for radius > 6)
   */
  private static approximateGaussianBlur(imageData: ImageData, radius: number): ImageData {
    const w = imageData.width;
    const h = imageData.height;
    const data = imageData.data;

    // Calculate ideal box blur radius
    // For 3 passes, the relationship between Gaussian sigma and box radius is:
    // boxRadius = sqrt((12 * sigma^2 / n) + 1) / 2 - 0.5
    const sigma = radius / 3;
    const n = 3; // number of passes
    const wIdeal = Math.sqrt((12 * sigma * sigma / n) + 1);
    let boxRadius = Math.floor((wIdeal - 1) / 2);
    if (boxRadius < 1) boxRadius = 1;

    const temp1 = new Uint8ClampedArray(data.length);
    const temp2 = new Uint8ClampedArray(data.length);

    // First pass: horizontal then vertical
    this.boxBlurHorizontal(data, temp1, w, h, boxRadius);
    this.boxBlurVertical(temp1, temp2, w, h, boxRadius);

    // Second pass: horizontal then vertical
    this.boxBlurHorizontal(temp2, temp1, w, h, boxRadius);
    this.boxBlurVertical(temp1, temp2, w, h, boxRadius);

    // Third pass: horizontal then vertical
    this.boxBlurHorizontal(temp2, temp1, w, h, boxRadius);
    this.boxBlurVertical(temp1, temp2, w, h, boxRadius);

    return new ImageData(temp2, w, h);
  }

  static gaussianBlur(imageData: ImageData, radius: number): ImageData {
    // For large radii, use box blur approximation (much faster)
    if (radius > 6) {
      return this.approximateGaussianBlur(imageData, radius);
    }

    // For small radii, use traditional Gaussian blur (more accurate)
    const w = imageData.width;
    const h = imageData.height;
    const data = imageData.data;
    const output = new Uint8ClampedArray(data.length);

    // Pre-compute Gaussian kernel
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

    // Normalize kernel
    for (let i = 0; i < kernel.length; i++) {
      kernel[i] /= kernelSum;
    }

    // Temporary buffer for horizontal pass
    const temp = new Uint8ClampedArray(data.length);

    // Horizontal pass
    for (let y = 0; y < h; y++) {
      const rowStart = y * w * 4;
      for (let x = 0; x < w; x++) {
        let r = 0, g = 0, b = 0;

        for (let k = 0; k < size; k++) {
          const sx = Math.max(0, Math.min(w - 1, x + k - radius));
          const idx = rowStart + sx * 4;
          const weight = kernel[k];
          r += data[idx] * weight;
          g += data[idx + 1] * weight;
          b += data[idx + 2] * weight;
        }

        const outIdx = rowStart + x * 4;
        temp[outIdx] = r;
        temp[outIdx + 1] = g;
        temp[outIdx + 2] = b;
        temp[outIdx + 3] = data[outIdx + 3];
      }
    }

    // Vertical pass
    for (let y = 0; y < h; y++) {
      const rowStart = y * w * 4;
      for (let x = 0; x < w; x++) {
        let r = 0, g = 0, b = 0;

        for (let k = 0; k < size; k++) {
          const sy = Math.max(0, Math.min(h - 1, y + k - radius));
          const idx = sy * w * 4 + x * 4;
          const weight = kernel[k];
          r += temp[idx] * weight;
          g += temp[idx + 1] * weight;
          b += temp[idx + 2] * weight;
        }

        const outIdx = rowStart + x * 4;
        output[outIdx] = r;
        output[outIdx + 1] = g;
        output[outIdx + 2] = b;
        output[outIdx + 3] = temp[outIdx + 3];
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
    const output = new Uint8ClampedArray(data.length);

    // Copy alpha channel and edges
    output.set(data);

    if (mode === "rgb") {
      const center = 1 + 4 * strength;
      const edge = -strength;

      // Process inner pixels only (skip edges)
      for (let y = 1; y < h - 1; y++) {
        const rowStart = y * w * 4;
        const rowAbove = (y - 1) * w * 4;
        const rowBelow = (y + 1) * w * 4;

        for (let x = 1; x < w - 1; x++) {
          const idx = rowStart + x * 4;
          const left = rowStart + (x - 1) * 4;
          const right = rowStart + (x + 1) * 4;
          const up = rowAbove + x * 4;
          const down = rowBelow + x * 4;

          // Process RGB channels together for better cache usage
          for (let c = 0; c < 3; c++) {
            const value =
              data[idx + c] * center +
              data[up + c] * edge +
              data[down + c] * edge +
              data[left + c] * edge +
              data[right + c] * edge;
            output[idx + c] = Math.max(0, Math.min(255, value));
          }
        }
      }
    } else {
      // LAB mode
      const labData = new Float32Array(w * h * 3);

      // Convert RGB to LAB once
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
      const labOutput = new Float32Array(labData.length);

      // Copy edges
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          if (x === 0 || x === w - 1 || y === 0 || y === h - 1) {
            const idx = (y * w + x) * 3;
            labOutput[idx] = labData[idx];
            labOutput[idx + 1] = labData[idx + 1];
            labOutput[idx + 2] = labData[idx + 2];
          }
        }
      }

      // Sharpen only L channel (luminance) for performance
      for (let y = 1; y < h - 1; y++) {
        for (let x = 1; x < w - 1; x++) {
          const idx = (y * w + x) * 3;
          const up = ((y - 1) * w + x) * 3;
          const down = ((y + 1) * w + x) * 3;
          const left = (y * w + (x - 1)) * 3;
          const right = (y * w + (x + 1)) * 3;

          const value =
            labData[idx] * center +
            labData[up] * edge +
            labData[down] * edge +
            labData[left] * edge +
            labData[right] * edge;

          labOutput[idx] = Math.max(0, Math.min(100, value));
          // Copy a and b channels without sharpening
          labOutput[idx + 1] = labData[idx + 1];
          labOutput[idx + 2] = labData[idx + 2];
        }
      }

      // Convert back to RGB
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
